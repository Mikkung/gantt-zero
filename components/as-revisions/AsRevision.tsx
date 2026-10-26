'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Profile, Team } from '../../types';
import { supabase } from '../../utils/supabase';
import { canAddRevisionTasks, canDeleteRevisionPeriod, canUseRevisionArea, effectiveRevisionAction, excludedRevisionAncestor, isEligibleRevisionEmployee, requiresRevisionApproval, revisionBranch, revisionError, revisionRows, revisionRpc, REVISION_FIELDS, revisionDifferences, revisionWeightBreakdown, validateRevision, type RevisionBusiness, type RevisionDeletionPreview, type RevisionItem, type RevisionPeriod, type RevisionRequest, type RevisionWorkspace } from '../../utils/asRevision';
import styles from './AsRevision.module.css';
import { compareTaskOutline } from '../../utils/evaluationTasks';
function orderedItems(items: RevisionItem[]) {
    const rows: {
        item: RevisionItem;
        depth: number;
    }[] = [];
    const visited = new Set<string>();
    const walk = (item: RevisionItem, depth: number) => {
        if (visited.has(item.id))
            return;
        visited.add(item.id);
        rows.push({ item, depth });
        items.filter(child => child.parent_task_id === item.source_task_id)
            .sort((a, b) => compareTaskOutline(a.business.name, b.business.name)).forEach(child => walk(child, depth + 1));
    };
    [...items].sort((a, b) => compareTaskOutline(a.business.name, b.business.name))
        .filter(item => !items.some(parent => parent.source_task_id === item.parent_task_id)).forEach(item => walk(item, 0));
    items.forEach(item => walk(item, 0));
    return rows;
}
function weightLabel(value: number) { return `${Number(value.toFixed(2))}%`; }
function useIdentity(area: 'setup' | 'employee' | 'review') {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const router = useRouter();
    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const { data: { user }, error: authError } = await supabase.auth.getUser();
                if (authError)
                    throw authError;
                if (!user) {
                    router.replace('/login');
                    return;
                }
                const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
                if (error)
                    throw error;
                if (active)
                    setProfile(data as Profile | null);
            }
            catch (error) {
                if (active)
                    setError(revisionError(error));
            }
            finally {
                if (active)
                    setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [router]);
    return { profile, loading, error, allowed: canUseRevisionArea(profile, area) };
}
export function RevisionBadge({ status }: {
    status: string;
}) {
    return <span className={`${styles.badge} ${styles[status] ?? ''}`}>{status.replaceAll('_', ' ')}</span>;
}
function Shell({ title, profile, children }: {
    title: string;
    profile: Profile | null;
    children: React.ReactNode;
}) {
    return <main className={styles.page}><header className={styles.header}><div><h1>{title}</h1><p>ISE Work Tracker</p></div>
    <nav className={styles.nav}><Link className="btn btn-secondary" href="/">Back to Main App</Link>
      {profile?.role === 'admin' && <Link href="/admin/as-revisions">Period setup</Link>}
      {profile?.role === 'user' && <Link href="/employee/as-revisions">My AS Revision</Link>}
      {(profile?.role === 'admin' || profile?.role === 'manager') && <Link href={profile.role === 'admin' ? '/admin/as-revisions/reviews' : '/manager/as-revisions'}>Review inbox</Link>}
    </nav></header>{children}</main>;
}
function Access({ identity }: {
    identity: ReturnType<typeof useIdentity>;
}) {
    return <p className={styles.error}>{identity.loading ? 'Loading...' : identity.error || 'คุณไม่มีสิทธิ์เข้าถึงหน้านี้'}</p>;
}
function localDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function RevisionPeriods() {
    const identity = useIdentity('setup');
    const router = useRouter();
    const { period_id } = useParams<{
        period_id?: string;
    }>();
    const [periods, setPeriods] = useState<RevisionPeriod[]>([]);
    const [requests, setRequests] = useState<RevisionRequest[]>([]);
    const [people, setPeople] = useState<Profile[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [items, setItems] = useState<RevisionItem[]>([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [message, setMessage] = useState('');
    const [deletionPreview, setDeletionPreview] = useState<RevisionDeletionPreview | null>(null);
    const [deletionTitle, setDeletionTitle] = useState('');
    const [form, setForm] = useState({ title: '', year: new Date().getFullYear(), cycle: 'Annual', starts_at: '', ends_at: '', eligible_team_ids: [] as string[], eligible_profile_ids: [] as string[] });
    const selected = periods.find(period => period.id === period_id);
    async function load() { try {
        const [p, r, u, t, i] = await Promise.all([revisionRows<RevisionPeriod>('as_revision_periods'), revisionRows<RevisionRequest>('as_revision_requests'), revisionRows<Profile>('profiles'), revisionRows<Team>('teams'), revisionRows<RevisionItem>('as_revision_items')]);
        setPeriods(p);
        setRequests(r);
        setPeople(u.filter(isEligibleRevisionEmployee));
        setTeams(t);
        setItems(i);
    }
    catch (error) {
        setError(revisionError(error));
    } }
    useEffect(() => { if (identity.allowed)
        void load(); }, [identity.allowed]);
    useEffect(() => { if (selected) {
        setForm({ ...selected, starts_at: localDate(selected.starts_at), ends_at: localDate(selected.ends_at) });
        setShowForm(true);
    } }, [selected?.id, selected?.revision]);
    useEffect(() => { setDeletionPreview(null); setDeletionTitle(''); }, [period_id, selected?.revision]);
    async function save(event: React.FormEvent) {
        event.preventDefault();
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            const saved = await revisionRpc<RevisionPeriod>('as_revision_save_period', { target_period_id: selected?.id ?? null, expected_revision: selected?.revision ?? 0,
                configuration: { ...form, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString() } });
            await load();
            router.push(`/admin/as-revisions/${saved.id}`);
        }
        catch (error) {
            setError(revisionError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function changeStatus(status: 'open' | 'closed') {
        if (!selected || busy || !confirm(status === 'open' ? 'Open this revision period and capture eligible baselines if not already initialized?' : 'Close employee editing? Submitted revisions remain reviewable.'))
            return;
        setBusy(true);
        setError('');
        try {
            await revisionRpc('as_revision_set_period_status', { target_period_id: selected.id, new_status: status, expected_revision: selected.revision });
            await load();
        }
        catch (error) {
            setError(revisionError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function deletePeriod(period: RevisionPeriod) {
        if (!identity.allowed || busy || !canDeleteRevisionPeriod(period, requests)) return;
        if (!confirm(`Delete AS Revision period "${period.title}"? This cannot be undone.`)) return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            await revisionRpc('as_revision_delete_period', { target_period_id: period.id, expected_revision: period.revision });
            periodDeleted(period.id);
        } catch (error) {
            setError(revisionError(error));
        } finally {
            setBusy(false);
        }
    }
    function periodDeleted(id: string) {
        const deletedRequests = new Set(requests.filter(request => request.period_id === id).map(request => request.id));
        setPeriods(current => current.filter(period => period.id !== id));
        setRequests(current => current.filter(request => request.period_id !== id));
        setItems(current => current.filter(item => !deletedRequests.has(item.request_id)));
        setDeletionPreview(null); setDeletionTitle('');
        setMessage('AS Revision period deleted.');
        if (period_id === id) {
            setShowForm(false);
            setForm({ title: '', year: new Date().getFullYear(), cycle: 'Annual', starts_at: '', ends_at: '', eligible_team_ids: [], eligible_profile_ids: [] });
            router.replace('/admin/as-revisions');
        }
    }
    async function previewDeletion() {
        if (!identity.allowed || !selected || busy || selected.status !== 'closed') return;
        setBusy(true); setError(''); setMessage(''); setDeletionPreview(null); setDeletionTitle('');
        try {
            setDeletionPreview(await revisionRpc<RevisionDeletionPreview>('as_revision_period_deletion_preview', { target_period_id: selected.id }));
        } catch (error) { setError(revisionError(error)); }
        finally { setBusy(false); }
    }
    async function deleteUnpublishedPeriod(event: React.FormEvent) {
        event.preventDefault();
        if (!identity.allowed || !selected || busy || !deletionPreview?.can_delete || deletionPreview.period_id !== selected.id || selected.status !== 'closed' || deletionTitle !== deletionPreview.title) return;
        setBusy(true); setError('');
        try {
            await revisionRpc('as_revision_delete_unpublished_period', { target_period_id: selected.id,
                expected_revision: deletionPreview.revision, confirmation_title: deletionTitle, expected_contents_token: deletionPreview.contents_token });
            periodDeleted(selected.id);
        } catch (error) {
            setError(revisionError(error)); setDeletionPreview(null); setDeletionTitle('');
            await load();
        } finally { setBusy(false); }
    }
    const deleteButton = (period: RevisionPeriod) => <span title={canDeleteRevisionPeriod(period, requests) ? 'Delete empty AS Revision period' : 'For periods with revisions, close editing and use the confirmed cleanup on the period detail page. Published periods cannot be deleted.'}>
        <button type="button" className={`btn btn-secondary ${styles.dangerButton}`} disabled={busy || !canDeleteRevisionPeriod(period, requests)} onClick={() => deletePeriod(period)}>Delete period</button>
    </span>;
    const captured = !!selected && requests.some(request => request.period_id === selected.id);
    const toggle = (key: 'eligible_team_ids' | 'eligible_profile_ids', id: string) => setForm(current => ({ ...current, [key]: current[key].includes(id) ? current[key].filter(value => value !== id) : [...current[key], id] }));
    return <Shell title="AS Revision Period Setup" profile={identity.profile}>{!identity.allowed ? <Access identity={identity}/> : <>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}
    <section className={styles.section}><div className={styles.actions}><button type="button" className="btn btn-primary" onClick={() => { setShowForm(true); if (period_id)
            router.push('/admin/as-revisions'); }}>Create revision period</button>
      {selected && <><RevisionBadge status={selected.status}/><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => changeStatus(selected.status === 'open' ? 'closed' : 'open')}>{selected.status === 'open' ? 'Close editing' : 'Open period'}</button>{deleteButton(selected)}</>}</div>
      {showForm && <form onSubmit={save}><div className={styles.fields} style={{ marginTop: 14 }}>
        <label>Period title<input required value={form.title} onChange={event => setForm({ ...form, title: event.target.value })}/></label>
        <label>Year<input required type="number" min={2000} max={3000} value={form.year} onChange={event => setForm({ ...form, year: Number(event.target.value) })}/></label>
        <label>Cycle<input required value={form.cycle} onChange={event => setForm({ ...form, cycle: event.target.value })}/></label>
        <label>Start<input required type="datetime-local" value={form.starts_at} onChange={event => setForm({ ...form, starts_at: event.target.value })}/></label>
        <label>End<input required type="datetime-local" value={form.ends_at} onChange={event => setForm({ ...form, ends_at: event.target.value })}/></label>
        <label>Official weight target<input value="100%" readOnly/></label>
      </div><h3>Eligible teams</h3><div className={styles.checks}>{teams.map(team => <label key={team.id}><input type="checkbox" disabled={captured} checked={form.eligible_team_ids.includes(team.id)} onChange={() => toggle('eligible_team_ids', team.id)}/>{team.name}</label>)}</div>
      <h3>Eligible employees</h3><div className={styles.checks}>{people.map(person => <label key={person.id}><input type="checkbox" disabled={captured} checked={form.eligible_profile_ids.includes(person.id)} onChange={() => toggle('eligible_profile_ids', person.id)}/>{person.display_name}</label>)}</div>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save period'}</button></form>}
    </section>
    <section className={styles.section}><h2>Revision periods</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Period</th><th>Window</th><th>Status</th><th>Employees</th><th>Actions</th></tr></thead><tbody>{periods.map(period => <tr key={period.id}><td><Link href={`/admin/as-revisions/${period.id}`}>{period.title}</Link><div>{period.year} / {period.cycle}</div></td><td>{new Date(period.starts_at).toLocaleString()} – {new Date(period.ends_at).toLocaleString()}</td><td><RevisionBadge status={period.status}/></td><td>{requests.filter(request => request.period_id === period.id).length}</td><td>{deleteButton(period)}</td></tr>)}</tbody></table></div></section>
    {selected && <section className={styles.section}><h2>Employee progress</h2><RequestTable requests={requests.filter(request => request.period_id === selected.id)} periods={periods} items={items} teams={teams} reviewBase="/admin/as-revisions/reviews"/>
    </section>}
    {selected && <section className={styles.section} aria-labelledby="delete-revision-period-heading">
      <h2 id="delete-revision-period-heading">ลบ Period และข้อมูล Revision ทั้งหมด</h2>
      <p className={styles.error}>ลบถาวรทั้งรอบ รวมร่าง รายการ Submit เวอร์ชัน และประวัติ Review ของพนักงานทุกคนในรอบนี้ ไม่สามารถกู้คืนผ่านแอปได้ งานจริงและข้อมูลประเมินจะไม่ถูกลบ</p>
      {selected.status !== 'closed' && <p className={styles.notice}>ต้อง Close editing ก่อนลบ Period</p>}
      {requests.some(request => request.period_id === selected.id && (request.status === 'published' || !!request.published_at)) && <p className={styles.error}>ลบไม่ได้: มี Revision ที่ Published แล้วในรอบนี้</p>}
      <button type="button" className={`btn btn-secondary ${styles.dangerButton}`} disabled={busy || selected.status !== 'closed' || requests.some(request => request.period_id === selected.id && (request.status === 'published' || !!request.published_at))} onClick={previewDeletion}>ตรวจสอบข้อมูลก่อนลบ</button>
      {deletionPreview && <form onSubmit={deleteUnpublishedPeriod} className={styles.deletionForm}>
        <h3>{deletionPreview.title}</h3>
        <dl className={styles.deletionCounts}>{([['employees', 'พนักงาน / Revision'], ['drafts', 'Draft'], ['submitted', 'Submitted'], ['returned', 'Returned'], ['approved', 'Approved'], ['cancelled', 'Cancelled'], ['published', 'Published'], ['items', 'รายการงานในร่าง'], ['versions', 'เวอร์ชัน Submit'], ['reviews', 'ประวัติ Review'], ['publications', 'ประวัติ Publish']] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{deletionPreview.counts[key]}</dd></div>)}</dl>
        {!deletionPreview.can_delete ? <p className={styles.error} role="alert">{deletionPreview.blocked_reason}</p> : <label className={styles.field}>พิมพ์ชื่อ Period เพื่อยืนยัน: {deletionPreview.title}<input value={deletionTitle} disabled={busy} autoComplete="off" onChange={event => setDeletionTitle(event.target.value)}/></label>}
        <div className={styles.actions}><button type="submit" className={`btn btn-secondary ${styles.dangerButton}`} disabled={busy || !deletionPreview.can_delete || deletionTitle !== deletionPreview.title}>ลบ Period และข้อมูล Revision ทั้งหมด</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setDeletionPreview(null); setDeletionTitle(''); }}>Cancel deletion</button></div>
      </form>}
    </section>}
  </>}</Shell>;
}
function RequestTable({ requests, periods, items, teams, reviewBase }: {
    requests: RevisionRequest[];
    periods: RevisionPeriod[];
    items: RevisionItem[];
    teams: Team[];
    reviewBase?: string;
}) {
    return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Employee / team</th><th>Period</th><th>Status</th><th>Required / approved / returned / pending</th><th>Submitted</th><th>Open</th></tr></thead><tbody>{requests.map(request => {
            const required = items.filter(item => item.request_id === request.id && requiresRevisionApproval(item, items));
            const approved = required.filter(item => item.review_status === 'approved').length;
            const returned = required.filter(item => item.review_status === 'returned').length;
            return <tr key={request.id}><td>{request.employee_id}<div className={styles.muted}>{teams.find(team => team.id === request.team_id)?.name ?? 'No team'}</div></td><td>{periods.find(period => period.id === request.period_id)?.title ?? '-'}</td><td><RevisionBadge status={request.status}/></td><td>{required.length} / {approved} / {returned} / {required.length - approved - returned}</td><td>{request.submitted_at ? new Date(request.submitted_at).toLocaleString() : '-'}</td><td><Link className="btn btn-secondary" href={`${reviewBase ?? '/employee/as-revisions'}/${request.id}`}>Open</Link></td></tr>;
        })}</tbody></table>{requests.length === 0 && <p className={styles.notice}>No AS revisions available.</p>}</div>;
}
export function RevisionRequests({ review = false }: {
    review?: boolean;
}) {
    const identity = useIdentity(review ? 'review' : 'employee');
    const [requests, setRequests] = useState<RevisionRequest[]>([]);
    const [periods, setPeriods] = useState<RevisionPeriod[]>([]);
    const [items, setItems] = useState<RevisionItem[]>([]);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('');
    const [search, setSearch] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const [teams, setTeams] = useState<Team[]>([]);
    const [teamFilter, setTeamFilter] = useState('');
    const [periodFilter, setPeriodFilter] = useState('');
    useEffect(() => {
        if (!identity.allowed)
            return;
        let active = true;
        const load = () => void Promise.all([revisionRows<RevisionRequest>('as_revision_requests'), revisionRows<RevisionPeriod>('as_revision_periods'), revisionRows<RevisionItem>('as_revision_items'), revisionRows<Team>('teams')])
            .then(([r, p, i, t]) => { if (active) {
            setRequests(r);
            setPeriods(p);
            setItems(i);
            setTeams(t);
        } }).catch(error => { if (active)
            setError(revisionError(error)); });
        load();
        window.addEventListener('focus', load);
        return () => { active = false; window.removeEventListener('focus', load); };
    }, [identity.allowed, refreshKey]);
    return <Shell title={review ? 'AS Revision Review' : 'My AS Revision'} profile={identity.profile}>{!identity.allowed ? <Access identity={identity}/> : <>
    {error && <p className={styles.error} role="alert">{error}</p>}{review && <p className={styles.notice} role="status">Awaiting review: {requests.filter(request => request.status === 'submitted').length}</p>}<button type="button" className="btn btn-secondary" onClick={() => setRefreshKey(key => key + 1)}>Refresh</button><section className={styles.section}><div className={styles.fields}>
      <label>Employee<input value={search} onChange={event => setSearch(event.target.value)}/></label><label>Status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="">All statuses</option>{['draft', 'submitted', 'returned', 'published', 'cancelled'].map(status => <option key={status}>{status}</option>)}</select></label>
      <label>Period<select value={periodFilter} onChange={event => setPeriodFilter(event.target.value)}><option value="">All periods</option>{periods.map(period => <option key={period.id} value={period.id}>{period.title}</option>)}</select></label>
      {review && <label>Team<select value={teamFilter} onChange={event => setTeamFilter(event.target.value)}><option value="">All permitted teams</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
    </div><RequestTable requests={requests.filter(request => (!filter || request.status === filter) && (!periodFilter || request.period_id === periodFilter) && (!teamFilter || request.team_id === teamFilter) && request.employee_id.toLowerCase().includes(search.toLowerCase()))} periods={periods} items={items} teams={teams} reviewBase={review ? (identity.profile?.role === 'admin' ? '/admin/as-revisions/reviews' : '/manager/as-revisions') : undefined}/></section>
  </>}</Shell>;
}
export function RevisionWorkspacePage({ review = false, compare = false }: {
    review?: boolean;
    compare?: boolean;
}) {
    const identity = useIdentity(review ? 'review' : 'employee');
    const { request_id } = useParams<{
        request_id: string;
    }>();
    const [workspace, setWorkspace] = useState<RevisionWorkspace | null>(null);
    const [error, setError] = useState('');
    const [items, setItems] = useState<RevisionItem[]>([]);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [versionId, setVersionId] = useState('');
    const [comments, setComments] = useState<Record<string, string>>({});
    const [exceptionReason, setExceptionReason] = useState('');
    const [extension, setExtension] = useState('');
    const [showNewTask, setShowNewTask] = useState(false);
    const [newTaskName, setNewTaskName] = useState('');
    const [newTaskParent, setNewTaskParent] = useState('');
    const [newTaskOfficial, setNewTaskOfficial] = useState(true);
    async function load() { setError(''); try {
        const result = await revisionRpc<RevisionWorkspace>('as_revision_workspace', { target_request_id: request_id });
        setWorkspace(result);
        setItems(result.items);
        setDirty(false);
        setConfirmed(false);
    }
    catch (error) {
        setError(revisionError(error));
    } }
    useEffect(() => { if (identity.allowed)
        void load(); }, [identity.allowed, request_id]);
    useEffect(() => {
        if (showNewTask && typeof document !== 'undefined')
            document.querySelector<HTMLInputElement>('#revision-new-task input')?.focus();
    }, [showNewTask, newTaskParent]);
    function updateItem(id: string, change: Partial<RevisionItem>) { setItems(current => current.map(item => item.id === id ? { ...item, ...change } : item)); setDirty(true); setMessage(''); setConfirmed(false); }
    function changeBusiness(item: RevisionItem, key: keyof RevisionBusiness, value: unknown) { updateItem(item.id, { business: { ...item.business, [key]: value } }); }
    async function save() {
        if (!workspace || busy)
            return;
        setBusy(true);
        setError('');
        try {
            await revisionRpc('as_revision_save_draft', { target_request_id: request_id, expected_draft_revision: workspace.request.draft_revision,
                item_changes: items.map(({ id, action, business }) => ({ id, action, business })) });
            await load();
            setMessage('Draft saved.');
        }
        catch (error) {
            setError(revisionError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function submit() {
        if (!workspace || busy || dirty || !confirmed)
            return;
        setBusy(true);
        setError('');
        try {
            await revisionRpc('as_revision_submit', { target_request_id: request_id, expected_draft_revision: workspace.request.draft_revision, comparison_confirmed: confirmed });
            await load();
            setMessage('AS revision submitted for approval.');
        }
        catch (error) {
            setError(revisionError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function changeDraftTasks(refresh: boolean) {
        if (!workspace || busy || dirty || !workspace.can_edit || !canAddRevisionTasks(workspace.request, items)) return;
        if (!refresh && (!newTaskName.trim() || (!newTaskOfficial && !newTaskParent))) return;
        if (!refresh && newTaskParent && !items.some(item => item.source_task_id === newTaskParent && item.kind === 'original' && effectiveRevisionAction(item, items) === 'original')) {
            setError('Choose an included AS parent before adding a task.'); return;
        }
        setBusy(true); setError('');
        try {
            const common = { target_request_id: request_id, expected_draft_revision: workspace.request.draft_revision };
            if (refresh) await revisionRpc('as_revision_sync_added_tasks', common);
            else await revisionRpc('as_revision_add_task', { ...common, job_name: newTaskName.trim(), target_parent_id: newTaskParent || null, make_official: newTaskOfficial });
            await load();
            if (!refresh) { setNewTaskName(''); setShowNewTask(false); }
            setMessage(refresh ? 'โหลดงาน user-added ล่าสุดเข้าร่างแล้ว กรุณาเลือกรายการที่ต้องการนำไปต่อ' : 'เพิ่มงานใหม่ในร่างแล้ว ยังไม่เผยแพร่เข้า Task Tracking');
        } catch (error) { setError(revisionError(error)); }
        finally { setBusy(false); }
    }
    async function reviewItem(action: 'comment' | 'return' | 'approve', item?: RevisionItem) {
        if (!workspace || busy || versionId)
            return;
        if (action !== 'comment' && !confirm(action === 'approve' ? item && effectiveRevisionAction(item, items) === 'exclude' ? 'Approve removal of this AS job? It and its excluded activities will be archived after all required approvals.' : 'Approve this AS job? The complete configuration publishes automatically after the last required approval.' : 'Return this scope for correction?'))
            return;
        setBusy(true);
        setError('');
        try {
            const result = await revisionRpc<RevisionRequest>('as_revision_review', { target_request_id: request_id, target_item_id: item?.id ?? null,
                review_action: action, review_comment: comments[item?.id ?? 'overall'] ?? '', expected_version: workspace.request.current_version });
            await load();
            setComments(current => ({ ...current, [item?.id ?? 'overall']: '' }));
            setMessage(result.status === 'published' ? 'All required jobs approved. AS configuration published successfully.' : action === 'return' ? 'Returned for correction.' : 'Review saved.');
        }
        catch (error) {
            setError(revisionError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function adminException(action: 'extend' | 'cancel') {
        if (busy || !exceptionReason.trim() || !confirm(action === 'cancel' ? 'Cancel this request? Its history will be retained.' : 'Grant an employee editing extension?'))
            return;
        setBusy(true);
        setError('');
        try {
            await revisionRpc('as_revision_admin_exception', { target_request_id: request_id, exception_action: action, reason: exceptionReason,
                extended_until: action === 'extend' && extension ? new Date(extension).toISOString() : null });
            await load();
            setMessage('Admin exception recorded.');
        }
        catch (error) {
            setError(revisionError(error));
        }
        finally {
            setBusy(false);
        }
    }
    const shown = versionId ? workspace?.versions.find(version => version.id === versionId)?.items ?? items : items;
    const validation = workspace ? validateRevision(shown, workspace.request.baseline, workspace.period.weight_target) : null;
    const scopeEditable = (item: RevisionItem) => !!workspace?.can_edit && !review && !compare && !versionId && !busy &&
        (workspace.request.status === 'draft' || item.review_status === 'returned');
    const editable = (item: RevisionItem) => scopeEditable(item) && effectiveRevisionAction(item, items) !== 'exclude';
    const canSelect = (item: RevisionItem) => scopeEditable(item) && !excludedRevisionAncestor(item, items);
    const canToggleOriginal = (item: RevisionItem) => canSelect(item) && revisionBranch(item, items).every(scopeEditable);
    const includedParents = items.filter(item => item.kind === 'original' && effectiveRevisionAction(item, items) === 'original');
    function toggleOriginal(item: RevisionItem, checked: boolean) {
        if (!canToggleOriginal(item)) return;
        const descendants = revisionBranch(item, items).length - 1;
        if (!checked && descendants > 0 && !confirm(`เสนอเอา "${item.business.name}" ออกจาก AS รอบใหม่พร้อมงานย่อย ${descendants} รายการ? ยังไม่มีผลกับงานจริงจนกว่า Reviewer จะอนุมัติครบ`)) return;
        updateItem(item.id, { action: checked ? 'original' : 'exclude' });
    }
    const canChangeTasks = !!workspace?.can_edit && !review && !compare && !versionId && canAddRevisionTasks(workspace.request, items);
    const existingAdded = items.filter(item => item.kind === 'user_added' && !item.is_new);
    const weightBreakdown = revisionWeightBreakdown(shown, workspace?.request.baseline)
        .sort((a, b) => compareTaskOutline(a.name, b.name));
    const openNewTask = (parent?: RevisionItem) => {
        setNewTaskParent(parent?.source_task_id ?? '');
        setNewTaskOfficial(!parent);
        setShowNewTask(true);
    };
    const reviewControls = (item?: RevisionItem) => review && workspace?.can_review && workspace.request.current_version > 0 && !versionId && workspace.request.status !== 'cancelled' &&
        <div className={styles.reviewControls}><label className={styles.field}>{item ? 'Job comment / return reason' : 'Overall comment / return reason'}<textarea rows={2} value={comments[item?.id ?? 'overall'] ?? ''} disabled={busy} onChange={event => setComments({ ...comments, [item?.id ?? 'overall']: event.target.value })}/></label>
      <div className={styles.actions}><button type="button" className="btn btn-secondary" disabled={busy || !comments[item?.id ?? 'overall']?.trim()} onClick={() => reviewItem('comment', item)}>Add comment</button>
      {workspace.request.status === 'submitted' && <><button type="button" className="btn btn-secondary" disabled={busy || !comments[item?.id ?? 'overall']?.trim()} onClick={() => reviewItem('return', item)}>Return for Revision</button>
        {item && requiresRevisionApproval(item, items) && <button type="button" className="btn btn-primary" disabled={busy || item.review_status === 'approved'} onClick={() => reviewItem('approve', item)}>{item.review_status === 'approved' ? 'Approved' : effectiveRevisionAction(item, items) === 'exclude' ? 'Approve AS removal' : 'Approve AS job'}</button>}</>}
      </div></div>;
    const businessFields = (item: RevisionItem) => <div className={styles.fields}>
    <label>Job name<input required value={item.business.name} disabled={!editable(item)} onChange={event => changeBusiness(item, 'name', event.target.value)}/></label>
    <label>Description<textarea value={item.business.description ?? ''} disabled={!editable(item)} onChange={event => changeBusiness(item, 'description', event.target.value || null)}/></label>
    <label>Work type<select value={item.business.work_type ?? ''} disabled={!editable(item)} onChange={event => changeBusiness(item, 'work_type', event.target.value || null)}><option value="">Unspecified</option>{['routine', 'strategic', 'process_improvement', 'self_development', 'other'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Output / deliverable<textarea value={item.business.output ?? ''} disabled={!editable(item)} onChange={event => changeBusiness(item, 'output', event.target.value || null)}/></label>
    <label>Frequency count<input type="number" min={0} step="any" value={item.business.frequency_count ?? ''} disabled={!editable(item)} onChange={event => changeBusiness(item, 'frequency_count', event.target.value === '' ? null : Number(event.target.value))}/></label>
    <label>Frequency unit<select value={item.business.frequency_unit ?? ''} disabled={!editable(item)} onChange={event => changeBusiness(item, 'frequency_unit', event.target.value || null)}><option value="">Unspecified</option>{[['year', 'ต่อปี'], ['month', 'ต่อเดือน'], ['academic_year', 'ต่อปีการศึกษา'], ['semester', 'ต่อภาคการศึกษา']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Time per occurrence (minutes)<input type="number" min={0} step="any" value={item.business.time_per_occurrence_minutes ?? ''} disabled={!editable(item)} onChange={event => changeBusiness(item, 'time_per_occurrence_minutes', event.target.value === '' ? null : Number(event.target.value))}/></label>
    <label>Priority<select value={item.business.priority ?? 'Medium'} disabled={!editable(item)} onChange={event => changeBusiness(item, 'priority', event.target.value)}>{['Low', 'Medium', 'High'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Start date<input type="date" value={item.business.start_date ?? ''} disabled={!editable(item)} onChange={event => changeBusiness(item, 'start_date', event.target.value || null)}/></label>
    <label>End date<input type="date" value={item.business.end_date ?? ''} disabled={!editable(item)} onChange={event => changeBusiness(item, 'end_date', event.target.value || null)}/></label>
  </div>;
    const rendered = new Set<string>();
    const renderJob = (item: RevisionItem) => {
        if (rendered.has(item.id)) return null;
        rendered.add(item.id);
        const effectiveAction = effectiveRevisionAction(item, items);
        const excludedParent = excludedRevisionAncestor(item, items);
        const isOfficial = effectiveAction === 'original' || effectiveAction === 'promote';
        const children = orderedItems(items.filter(child => child.parent_task_id === item.source_task_id));
        const available = workspace?.available_user_added_tasks?.filter(task => task.parent_id === item.source_task_id) ?? [];
        const rootWeight = weightBreakdown.find(row => row.taskId === item.source_task_id);
        return <article className={`${styles.job} ${effectiveAction === 'exclude' ? styles.excluded : ''}`} key={item.id} data-revision-task={item.source_task_id}>
          <div className={styles.jobHeading}>
            {item.kind === 'original' ? <div><h3 className={effectiveAction === 'exclude' ? styles.removedName : undefined}>{item.business.name}</h3><label className={styles.selection}><input type="checkbox" checked={effectiveAction !== 'exclude'} disabled={!canToggleOriginal(item)} onChange={event => toggleOriginal(item, event.target.checked)}/> รวมงานนี้ใน AS รอบใหม่</label></div> : <label className={styles.selection}><input type="checkbox" checked={effectiveAction !== 'exclude'} disabled={!canSelect(item)} onChange={event => updateItem(item.id, { action: event.target.checked ? (item.is_new && !item.parent_task_id ? 'promote' : 'keep') : 'exclude', business: { ...item.business, weight: 0 } })}/> {item.business.name}</label>}
            <div className={styles.actions}>{item.is_new && <RevisionBadge status="new_task"/>}<RevisionBadge status={item.review_status}/>
              {isOfficial ? <label className={styles.inlineWeight}>Official weight (%)<input type="number" min={0} max={100} step="any" value={item.business.weight ?? 0} disabled={!editable(item)} onChange={event => changeBusiness(item, 'weight', Number(event.target.value))}/></label> : <span className={styles.badge}>{effectiveAction === 'keep' ? 'Supporting / Official 0%' : item.kind === 'original' ? 'เสนอเอาออก / นับน้ำหนัก 0%' : 'Not carried forward'}</span>}
              {rootWeight?.usesChildWeights && <strong className={styles.countedWeight}>นับรวม {weightLabel(rootWeight.effectiveWeight)} จากงานย่อย AS</strong>}
            </div>
          </div>
          {item.kind === 'original' && canSelect(item) && !canToggleOriginal(item) && <p className={styles.notice}>การเอาออกหรือคืนงานนี้กระทบงานย่อย กรุณาให้ Reviewer Return ทั้งสาขาหรือทั้งฉบับก่อน</p>}
          {effectiveAction !== 'exclude' ? <>
            {item.kind === 'user_added' && <label className={styles.taskType}>Task type <select value={item.action} disabled={!editable(item)} onChange={event => updateItem(item.id, { action: event.target.value as RevisionItem['action'], business: { ...item.business, weight: 0 } })}>
              {item.parent_task_id && <option value="keep">Keep as user-added (official weight 0)</option>}<option value="promote">Official AS proposal</option>
            </select></label>}
            {item.action === 'keep' && <p className={styles.muted}>งานเสริม / น้ำหนักทางการ 0% ไม่นับรวมในยอด 100%</p>}
            <details className={styles.jobDetails}><summary>รายละเอียด{isOfficial ? 'งาน AS' : 'งานเสริม'}</summary>{businessFields(item)}</details>
          </> : <p className={styles.muted}>{excludedParent ? `เสนอเอาออกพร้อม parent: ${excludedParent.business.name}` : item.kind === 'original' ? 'เสนอเอาออก ต้องได้รับอนุมัติก่อน Archive งานจริง เก็บประวัติและน้ำหนักเดิมไว้' : item.is_new ? 'ไม่สร้างงานนี้เมื่อเผยแพร่' : 'Not carried forward; historical task retained.'}</p>}
          {item.kind === 'original' && effectiveAction !== 'exclude' && canChangeTasks && <button type="button" className="btn btn-secondary" aria-label={`เพิ่มงานย่อยใต้: ${item.business.name}`} disabled={busy || dirty} onClick={() => openNewTask(item)}>+ เพิ่มงานย่อย</button>}
          {(children.length > 0 || available.length > 0) && <div className={styles.children}>
            <h4>งานย่อยของ {item.business.name}</h4>
            {children.map(({ item: child }) => renderJob(child))}
            {available.map(task => <p className={styles.muted} key={task.id}>{task.name} / ยังไม่อยู่ในร่าง</p>)}
          </div>}
        </article>;
    };
    return <Shell title={compare ? 'Original vs Revised AS' : 'AS Revision Workspace'} profile={identity.profile}>{!identity.allowed ? <Access identity={identity}/> : <>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.success} role="status">{message}</p>}
    {workspace && <><section className={styles.section}><h2>{workspace.period.title} / {workspace.request.employee_id}</h2><div className={styles.actions}><RevisionBadge status={workspace.request.status}/><span>{dirty ? 'Unsaved changes' : 'Saved draft / version ' + workspace.request.current_version}</span>
      {!review && <>{!compare ? <Link className="btn btn-secondary" href={`/employee/as-revisions/${request_id}/compare`} onClick={event => { if (dirty) {
                    event.preventDefault();
                    setError('Save Draft before reviewing the comparison.');
                } }}>Review Changes</Link> : <Link className="btn btn-secondary" href={`/employee/as-revisions/${request_id}`}>Continue Editing</Link>}
        {workspace.can_edit && !compare && <button className="btn btn-primary" type="button" disabled={busy || !dirty} onClick={save}>Save Draft</button>}</>}
      {!review && !compare && !versionId && workspace.can_edit && <button className="btn btn-secondary" type="button" disabled={busy || !canChangeTasks} onClick={() => openNewTask()}>Add new task</button>}
      <label>Version <select value={versionId} onChange={event => setVersionId(event.target.value)}><option value="">Current saved/draft</option>{workspace.versions.map(version => <option key={version.id} value={version.id}>Submitted version {version.version_no}</option>)}</select></label><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { if (!dirty || confirm('Discard unsaved changes and reload?'))
                void load(); }}>Refresh</button></div>
      {workspace.publication && <p className={styles.success}>Published successfully. Effective AS version: {workspace.publication.effective_version} / {new Date(workspace.publication.published_at).toLocaleString()}</p>}
      {validation && <><div className={styles.metrics}><span>Before: <strong>{weightLabel(validation.before)}</strong></span><span>Revised: <strong>{validation.total === null ? '-' : weightLabel(validation.total)}</strong></span><span>Target: <strong>{weightLabel(workspace.period.weight_target)}</strong></span>
        <strong className={validation.total !== null && Math.abs(validation.total - workspace.period.weight_target) > 0.01 ? styles.overTarget : undefined}>{validation.total === null ? 'ตรวจสอบข้อมูลน้ำหนัก' : Math.abs(validation.total - workspace.period.weight_target) <= 0.01 ? 'ครบตามเป้าหมาย' : validation.total > workspace.period.weight_target ? `เกินเป้าหมาย ${weightLabel(validation.total - workspace.period.weight_target)}` : `ยังขาด ${weightLabel(workspace.period.weight_target - validation.total)}`}</strong></div>
        {weightBreakdown.length > 0 && <div className={styles.tableWrap}><table className={styles.table}><caption>น้ำหนักทางการที่นับรวมในร่าง</caption><thead><tr><th>งานหลัก AS</th><th>น้ำหนักที่ระบุ</th><th>นับรวมในยอด</th><th>รายการที่นำมาคำนวณ</th></tr></thead><tbody>
          {weightBreakdown.map(row => <tr key={row.taskId}><td>{row.name}</td><td>{weightLabel(row.storedWeight)}</td><td><strong>{weightLabel(row.effectiveWeight)}</strong></td><td>{row.usesChildWeights ? <>{row.contributions.map(child => `${child.name} ${weightLabel(child.weight)}`).join(' + ')}<div className={styles.muted}>ใช้ผลรวมงานย่อย AS แทนน้ำหนัก parent ไม่บวกซ้ำ</div></> : 'ใช้น้ำหนักของงานนี้'}</td></tr>)}
        </tbody><tfoot><tr><th colSpan={2}>รวม Official AS</th><td><strong>{validation.total === null ? '-' : weightLabel(validation.total)}</strong></td><td>งานเสริม user-added = 0%</td></tr></tfoot></table></div>}
        {validation.errors.length > 0 && <div className={styles.error} role="alert"><strong>Blocking validation</strong><ul>{validation.errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
        {validation.warnings.length > 0 && <div className={styles.notice}><strong>Recommendations</strong><ul>{validation.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}</>}
    </section>
    {(compare || review || !!versionId) ? <section className={styles.section}><h2>Original AS / Revised AS</h2>{orderedItems(shown).map(({ item, depth }) => {
                        const changed = new Set(revisionDifferences(item).map(([key]) => key));
                        const parent = shown.find(candidate => candidate.source_task_id === item.parent_task_id);
                        const excluded = effectiveRevisionAction(item, shown) === 'exclude';
                        return <div className={`${styles.job} ${excluded ? styles.excluded : ''}`} style={{ paddingLeft: Math.min(depth, 4) * 12 }} key={item.id}><h3><span className={excluded ? styles.removedName : undefined}>{item.business.name}</span> <RevisionBadge status={effectiveRevisionAction(item, shown)}/>{item.is_new && <RevisionBadge status="new_task"/>} <RevisionBadge status={(versionId ? item : workspace.items.find(current => current.id === item.id) ?? item).review_status}/>{changed.size === 0 && item.kind === 'original' && !excluded && <span className={styles.muted}> Unchanged</span>}</h3>
        {excluded && <p className={styles.notice}>{item.kind === 'original' ? 'เสนอเอางาน AS ออก / ต้องอนุมัติการเอาออก / ไม่นับน้ำหนักในร่าง' : 'ไม่รวมใน AS รอบใหม่'}{excludedRevisionAncestor(item, shown) && ` พร้อม parent: ${excludedRevisionAncestor(item, shown)!.business.name}`}</p>}
        <p className={styles.muted}>Parent: {parent?.business.name ?? 'Root AS job'} / {item.is_new ? 'New task ID' : 'Source task'}: {item.source_task_id}</p>
        <div className={styles.comparison}>{[item.original_business, item.business].map((business, index) => <div key={index}><strong>{index === 0 ? (item.is_new ? 'NOT IN ORIGINAL AS' : 'ORIGINAL AS') : 'REVISED AS'}</strong><dl>{REVISION_FIELDS.map(([key, label]) => <div key={key} className={changed.has(key) ? styles.changed : undefined}><dt>{label}</dt><dd>{index === 1 && key === 'weight' && excluded ? `0% counted / retained weight ${business.weight ?? 0}%` : String(business[key] ?? '-')}</dd></div>)}</dl></div>)}</div>
        {reviewControls(workspace.items.find(current => current.id === item.id) ?? item)}
      </div>;
                    })}</section> : <>
      <section className={styles.section}><div className={styles.jobHeading}><h2>AS jobs &amp; supporting tasks</h2>
        {workspace.can_edit && <div className={styles.actions}><button className="btn btn-secondary" type="button" disabled={busy || dirty || !canChangeTasks} onClick={() => changeDraftTasks(true)}>Refresh user-added tasks</button><span>{workspace.available_user_added_tasks?.length ?? 0} งานใหม่ที่ยังไม่อยู่ในร่าง</span></div>}
        </div>
        {dirty && workspace.can_edit && <p className={styles.notice}>มีการแก้ไขที่ยังไม่บันทึก กรุณา Save Draft ก่อนเพิ่มหรือนำงานล่าสุดเข้าร่าง</p>}
        {!workspace.can_edit && <p className={styles.notice}>รายการนี้เป็นแบบอ่านอย่างเดียว เลือกงานได้เฉพาะร่างที่อยู่ในช่วงแก้ไข</p>}
        {existingAdded.length === 0 && <p className={styles.notice}>ยังไม่มีงาน user-added ที่จับเข้าร่างรอบนี้</p>}
        {showNewTask && canChangeTasks && <form id="revision-new-task" className={styles.newTaskForm} onSubmit={event => { event.preventDefault(); void changeDraftTasks(false); }}>
          <h3>{newTaskParent ? `เพิ่มงานใต้: ${items.find(item => item.source_task_id === newTaskParent)?.business.name ?? '-'}` : 'เพิ่มงานหลัก AS ใหม่'}</h3>
          <div className={styles.fields}><label>New task name<input required value={newTaskName} onChange={event => setNewTaskName(event.target.value)} disabled={busy}/></label>
            <label>Task type<select value={newTaskOfficial ? 'official' : 'supporting'} disabled={busy} onChange={event => { const official = event.target.value === 'official'; setNewTaskOfficial(official); if (!official && !newTaskParent) setNewTaskParent(includedParents[0]?.source_task_id ?? ''); }}><option value="official">Official AS proposal</option><option value="supporting">User-added activity (official weight 0)</option></select></label>
            <label>Parent AS task<select value={newTaskParent} disabled={busy} onChange={event => setNewTaskParent(event.target.value)}><option value="">{newTaskOfficial ? 'Root AS job' : 'Choose included AS parent'}</option>{includedParents.map(item => <option key={item.id} value={item.source_task_id}>{item.business.name}</option>)}</select></label></div>
          <div className={styles.actions}><button type="submit" className="btn btn-primary" disabled={busy || dirty || !newTaskName.trim() || (!newTaskOfficial && !newTaskParent) || (!!newTaskParent && !includedParents.some(item => item.source_task_id === newTaskParent))}>Add to revision draft</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setShowNewTask(false)}>Cancel</button></div>
        </form>}
        {orderedItems(items).map(({ item }) => renderJob(item))}
      </section>
    </>}
    {compare && !review && workspace.can_edit && !versionId && <section className={styles.section}><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/> I have reviewed the original and revised AS comparison.</label><div className={styles.actions}><button className="btn btn-primary" type="button" onClick={submit} disabled={busy || dirty || !confirmed || !!validation?.errors.length}>{workspace.request.status === 'returned' ? 'Resubmit for Approval' : 'Submit for Approval'}</button></div></section>}
    {review && <section className={styles.section}><h2>Overall review</h2>{reviewControls()}</section>}
    {identity.profile?.role === 'admin' && !['published', 'cancelled'].includes(workspace.request.status) && <section className={styles.section}><h2>Admin exception</h2><div className={styles.fields}>
      <label>Reason<textarea value={exceptionReason} onChange={event => setExceptionReason(event.target.value)}/></label><label>Editing extension until<input type="datetime-local" value={extension} onChange={event => setExtension(event.target.value)}/></label>
      </div><div className={styles.actions}><button className="btn btn-secondary" type="button" disabled={busy || !extension || !exceptionReason.trim()} onClick={() => adminException('extend')}>Extend editing</button><button className="btn btn-secondary" type="button" disabled={busy || !exceptionReason.trim()} onClick={() => adminException('cancel')}>Cancel request</button></div></section>}
    <section className={styles.section}><h2>Submission and review history</h2><ul className={styles.history}>{workspace.versions.map(version => <li key={version.id}>Version {version.version_no} / {new Date(version.created_at).toLocaleString()} / {version.items.length} items</li>)}{workspace.reviews.map(event => <li key={event.id}><strong>{event.action}</strong> / {new Date(event.created_at).toLocaleString()} / {event.reviewer_id}{event.item_id && <> / {workspace.items.find(item => item.id === event.item_id)?.business.name}</>}{event.comment && <div>{event.comment}</div>}</li>)}</ul></section>
    </>}
  </>}</Shell>;
}
