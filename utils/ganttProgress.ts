import type { Task } from '../types';
import { toFiniteNumber } from './taskProgress';

export const GANTT_PROGRESS_LEGEND = [
  { state: 'not-started', label: '0%' },
  { state: 'active', label: '0% < Progress < 100%' },
  { state: 'complete', label: '100%' },
  { state: 'blocked', label: 'Blocked / Need Help' },
] as const;

export function getGanttProgressVisual(task: Pick<Task, 'progress' | 'calculated_progress' | 'status'>) {
  const progress = Math.min(100, Math.max(0, toFiniteNumber(task.calculated_progress ?? task.progress ?? 0) ?? 0));
  const status = (task.status ?? '').toLowerCase().replace(/[\s_-]/g, '');
  const state = status === 'blocked' || status === 'inproblemneedhelp' ? 'blocked'
    : progress === 0 ? 'not-started' : progress < 100 ? 'active' : 'complete';
  const isComputed = toFiniteNumber(task.calculated_progress) !== null;
  return { progress, isComputed, className: `progress-${state}${isComputed ? ' progress-computed' : ''}` };
}
