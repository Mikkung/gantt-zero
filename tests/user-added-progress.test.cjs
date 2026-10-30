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

test('recursive tracking propagates zero-weight AS children and weighted AS siblings', () => {
  const a = { ...parent, id: 'a', progress: 10 };
  const b = { ...parent, id: 'b', parent_id: 'a', progress: 30, weight: 0 };
  const activities = [child('one', 100, 50), child('two', 0, 50)].map(task => ({ ...task, parent_id: 'b' }));
  const tasks = [a, b, ...activities];
  const frozen = JSON.stringify(tasks);
  const metrics = progress.calculateTrackingProgressMetrics(tasks);
  assert.equal(metrics.b.displayProgress, 50);
  assert.equal(metrics.a.displayProgress, 50);
  assert.equal(metrics.a.trackingProgressSource, 'as_children');
  assert.equal(metrics.b.trackingProgressSource, 'user_added');
  assert.equal(JSON.stringify(tasks), frozen);
  const weighted = [a, { ...b, weight: 40 }, { ...parent, id: 'c', parent_id: 'a', weight: 60, progress: 80 }, ...activities];
  assert.equal(progress.calculateTrackingProgressMetrics(weighted).a.displayProgress, 68);
  const zeroSiblings = [a, { ...b, progress: 20 }, { ...b, id: 'c', progress: 80 }];
  assert.equal(progress.calculateTrackingProgressMetrics(zeroSiblings).a.displayProgress, 50);
  assert.equal(progress.calculateTrackingProgressMetrics([a, { ...b, progress: 0 }]).a.displayProgress, 0);
});

test('recursive tracking uses complete context, effective AS weights and AS children before activities', () => {
  const a = { ...parent, id: 'a', progress: 10 };
  const b = { ...parent, id: 'b', parent_id: 'a', weight: 99, progress: 30 };
  const c = { ...parent, id: 'c', parent_id: 'b', weight: 40, progress: 0 };
  const activities = [child('one', 100, 50), child('two', 0, 50)].map(task => ({ ...task, parent_id: 'c' }));
  const supporting = { ...child('supporting', 100, 100), parent_id: 'a' };
  const sibling = { ...parent, id: 'other-as', parent_id: 'a', weight: 60, progress: 80 };
  const context = [a, b, c, sibling, supporting, ...activities];
  const metrics = progress.calculateTrackingProgressMetrics([a, b, c], context);
  assert.equal(metrics.c.displayProgress, 50);
  assert.equal(metrics.b.displayProgress, 50);
  assert.equal(metrics.a.displayProgress, 68, 'B effective official weight is 40, not its recorded 99');
  const parentOnly = progress.calculateTrackingProgressMetrics([a], context);
  assert.deepEqual(Object.keys(parentOnly), ['a']);
  assert.equal(parentOnly.a.displayProgress, 68);
  assert.equal(progress.calculateTrackingProgressMetrics([c, b, a], [...context].reverse()).a.displayProgress, 68);
  const noSibling = context.filter(task => task.id !== 'other-as');
  assert.equal(progress.calculateTrackingProgressMetrics([a], noSibling).a.displayProgress, 50);
  assert.equal(supporting.progress, 100, 'supporting activities stay visible and unchanged, but do not double-count');
});

test('tracking falls back to recorded progress when children are unusable', () => {
  const a = { ...parent, progress: 27 };
  const invalid = { ...parent, id: 'invalid', parent_id: a.id, progress: null, weight: 40 };
  const notFinite = { ...invalid, id: 'not-finite', progress: NaN };
  assert.equal(progress.calculateTrackingProgressMetrics([a, invalid, notFinite])[a.id].displayProgress, 27);
  const added = { ...child('invalid-added', null, 100), parent_id: a.id };
  assert.equal(progress.calculateTrackingProgressMetrics([a, added])[a.id].displayProgress, 27);
  const zero = { ...child('zero', 100, 0), parent_id: a.id };
  assert.equal(progress.calculateTrackingProgressMetrics([a, zero])[a.id].displayProgress, 27);
  const positive = { ...invalid, progress: 60 };
  const zeroWeight = { ...invalid, id: 'no-weight', progress: 100, weight: 0 };
  assert.equal(progress.calculateTrackingProgressMetrics([a, positive, zeroWeight])[a.id].displayProgress, 60);
});

