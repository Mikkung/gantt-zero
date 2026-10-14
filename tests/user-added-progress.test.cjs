const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const XLSX = require('xlsx');

function loadTs(filename, overrides = {}, cache = new Map()) {
  const resolved = path.resolve(filename);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const mod = new Module(resolved, module);
  mod.filename = resolved;
  mod.paths = module.paths;
  cache.set(resolved, mod);
  mod.require = name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('.')) {
      const target = path.resolve(path.dirname(resolved), name);
      for (const extension of ['.ts', '.tsx']) {
        if (fs.existsSync(target + extension)) return loadTs(target + extension, overrides, cache);
      }
    }
    return require(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, resolved);
  return mod.exports;
}

const profile = { id: 'staff-id', display_name: 'Staff A', role: 'user', team_id: null };
const parent = { id: 'parent-id', name: 'AS parent', task_source: 'as_original', counts_toward_assessment: true, include_in_ai_summary: true, weight: 25, progress: 20, assignee: 'Staff A', work_type: 'routine', start_date: '2026-10-12' };
const child = (id, progress, userAddedWeight) => ({ ...parent, id, name: id, parent_id: parent.id, task_source: 'user_added', weight: 0, counts_toward_assessment: false, progress, user_added_weight: userAddedWeight, user_added_weight_is_manual: true });
const progress = loadTs('utils/userAddedProgress.ts');

test('50/50 progress rollup displays 50% while preserving all official assessment inputs', () => {
  const first = child('first', 100, 50);
  const second = child('second', 0, 50);
  const tasks = [parent, first, second];
  const original = JSON.stringify(tasks);
  const tracking = progress.calculateTrackingProgressMetrics(tasks);
  assert.equal(tracking[parent.id].calculatedProgress, 50);
  assert.equal(tracking[parent.id].displayWeight, 25);
  const originalOnly = progress.calculateTrackingProgressMetrics([parent], tasks);
  assert.equal(originalOnly[parent.id].calculatedProgress, 50);
  assert.equal(originalOnly[parent.id].displayWeight, 25);
  const official = loadTs('utils/taskProgress.ts');
  const assessment = loadTs('utils/assessment.ts');
  const scoring = loadTs('utils/scoring.ts');
  const changed = [parent, { ...first, user_added_weight: 10 }, { ...second, user_added_weight: 90 }];
  assert.equal(progress.calculateTrackingProgressMetrics(changed)[parent.id].displayProgress, 10);
  assert.deepEqual(official.calculateTaskProgressMetrics(tasks), official.calculateTaskProgressMetrics(changed));
  assert.deepEqual(official.getEffectiveEvaluableTasks(tasks), [parent]);
  const snapshots = assessment.createAssessmentTaskSnapshots('period', profile.display_name, tasks);
  assert.deepEqual(snapshots, assessment.createAssessmentTaskSnapshots('period', profile.display_name, changed));
  assert.equal(snapshots[0].weight, 25);
  assert.equal(snapshots[0].calculated_progress, null);
  assert.equal(Object.hasOwn(snapshots[0], 'user_added_weight'), false);
  const settings = { workload_factor: 0.7, score_level_values: scoring.DEFAULT_SCORE_LEVEL_VALUES };
  const answers = [{ task_id: parent.id, self_progress_score: 4 }];
  assert.equal(scoring.calculateTotalWorkloadContribution(answers, tasks, settings), scoring.calculateTotalWorkloadContribution(answers, changed, settings));
  assert.equal(tracking[parent.id].weightedContribution, official.calculateTaskProgressMetrics(tasks)[parent.id].weightedContribution);
  assert.equal(JSON.stringify(tasks), original);
});

