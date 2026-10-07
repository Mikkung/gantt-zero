'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Profile, Team } from '../../types';
import { supabase } from '../../utils/supabase';
import { getHierarchicalTaskRows, getWorkTypeLabel } from '../../utils/taskGrouping';
import {
  canAccessMonthlyReviews, canReviewEmployee, formatMonthlyReviewDate,
  getBangkokReviewMonth, loadMonthlyRows, monthlyReviewError, monthlyReviewHref,
} from '../../utils/monthlyReviews';
import type {
  MonthlyProgressReview, MonthlyReviewMode, MonthlyReviewPeriod, MonthlyReviewTask,
} from '../../utils/monthlyReviews';
import styles from './MonthlyReviews.module.css';

function useReviewer(mode: MonthlyReviewMode) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (!user) { router.replace('/login'); return; }
        if (authError) throw authError;
        const { data, error: profileError } = await supabase.from('profiles')
          .select('*').eq('id', user.id).maybeSingle();
        if (profileError) throw profileError;
        if (active) setProfile(data as Profile | null);
      } catch (err) {
        if (active) setError(monthlyReviewError(err as { message: string; code?: string }));
      } finally {
        if (active) setLoading(false);
      }
    }
    void init();
    return () => { active = false; };
  }, [router]);
  return { profile, loading, error, allowed: canAccessMonthlyReviews(profile, mode) };
}

function ReviewShell({ title, backHref = '/', backLabel = 'Back to Main App', children }: {
  title: string; backHref?: string; backLabel?: string; children: ReactNode;
}) {
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><div className={styles.brand}>ISE Work Tracker</div><h1>{title}</h1></div>
      <Link href={backHref} className="btn btn-secondary">{backLabel}</Link>
    </header>
    {children}
  </main>;
}

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={error ? styles.error : styles.notice} role={error ? 'alert' : 'status'}>{children}</p>;
}

function Status({ reviewed }: { reviewed: boolean }) {
  return <span className={reviewed ? styles.reviewed : styles.pending}>{reviewed ? 'Reviewed' : 'Not reviewed'}</span>;
}

function AccessState({ identity }: { identity: ReturnType<typeof useReviewer> }) {
  if (identity.loading) return <Notice>Loading...</Notice>;
  if (identity.error) return <Notice error>{identity.error}</Notice>;
  return <Notice error>คุณไม่มีสิทธิ์เข้าถึงหน้านี้</Notice>;
}