test('tracking handles cycles, missing parents, duplicate IDs and malformed rows without mutating input', () => {
  const a = { ...parent, id: 'a', parent_id: 'b', progress: 15 };
  const b = { ...parent, id: 'b', parent_id: 'a', progress: 80 };
  const self = { ...parent, id: 'self', parent_id: 'self', progress: 45 };
  const orphan = { ...parent, id: 'orphan', parent_id: 'missing', progress: 65 };
  const tasks = [a, b, self, orphan, { ...a, progress: 99 }, { ...parent, id: '' }, { ...parent, id: 'unnamed', name: '' }];
  const before = JSON.stringify(tasks);
  const metrics = progress.calculateTrackingProgressMetrics(tasks);
  assert.deepEqual(Object.keys(metrics), ['a', 'b', 'self', 'orphan']);
  assert.equal(metrics.a.displayProgress, 15);
  assert.equal(metrics.b.displayProgress, 80);
  assert.equal(metrics.self.displayProgress, 45);
  assert.equal(metrics.orphan.displayProgress, 65);
  assert.equal(progress.calculateTrackingProgressMetrics([b, a]).a.displayProgress, 15);
  assert.equal(JSON.stringify(tasks), before);
});

test('recursive tracking preserves official assessment weights, contributions, scores and snapshots', () => {
  const a = { ...parent, id: 'a', weight: 100, progress: 10 };
  const b = { ...parent, id: 'b', parent_id: 'a', weight: 40, progress: 20 };
  const c = { ...parent, id: 'c', parent_id: 'a', weight: 60, progress: 80 };
  const tasks = [a, b, c, ...[child('one', 100, 50), child('two', 0, 50)].map(task => ({ ...task, parent_id: 'b' }))];
  const official = loadTs('utils/taskProgress.ts');
  const assessment = loadTs('utils/assessment.ts');
  const scoring = loadTs('utils/scoring.ts');
  const before = JSON.stringify(tasks);
  const baseline = official.calculateTaskProgressMetrics(tasks);
  const snapshots = assessment.createAssessmentTaskSnapshots('period', profile.display_name, tasks);
  const settings = { workload_factor: 0.7, score_level_values: scoring.DEFAULT_SCORE_LEVEL_VALUES };
  const answers = [{ task_id: 'b', self_progress_score: 4 }, { task_id: 'c', self_progress_score: 3 }];
  const score = scoring.calculateTotalWorkloadContribution(answers, tasks, settings);
  const metrics = progress.calculateTrackingProgressMetrics(tasks);
  assert.equal(metrics.a.displayProgress, 68);
  for (const task of tasks) for (const key of ['weight', 'displayWeight', 'isComputedWeight', 'weightedContribution', 'childCount']) {
    assert.equal(metrics[task.id][key], baseline[task.id][key], `${task.id}.${key}`);
  }
  assert.deepEqual(assessment.createAssessmentTaskSnapshots('period', profile.display_name, tasks), snapshots);
  assert.equal(scoring.calculateTotalWorkloadContribution(answers, tasks, settings), score);
  assert.equal(JSON.stringify(tasks), before);
});

// Exercise the real components' form/download/import handlers with controlled hooks.
function componentHarness(filename, initialProps, client = {}, overrides = {}, componentName = 'default', createRefValue = value => value) {
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
    useMemo(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !deps || deps.some((value, i) => value !== slots[index].deps[i])) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: createRefValue(initial) };
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
  const Component = loadTs(filename, { react: { ...require('react'), ...hooks }, '../utils/supabase': { supabase: client }, '../../utils/supabase': { supabase: client }, './supabase': { supabase: client }, ...overrides })[componentName];
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