test('rollup ignores other sources and duplicates; handles zero weights and warns on non-100 total', () => {
  const zero = [parent, child('zero', 100, 0), child('missing', 0, undefined)];
  assert.equal(progress.getUserAddedProgressRollup(parent, zero).calculatedProgress, null);
  assert.equal(progress.calculateTrackingProgressMetrics(zero)[parent.id].displayProgress, 20);
  assert.match(progress.getUserAddedWeightWarning(progress.getUserAddedProgressRollup(parent, zero)), /0%/);
  const added = child('one', 100, 40);
  const ignored = { ...child('admin', 0, 100), task_source: 'admin_added' };
  const rollup = progress.getUserAddedProgressRollup(parent, [parent, added, added, ignored]);
  assert.equal(rollup.totalWeight, 40);
  assert.equal(rollup.calculatedProgress, 100);
  assert.match(progress.getUserAddedWeightWarning(rollup), /40%/);
  assert.equal(progress.getUserAddedWeightWarning({ childCount: 2, totalWeight: 100, calculatedProgress: 50 }), null);
  assert.equal(progress.getUserAddedProgressRollup(added, [added, child('child', 40, 50)]).calculatedProgress, null);
  for (const value of [-1, 101, 'abc', '50%', Infinity, NaN, true, []]) assert.ok(progress.parseUserAddedWeight(value).error);
  for (const [value, expected] of [[0, 0], [100, 100], ['50.5', 50.5], ['', 0], [null, 0]]) assert.equal(progress.parseUserAddedWeight(value).value, expected);
});

test('progress-only weight warnings tolerate rounding, including both boundaries', () => {
  assert.equal(progress.USER_ADDED_WEIGHT_TOTAL_TARGET, 100);
  assert.equal(progress.USER_ADDED_WEIGHT_TOTAL_TOLERANCE, 0.1);
  for (const total of [99.9, 99.99, 100, 100.02, 100.05, 100.1]) {
    const tasks = [parent, child('first', 100, total / 2), child('second', 0, total / 2)];
    const rollup = progress.getUserAddedProgressRollup(parent, tasks);
    assert.equal(progress.isUserAddedWeightTotalBalanced(rollup.totalWeight), true, `total ${total}`);
    assert.equal(progress.getUserAddedWeightWarning(rollup), null, `total ${total}`);
    assert.equal(rollup.totalWeight, total, 'warning tolerance must not alter actual weights or progress calculations');
  }
  const boundary = progress.getUserAddedProgressRollup(parent, [parent,
    child('a', 0, 33.3), child('b', 0, 33.3), child('c', 0, 33.3)]);
  assert.equal(progress.getUserAddedWeightWarning(boundary), null);
  for (const total of [0, 50, 80, 120, 99.89, 100.11]) {
    const rollup = progress.getUserAddedProgressRollup(parent,
      [parent, child('first', 100, total / 2), child('second', 0, total / 2)]);
    assert.equal(progress.isUserAddedWeightTotalBalanced(rollup.totalWeight), false, `total ${total}`);
    assert.match(progress.getUserAddedWeightWarning(rollup), new RegExp(`= ${total}%`));
  }
  assert.match(progress.getUserAddedWeightWarning({ childCount: 1, totalWeight: 79.876543, calculatedProgress: 20 }), /= 79\.88%/);
  assert.equal(progress.getUserAddedWeightWarning({ childCount: 0, totalWeight: 0, calculatedProgress: null }), null);
});

// Exercise the real components' form/download/import handlers with controlled hooks.
function componentHarness(filename, initialProps, client = {}, overrides = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let props = initialProps;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
    },
    useMemo(fn) { cursor++; return fn(); },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) {
        slots[index] = { deps };
        effects.push(fn);
      }
    },
  };
  const Component = loadTs(filename, { react: { ...require('react'), ...hooks }, '../utils/supabase': { supabase: client }, './supabase': { supabase: client }, ...overrides }).default;
  return {
    render(nextProps = props) {
      props = nextProps;
      for (let i = 0; i < 10; i++) {
        cursor = 0;
        const tree = Component(props);
        if (!effects.length) return tree;
        const pending = effects;
        effects = [];
        pending.forEach(effect => effect());
      }
      throw new Error('Component effects did not settle');
    },
  };
}
function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
function textOf(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  if (Array.isArray(tree)) return tree.map(textOf).join('');
  return textOf(tree.props?.children);
}
const button = (tree, label) => elements(tree).find(item => item.type === 'button' && textOf(item) === label);

