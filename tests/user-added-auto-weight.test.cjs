const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadTs(filename, cache = new Map()) {
  const resolved = path.resolve(filename);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const mod = new Module(resolved, module);
  cache.set(resolved, mod);
  mod.filename = resolved;
  mod.paths = module.paths;
  mod.require = name => name.startsWith('.') ? loadTs(path.resolve(path.dirname(resolved), name) + '.ts', cache) : require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, resolved);
  return mod.exports;
}
const helpers = loadTs('utils/userAddedProgress.ts');
const original = { id: 'parent', name: 'AS task', task_source: 'as_original', weight: 25, progress: 20, counts_toward_assessment: true };
const makeChild = (id, manual = false, weight = 0) => ({ id, name: id, parent_id: original.id, task_source: 'user_added', weight: 0, progress: 0, counts_toward_assessment: false, include_in_ai_summary: true, user_added_weight: weight, user_added_weight_is_manual: manual });

test('auto previews distribute exact totals and preserve manual weights', () => {
  assert.deepEqual(helpers.calculateAutoUserAddedWeights([makeChild('a')]).weights, { a: 100 });
  assert.deepEqual(helpers.calculateAutoUserAddedWeights([makeChild('a'), makeChild('b')]).weights, { a: 50, b: 50 });
  assert.deepEqual(helpers.calculateAutoUserAddedWeights([makeChild('a'), makeChild('b'), makeChild('c')]).weights, { a: 33.33, b: 33.33, c: 33.34 });
  const manual = makeChild('a', true, 70);
  assert.deepEqual(helpers.calculateAutoUserAddedWeights([manual, makeChild('b'), makeChild('c')]).weights, { a: 70, b: 15, c: 15 });
  assert.equal(helpers.previewUserAddedWeight('parent', [manual]).weight, 30);
  assert.equal(helpers.previewUserAddedWeight('parent', [makeChild('a', true, 100)]).weight, 0);
  assert.deepEqual(helpers.calculateAutoUserAddedWeights([makeChild('a', true, 80), makeChild('b', true, 80), makeChild('c')]).weights, { a: 80, b: 80, c: 0 });
  assert.deepEqual(helpers.calculateAutoUserAddedWeights([manual, makeChild('b'), makeChild('c')], true).weights, { a: 33.33, b: 33.33, c: 33.34 });
});

test('auto weighting leaves official contributions and snapshot contents unchanged', () => {
  const tasks = [original, { ...makeChild('a'), progress: 100 }, makeChild('b')];
  const allocated = helpers.calculateAutoUserAddedWeights(tasks);
  const updated = tasks.map(task => ({ ...task, ...(allocated.weights[task.id] === undefined ? {} : { user_added_weight: allocated.weights[task.id] }) }));
  assert.equal(helpers.calculateTrackingProgressMetrics(updated).parent.calculatedProgress, 50);
  const official = loadTs('utils/taskProgress.ts');
  const assessment = loadTs('utils/assessment.ts');
  assert.equal(official.calculateEffectiveWeightTotal(tasks), official.calculateEffectiveWeightTotal(updated));
  assert.equal(official.calculateEffectiveWeightedContribution(original, tasks), official.calculateEffectiveWeightedContribution(original, updated));
  assert.deepEqual(assessment.createAssessmentTaskSnapshots('period', 'Staff A', tasks), assessment.createAssessmentTaskSnapshots('period', 'Staff A', updated));
});