test('AS original modal locks visible configuration and submits only operational fields while admin/user-added permissions remain unchanged', () => {
  const { AS_ORIGINAL_EDITABLE_FIELDS, AS_ORIGINAL_LOCK_HELP } = loadTs('utils/asOriginalTaskEditing.ts', { './supabase': { supabase: {} } });
  const saved = []; const task = { ...parent, start_date: null, end_date: null, status: 'To Do', priority: 'Medium', work_type: null, description: 'Scope', progress_summary: 'Legacy note',
    output: 'Report', frequency_count: 2, time_per_occurrence_minutes: 90, team_id: 'team-id', dependencies: 'dependency-id',
    is_recurring: true, recurring_type: 'weekly', recurring_interval: 2, recurring_unit: 'week' };
  const props = { isOpen: true, task, allTasks: [task], currentUser: profile, onSave: value => saved.push(value), onClose() {}, onDelete() {} };
  const harness = componentHarness('components/TaskModal.tsx', props); let tree = harness.render();
  assert.match(textOf(tree), new RegExp(AS_ORIGINAL_LOCK_HELP));
  for (const value of [task.name, task.weight, 90, 'dependency-id', 'team-id', 'weekly']) {
    const input = elements(tree).find(node => node.type === 'input' && node.props.value === value); assert.ok(input, String(value)); assert.equal(input.props.disabled, true, String(value));
  }
  for (const label of ['Assignee', 'Parent task']) assert.equal(elements(tree).find(node => node.props?.['aria-label'] === label).props.disabled, true);
  for (const value of ['', 'as_original']) assert.equal(elements(tree).find(node => node.type === 'select' && node.props.value === value).props.disabled, true);
  for (const node of elements(tree).filter(node => node.type === 'input' && node.props.type === 'checkbox')) assert.equal(node.props.disabled, true);
  assert.equal(elements(tree).find(node => node.type === 'textarea').props.disabled, false);
  for (const node of elements(tree).filter(node => node.type === 'input' && ['date', 'range'].includes(node.props.type))) assert.equal(node.props.disabled, false);
  assert.equal(button(tree, 'Delete'), undefined);
  button(tree, 'Save changes').props.onClick(); assert.equal(saved.length, 1);
  assert.deepEqual(Object.keys(saved[0]).sort(), [...AS_ORIGINAL_EDITABLE_FIELDS].sort());
  assert.equal(saved[0].description, 'Scope\n\nLegacy note'); assert.equal(saved[0].progress_summary, saved[0].description);
  for (const key of ['id','name','weight','work_type','time_per_occurrence_minutes','assignee','parent_id','team_id','dependencies','is_recurring','task_source']) assert.equal(Object.hasOwn(saved[0], key), false, key);
  const admin = componentHarness('components/TaskModal.tsx', { ...props, task: { ...task, work_type: 'routine', start_date: parent.start_date }, currentUser: { ...profile, role: 'admin' } });
  tree = admin.render(); assert.equal(elements(tree).find(node => node.type === 'input' && node.props.value === task.name).props.disabled, false);
  assert.equal(elements(tree).find(node => node.type === 'input' && node.props.value === 90).props.disabled, false);
  const added = componentHarness('components/TaskModal.tsx', { ...props, task: child('support', 25, 50) });
  tree = added.render(); assert.equal(elements(tree).find(node => node.type === 'input' && node.props.value === 'support').props.disabled, false);
  for (const currentUser of [{ ...profile, role: 'manager' }, { ...profile, display_name: 'Other employee' }]) {
    const readonly = componentHarness('components/TaskModal.tsx', { ...props, currentUser, canEdit: true }); tree = readonly.render();
    assert.equal(elements(tree).find(node => node.type === 'textarea').props.disabled, true); assert.equal(button(tree, 'View only').props.disabled, true);
  }
});

test('AS original app save uses an explicit RPC payload and refuses null/wrong/zero-row responses without closing the modal', async () => {
  const previous = global.alert; const alerts = []; global.alert = message => alerts.push(message);
  const task = { ...parent }; let response; const calls = [];
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: profile.id, email: 'staff@example.test' } } } }) },
    rpc(name, args) { calls.push({ name, args }); return { single: async () => response }; },
    from(table) { return { select() { return this; }, eq() { return this; }, limit() { return this; }, order() { return this; }, range() { return this; },
      update() { throw new Error('Normal AS edits must not use direct updates'); },
      then(resolve) { return Promise.resolve({ data: table === 'profiles' ? [profile] : table === 'tasks' ? [task] : [], error: null }).then(resolve); } }; } };
  function TaskModal() { return null; } function GanttChart() { return null; }
  const router = { push() {} };
  try {
    const harness = componentHarness('app/page.tsx', {}, client, { 'next/navigation': { useRouter: () => router },
      '../components/AppShell': { AppShell: () => null }, '../components/GanttChart': { __esModule: true, default: GanttChart },
      '../components/TaskModal': { __esModule: true, default: TaskModal }, '../components/AddedTaskBulkImportModal': { __esModule: true, default: () => null } });
    let tree; for (let i = 0; i < 30; i++) { tree = harness.render(); if (elements(tree).some(node => node.type === GanttChart)) break; await new Promise(resolve => setImmediate(resolve)); }
    elements(tree).find(node => node.type === GanttChart).props.onTaskClick(task); tree = harness.render();
    for (const invalid of [{ data: null, error: null }, { data: { ...task, id: 'wrong' }, error: null }, { data: null, error: { code: 'PGRST116', message: 'Cannot coerce the result' } }, { data: null, error: { code: '42501', message: 'Only your own tasks' } }]) {
      response = invalid; await elements(tree).find(node => node.type === TaskModal).props.onSave({ description: 'Changed', weight: 99, name: 'Hacked' }); tree = harness.render();
      assert.equal(elements(tree).find(node => node.type === TaskModal).props.isOpen, true);
      assert.equal(elements(tree).find(node => node.type === GanttChart).props.tasks.find(row => row.id === task.id).weight, task.weight);
    }
    assert.ok(alerts.every(message => message.startsWith('Cannot update task:')));assert.equal(alerts.some(message => message.includes('Cannot coerce')), false);
    response = { data: { ...task, description: 'Changed', progress_summary: 'Changed', progress: 55 }, error: null };
    await elements(tree).find(node => node.type === TaskModal).props.onSave({ name: 'Hacked', description: 'Changed', progress_summary: 'Changed', progress: 55, weight: 99, assignee: 'Other', parent_id: 'Other', task_source: 'user_added' }); tree = harness.render();
    assert.equal(calls.at(-1).name, 'update_own_as_original_task');assert.deepEqual(calls.at(-1).args.task_changes, { description: 'Changed', progress_summary: 'Changed', progress: 55 });
    assert.equal(elements(tree).find(node => node.type === TaskModal).props.isOpen, false);
    const saved = elements(tree).find(node => node.type === GanttChart).props.tasks.find(row => row.id === task.id);assert.equal(saved.description, 'Changed');assert.equal(saved.progress, 55);assert.equal(saved.weight, task.weight);
  } finally { global.alert = previous; }
});