test('TaskModal switches weight fields and saves only safe user-added values', () => {
  const saved = [];
  const props = { isOpen: true, task: child('edit', 40, 50), allTasks: [parent], currentUser: profile, onSave: row => saved.push(row), onClose() {}, onDelete() {} };
  const harness = componentHarness('components/TaskModal.tsx', props);
  let tree = harness.render();
  assert.ok(elements(tree).some(item => item.props?.id === 'user-added-weight'));
  assert.equal(textOf(tree).includes('Official weight /'), false);
  button(tree, 'Save changes').props.onClick();
  assert.equal(saved[0].user_added_weight, 50);
  assert.equal(saved[0].weight, 0);
  assert.equal(saved[0].counts_toward_assessment, false);
  assert.equal(saved[0].include_in_ai_summary, true);
  assert.equal(saved[0].parent_id, parent.id);
  tree = harness.render({ ...props, task: parent });
  assert.ok(textOf(tree).includes('Official weight /'));
  assert.equal(elements(tree).some(item => item.props?.id === 'user-added-weight'), false);
  const create = componentHarness('components/TaskModal.tsx', { ...props, task: null, fixedParentTask: parent });
  assert.ok(elements(create.render()).some(item => item.props?.id === 'user-added-weight'));
});

test('SQL-loaded weight 50 edits to 60 in modal with source and parent preserved', () => {
  const saved = [];
  for (const role of ['user', 'admin']) {
    const props = { isOpen: true, task: child('edit', 40, 50), allTasks: [parent], currentUser: { ...profile, role }, onSave: row => saved.push(row), onClose() {}, onDelete() {} };
    const harness = componentHarness('components/TaskModal.tsx', props);
    let tree = harness.render();
    const input = elements(tree).find(item => item.props?.id === 'user-added-weight');
    assert.equal(input.props.value, 50);
    assert.equal(textOf(tree).includes('Official weight /'), false);
    assert.equal(elements(tree).some(item => item.type === 'select' && item.props.value === parent.id), false);
    input.props.onChange({ target: { value: '60' } });
    tree = harness.render();
    button(tree, 'Save changes').props.onClick();
    const row = saved.at(-1);
    assert.equal(row.user_added_weight, 60);
    assert.equal(row.weight, 0);
    assert.equal(row.task_source, 'user_added');
    assert.equal(row.counts_toward_assessment, false);
    assert.equal(row.include_in_ai_summary, true);
    assert.equal(row.parent_id, parent.id);
  }
});

test('tracking displays use user-added weight rather than official zero', () => {
  const row = child('display', 50, 50);
  assert.deepEqual(progress.getTrackingWeightDisplay(row), { value: 50, label: 'น้ำหนักย่อย (progress only)', isProgressOnly: true });
  assert.equal(progress.getTrackingWeightDisplay({ ...row, user_added_weight: null }).value, 0);
  assert.equal(progress.getTrackingWeightDisplay({ ...parent, user_added_weight: 90 }).value, 25);
  assert.equal(progress.getTrackingWeightDisplay(parent).isProgressOnly, false);
});

