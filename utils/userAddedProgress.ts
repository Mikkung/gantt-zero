import type { Task } from '../types';
import { calculateEffectiveTaskWeight, calculateTaskProgressMetrics, formatNumber, toFiniteNumber } from './taskProgress';
import { isOriginalAsTask } from './taskSource';

export const USER_ADDED_WEIGHT_LABEL = 'น้ำหนักย่อยสำหรับคำนวณความคืบหน้า (%)';
export const USER_ADDED_WEIGHT_HELP = 'ระบบคำนวณน้ำหนักย่อยให้อัตโนมัติ แต่สามารถแก้เองได้ และไม่กระทบคะแนนประเมิน';
export const USER_ADDED_WEIGHT_HEADER = 'น้ำหนักย่อย (%)';
export const USER_ADDED_WEIGHT_TOTAL_TARGET = 100;
export const USER_ADDED_WEIGHT_TOTAL_TOLERANCE = 0.1;

export function isUserAddedWeightTotalBalanced(totalWeight: number) {
  // Keep the tolerance endpoints inclusive despite floating-point summation noise.
  return Math.abs(totalWeight - USER_ADDED_WEIGHT_TOTAL_TARGET) <=
    USER_ADDED_WEIGHT_TOTAL_TOLERANCE + Number.EPSILON * USER_ADDED_WEIGHT_TOTAL_TARGET;
}

export function getTrackingWeightDisplay(task: Task, officialWeight: unknown = task.weight) {
  const isProgressOnly = task.task_source === 'user_added';
  return {
    isProgressOnly,
    label: isProgressOnly ? 'น้ำหนักย่อย (progress only)' : 'Official weight',
    value: isProgressOnly
      ? toFiniteNumber(task.user_added_weight) ?? 0
      : toFiniteNumber(officialWeight) ?? 0,
  };
}

export function parseUserAddedWeight(value: unknown): { value: number; error?: string } {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return { value: 0 };
  const number = toFiniteNumber(value);
  if (number === null || number < 0 || number > 100) {
    return { value: 0, error: 'user_added_weight ต้องเป็นตัวเลขระหว่าง 0–100' };
  }
  return { value: number };
}

export function calculateAutoUserAddedWeights(tasks: Task[], resetManual = false) {
  const unique = new Map<string, Task>();
  for (const task of tasks) if (task.id && task.task_source === 'user_added' && !unique.has(task.id)) unique.set(task.id, task);
  const siblings = [...unique.values()].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
  );
  const manual = siblings.filter(task => !resetManual && task.user_added_weight_is_manual === true);
  const auto = siblings.filter(task => resetManual || task.user_added_weight_is_manual !== true);
  const manualTotal = manual.reduce((sum, task) => sum + parseUserAddedWeight(task.user_added_weight).value, 0);
  const remaining = Math.max(USER_ADDED_WEIGHT_TOTAL_TARGET - manualTotal, 0);
  const base = auto.length ? Math.floor((remaining / auto.length + Number.EPSILON) * 100) / 100 : 0;
  const weights: Record<string, number> = {};
  for (const task of manual) weights[task.id] = parseUserAddedWeight(task.user_added_weight).value;
  auto.forEach((task, index) => {
    weights[task.id] = index === auto.length - 1
      ? Number((remaining - base * (auto.length - 1)).toFixed(12))
      : base;
  });
  return { weights, manualTotal, autoCount: auto.length };
}

export function previewUserAddedWeight(parentId: string | null, tasks: Task[], task?: Task | null) {
  const pendingId = '__pending_user_added__';
  const candidate: Task = task ?? {
    id: pendingId, name: '', parent_id: parentId, task_source: 'user_added',
    user_added_weight_is_manual: false, created_at: '9999', start_date: null, end_date: null,
    assignee: null, is_recurring: false, status: 'To Do', priority: 'Medium', progress: 0,
  };
  const siblings = tasks.filter(row => row.task_source === 'user_added' && row.parent_id === parentId && row.id !== candidate.id);
  const result = calculateAutoUserAddedWeights([...siblings, candidate]);
  return { ...result, weight: result.weights[candidate.id] ?? 0 };
}

export type UserAddedProgressRollup = {
  childCount: number;
  totalWeight: number;
  calculatedProgress: number | null;
};

export function getUserAddedProgressRollup(parent: Task, tasks: Task[]): UserAddedProgressRollup {
  const rollup: UserAddedProgressRollup = { childCount: 0, totalWeight: 0, calculatedProgress: null };
  if (!parent.id || !isOriginalAsTask(parent)) return rollup;
  let weightedProgress = 0;
  let usableWeight = 0;
  const visited = new Set<string>();
  for (const child of tasks) {
    if (!child.id || child.id === parent.id || visited.has(child.id) || child.parent_id !== parent.id || child.task_source !== 'user_added') continue;
    visited.add(child.id);
    rollup.childCount += 1;
    const weight = parseUserAddedWeight(child.user_added_weight).value;
    rollup.totalWeight += weight;
    const progress = toFiniteNumber(child.progress);
    if (progress !== null) {
      weightedProgress += Math.min(100, Math.max(0, progress)) * weight;
      usableWeight += weight;
    }
  }
  if (usableWeight > 0) rollup.calculatedProgress = weightedProgress / usableWeight;
  return rollup;
}