test('AS original Gantt schedule/progress edits use the checked RPC while computed progress and manager writes remain blocked', async () => {
  const previous = global.window;global.window = { innerWidth: 1280, localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, removeEventListener() {} };
  const calls = [];const charts = [];let reloads = 0;
  const computed = { ...parent, id: 'computed', calculated_progress: 50 };
  const client = { rpc(name, args) { calls.push({ name, args });return { single: async () => ({ data: { ...parent, ...args.task_changes }, error: null }) }; }, from() { throw new Error('Unexpected direct AS update'); } };
  class Frappe { constructor(container, tasks, options) { charts.push(options); } set_scroll_position() {} }
  const props = { tasks: [parent, computed], currentUser: profile, onTaskUpdate() { reloads++; }, onTaskClick() {} };
  try {
    const harness = componentHarness('components/GanttChart.tsx', props, client, { 'frappe-gantt/dist/frappe-gantt.css': {}, 'frappe-gantt': { __esModule: true, default: Frappe } }, 'default', value => value === null ? { innerHTML: '', addEventListener() {}, removeEventListener() {} } : value);
    harness.render();let chart = charts.at(-1);
    await chart.on_progress_change({ id: parent.id }, 65);await chart.on_date_change({ id: parent.id }, new Date('2026-10-01'), new Date('2026-11-30'));
    assert.equal(calls.length, 2);assert.deepEqual(calls[0].args.task_changes, { progress: 65 });assert.deepEqual(calls[1].args.task_changes, { start_date: '2026-10-01', end_date: '2026-11-30' });assert.equal(reloads, 2);
    await chart.on_progress_change({ id: computed.id }, 90);assert.equal(calls.length, 2);
    harness.render({ ...props, currentUser: { ...profile, role: 'manager' } });chart = charts.at(-1);
    await chart.on_progress_change({ id: parent.id }, 80);await chart.on_date_change({ id: parent.id }, new Date(), new Date());assert.equal(calls.length, 2);
  } finally { global.window = previous; }
});

test('unified task notes preserve legacy content, deduplicate complete text and stay stable across repeated saves', () => {
  const { getTaskNotes, taskNotesPayload } = loadTs('utils/taskNotes.ts');
  for (const [description, progress_summary, expected] of [
    [null, null, ''], ['Scope', null, 'Scope'], [null, 'Legacy update', 'Legacy update'],
    ['Scope', 'Update', 'Scope\n\nUpdate'], ['Scope', 'Scope', 'Scope'],
    ['Scope\r\nDone', 'Scope\nDone', 'Scope\nDone'],
    ['Scope\nDone', 'Done\nNext', 'Scope\nDone\nNext'],
    ['Scope\n\nDone', 'Scope\n\nNext', 'Scope\n\nDone\n\nNext'],
    ['Scope\nDone\nNext', 'Done', 'Scope\nDone\nNext'],
    ['Done', 'Scope\nDone\nNext', 'Scope\nDone\nNext'],
    ['Task 1', 'Task 10', 'Task 1\n\nTask 10'],
    ['ส่งรายงานแล้ว', 'ตรวจสอบโดยหัวหน้า', 'ส่งรายงานแล้ว\n\nตรวจสอบโดยหัวหน้า'],
  ]) {
    const original = { description, progress_summary }; const before = JSON.stringify(original);
    let text = getTaskNotes(original); assert.equal(text, expected); assert.equal(JSON.stringify(original), before);
    for (let i = 0; i < 5; i++) text = getTaskNotes(taskNotesPayload(text));
    assert.equal(text, expected);
  }
  assert.deepEqual(taskNotesPayload(''), { description: '', progress_summary: null });
});