test('new child defaults to auto; editing the suggestion marks the saved weight manual', () => {
  const saved = [];
  const autoSibling = { ...child('first-auto', 100, 100), user_added_weight_is_manual: false, created_at: '2026-10-14' };
  const props = { isOpen: true, task: null, fixedParentTask: parent, allTasks: [parent, autoSibling], currentUser: profile, onSave: row => saved.push(row), onClose() {}, onDelete() {} };
  const harness = componentHarness('components/TaskModal.tsx', props);
  let tree = harness.render();
  let input = elements(tree).find(item => item.props?.id === 'user-added-weight');
  assert.equal(input.props.value, 50);
  const nameInput = elements(tree).find(item => item.type === 'input' && item.props.placeholder === 'e.g. Prepare weekly report');
  nameInput.props.onChange({ target: { value: 'New child' } });
  tree = harness.render();
  button(tree, 'Create task').props.onClick();
  assert.equal(saved[0].user_added_weight, 50);
  assert.equal(saved[0].user_added_weight_is_manual, false);
  input = elements(tree).find(item => item.props?.id === 'user-added-weight');
  input.props.onChange({ target: { value: '70' } });
  tree = harness.render();
  button(tree, 'Create task').props.onClick();
  assert.equal(saved[1].user_added_weight, 70);
  assert.equal(saved[1].user_added_weight_is_manual, true);
  assert.equal(saved[1].weight, 0);
});

test('Auto balance action resets manual mode and reloads the suggested weight', async () => {
  const originalConfirm = global.confirm;
  global.confirm = () => true;
  try {
    const manualTask = child('manual', 50, 70);
    const balanced = [{ ...manualTask, user_added_weight: 50, user_added_weight_is_manual: false }, { ...child('auto', 0, 50), user_added_weight_is_manual: false }];
    let calls = 0;
    const saved = [];
    const props = { isOpen: true, task: manualTask, allTasks: [parent, manualTask, balanced[1]], currentUser: profile, onSave: row => saved.push(row), onClose() {}, onDelete() {}, onAutoBalance: async (chosen, reset) => { assert.equal(chosen.id, parent.id); assert.equal(reset, true); calls++; return balanced; } };
    const harness = componentHarness('components/TaskModal.tsx', props);
    await button(harness.render(), 'รีเซ็ตน้ำหนักย่อยทุกงานเป็น Auto').props.onClick();
    const tree = harness.render({ ...props, allTasks: [parent, ...balanced] });
    assert.equal(calls, 1);
    assert.equal(elements(tree).find(item => item.props?.id === 'user-added-weight').props.value, 50);
    button(tree, 'Save changes').props.onClick();
    assert.equal(saved[0].user_added_weight_is_manual, false);
    assert.equal(saved[0].user_added_weight, 50);
  } finally { global.confirm = originalConfirm; }
});

test('Auto balance preserves manual mode, unsaved form content and is available on the AS parent', async () => {
  const manual = child('manual', 50, 70);
  const auto = { ...child('auto', 0, 0), user_added_weight_is_manual: false };
  const saved = [];
  const calls = [];
  const props = { isOpen: true, task: manual, allTasks: [parent, manual, auto], currentUser: profile,
    onSave: row => saved.push(row), onClose() {}, onDelete() {},
    onAutoBalance: async (chosen, reset) => {
      calls.push([chosen.id, reset]);
      return [manual, { ...auto, user_added_weight: 30 }];
    } };
  const harness = componentHarness('components/TaskModal.tsx', props);
  let tree = harness.render();
  const name = elements(tree).find(item => item.type === 'input' && item.props.placeholder === 'e.g. Prepare weekly report');
  name.props.onChange({ target: { value: 'Unsaved task name' } });
  await button(harness.render(), 'Auto balance น้ำหนักย่อย').props.onClick();
  tree = harness.render();
  assert.deepEqual(calls, [[parent.id, false]]);
  assert.equal(elements(tree).find(item => item.props?.id === 'user-added-weight').props.value, 70);
  button(tree, 'Save changes').props.onClick();
  assert.equal(saved[0].user_added_weight_is_manual, true);
  assert.equal(saved[0].name, 'Unsaved task name');
  const originalModal = componentHarness('components/TaskModal.tsx', { ...props, task: parent });
  assert.ok(button(originalModal.render(), 'Auto balance น้ำหนักย่อย'));
  const foreign = componentHarness('components/TaskModal.tsx', { ...props, currentUser: { ...profile, display_name: 'Other staff' } });
  assert.equal(button(foreign.render(), 'Auto balance น้ำหนักย่อย'), undefined);
  const manager = componentHarness('components/TaskModal.tsx', { ...props, currentUser: { ...profile, role: 'manager' } });
  assert.equal(button(manager.render(), 'Auto balance น้ำหนักย่อย'), undefined);
});

