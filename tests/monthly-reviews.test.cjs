const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadHelpers(client = {}) {
  const filename = path.resolve('utils/monthlyReviews.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = name => name === './supabase' ? { supabase: client } : require(name);
  mod._compile(compiled, filename);
  return mod.exports;
}

test('monthly review access uses real roles and current employee teams', () => {
  const { canAccessMonthlyReviews, canReviewEmployee, monthlyReviewHref } = loadHelpers();
  const employee = { role: 'user', team_id: 'team-a' };
  assert.equal(canAccessMonthlyReviews({ role: 'user' }, 'manager'), false);
  assert.equal(canAccessMonthlyReviews({ role: 'manager' }, 'admin'), false);
  assert.equal(canAccessMonthlyReviews({ role: 'admin' }, 'manager'), true);
  assert.equal(canReviewEmployee({ role: 'admin' }, employee), true);
  assert.equal(canReviewEmployee({ role: 'manager', team_id: 'team-a' }, employee), true);
  assert.equal(canReviewEmployee({ role: 'manager', team_id: 'team-b' }, employee), false);
  assert.equal(canReviewEmployee({ role: 'manager', team_id: null }, { role: 'user', team_id: null }), false);
  assert.equal(canReviewEmployee({ role: 'user', team_id: 'team-a' }, employee), false);
  assert.equal(monthlyReviewHref('manager', 'period', 'ชื่อ / name'), '/manager/monthly-reviews/period/' + encodeURIComponent('ชื่อ / name'));
});

test('monthly queries paginate and retain employee filters', async () => {
  const calls = [];
  const client = { from(table) {
    let offset;
    const filters = {};
    const query = {
      select() { return this; }, order() { return this; },
      range(start) { offset = start; return this; },
      eq(key, value) { filters[key] = value; return this; },
      then(resolve) {
        calls.push({ table, offset, filters });
        return Promise.resolve({ data: Array.from({ length: offset === 0 ? 500 : 1 }, (_, i) => ({ id: offset + i })), error: null }).then(resolve);
      },
    };
    return query;
  } };
  const { loadMonthlyRows } = loadHelpers(client);
  const rows = await loadMonthlyRows('tasks', { assignee: 'Reviewer A' });
  assert.equal(rows.length, 501);
  assert.deepEqual(calls.map(call => call.offset), [0, 500]);
  assert.ok(calls.every(call => call.filters.assignee === 'Reviewer A'));
});

const pglitePath = process.env.MONTHLY_REVIEW_PGLITE_PATH;
test('migration enforces monthly review persistence and role boundaries', { skip: !pglitePath }, async t => {
  const { PGlite } = require(pglitePath);
  const db = new PGlite();
  const ids = {
    admin: '10000000-0000-0000-0000-000000000001',
    manager: '10000000-0000-0000-0000-000000000002',
    employee: '10000000-0000-0000-0000-000000000003',
    outsider: '10000000-0000-0000-0000-000000000004',
    noTeam: '10000000-0000-0000-0000-000000000005',
    invalidRole: '10000000-0000-0000-0000-000000000006',
  };
  let periodId;
  async function login(id, role = 'authenticated') {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
    await db.exec(`SET ROLE ${role}`);
  }
  const save = (employee, mark, comment = 'Monthly comment') => db.query(
    'SELECT * FROM public.save_monthly_progress_review($1, $2, $3, $4)', [periodId, employee, comment, mark],
  );
  try {
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE ROLE anon;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated, anon;
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, display_name text UNIQUE, role text, team_id uuid);
      CREATE TABLE public.tasks (id uuid PRIMARY KEY, name text, assignee text, progress int, weight numeric);
      INSERT INTO public.profiles VALUES
        ('${ids.admin}', 'Admin', 'admin', NULL),
        ('${ids.manager}', 'Manager A', 'manager', '20000000-0000-0000-0000-000000000001'),
        ('${ids.employee}', 'Employee A', 'user', '20000000-0000-0000-0000-000000000001'),
        ('${ids.outsider}', 'Employee B', 'user', '20000000-0000-0000-0000-000000000002'),
        ('${ids.noTeam}', 'Manager no team', 'manager', NULL),
        ('${ids.invalidRole}', 'Invalid role', NULL, NULL);
      INSERT INTO public.tasks VALUES ('30000000-0000-0000-0000-000000000001', 'Task', 'Employee A', 42, 10);
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
        $$ SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid() $$;
      CREATE FUNCTION public.is_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
        $$ SELECT role = 'manager' FROM public.profiles WHERE id = auth.uid() $$;
      CREATE FUNCTION public.can_manager_view_team_employee(employee text) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER AS $$
          SELECT EXISTS (SELECT 1 FROM public.profiles actor JOIN public.profiles target
            ON target.team_id = actor.team_id WHERE actor.id = auth.uid() AND actor.role = 'manager'
            AND target.role = 'user' AND target.display_name = employee) $$;
      CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    `);
    await db.exec(fs.readFileSync(path.resolve('supabase/migrations/20261007000000_add_monthly_progress_reviews.sql'), 'utf8'));

    await t.test('admin creates a period; duplicate months and invalid months are rejected', async () => {
      await login(ids.admin);
      const result = await db.query("INSERT INTO monthly_review_periods(name, year, month, created_by) VALUES ('October', 2026, 10, $1) RETURNING *", [ids.admin]);
      periodId = result.rows[0].id;
      await assert.rejects(db.query("INSERT INTO monthly_review_periods(name, year, month) VALUES ('Duplicate', 2026, 10)"), /unique/i);
      await assert.rejects(db.query("INSERT INTO monthly_review_periods(name, year, month) VALUES ('Invalid', 2026, 13)"), /check/i);
    });
    await t.test('manager saves comment, marks reviewed, and status persists on later comment save', async () => {
      await login(ids.manager);
      const draft = (await save('Employee A', false)).rows[0];
      assert.equal(draft.review_status, 'not_reviewed');
      assert.equal(draft.reviewer_id, ids.manager);
      assert.equal(draft.team_id, '20000000-0000-0000-0000-000000000001');
      const reviewed = (await save('Employee A', true, 'Reviewed comment')).rows[0];
      assert.equal(reviewed.review_status, 'reviewed');
      assert.ok(reviewed.reviewed_at);
      const edited = (await save('Employee A', false, 'Updated comment')).rows[0];
      assert.equal(edited.review_status, 'reviewed');
      assert.deepEqual(edited.reviewed_at, reviewed.reviewed_at);
      const reload = await db.query('SELECT * FROM monthly_progress_reviews WHERE period_id = $1', [periodId]);
      assert.equal(reload.rows[0].review_comment, 'Updated comment');
      assert.equal(reload.rows.length, 1);
    });
    await t.test('manager cannot write another team, create a period, or bypass the RPC', async () => {
      await login(ids.manager);
      await assert.rejects(save('Employee B', true), /not available/i);
      await assert.rejects(db.query("INSERT INTO monthly_review_periods(name, year, month) VALUES ('November', 2026, 11)"), /row-level security/i);
      await assert.rejects(db.query("UPDATE monthly_progress_reviews SET review_status = 'not_reviewed'"), /permission denied/i);
      await login(ids.noTeam);
      await assert.rejects(save('Employee A', true), /not available/i);
    });
    await t.test('admin reviews any team; managers read only their team', async () => {
      await login(ids.admin);
      await save('Employee B', true);
      assert.equal((await db.query('SELECT * FROM monthly_progress_reviews')).rows.length, 2);
      await login(ids.manager);
      const rows = (await db.query('SELECT * FROM monthly_progress_reviews')).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].employee_id, 'Employee A');
    });
    await t.test('user, invalid role and anonymous cannot review', async () => {
      await login(ids.employee);
      assert.equal((await db.query('SELECT * FROM monthly_review_periods')).rows.length, 0);
      assert.equal((await db.query('SELECT * FROM monthly_progress_reviews')).rows.length, 0);
      await assert.rejects(save('Employee A', true), /Only admins and managers/i);
      await login(ids.invalidRole);
      await assert.rejects(save('Employee A', true), /Only admins and managers/i);
      await login(null, 'anon');
      await assert.rejects(save('Employee A', true), /permission denied/i);
    });
    await t.test('closed periods reject saves; reopen enables save; task fields stay intact', async () => {
      await login(ids.admin);
      await db.query("UPDATE monthly_review_periods SET status = 'closed' WHERE id = $1", [periodId]);
      await assert.rejects(save('Employee A', false), /period is closed/i);
      await login(ids.manager);
      await assert.rejects(save('Employee A', true), /period is closed/i);
      await login(ids.admin);
      await db.query("UPDATE monthly_review_periods SET status = 'open' WHERE id = $1", [periodId]);
      await save('Employee A', false, 'After reopening');
      await login(null);
      await db.exec('RESET ROLE');
      const task = (await db.query('SELECT * FROM tasks')).rows[0];
      assert.equal(task.progress, 42);
      assert.equal(Number(task.weight), 10);
    });
  } finally { await db.close(); }
});