test('TaskModal has one unified notes editor and saves canonical text plus a synchronized legacy mirror', () => {
  const { getTaskNotes, TASK_NOTES_LABEL } = loadTs('utils/taskNotes.ts');
  for (const notes of [{ description: 'Scope', progress_summary: 'Progress note' }, { description: null, progress_summary: 'Legacy only' }, { description: 'Description only', progress_summary: null }, { description: 'Same', progress_summary: 'Same' }]) {
    const task = { ...child('edit', 40, 50), ...notes }; const saved = [];
    const props = { isOpen: true, task, allTasks: [parent], currentUser: profile, onSave: row => saved.push(row), onClose() {}, onDelete() {} };
    const harness = componentHarness('components/TaskModal.tsx', props); let tree = harness.render();
    const editors = elements(tree).filter(item => item.type === 'textarea'); assert.equal(editors.length, 1);
    assert.equal(editors[0].props.id, 'task-description'); assert.equal(editors[0].props.value, getTaskNotes(task));
    assert.ok(textOf(tree).includes(TASK_NOTES_LABEL));
    button(tree, 'Save changes').props.onClick(); assert.equal(saved[0].description, getTaskNotes(task));
    assert.equal(saved[0].progress_summary, saved[0].description);
    editors[0].props.onChange({ target: { value: 'Edited unified notes' } }); tree = harness.render();
    button(tree, 'Save changes').props.onClick(); assert.equal(saved[1].description, 'Edited unified notes'); assert.equal(saved[1].progress_summary, 'Edited unified notes');
    tree = harness.render({ ...props, task: { ...task, ...saved[1] } }); assert.equal(elements(tree).find(item => item.type === 'textarea').props.value, 'Edited unified notes');
    assert.equal(saved[1].progress, 40); assert.equal(saved[1].weight, 0); assert.equal(saved[1].user_added_weight, 50);
    const readonly = componentHarness('components/TaskModal.tsx', { ...props, canEdit: false });
    assert.equal(elements(readonly.render()).find(item => item.type === 'textarea').props.disabled, true);
  }
});

test('unified notes require confirmation to clear both fields and generated summaries append without erasing notes', () => {
  const previous = global.confirm;
  try {
    const saved = []; const task = { ...parent, description: 'Keep the job context', progress_summary: 'Existing progress note' };
    const props = { isOpen: true, task, allTasks: [task, child('one', 100, 100)], currentUser: profile, onSave: row => saved.push(row), onClose() {}, onDelete() {} };
    const harness = componentHarness('components/TaskModal.tsx', props); let tree = harness.render();
    button(tree, 'Generate Summary').props.onClick(); tree = harness.render();
    const generated = elements(tree).find(item => item.type === 'textarea').props.value;
    assert.ok(generated.startsWith('Keep the job context\n\nExisting progress note')); assert.ok(generated.length > task.description.length + task.progress_summary.length + 2);
    button(tree, 'Generate Summary').props.onClick(); tree = harness.render(); assert.equal(elements(tree).find(item => item.type === 'textarea').props.value, generated);
    elements(tree).find(item => item.type === 'textarea').props.onChange({ target: { value: '' } }); tree = harness.render();
    global.confirm = () => false; button(tree, 'Save changes').props.onClick(); assert.equal(saved.length, 0);
    global.confirm = () => true; button(tree, 'Save changes').props.onClick(); assert.equal(saved[0].description, ''); assert.equal(saved[0].progress_summary, null);
  } finally { global.confirm = previous; }
});

test('AI supplementary evidence uses unified notes once while official snapshot text, weights and scores stay frozen', () => {
  const ai = loadTs('utils/aiSummary.ts'); const assessment = loadTs('utils/assessment.ts');
  const snapshots = assessment.createAssessmentTaskSnapshots('period', profile.display_name, [{ ...parent, progress_summary: 'Frozen assessment notes' }]);
  const original = JSON.stringify(snapshots);
  const args = { period: { title: 'Historical period' }, employeeId: profile.display_name, snapshots, taskEvaluations: [{ task_id: parent.id, self_progress_score: 4 }], summaryScope: 'employee_workload', supplementaryTasks: [{ ...child('support', 50, 50), description: 'Scope', progress_summary: 'Latest update' }] };
  const rows = ai.getAiSummarySupplementaryTaskRows(args);
  assert.equal(rows[0].description, 'Scope\n\nLatest update'); assert.equal(Object.hasOwn(rows[0], 'progress_summary'), false);
  const official = ai.getAiSummarySourceRows(args); assert.equal(official[0].progress_summary, 'Frozen assessment notes');
  assert.equal(official[0].weight, parent.weight); assert.equal(official[0].self_progress_score, 4); assert.equal(JSON.stringify(snapshots), original);
  assert.ok(ai.buildAiSummaryPrompt(args).includes('Frozen assessment notes'));
});

