import type { Profile, Task } from '../types';
import { supabase } from './supabase';
import { calculateEffectiveTaskWeight, calculateEffectiveWeightTotal, getEffectiveEvaluableTasks, getPositiveWeight, getTopLevelTasks, validateParentChildWeights } from './taskProgress';
export type RevisionAction = 'original' | 'keep' | 'promote' | 'exclude';
export type RevisionBusiness = Pick<Task, 'name' | 'description' | 'work_type' | 'output' | 'frequency_count' | 'frequency_unit' | 'time_per_occurrence_minutes' | 'weight' | 'start_date' | 'end_date' | 'priority' | 'is_recurring' | 'recurring_type' | 'recurring_interval' | 'recurring_unit' | 'dependencies'>;
export interface RevisionPeriod {
    id: string;
    title: string;
    year: number;
    cycle: string;
    starts_at: string;
    ends_at: string;
    status: 'draft' | 'open' | 'closed';
    eligible_team_ids: string[];
    eligible_profile_ids: string[];
    revision: number;
    weight_target: number;
}
export interface RevisionRequest {
    id: string;
    period_id: string;
    employee_profile_id: string;
    employee_id: string;
    team_id: string | null;
    baseline: Task[];
    status: 'draft' | 'submitted' | 'returned' | 'approved' | 'published' | 'cancelled';
    draft_revision: number;
    current_version: number;
    edit_until: string | null;
    submitted_at: string | null;
    published_at: string | null;
}
export interface RevisionDeletionPreview {
    period_id: string;
    title: string;
    revision: number;
    counts: Record<'employees' | 'drafts' | 'submitted' | 'returned' | 'approved' | 'cancelled' | 'published' | 'items' | 'versions' | 'reviews' | 'publications', number>;
    can_delete: boolean;
    blocked_reason: string | null;
    contents_token: string;
}
export interface RevisionItem {
    id: string;
    request_id: string;
    source_task_id: string;
    parent_task_id: string | null;
    kind: 'original' | 'user_added';
    action: RevisionAction;
    original_business: Partial<RevisionBusiness>;
    is_new?: boolean;
    business: RevisionBusiness;
    review_status: 'pending' | 'approved' | 'returned';
    approved_by: string | null;
}
export interface RevisionVersion {
    id: string;
    version_no: number;
    items: RevisionItem[];
    created_at: string;
    submitted_by: string;
}
export interface RevisionReview {
    id: string;
    item_id: string | null;
    version_id: string | null;
    action: string;
    comment: string | null;
    reviewer_id: string;
    created_at: string;
}
export interface RevisionWorkspace {
    request: RevisionRequest;
    period: RevisionPeriod;
    items: RevisionItem[];
    versions: RevisionVersion[];
    reviews: RevisionReview[];
    can_edit: boolean;
    can_review: boolean;
    publication: {
        effective_version: string;
        published_at: string;
    } | null;
    available_user_added_tasks?: (RevisionBusiness & { id: string; parent_id: string })[];
}
export const REVISION_FIELDS = [
    ['name', 'Job name'], ['description', 'Description'], ['work_type', 'Work type'], ['output', 'Output / deliverable'],
    ['frequency_count', 'Frequency count'], ['frequency_unit', 'Frequency unit'], ['time_per_occurrence_minutes', 'Time per occurrence (minutes)'],
    ['weight', 'Official weight'], ['start_date', 'Start date'], ['end_date', 'End date'], ['priority', 'Priority'],
    ['is_recurring', 'Recurring'], ['recurring_type', 'Recurring type'], ['recurring_interval', 'Recurring interval'],
    ['recurring_unit', 'Recurring unit'], ['dependencies', 'Dependencies'],
] as const;
export function revisionError(error: unknown) {
    const value = error as {
        code?: string;
        message?: string;
    };
    return ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(value?.code ?? '')
        ? 'AS Revision setup is missing. Apply the pending AS Revision migrations listed in docs/as-revision-system.md.'
        : value?.message ?? String(error);
}
export async function revisionRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.rpc(name, args);
    if (error)
        throw error;
    return data as T;
}
export async function revisionRows<T>(table: string): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0;; offset += 500) {
        const { data, error } = await supabase.from(table).select('*').order('id').range(offset, offset + 499);
        if (error)
            throw error;
        rows.push(...(data ?? []) as T[]);
        if (!data || data.length < 500)
            return rows;
    }
}
export function canUseRevisionArea(profile: Profile | null, area: 'setup' | 'employee' | 'review') {
    return area === 'setup' ? profile?.role === 'admin' : area === 'employee' ? profile?.role === 'user'
        : profile?.role === 'admin' || profile?.role === 'manager';
}
export function isEligibleRevisionEmployee(profile: Profile) {
    // Missing/null flags preserve compatibility with profiles created before activation tracking.
    return profile.role === 'user' && profile.is_active !== false;
}
export function canDeleteRevisionPeriod(period: Pick<RevisionPeriod, 'id' | 'status'>, requests: Pick<RevisionRequest, 'period_id'>[]) {
    return period.status !== 'open' && !requests.some(request => request.period_id === period.id);
}
export function canAddRevisionTasks(request: RevisionRequest, items: RevisionItem[]) {
    return request.status === 'draft' || (request.status === 'returned' && items.every(item => item.review_status === 'returned'));
}
export function excludedRevisionAncestor(item: RevisionItem, items: RevisionItem[]): RevisionItem | null {
    const visited = new Set([item.source_task_id]);
    let parentId = item.parent_task_id;
    while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = items.find(candidate => candidate.request_id === item.request_id && candidate.source_task_id === parentId);
        if (!parent) return null;
        if (parent.action === 'exclude') return parent;
        parentId = parent.parent_task_id;
    }
    return null;
}
export function effectiveRevisionAction(item: RevisionItem, items: RevisionItem[]): RevisionAction {
    return excludedRevisionAncestor(item, items) ? 'exclude' : item.action;
}
export function requiresRevisionApproval(item: RevisionItem, items: RevisionItem[]) {
    return item.kind === 'original' || effectiveRevisionAction(item, items) === 'promote';
}
export function revisionBranch(item: RevisionItem, items: RevisionItem[]) {
    const result: RevisionItem[] = [];
    const visited = new Set<string>();
    const pending = [item];
    while (pending.length) {
        const current = pending.pop()!;
        if (visited.has(current.source_task_id)) continue;
        visited.add(current.source_task_id);
        result.push(current);
        pending.push(...items.filter(child => child.request_id === item.request_id && child.parent_task_id === current.source_task_id));
    }
    return result;
}
export function revisionTasks(items: RevisionItem[], baseline: Task[] = []): Task[] {
    const sources = new Map(baseline.map(task => [task.id, task]));
    return items.filter(item => effectiveRevisionAction(item, items) !== 'exclude').map(item => ({
        ...sources.get(item.source_task_id), ...item.business, id: item.source_task_id,
        parent_id: item.parent_task_id, assignee: sources.get(item.source_task_id)?.assignee ?? null,
        progress: sources.get(item.source_task_id)?.progress ?? 0,
        start_date: item.business.start_date ?? null, end_date: item.business.end_date ?? null,
        status: sources.get(item.source_task_id)?.status ?? 'To Do', priority: item.business.priority ?? 'Medium',
        is_recurring: item.business.is_recurring ?? false,
        task_source: item.action === 'keep' ? 'user_added' : 'as_original',
        weight: item.action === 'keep' ? 0 : Number(item.business.weight ?? 0),
        counts_toward_assessment: item.action !== 'keep', include_in_ai_summary: true,
    }));
}
export function revisionDifferences(item: RevisionItem) {
    return REVISION_FIELDS.filter(([key]) => JSON.stringify(item.original_business[key] ?? null) !== JSON.stringify(item.business[key] ?? null));
}
export function validateRevision(items: RevisionItem[], baseline: Task[], target = 100) {
    const errors: string[] = [];
    const byId = new Map(items.map(item => [item.source_task_id, item]));
    if (byId.size !== items.length)
        errors.push('Duplicate source tasks.');
    for (const item of items) {
        if ((item.kind === 'original' && !['original', 'exclude'].includes(item.action)) ||
            (item.kind === 'user_added' && !['keep', 'promote', 'exclude'].includes(item.action))) errors.push('Invalid task selection.');
        const visited = new Set([item.source_task_id]);
        let parent = item.parent_task_id;
        while (parent) {
            const ancestor = byId.get(parent);
            if (visited.has(parent) || !ancestor || ancestor.kind !== 'original') {
                errors.push('Invalid, missing or cyclic AS parent.');
                break;
            }
            visited.add(parent);
            parent = ancestor.parent_task_id;
        }
        if (effectiveRevisionAction(item, items) === 'exclude')
            continue;
        if (item.kind === 'user_added' && !item.parent_task_id && !(item.is_new && item.action === 'promote'))
            errors.push('User-added activities require an existing AS parent.');
        if (!item.business.name?.trim())
            errors.push('Every selected job requires a name.');
        for (const field of ['weight', 'frequency_count', 'time_per_occurrence_minutes'] as const) {
            const value = item.business[field];
            if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0 || (field === 'weight' && Number(value) > 100)))
                errors.push(`${item.business.name}: invalid ${field}.`);
        }
        if (item.action === 'keep' && Number(item.business.weight ?? 0) !== 0)
            errors.push('Kept user-added tasks must have official weight 0.');
        if (item.business.start_date && item.business.end_date && item.business.end_date < item.business.start_date)
            errors.push(`${item.business.name}: end date cannot precede start date.`);
        if (item.business.work_type && !['routine', 'strategic', 'process_improvement', 'self_development', 'other'].includes(item.business.work_type))
            errors.push(`${item.business.name}: invalid work type.`);
        if (item.business.frequency_unit && !['month', 'year', 'academic_year', 'semester'].includes(item.business.frequency_unit))
            errors.push(`${item.business.name}: invalid frequency unit.`);
    }
    const tasks = revisionTasks(items, baseline);
    const total = errors.length ? null : calculateEffectiveWeightTotal(tasks);
    if (total !== null && Math.abs(total - target) > 0.01)
        errors.push(`Effective official weight must total ${target}% (currently ${total}%).`);
    return { errors: [...new Set(errors)], total, before: calculateEffectiveWeightTotal(baseline),
        warnings: errors.length ? [] : validateParentChildWeights(tasks).map(warning => `${warning.taskName}: parent weight ${warning.parentWeight}, effective children ${warning.childrenWeight}.`) };
}

// Display the same effective weights used by validation, never a parent + child sum.
export function revisionWeightBreakdown(items: RevisionItem[], baseline: Task[] = []) {
    if (validateRevision(items, baseline).total === null) return [];
    const tasks = revisionTasks(items, baseline);
    const byId = new Map(tasks.map(task => [task.id, task]));
    const evaluable = getEffectiveEvaluableTasks(tasks);
    return getTopLevelTasks(tasks).filter(task => task.counts_toward_assessment).map(task => {
        const contributions = evaluable.filter(candidate => {
            let current: Task | undefined = candidate;
            while (current) {
                if (current.id === task.id) return true;
                current = current.parent_id ? byId.get(current.parent_id) : undefined;
            }
            return false;
        }).map(candidate => ({ taskId: candidate.id, name: candidate.name, weight: getPositiveWeight(candidate.weight) }));
        return { taskId: task.id, name: task.name, storedWeight: getPositiveWeight(task.weight),
            effectiveWeight: calculateEffectiveTaskWeight(task, tasks),
            usesChildWeights: contributions.some(candidate => candidate.taskId !== task.id), contributions };
    });
}