export function MonthlyPeriodsPage({ mode }: { mode: MonthlyReviewMode }) {
  const identity = useReviewer(mode);
  const [periods, setPeriods] = useState<MonthlyReviewPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [month, setMonth] = useState(getBangkokReviewMonth);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!identity.allowed) return;
    let active = true;
    loadMonthlyRows<MonthlyReviewPeriod>('monthly_review_periods')
      .then(rows => { if (active) setPeriods(rows); })
      .catch(err => { if (active) setError(monthlyReviewError(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [identity.allowed]);

  const sortedPeriods = useMemo(() => [...periods].sort((a, b) => b.year - a.year || b.month - a.month), [periods]);

  async function createPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || identity.profile?.role !== 'admin') return;
    setError(''); setMessage('');
    const [year, selectedMonth] = month.split('-').map(Number);
    if (!name.trim() || !Number.isInteger(year) || year < 1900 || year > 9999 || !Number.isInteger(selectedMonth) || selectedMonth < 1 || selectedMonth > 12) {
      setError('Please enter a period name and a valid month.'); return;
    }
    setSaving(true);
    try {
      const { data, error: insertError } = await supabase.from('monthly_review_periods')
        .insert({ name: name.trim(), year, month: selectedMonth, created_by: identity.profile.id })
        .select('*').single();
      if (insertError) throw insertError;
      setPeriods(prev => [...prev, data as MonthlyReviewPeriod]);
      setShowForm(false); setName(''); setMessage('Monthly review period created.');
    } catch (err) { setError(monthlyReviewError(err as { message: string; code?: string })); }
    finally { setSaving(false); }
  }

  async function togglePeriod(period: MonthlyReviewPeriod) {
    if (saving || identity.profile?.role !== 'admin') return;
    setSaving(true); setError(''); setMessage('');
    try {
      const { data, error: updateError } = await supabase.from('monthly_review_periods')
        .update({ status: period.status === 'open' ? 'closed' : 'open' }).eq('id', period.id).select('*').single();
      if (updateError) throw updateError;
      setPeriods(prev => prev.map(row => row.id === data.id ? data as MonthlyReviewPeriod : row));
      setMessage(data.status === 'open' ? 'Period reopened.' : 'Period closed.');
    } catch (err) { setError(monthlyReviewError(err as { message: string; code?: string })); }
    finally { setSaving(false); }
  }

  return <ReviewShell title="Monthly Progress Review">
    {!identity.allowed ? <AccessState identity={identity} /> : <>
      <div className={styles.toolbar}><h2>Monthly periods</h2>
        {identity.profile?.role === 'admin' && <button className="btn btn-primary" type="button" onClick={() => setShowForm(!showForm)} aria-expanded={showForm} disabled={saving}>
          {showForm ? 'Cancel' : '+ Create monthly review period'}
        </button>}
      </div>
      {showForm && <form className={styles.createForm} onSubmit={createPeriod}>
        <label>Period name<input value={name} onChange={e => setName(e.target.value)} required disabled={saving} maxLength={200} /></label>
        <label>Month<input type="month" value={month} onChange={e => setMonth(e.target.value)} min="1900-01" max="9999-12" required disabled={saving} /></label>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create period'}</button>
      </form>}
      {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
      {loading ? <Notice>Loading periods...</Notice> : periods.length === 0 ? <Notice>No monthly review periods yet.</Notice> :
        <div className={styles.tableWrap}><table><thead><tr><th>Period</th><th>Month</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{sortedPeriods.map(period => <tr key={period.id}>
            <td><Link href={monthlyReviewHref(mode, period.id)}>{period.name}</Link></td>
            <td>{period.year}-{String(period.month).padStart(2, '0')}</td><td>{period.status === 'open' ? 'Open' : 'Closed'}</td>
            <td><div className={styles.actions}><Link className="btn btn-secondary" href={monthlyReviewHref(mode, period.id)}>View employees</Link>
              {identity.profile?.role === 'admin' && <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => togglePeriod(period)}>{period.status === 'open' ? 'Close period' : 'Reopen period'}</button>}
            </div></td>
          </tr>)}</tbody>
        </table></div>}
    </>}
  </ReviewShell>;
}