test('Gantt colors follow visual completion, preserve status and give blocked tasks red priority', () => {
  const { getGanttProgressVisual } = loadTs('utils/ganttProgress.ts');
  for (const [value, state] of [[0, 'not-started'], [0.01, 'active'], [50, 'active'], [99.99, 'active'], [100, 'complete']]) {
    const task = { ...parent, status: 'Done', progress: 0, calculated_progress: value };
    assert.equal(getGanttProgressVisual(task).className, `progress-${state} progress-computed`);
    assert.equal(getGanttProgressVisual(task).progress, value);
    assert.equal(task.status, 'Done');
  }
  assert.equal(getGanttProgressVisual({ ...parent, status: 'To Do', progress: 100 }).className, 'progress-complete');
  assert.equal(getGanttProgressVisual({ ...parent, progress: 100, calculated_progress: 0 }).progress, 0);
  assert.equal(getGanttProgressVisual({ ...parent, progress: 25, calculated_progress: null }).isComputed, false);
  for (const status of ['Blocked', 'In problem Need Help', 'In Problem Need Help']) for (const value of [0, 50, 100]) {
    assert.match(getGanttProgressVisual({ ...parent, status, calculated_progress: value }).className, /^progress-blocked /);
  }
  for (const [value, expected] of [[-5, 0], [120, 100], [NaN, 0]]) {
    assert.equal(getGanttProgressVisual({ ...parent, progress: value }).progress, expected);
  }
});

test('Gantt rebuilds recursive yellow/green bars and blocks computed writes while allowing leaf edits', async () => {
  const previousWindow = global.window;
  global.window = { innerWidth: 1280, localStorage: { getItem: () => '300', setItem() {} }, addEventListener() {}, removeEventListener() {} };
  const constructions = [];
  const writes = [];
  let reloads = 0;
  class FrappeStub {
    constructor(container, tasks, options) { constructions.push({ tasks, options }); }
    set_scroll_position() {}
  }
  const client = { from(table) {
    assert.equal(table, 'tasks');
    return { update(payload) { return { async eq(key, id) { writes.push({ payload, key, id }); return { error: null }; } }; } };
  } };
  const a = { ...parent, id: 'a', status: 'Done', end_date: parent.start_date };
  const b = { ...a, id: 'b', parent_id: a.id, name: 'AS B', weight: 0, status: 'To Do', description: 'Scope <img src=x onerror=alert(1)>', progress_summary: 'Legacy progress note' };
  const first = { ...child('first', 100, 50), parent_id: b.id, status: 'Done', end_date: a.end_date };
  const second = { ...first, id: 'second', name: 'Second', progress: 0 };
  const editable = { ...first, id: 'editable', name: 'Supporting task', parent_id: a.id, progress: 25, user_added_weight: 0 };
  const context = [a, b, first, second, editable];
  const withTracking = rows => {
    const metrics = progress.calculateTrackingProgressMetrics(rows);
    return rows.map(task => ({ ...task, calculated_progress: metrics[task.id].calculatedProgress }));
  };
  const props = { tasks: withTracking(context), onTaskUpdate: () => { reloads++; }, onTaskClick() {} };
  try {
    const harness = componentHarness('components/GanttChart.tsx', props, client, {
      'frappe-gantt/dist/frappe-gantt.css': {},
      'frappe-gantt': { __esModule: true, default: FrappeStub },
    }, 'default', value => value === null ? { innerHTML: '', scrollTop: 0, addEventListener() {}, removeEventListener() {} } : value);
    let tree = harness.render();
    const category = elements(tree).find(item => item.props?.className === 'gantt-tree-row gantt-tree-row-category');
    assert.ok(category);
    category.props.onClick();
    tree = harness.render();
    let chart = constructions.at(-1);
    const popup = chart.options.custom_popup_html({ id: b.id, name: b.name, _start: a.start_date, _end: a.end_date });
    assert.match(popup, /Description \/ Progress Summary/); assert.match(popup, /Scope &lt;img/); assert.match(popup, /Legacy progress note/);
    assert.equal(popup.includes('<img'), false);
    for (const id of [a.id, b.id]) {
      assert.equal(chart.tasks.find(task => task.id === id).progress, 50);
      assert.equal(chart.tasks.find(task => task.id === id).custom_class, 'progress-active progress-computed');
      await chart.options.on_progress_change({ id, progress: 75 }, 75);
    }
    assert.equal(writes.length, 0);
    await chart.options.on_progress_change({ id: editable.id }, 75);
    assert.deepEqual(writes, [{ payload: { progress: 75 }, key: 'id', id: editable.id }]);
    assert.equal(reloads, 1);
    const previousCount = constructions.length;
    harness.render({ ...props, tasks: withTracking(context.map(task => task.id === second.id ? { ...task, progress: 100 } : task)) });
    assert.ok(constructions.length > previousCount, 'a task-data reload must rebuild the chart without a browser refresh');
    chart = constructions.at(-1);
    for (const id of [a.id, b.id]) {
      assert.equal(chart.tasks.find(task => task.id === id).progress, 100);
      assert.equal(chart.tasks.find(task => task.id === id).custom_class, 'progress-complete progress-computed');
    }
    harness.render({ ...props, tasks: withTracking(context.map(task => [first.id, second.id].includes(task.id) ? { ...task, progress: 0 } : task)) });
    chart = constructions.at(-1);
    assert.equal(chart.tasks.find(task => task.id === a.id).custom_class, 'progress-not-started progress-computed');
    await chart.options.on_progress_change({ id: a.id }, 60);
    assert.equal(writes.length, 1, 'computed zero is also read-only');
    assert.equal(a.progress, 20);
    assert.equal(a.status, 'Done');
    for (const label of ['0%', '0% < Progress < 100%', '100%', 'Blocked / Need Help']) assert.ok(textOf(tree).includes(label));
  } finally { global.window = previousWindow; }
});