test('app save/create/delete persists balance calls and replaces state with authoritative sibling rows', async () => {
  const database = [{ ...parent }, child('edit', 40, 50)];
  const queries = [];
  const updates = [];
  const insertedPayloads = [];
  const balanceCalls = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: profile.id, email: 'staff@example.test' } } } }) },
    rpc(name, args) {
      if (name === 'rebalance_user_added_task_weights') {
        assert.equal(args.target_parent_id, parent.id);
        assert.equal(args.reset_manual, false);
        balanceCalls.push(args);
        const allocation = progress.calculateAutoUserAddedWeights(database.filter(row => row.parent_id === parent.id));
        for (const row of database) if (allocation.weights[row.id] !== undefined) row.user_added_weight = allocation.weights[row.id];
        return Promise.resolve({ data: database.filter(row => row.parent_id === parent.id), error: null });
      }
      if (name === 'create_user_added_tasks') {
        insertedPayloads.push(args.task_rows[0]);
        return { async single() {
          const row = { ...args.task_rows[0], id: `db-created-${insertedPayloads.length}` };
          database.push(row);
          return { data: { ...row }, error: null };
        } };
      }
      if (name === 'delete_user_added_task') {
        database.splice(database.findIndex(row => row.id === args.target_task_id), 1);
        return Promise.resolve({ data: null, error: null });
      }
      assert.equal(name, 'update_user_added_task');
      updates.push(args.task_changes);
      return { async single() {
        const index = database.findIndex(row => row.id === args.target_task_id);
        database[index] = { ...database[index], ...args.task_changes };
        return { data: { ...database[index] }, error: null };
      } };
    },
    from(table) {
      let payload;
      let id;
      const query = {
        select(columns) { queries.push({ table, columns }); return this; },
        eq(key, value) { if (key === 'id') id = value; return this; },
        limit() { return this; }, order() { return this; },
        update(row) { payload = row; updates.push(row); return this; },
        async single() {
          const index = database.findIndex(row => row.id === id);
          database[index] = { ...database[index], ...payload };
          return { data: { ...database[index] }, error: null };
        },
        then(resolve) {
          return Promise.resolve({ data: table === 'profiles' ? [profile] : table === 'tasks' ? database.map(row => ({ ...row })) : [], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  function TaskModal() { return null; }
  function GanttChart() { return null; }
  const router = { push() {} };
  const harness = componentHarness('app/page.tsx', {}, client, {
    'next/navigation': { useRouter: () => router },
    '../components/AppShell': { AppShell: () => null },
    '../components/GanttChart': { __esModule: true, default: GanttChart },
    '../components/TaskModal': { __esModule: true, default: TaskModal },
    '../components/AddedTaskBulkImportModal': { __esModule: true, default: () => null },
  });
  let tree;
  for (let i = 0; i < 30; i++) {
    tree = harness.render();
    if (elements(tree).some(item => item.type === GanttChart)) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  const gantt = elements(tree).find(item => item.type === GanttChart);
  assert.ok(gantt);
  // View objects can be incomplete or stale: modal must use the actual loaded row.
  gantt.props.onTaskClick({ id: 'edit', task_source: 'as_original', user_added_weight: 0 });
  tree = harness.render();
  let modal = elements(tree).find(item => item.type === TaskModal);
  assert.equal(modal.props.task.user_added_weight, 50);
  assert.equal(modal.props.task.task_source, 'user_added');
  await modal.props.onSave({ name: 'Updated child', assignee: profile.display_name, user_added_weight: '60', weight: 100, parent_id: null, task_source: 'as_original', counts_toward_assessment: true, include_in_ai_summary: false });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].user_added_weight, 60);
  assert.equal(updates[0].weight, 0);
  assert.equal(updates[0].task_source, 'user_added');
  assert.equal(updates[0].parent_id, parent.id);
  assert.equal(updates[0].counts_toward_assessment, false);
  assert.equal(updates[0].include_in_ai_summary, true);
  tree = harness.render();
  const newGantt = elements(tree).find(item => item.type === GanttChart);
  assert.equal(newGantt.props.tasks.find(row => row.id === 'edit').user_added_weight, 60);
  newGantt.props.onTaskClick({ id: 'edit' });
  modal = elements(harness.render()).find(item => item.type === TaskModal);
  assert.equal(modal.props.task.user_added_weight, 60);
  assert.equal(modal.props.task.user_added_weight_is_manual, true);
  for (let index = 0; index < 2; index++) {
    const chart = elements(harness.render()).find(item => item.type === GanttChart);
    chart.props.onAddSubtask(parent);
    modal = elements(harness.render()).find(item => item.type === TaskModal);
    await modal.props.onSave({ name: `Auto child ${index}`, parent_id: parent.id, user_added_weight: 100, user_added_weight_is_manual: false });
    assert.equal(insertedPayloads[index].user_added_weight, 0);
    assert.equal(insertedPayloads[index].weight, 0);
    assert.equal(insertedPayloads[index].counts_toward_assessment, false);
    assert.equal(insertedPayloads[index].include_in_ai_summary, true);
  }
  const chart = elements(harness.render()).find(item => item.type === GanttChart);
  assert.equal(chart.props.tasks.find(row => row.id === 'edit').user_added_weight, 60);
  assert.equal(chart.props.tasks.find(row => row.id === 'db-created-1').user_added_weight, 20);
  assert.equal(chart.props.tasks.find(row => row.id === 'db-created-2').user_added_weight, 20);
  chart.props.onTaskClick({ id: 'db-created-2' });
  modal = elements(harness.render()).find(item => item.type === TaskModal);
  await modal.props.onDelete('db-created-2');
  const afterDelete = elements(harness.render()).find(item => item.type === GanttChart);
  assert.equal(afterDelete.props.tasks.some(row => row.id === 'db-created-2'), false);
  assert.equal(afterDelete.props.tasks.find(row => row.id === 'db-created-1').user_added_weight, 40);
  assert.equal(afterDelete.props.tasks.find(row => row.id === parent.id).weight, 25);
  assert.equal(balanceCalls.length, 4);
  assert.ok(queries.filter(query => query.table === 'tasks').every(query => query.columns === '*'));
});

test('actual XLSX download contains progress-only weight validation and existing dropdowns', async () => {
  let downloaded;
  const originalDocument = global.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  global.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  URL.createObjectURL = blob => { downloaded = blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    const harness = componentHarness('components/AddedTaskBulkImportModal.tsx', { isOpen: true, initialMode: 'download', tasks: [parent], currentProfile: profile });
    button(harness.render(), 'Select All').props.onClick();
    const tree = harness.render();
    const download = elements(tree).find(item => item.type === 'button' && item.props.onClick?.name === 'handleDownloadTemplate');
    assert.ok(download);
    await download.props.onClick();
    assert.ok(downloaded);
    const JSZip = require('jszip');
    const bytes = await downloaded.arrayBuffer();
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    assert.match(xml, /type="decimal"[^>]*sqref="L2:L201"/);
    assert.match(xml, /<formula1>0<\/formula1><formula2>100<\/formula2>/);
    assert.match(xml, /sqref="A2:A201"/);
    assert.match(xml, /sqref="F2:F201"/);
    const workbook = XLSX.read(bytes, { type: 'array' });
    assert.equal(workbook.Sheets['+ Create Subtask'].L1.v, 'น้ำหนักย่อย (%)');
    assert.equal(workbook.Workbook.Sheets.find(sheet => sheet.name === '_LOOKUP').Hidden, 2);
  } finally { global.document = originalDocument; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test('import rejects invalid weight before insert, preserves old templates, forces protected fields', async () => {
  const originalAlert = global.alert;
  global.alert = () => {};
  try {
    for (const value of [150, 'invalid', 50, 0, undefined]) {
      const inserts = [];
      const balances = [];
      const client = { async rpc(name, args) {
        if (name === 'rebalance_user_added_task_weights') {
          balances.push(args);
          return { data: inserts.map(row => ({ ...row, id: 'saved-child', user_added_weight: row.user_added_weight_is_manual ? row.user_added_weight : 100 })), error: null };
        }
        assert.equal(name, 'create_user_added_tasks');
        inserts.push(...args.task_rows);
        return { data: args.task_rows, error: null };
      }, from() { return {
        select() { return { in: async () => ({ data: [parent], error: null }) }; },
        async insert(rows) { inserts.push(...rows); return { error: null }; },
      }; } };
      const props = { isOpen: true, initialMode: 'import', tasks: [parent], currentProfile: profile, onImported: async () => {}, onClose() {} };
      const harness = componentHarness('components/AddedTaskBulkImportModal.tsx', props, client);
      const workbook = XLSX.utils.book_new();
      const row = { 'เลือกงานหลักจาก AS': 'AS parent', 'งานย่อยที่ต้องการเพิ่ม': 'Imported child', 'ความคืบหน้า %': 100, weight: 99, counts_toward_assessment: true, assignee: 'Another person' };
      if (value !== undefined) row['น้ำหนักย่อย (%)'] = value;
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row]), '+ Create Subtask');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ parent_label: 'AS parent', parent_task_id: parent.id }]), '_SYSTEM_PARENT_MAP');
      const file = { arrayBuffer: async () => XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) };
      const input = elements(harness.render()).find(item => item.type === 'input' && item.props.type === 'file');
      input.props.onChange({ target: { files: [file] } });
      let tree;
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setImmediate(resolve));
        tree = harness.render();
        if (textOf(tree).includes('Errors:')) break;
      }
      assert.ok(textOf(tree).includes('Errors:'));
      const confirm = button(tree, 'Confirm Import');
      if (value === 150 || value === 'invalid') {
        assert.equal(confirm.props.disabled, true);
        assert.match(textOf(tree), /user_added_weight/);
        await confirm.props.onClick();
        assert.equal(inserts.length, 0);
      } else {
        assert.equal(confirm.props.disabled, false);
        await confirm.props.onClick();
        assert.equal(inserts.length, 1);
        assert.equal(inserts[0].user_added_weight, value ?? 0);
        assert.deepEqual(balances, [{ target_parent_id: parent.id, reset_manual: false }]);
        assert.equal(inserts[0].user_added_weight_is_manual, value !== undefined);
        assert.equal(inserts[0].weight, 0);
        assert.equal(inserts[0].task_source, 'user_added');
        assert.equal(inserts[0].counts_toward_assessment, false);
        assert.equal(inserts[0].include_in_ai_summary, true);
        assert.equal(inserts[0].assignee, profile.display_name);
        assert.equal(inserts[0].parent_id, parent.id);
      }
    }
  } finally { global.alert = originalAlert; }
});