export function MonthlyOverviewPage({ mode }: { mode: MonthlyReviewMode }) {
  const { period_id: periodId } = useParams<{ period_id: string }>();
  const identity = useReviewer(mode);
  const [period, setPeriod] = useState<MonthlyReviewPeriod | null>(null);
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [reviews, setReviews] = useState<MonthlyProgressReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (!identity.allowed || !identity.profile) return;
    const actor = identity.profile;
    let active = true;
    setLoading(true); setError(''); setPeriod(null);
    async function load() {
      try {
        const filters: Record<string, string> = { role: 'user' };
        if (actor.role === 'manager' && actor.team_id) filters.team_id = actor.team_id;
        const [periods, people, groups, saved] = await Promise.all([
          loadMonthlyRows<MonthlyReviewPeriod>('monthly_review_periods', { id: periodId }),
          actor.role === 'manager' && !actor.team_id ? Promise.resolve([]) : loadMonthlyRows<Profile>('profiles', filters),
          loadMonthlyRows<Team>('teams'),
          loadMonthlyRows<MonthlyProgressReview>('monthly_progress_reviews', { period_id: periodId }),
        ]);
        if (!periods[0]) throw new Error('Monthly review period was not found.');
        if (active) {
          setPeriod(periods[0]); setEmployees(people.filter(person => canReviewEmployee(actor, person)));
          setTeams(groups); setReviews(saved);
        }
      } catch (err) { if (active) setError(monthlyReviewError(err as { message: string; code?: string })); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [identity.allowed, identity.profile, periodId]);

  const reviewByEmployee = useMemo(() => new Map(reviews.map(row => [row.employee_id, row])), [reviews]);
  const teamNames = useMemo(() => new Map(teams.map(team => [team.id, team.name])), [teams]);
  const sortedEmployees = useMemo(() => [...employees].sort((a, b) => a.display_name.localeCompare(b.display_name)), [employees]);
  const filtered = sortedEmployees.filter(person => {
    const status = reviewByEmployee.get(person.display_name)?.review_status ?? 'not_reviewed';
    return (!teamFilter || (teamFilter === '__none__' ? !person.team_id : person.team_id === teamFilter)) &&
      (!employeeFilter || person.display_name === employeeFilter) && (!statusFilter || status === statusFilter);
  });
  const reviewedCount = employees.filter(person => reviewByEmployee.get(person.display_name)?.review_status === 'reviewed').length;

  return <ReviewShell title={period?.name ?? 'Monthly Progress Review'} backHref={monthlyReviewHref(mode)} backLabel="Back to periods">
    {!identity.allowed ? <AccessState identity={identity} /> : <>
      {error && <Notice error>{error}</Notice>}
      {loading ? <Notice>Loading employees...</Notice> : period && <>
        <div className={styles.toolbar}><h2>{period.year}-{String(period.month).padStart(2, '0')}</h2><span>{period.status === 'open' ? 'Open' : 'Closed'}</span></div>
        <dl className={styles.summary}><div><dt>Employees</dt><dd>{employees.length}</dd></div><div><dt>Reviewed</dt><dd>{reviewedCount}</dd></div><div><dt>Not reviewed</dt><dd>{employees.length - reviewedCount}</dd></div></dl>
        <div className={styles.filters}>
          <label>Team<select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}><option value="">All teams</option><option value="__none__">No team</option>{teams.filter(team => employees.some(person => person.team_id === team.id)).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <label>Employee<select value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}><option value="">All employees</option>{sortedEmployees.map(person => <option key={person.id} value={person.display_name}>{person.display_name}</option>)}</select></label>
          <label>Review status<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All statuses</option><option value="not_reviewed">Not reviewed</option><option value="reviewed">Reviewed</option></select></label>
        </div>
        {filtered.length === 0 ? <Notice>No employees for the selected filters.</Notice> : <div className={styles.tableWrap}><table><thead><tr><th>Employee</th><th>Team</th><th>Review status</th><th>Reviewed at</th><th>Review</th></tr></thead>
          <tbody>{filtered.map(person => {
            const review = reviewByEmployee.get(person.display_name);
            return <tr key={person.id}><td>{person.display_name}</td><td>{teamNames.get(person.team_id ?? '') ?? '-'}</td><td><Status reviewed={review?.review_status === 'reviewed'} /></td><td>{formatMonthlyReviewDate(review?.reviewed_at)}</td><td><Link className="btn btn-secondary" href={monthlyReviewHref(mode, periodId, person.display_name)}>Open review</Link></td></tr>;
          })}</tbody>
        </table></div>}
      </>}
    </>}
  </ReviewShell>;
}