test('Gantt CSS shares legend/fill colors, overrides hover styles and hides only computed progress handles', () => {
  const css = fs.readFileSync('app/globals.css', 'utf8');
  for (const [state, color] of [['not-started', '#e5e7eb'], ['active', '#f7d448'], ['complete', '#5ada9e'], ['blocked', '#eb5858']]) {
    assert.ok(css.includes(`.gantt-wrapper .progress-${state} {\n  --gantt-progress-color: ${color};`) ||
      css.includes(`.gantt-wrapper .progress-${state} {\r\n  --gantt-progress-color: ${color};`));
  }
  assert.match(css, /\.gantt-wrapper \.gantt-legend-color\s*\{\s*background-color: var\(--gantt-progress-color\)/);
  assert.match(css, /\.gantt-wrapper \.gantt \.bar-wrapper\[class\*="progress-"\] \.bar-progress\s*\{\s*fill: var\(--gantt-progress-color\)/);
  assert.match(css, /\.progress-computed \.handle\.progress\s*\{\s*display: none;\s*pointer-events: none/);
  assert.doesNotMatch(css, /\.status-(todo|done|inprogress|inproblemneedhelp) \.bar-progress/);
});

test('TaskModal shows recursive tracking separately and saves recorded progress only', () => {
  const a = { ...parent, progress: 15 };
  const b = { ...parent, id: 'b', parent_id: a.id, weight: 0, progress: 20 };
  const activities = [child('one', 100, 50), child('two', 0, 50)].map(task => ({ ...task, parent_id: 'b' }));
  const saved = [];
  const harness = componentHarness('components/TaskModal.tsx', { isOpen: true, task: a, allTasks: [a, b, ...activities],
    currentUser: profile, onSave: row => saved.push(row), onClose() {}, onDelete() {} });
  const tree = harness.render();
  assert.match(textOf(elements(tree).find(item => item.props?.['data-testid'] === 'tracking-progress')), /50%/);
  assert.equal(elements(tree).find(item => item.type === 'input' && item.props.type === 'range').props.value, 15);
  button(tree, 'Save changes').props.onClick();
  assert.equal(saved[0].progress, 15);
});

test('Monthly Review uses authorized context while rendering only the selected employee tasks', async () => {
  const reviewer = { ...profile, id: 'admin', role: 'admin' };
  const a = { ...parent, progress: 15, description: 'Monthly job scope', progress_summary: 'Monthly legacy update' };
  const b = { ...parent, id: 'b', name: 'Other authorized employee task', assignee: 'Other staff', parent_id: a.id, weight: 0, progress: 20 };
  const activities = [child('one', 100, 50), child('two', 0, 50)].map(task => ({ ...task, assignee: 'Other staff', parent_id: 'b' }));
  const calls = [];
  const client = { auth: { getUser: async () => ({ data: { user: { id: reviewer.id } }, error: null }) },
    from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: reviewer, error: null }) }) };
  const monthly = loadTs('utils/monthlyReviews.ts', { './supabase': { supabase: client } });
  const router = { replace() {} };
  const harness = componentHarness('components/monthly-reviews/MonthlyReviews.tsx', { mode: 'admin' }, client, {
    'next/navigation': { useParams: () => ({ period_id: 'period', employee_id: profile.display_name }), useRouter: () => router },
    'next/link': { __esModule: true, default: () => null },
    './MonthlyReviews.module.css': {},
    '../../utils/monthlyReviews': { ...monthly, loadMonthlyRows: async (table, filters = {}) => {
      calls.push({ table, filters });
      if (table === 'profiles') return [profile];
      if (table === 'monthly_review_periods') return [{ id: 'period', name: 'October review', year: 2026, month: 10, status: 'open' }];
      if (table === 'tasks') return [a, b, ...activities];
      return [];
    } },
  }, 'MonthlyEmployeePage');
  let tree;
  for (let i = 0; i < 30; i++) {
    tree = harness.render();
    if (elements(tree).some(item => item.type === 'progress')) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(elements(tree).find(item => item.type === 'progress').props.value, 50);
  assert.equal(textOf(tree).includes(b.name), false);
  assert.match(textOf(tree), /From AS subtasks/);
  assert.match(textOf(tree), /Monthly job scope\n\nMonthly legacy update/);
  assert.deepEqual(calls.find(call => call.table === 'tasks').filters, {});
});