export function getUserAddedWeightWarning(rollup: UserAddedProgressRollup) {
  return rollup.childCount > 0 && !isUserAddedWeightTotalBalanced(rollup.totalWeight)
    ? `น้ำหนักย่อยรวมขณะนี้ = ${formatNumber(rollup.totalWeight)}% แนะนำให้รวมเป็น ${USER_ADDED_WEIGHT_TOTAL_TARGET}%`
    : null;
}

// A display-only forest: detach every cycle edge, not an arbitrary edge determined by row order.
export function getTrackingTaskContext(tasks: Task[]) {
  const byId = new Map<string, Task>();
  for (const task of tasks) if (task?.id && task.name && !byId.has(task.id)) byId.set(task.id, task);
  const done = new Set<string>();
  const cyclic = new Set<string>();
  for (const task of byId.values()) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let id: string | null = task.id;
    while (id && byId.has(id) && !done.has(id)) {
      const position = positions.get(id);
      if (position !== undefined) {
        for (const member of path.slice(position)) cyclic.add(member);
        break;
      }
      positions.set(id, path.length);
      path.push(id);
      id = byId.get(id)!.parent_id ?? null;
    }
    for (const member of path) done.add(member);
  }
  return [...byId.values()].map(task => cyclic.has(task.id) || (task.parent_id && !byId.has(task.parent_id))
    ? { ...task, parent_id: null } : task);
}

type TrackingProgress = {
  calculatedProgress: number | null;
  displayProgress: number | null;
  trackingProgressSource: 'as_children' | 'user_added' | null;
};

// Only tracking values are replaced. Official weight/contribution helpers and stored rows stay unchanged.
export function calculateTrackingProgressMetrics(tasks: Task[], progressContext: Task[] = tasks) {
  const context = getTrackingTaskContext([...progressContext, ...tasks]);
  const byId = new Map(context.map(task => [task.id, task]));
  const childrenByParent = new Map<string, Task[]>();
  for (const task of context) {
    if (!task.parent_id) continue;
    const children = childrenByParent.get(task.parent_id) ?? [];
    children.push(task);
    childrenByParent.set(task.parent_id, children);
  }
  // Sanitize before invoking legacy official helpers, which assume an acyclic tree.
  const officialMetrics = calculateTaskProgressMetrics(context);
  const memo = new Map<string, TrackingProgress>();
  const active = new Set<string>();
  const effectiveWeights = new Map<string, number>();
  const resolve = (task: Task): TrackingProgress => {
    const cached = memo.get(task.id);
    if (cached) return cached;
    const recorded = toFiniteNumber(task.progress);
    const result: TrackingProgress = {
      calculatedProgress: null,
      displayProgress: recorded,
      trackingProgressSource: null,
    };
    if (active.has(task.id)) return result;
    active.add(task.id);
    if (isOriginalAsTask(task)) {
      const children = childrenByParent.get(task.id) ?? [];
      const originals = children.filter(isOriginalAsTask);
      if (originals.length) {
        const usable = originals.flatMap(child => {
          const progress = resolve(child).displayProgress;
          if (progress === null) return [];
          let weight = effectiveWeights.get(child.id);
          if (weight === undefined) {
            weight = calculateEffectiveTaskWeight(child, context);
            effectiveWeights.set(child.id, weight);
          }
          return [{ progress, weight }];
        });
        const positive = usable.filter(child => child.weight > 0);
        const weighted = positive.length ? positive : usable.map(child => ({ ...child, weight: 1 }));
        const total = weighted.reduce((sum, child) => sum + child.weight, 0);
        if (total > 0) {
          result.calculatedProgress = weighted.reduce((sum, child) => sum + child.progress * child.weight, 0) / total;
          result.trackingProgressSource = 'as_children';
        }
      } else {
        result.calculatedProgress = getUserAddedProgressRollup(task, children).calculatedProgress;
        if (result.calculatedProgress !== null) result.trackingProgressSource = 'user_added';
      }
      result.displayProgress = result.calculatedProgress ?? recorded;
    } else {
      result.calculatedProgress = officialMetrics[task.id].calculatedProgress;
      result.displayProgress = officialMetrics[task.id].displayProgress;
    }
    active.delete(task.id);
    memo.set(task.id, result);
    return result;
  };
  const metrics: Record<string, (typeof officialMetrics)[string] & TrackingProgress> = {};
  for (const task of tasks) {
    const canonical = byId.get(task?.id);
    if (!canonical || Object.hasOwn(metrics, canonical.id)) continue;
    const tracking = resolve(canonical);
    metrics[canonical.id] = { ...officialMetrics[canonical.id], ...tracking,
      isParent: tracking.trackingProgressSource !== null || officialMetrics[canonical.id].isParent };
  }
  return metrics;
}