export function MonthlyEmployeePage({ mode }: { mode: MonthlyReviewMode }) {
  const { period_id: periodId, employee_id: employeeId } = useParams<{ period_id: string; employee_id: string }>();
  const identity = useReviewer(mode);
  const [period, setPeriod] = useState<MonthlyReviewPeriod | null>(null);
  const [employee, setEmployee] = useState<Profile | null>(null);
  const [teamName, setTeamName] = useState('-');
  const [tasks, setTasks] = useState<MonthlyReviewTask[]>([]);
  const [review, setReview] = useState<MonthlyProgressReview | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!identity.allowed || !identity.profile) return;
    const actor = identity.profile;
    let active = true;
    setLoading(true); setError(''); setMessage(''); setEmployee(null); setPeriod(null); setReview(null); setTasks([]); setComment('');
    async function load() {
      try {
        const people = await loadMonthlyRows<Profile>('profiles', { display_name: employeeId, role: 'user' });
        const person = people[0];
        if (!person || !canReviewEmployee(actor, person)) throw new Error('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
        const [periods, currentTasks, saved, teams] = await Promise.all([
          loadMonthlyRows<MonthlyReviewPeriod>('monthly_review_periods', { id: periodId }),
          loadMonthlyRows<MonthlyReviewTask>('tasks', { assignee: person.display_name }),
          loadMonthlyRows<MonthlyProgressReview>('monthly_progress_reviews', { period_id: periodId, employee_id: person.display_name }),
          person.team_id ? loadMonthlyRows<Team>('teams', { id: person.team_id }) : Promise.resolve([]),
        ]);
        if (!periods[0]) throw new Error('Monthly review period was not found.');
        if (active) {
          setEmployee(person); setPeriod(periods[0]); setTasks(currentTasks); setReview(saved[0] ?? null);
          setComment(saved[0]?.review_comment ?? ''); setTeamName(teams[0]?.name ?? '-');
        }
      } catch (err) { if (active) setError(monthlyReviewError(err as { message: string; code?: string })); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [identity.allowed, identity.profile, periodId, employeeId]);

  const taskRows = useMemo(() => getHierarchicalTaskRows(tasks), [tasks]);
  const readOnly = period?.status !== 'open';

  async function save(markReviewed: boolean) {
    if (saving || readOnly || !employee || !identity.profile || !canReviewEmployee(identity.profile, employee)) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const { data, error: saveError } = await supabase.rpc('save_monthly_progress_review', {
        target_period_id: periodId, target_employee_id: employee.display_name,
        comment_text: comment, mark_reviewed: markReviewed,
      }).single();
      if (saveError) throw saveError;
      const saved = data as MonthlyProgressReview;
      if (!saved?.id) throw new Error('No saved review was returned. Please refresh and check the review.');
      setReview(saved); setComment(saved.review_comment ?? '');
      setMessage(markReviewed ? 'Marked as reviewed.' : 'Comment saved.');
    } catch (err) { setError(monthlyReviewError(err as { message: string; code?: string })); }
    finally { setSaving(false); }
  }

  return <ReviewShell title={employee?.display_name ?? 'Employee progress review'} backHref={monthlyReviewHref(mode, periodId)} backLabel="Back to employees">
    {!identity.allowed ? <AccessState identity={identity} /> : <>
      {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
      {loading ? <Notice>Loading employee progress...</Notice> : employee && period && <>
        <div className={styles.toolbar}><div><h2>{period.name}</h2><p className={styles.muted}>{employee.email} &middot; {teamName}</p></div><Status reviewed={review?.review_status === 'reviewed'} /></div>
        <div className={styles.toolbar}><h2>Current tasks <span className={styles.muted}>({taskRows.length})</span></h2><span className={styles.muted}>Reviewed at: {formatMonthlyReviewDate(review?.reviewed_at)}</span></div>
        {taskRows.length === 0 ? <Notice>No current tasks for this employee.</Notice> : <div className={styles.tableWrap}><table className={styles.taskTable}>
          <thead><tr><th>Task</th><th>Status</th><th>Progress</th><th>Progress summary</th><th>Weight</th><th>Work type</th><th>Updated at</th></tr></thead>
          <tbody>{taskRows.map(({ task, depth }) => <tr key={task.id}>
            <td style={{ paddingLeft: 12 + Math.min(depth, 8) * 16 }}><div>{task.name}</div>{task.task_source === 'user_added' && <span className={styles.muted}>User-added</span>}</td>
            <td>{task.status}</td><td><div className={styles.progress}><progress max={100} value={Number.isFinite(Number(task.progress)) ? Math.min(100, Math.max(0, Number(task.progress))) : 0} aria-label={`${task.name} progress`} /><span>{task.progress ?? 0}%</span></div></td>
            <td className={styles.preWrap}>{task.progress_summary || '-'}</td><td>{task.weight ?? '-'}</td><td>{getWorkTypeLabel(task.work_type)}</td><td>{formatMonthlyReviewDate((task as MonthlyReviewTask).updated_at)}</td>
          </tr>)}</tbody>
        </table></div>}
        <section className={styles.commentSection}>
          <h2>Management review</h2>
          {readOnly && <Notice>This period is closed. Reviews are read-only.</Notice>}
          <label>Review comment<textarea value={comment} onChange={e => { setComment(e.target.value); setMessage(''); }} rows={6} disabled={saving || readOnly} /></label>
          <div className={styles.actions}><button className="btn btn-secondary" type="button" disabled={saving || readOnly} onClick={() => save(false)}>{saving ? 'Saving...' : 'Save comment'}</button><button className="btn btn-primary" type="button" disabled={saving || readOnly} onClick={() => save(true)}>Mark as reviewed</button></div>
        </section>
      </>}
    </>}
  </ReviewShell>;
}
