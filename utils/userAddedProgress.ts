import type { Task } from '../types';
import { calculateTaskProgressMetrics, formatNumber, toFiniteNumber } from './taskProgress';
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
  const visited = new Set<string>();
  for (const child of tasks) {
    if (!child.id || child.id === parent.id || visited.has(child.id) || child.parent_id !== parent.id || child.task_source !== 'user_added') continue;
    visited.add(child.id);
    rollup.childCount += 1;
    const weight = parseUserAddedWeight(child.user_added_weight).value;
    rollup.totalWeight += weight;
    weightedProgress += Math.min(100, Math.max(0, toFiniteNumber(child.progress) ?? 0)) * weight;
  }
  if (rollup.totalWeight > 0) rollup.calculatedProgress = weightedProgress / rollup.totalWeight;
  return rollup;
}

export function getUserAddedWeightWarning(rollup: UserAddedProgressRollup) {
  return rollup.childCount > 0 && !isUserAddedWeightTotalBalanced(rollup.totalWeight)
    ? `น้ำหนักย่อยรวมขณะนี้ = ${formatNumber(rollup.totalWeight)}% แนะนำให้รวมเป็น ${USER_ADDED_WEIGHT_TOTAL_TARGET}%`
    : null;
}

// Display-only overlay: official weight, contribution and snapshot helpers stay unchanged.
export function calculateTrackingProgressMetrics(tasks: Task[], progressContext: Task[] = tasks) {
  const metrics = calculateTaskProgressMetrics(tasks);
  for (const task of tasks) {
    const rollup = getUserAddedProgressRollup(task, progressContext);
    if (rollup.calculatedProgress !== null) {
      metrics[task.id] = {
        ...metrics[task.id],
        isParent: true,
        calculatedProgress: rollup.calculatedProgress,
        displayProgress: rollup.calculatedProgress,
      };
    }
  }
  return metrics;
}