const pglitePath = process.env.MONTHLY_REVIEW_PGLITE_PATH;
test('new migration enables owned user-added weights and protects official fields through RLS', { skip: !pglitePath }, async () => {
  const { PGlite } = require(pglitePath);
  const db = new PGlite();
  const admin = '10000000-0000-0000-0000-000000000001';
  const user = '10000000-0000-0000-0000-000000000002';
  const manager = '10000000-0000-0000-0000-000000000003';
  const ownParent = '20000000-0000-0000-0000-000000000001';
  const otherParent = '20000000-0000-0000-0000-000000000002';
  async function login(id) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
    await db.exec('SET ROLE authenticated');
  }
  const insert = (parentId, weight = 50, officialWeight = 0, counts = false, ai = true) => db.query(
    "INSERT INTO tasks(name,assignee,parent_id,task_source,weight,counts_toward_assessment,include_in_ai_summary,user_added_weight) VALUES ('Child','Staff A',$1,'user_added',$2,$3,$4,$5) RETURNING *",
    [parentId, officialWeight, counts, ai, weight],
  );
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY, display_name text, role text);
      INSERT INTO profiles VALUES ('${admin}','Admin','admin'), ('${user}','Staff A','user'), ('${manager}','Manager','manager');
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role='admin' FROM profiles WHERE id=auth.uid() $$;
      CREATE FUNCTION public.is_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role='user' FROM profiles WHERE id=auth.uid() $$;
      CREATE FUNCTION public.current_employee_key() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT display_name FROM profiles WHERE id=auth.uid() $$;
      CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,assignee text,team_id uuid,parent_id uuid REFERENCES tasks(id),task_source text DEFAULT 'as_original',weight numeric DEFAULT 0,progress numeric DEFAULT 0,calculated_progress numeric,counts_toward_assessment boolean DEFAULT true,include_in_ai_summary boolean DEFAULT true);
      INSERT INTO tasks(id,name,assignee,weight,progress) VALUES ('${ownParent}','AS parent','Staff A',25,20),('${otherParent}','Other AS','Staff B',75,0);
      ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      GRANT ALL ON tasks TO authenticated;
      CREATE POLICY tasks_admin ON tasks FOR ALL TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
      CREATE POLICY tasks_user_read ON tasks FOR SELECT TO authenticated USING(assignee=public.current_employee_key());
      CREATE POLICY legacy_permissive_insert ON tasks FOR INSERT TO authenticated WITH CHECK(true);
      CREATE POLICY legacy_permissive_update ON tasks FOR UPDATE TO authenticated USING(true) WITH CHECK(true);
    `);
    const sql = fs.readFileSync('supabase/migrations/20261012000000_add_user_added_progress_weight.sql', 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    await login(user);
    const created = (await insert(ownParent)).rows[0];
    assert.equal(Number(created.user_added_weight), 50);
    await db.query('UPDATE tasks SET user_added_weight=75 WHERE id=$1', [created.id]);
    assert.equal(Number((await db.query('SELECT * FROM tasks WHERE id=$1', [created.id])).rows[0].user_added_weight), 75);
    for (const weight of [-1, 101, 'NaN']) await assert.rejects(insert(ownParent, weight), /check|row-level security/i);
    await assert.rejects(insert(otherParent), /row-level security/i);
    await assert.rejects(insert(null), /check|row-level security/i);
    await assert.rejects(insert(ownParent, 50, 1), /check|row-level security/i);
    await assert.rejects(insert(ownParent, 50, 0, true), /check|row-level security/i);
    await assert.rejects(insert(ownParent, 50, 0, false, false), /check|row-level security/i);
    for (const change of ["weight=99", "counts_toward_assessment=true", "include_in_ai_summary=false", "task_source='as_original'", "assignee='Staff B'"]) {
      await assert.rejects(db.query(`UPDATE tasks SET ${change} WHERE id=$1`, [created.id]), /cannot be changed|row-level security/i);
    }
    await assert.rejects(db.query('UPDATE tasks SET weight=99 WHERE id=$1', [ownParent]), /cannot be changed/i);
    await assert.rejects(db.query('UPDATE tasks SET user_added_weight=10 WHERE id=$1', [ownParent]), /cannot be changed/i);
    await db.query('UPDATE tasks SET progress=30 WHERE id=$1', [ownParent]);
    await login(manager);
    await assert.rejects(insert(ownParent), /authorized|row-level security/i);
    await login(admin);
    await db.query('UPDATE tasks SET weight=30 WHERE id=$1', [ownParent]);
    await assert.rejects(insert(ownParent, 50, 5), /check/i);
    const tasks = (await db.query('SELECT * FROM tasks')).rows;
    assert.equal(Number(tasks.find(task => task.id === otherParent).weight), 75);
    assert.equal(Number(tasks.find(task => task.id === ownParent).weight), 30);
  } finally { await db.close(); }
});