test('main views use complete paginated task context for recursive progress', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const a = { ...parent, start_date: today, end_date: today, progress: 15, status: 'To Do', priority: 'Medium', description: 'List job scope', progress_summary: 'List legacy update' };
  const b = { ...parent, id: 'branch', name: 'Nested AS branch', parent_id: a.id, weight: 0, progress: 20 };
  const activities = [child('one', 100, 50), child('two', 0, 50)].map(task => ({ ...task, parent_id: b.id }));
  const database = [a, ...Array.from({ length: 499 }, (_, i) => ({ ...a, id: `filler-${i}`, name: `Filler ${i}`, weight: 0 })), b, ...activities];
  const pages = [];
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: profile.id, email: 'staff@example.test' } } } }) },
    from(table) {
      let start = 0;
      let end = 499;
      return { select() { return this; }, eq() { return this; }, limit() { return this; }, order() { return this; },
        range(first, last) { start = first; end = last; return this; },
        then(resolve) {
          if (table === 'tasks') pages.push([start, end]);
          return Promise.resolve({ data: table === 'tasks' ? database.slice(start, end + 1) : table === 'profiles' ? [profile] : [], error: null }).then(resolve);
        } };
    } };
  function GanttChart() { return null; }
  const router = { push() {} };
  const harness = componentHarness('app/page.tsx', {}, client, {
    'next/navigation': { useRouter: () => router },
    '../components/AppShell': { AppShell: () => null },
    '../components/GanttChart': { __esModule: true, default: GanttChart },
    '../components/TaskModal': { __esModule: true, default: () => null },
    '../components/AddedTaskBulkImportModal': { __esModule: true, default: () => null },
  });
  let tree;
  for (let i = 0; i < 30; i++) {
    tree = harness.render();
    if (elements(tree).some(item => item.type === GanttChart)) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  const chart = elements(tree).find(item => item.type === GanttChart);
  assert.ok(chart);
  assert.deepEqual(pages, [[0, 499], [500, 999]]);
  assert.equal(chart.props.tasks.find(task => task.id === a.id).calculated_progress, 50);
  assert.equal(chart.props.tasks.find(task => task.id === b.id).calculated_progress, 50);
  for (const view of ['list', 'board', 'calendar']) {
    tree.props.onChangeView(view);
    tree = harness.render();
    const componentName = `Tasks${view[0].toUpperCase()}${view.slice(1)}View`;
    const viewElement = elements(tree).find(item => item.type?.name === componentName);
    assert.ok(viewElement, componentName);
    const renderedView = viewElement.type(viewElement.props);
    if (view === 'list') assert.match(textOf(renderedView), /List job scope\n\nList legacy update/);
    assert.ok(elements(renderedView).some(item => ['tr', 'div', 'button'].includes(item.type) &&
      typeof item.props.onClick === 'function' && textOf(item).includes(a.name) && textOf(item).includes('50%')), `${view} must show recursive tracking progress`);
  }
  assert.equal(database[0].progress, 15);
});

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
        limit() { return this; }, order() { return this; }, range() { return this; },
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
  await modal.props.onSave({ name: 'Updated child', assignee: profile.display_name, user_added_weight: '60', weight: 100, parent_id: null, task_source: 'as_original', counts_toward_assessment: true, include_in_ai_summary: false, description: 'Unified persisted notes', progress_summary: 'Unified persisted notes' });
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
  assert.equal(modal.props.task.description, 'Unified persisted notes');
  assert.equal(modal.props.task.progress_summary, 'Unified persisted notes');
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