const pglitePath = process.env.MONTHLY_REVIEW_PGLITE_PATH;
test('existing-column balance RPC persists auto siblings without rewriting manual or official weights', { skip: !pglitePath }, async () => {
  const { PGlite } = require(pglitePath);
  const db = new PGlite();
  const user = '10000000-0000-0000-0000-000000000001';
  const manager = '10000000-0000-0000-0000-000000000002';
  const admin = '10000000-0000-0000-0000-000000000003';
  const parent = '20000000-0000-0000-0000-000000000001';
  const other = '20000000-0000-0000-0000-000000000002';
  const migration = fs.readFileSync('supabase/migrations/20261014010000_persist_existing_user_added_weight_balance.sql', 'utf8');
  assert.doesNotMatch(migration, /ALTER TABLE|ADD COLUMN|CREATE POLICY|DROP POLICY/i);
  const login = async id => {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
    await db.exec('SET ROLE authenticated');
  };
  const balance = (id = parent, reset = false) => db.query('SELECT * FROM rebalance_user_added_task_weights($1,$2)', [id, reset]);
  const stored = () => db.query("SELECT * FROM tasks WHERE parent_id=$1 AND task_source='user_added' ORDER BY created_at,id", [parent]);
  const add = async (name, manual = false, weight = 0, parentId = parent) => (await db.query(`
    INSERT INTO tasks(name,parent_id,assignee,task_source,weight,counts_toward_assessment,include_in_ai_summary,user_added_weight,user_added_weight_is_manual)
    VALUES ($1,$2,'Staff A','user_added',0,false,true,$3,$4) RETURNING *`, [name, parentId, weight, manual])).rows[0];
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY,display_name text,role text);
      INSERT INTO profiles VALUES ('${user}','Staff A','user'),('${manager}','Manager','manager'),('${admin}','Admin','admin');
      CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,parent_id uuid,assignee text,
        task_source text,weight numeric,progress numeric DEFAULT 0,counts_toward_assessment boolean,
        include_in_ai_summary boolean,user_added_weight numeric DEFAULT 0,user_added_weight_is_manual boolean DEFAULT false,
        created_at timestamptz DEFAULT now());
      INSERT INTO tasks(id,name,assignee,task_source,weight,progress,counts_toward_assessment,include_in_ai_summary)
        VALUES ('${parent}','AS','Staff A','as_original',25,20,true,true),('${other}','Other AS','Staff B','as_original',75,40,true,true);
      INSERT INTO tasks(name,parent_id,assignee,task_source,weight,user_added_weight,user_added_weight_is_manual)
        VALUES ('Ignored admin task','${parent}','Staff A','admin_added',15,99,false);
      GRANT ALL ON tasks TO authenticated;
    `);
    const columnsBefore = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='tasks' ORDER BY ordinal_position")).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='tasks' ORDER BY ordinal_position")).rows, columnsBefore);
    const officialBefore = (await db.query("SELECT * FROM tasks WHERE task_source <> 'user_added' ORDER BY id")).rows;
    await login(user);
    const first = await add('First');
    assert.equal(Number(first.user_added_weight), 0);
    assert.equal(Number((await balance()).rows[0].user_added_weight), 100);
    assert.equal(Number((await stored()).rows[0].user_added_weight), 100);
    const second = await add('Second', null, null);
    await balance();
    assert.deepEqual((await stored()).rows.map(row => Number(row.user_added_weight)), [50, 50]);
    const third = await add('Third');
    await balance();
    assert.deepEqual((await stored()).rows.map(row => Number(row.user_added_weight)), [33.33, 33.33, 33.34]);
    await db.query('UPDATE tasks SET user_added_weight=70,user_added_weight_is_manual=true WHERE id=$1', [first.id]);
    await balance();
    assert.deepEqual((await stored()).rows.map(row => Number(row.user_added_weight)), [70, 15, 15]);
    const fourth = await add('Fourth');
    await balance();
    assert.deepEqual((await stored()).rows.map(row => Number(row.user_added_weight)), [70, 10, 10, 10]);
    await db.query('DELETE FROM tasks WHERE id=$1', [fourth.id]);
    await balance();
    assert.deepEqual((await stored()).rows.map(row => Number(row.user_added_weight)), [70, 15, 15]);
    await db.query('UPDATE tasks SET user_added_weight=40,user_added_weight_is_manual=true WHERE id=$1', [second.id]);
    await balance();
    assert.deepEqual((await stored()).rows.map(row => Number(row.user_added_weight)), [70, 40, 0]);
    assert.equal((await stored()).rows.find(row => row.id === first.id).user_added_weight_is_manual, true);
    await assert.rejects(balance(other), /own parent/i);
    await assert.rejects(balance(third.id), /original AS/i);
    await login(manager);
    await assert.rejects(balance(), /Only admins/i);
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(balance(), /permission denied/i);
    await login(admin);
    const before = (await stored()).rows;
    await db.exec('RESET ROLE');
    await db.exec(migration);
    await login(admin);
    assert.deepEqual((await stored()).rows, before);
    await balance(parent, true);
    const resetRows = (await stored()).rows;
    assert.deepEqual(resetRows.map(row => Number(row.user_added_weight)), [33.33, 33.33, 33.34]);
    assert.ok(resetRows.every(row => row.user_added_weight_is_manual === false));
    assert.ok(resetRows.every(row => Number(row.weight) === 0 && row.counts_toward_assessment === false && row.include_in_ai_summary === true));
    assert.deepEqual((await db.query("SELECT * FROM tasks WHERE task_source <> 'user_added' ORDER BY id")).rows, officialBefore);
    await db.query("UPDATE tasks SET assignee='Staff B' WHERE id=$1", [third.id]);
    await login(user);
    await assert.rejects(balance(), /own parent/i);
    await login(admin);
    assert.equal((await balance()).rows.length, 3);
  } finally { await db.close(); }
});

test('auto-weight RPCs persist allocations, enforce ownership and preserve official fields', { skip: !pglitePath }, async () => {
  const { PGlite } = require(pglitePath);
  const db = new PGlite();
  const user = '10000000-0000-0000-0000-000000000001';
  const admin = '10000000-0000-0000-0000-000000000002';
  const manager = '10000000-0000-0000-0000-000000000003';
  const parent = '20000000-0000-0000-0000-000000000001';
  const otherParent = '20000000-0000-0000-0000-000000000002';
  const legacy = '20000000-0000-0000-0000-000000000003';
  async function login(id) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
    await db.exec('SET ROLE authenticated');
  }
  const create = rows => db.query('SELECT * FROM create_user_added_tasks($1::jsonb)', [JSON.stringify(rows)]);
  const update = (id, changes) => db.query('SELECT * FROM update_user_added_task($1, $2::jsonb)', [id, JSON.stringify(changes)]);
  const children = () => db.query("SELECT * FROM tasks WHERE parent_id=$1 AND task_source='user_added' ORDER BY created_at,id", [parent]);
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY, display_name text, role text);
      INSERT INTO profiles VALUES ('${user}','Staff A','user'),('${admin}','Admin','admin'),('${manager}','Manager','manager');
      CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role='admin' FROM profiles WHERE id=auth.uid() $$;
      CREATE FUNCTION is_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role='user' FROM profiles WHERE id=auth.uid() $$;
      CREATE FUNCTION current_employee_key() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT display_name FROM profiles WHERE id=auth.uid() $$;
      CREATE TABLE tasks(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text,
        start_date date, end_date date, status text DEFAULT 'To Do', priority text DEFAULT 'Medium',
        progress numeric DEFAULT 0, progress_summary text, assignee text, team_id uuid,
        parent_id uuid REFERENCES tasks(id), is_recurring boolean DEFAULT false, recurring_type text DEFAULT 'none',
        recurring_interval integer, recurring_unit text, dependencies text, work_type text,
        output text, frequency_count numeric, frequency_unit text, time_per_occurrence_minutes numeric,
        weight numeric DEFAULT 0, calculated_progress numeric, task_source text DEFAULT 'as_original',
        counts_toward_assessment boolean DEFAULT true, include_in_ai_summary boolean DEFAULT true,
        created_at timestamptz DEFAULT now()
      );
      INSERT INTO tasks(id,name,assignee,weight,progress) VALUES ('${parent}','AS task','Staff A',25,20),('${otherParent}','Other AS','Staff B',75,40);
      ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      GRANT ALL ON tasks TO authenticated;
      CREATE POLICY tasks_admin ON tasks FOR ALL TO authenticated USING(is_admin()) WITH CHECK(is_admin());
      CREATE POLICY tasks_user_read ON tasks FOR SELECT TO authenticated USING(assignee=current_employee_key());
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261012000000_add_user_added_progress_weight.sql', 'utf8'));
    await db.exec(`INSERT INTO tasks(id,name,assignee,parent_id,task_source,weight,user_added_weight,counts_toward_assessment,include_in_ai_summary)
      VALUES ('${legacy}','Legacy custom weight','Staff B','${otherParent}','user_added',0,60,false,true)`);
    const migration = fs.readFileSync('supabase/migrations/20261014000000_add_user_added_auto_weighting.sql', 'utf8');
    await db.exec(migration);
    assert.equal((await db.query('SELECT user_added_weight_is_manual FROM tasks WHERE id=$1', [legacy])).rows[0].user_added_weight_is_manual, true);
    await login(user);
    const first = (await create([{ name: 'First', parent_id: parent, progress: 100, assignee: 'Attacker', weight: 99, counts_toward_assessment: true }])).rows[0];
    assert.equal(Number(first.user_added_weight), 100);
    assert.equal(first.user_added_weight_is_manual, false);
    assert.equal(first.assignee, 'Staff A');
    const second = (await create([{ name: 'Second', parent_id: parent, progress: 0 }])).rows[0];
    let rows = (await children()).rows;
    assert.deepEqual(rows.map(row => Number(row.user_added_weight)), [50, 50]);
    const third = (await create([{ name: 'Third', parent_id: parent }])).rows[0];
    rows = (await children()).rows;
    assert.deepEqual(rows.map(row => Number(row.user_added_weight)), [33.33, 33.33, 33.34]);
    await update(first.id, { user_added_weight: 70, user_added_weight_is_manual: true, weight: 99, parent_id: otherParent });
    rows = (await children()).rows;
    assert.deepEqual(rows.map(row => Number(row.user_added_weight)), [70, 15, 15]);
    assert.equal(rows[0].user_added_weight_is_manual, true);
    const fourth = (await create([{ name: 'Fourth', parent_id: parent }])).rows[0];
    rows = (await children()).rows;
    assert.deepEqual(rows.map(row => Number(row.user_added_weight)), [70, 10, 10, 10]);
    assert.equal(rows[0].parent_id, parent);
    await update(first.id, { user_added_weight: 100, user_added_weight_is_manual: true });
    rows = (await children()).rows;
    assert.deepEqual(rows.map(row => Number(row.user_added_weight)), [100, 0, 0, 0]);
    await update(second.id, { user_added_weight: 30, user_added_weight_is_manual: true });
    rows = (await children()).rows;
    assert.deepEqual(rows.map(row => Number(row.user_added_weight)), [100, 30, 0, 0]);
    await db.query('SELECT * FROM auto_balance_user_added_weights($1)', [parent]);
    rows = (await children()).rows;
    assert.ok(rows.every(row => Number(row.user_added_weight) === 25 && row.user_added_weight_is_manual === false));
    await db.query('SELECT delete_user_added_task($1)', [fourth.id]);
    rows = (await children()).rows;
    assert.deepEqual(rows.map(row => Number(row.user_added_weight)), [33.33, 33.33, 33.34]);
    await assert.rejects(create([{ name: 'Bad ownership', parent_id: otherParent }]), /own AS task/i);
    await assert.rejects(update(legacy, { user_added_weight: 70 }), /own AS task/i);
    await assert.rejects(update(parent, { task_source: 'user_added', parent_id: otherParent }), /Only an admin/i);
    await assert.rejects(db.query('SELECT * FROM auto_balance_user_added_weights($1)', [otherParent]), /own AS task/i);
    await assert.rejects(db.query('SELECT rebalance_user_added_weights_internal($1,false)', [parent]), /permission denied/i);
    await assert.rejects(update(first.id, { user_added_weight: 101, user_added_weight_is_manual: true }), /check/i);
    assert.equal((await children()).rows.length, 3);
    await assert.rejects(create([{ name: 'Would insert', parent_id: parent }, { name: '', parent_id: parent }]), /name is required/i);
    assert.equal((await children()).rows.length, 3);
    await login(manager);
    await assert.rejects(create([{ name: 'Denied', parent_id: parent }]), /Only admins/i);
    await login(admin);
    const batch = await create([{ name: 'Batch A', parent_id: parent }, { name: 'Batch B', parent_id: parent }, { name: 'Other parent', parent_id: otherParent }]);
    assert.equal(batch.rows.length, 3);
    const convertibleId = '20000000-0000-0000-0000-000000000004';
    await db.query("INSERT INTO tasks(id,name,assignee,weight) VALUES ($1,'Admin reclassification','Staff A',10)", [convertibleId]);
    const converted = (await update(convertibleId, { task_source: 'user_added', parent_id: parent, user_added_weight_is_manual: false })).rows[0];
    assert.equal(converted.task_source, 'user_added');
    assert.equal(Number(converted.weight), 0);
    assert.equal(converted.parent_id, parent);
    const before = (await children()).rows.map(row => ({ id: row.id, weight: row.user_added_weight, manual: row.user_added_weight_is_manual }));
    await db.exec('RESET ROLE');
    await db.exec(migration);
    await login(admin);
    assert.deepEqual((await children()).rows.map(row => ({ id: row.id, weight: row.user_added_weight, manual: row.user_added_weight_is_manual })), before);
    rows = (await children()).rows;
    assert.equal(rows.reduce((sum, row) => sum + Number(row.user_added_weight), 0), 100);
    assert.ok(rows.every(row => Number(row.weight) === 0 && row.counts_toward_assessment === false && row.include_in_ai_summary === true && row.task_source === 'user_added'));
    const storedParent = (await db.query('SELECT * FROM tasks WHERE id=$1', [parent])).rows[0];
    assert.equal(Number(storedParent.weight), 25);
    assert.equal(Number(storedParent.progress), 20);
    assert.equal(storedParent.calculated_progress, null);
  } finally { await db.close(); }
});
