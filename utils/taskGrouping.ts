import type { Task, WorkType } from '../types';
import {
  calculateAssigneeWeightSummary,
  calculateEffectiveWeightTotal,
  getEffectiveEvaluableTasks,
  getPositiveWeight,
} from './taskProgress';

export const UNSPECIFIED_WORK_TYPE = '__unspecified__';

export type WorkTypeKey = WorkType | typeof UNSPECIFIED_WORK_TYPE;

export const WORK_TYPE_ORDER: WorkTypeKey[] = [
  'routine',
  'strategic',
  'process_improvement',
  'self_development',
  'other',
  UNSPECIFIED_WORK_TYPE,
];

const WORK_TYPE_LABELS: Record<WorkTypeKey, string> = {
  routine: 'งานประจำ',
  strategic: 'งานยุทธศาสตร์',
  process_improvement: 'งานพัฒนากระบวนการ',
  self_development: 'งานพัฒนาตนเอง',
  other: 'งานอื่นๆ',
  [UNSPECIFIED_WORK_TYPE]: 'ไม่ระบุประเภทงาน',
};

export function normalizeWorkType(value: Task['work_type']): WorkTypeKey {
  if (!value) return UNSPECIFIED_WORK_TYPE;
  if (WORK_TYPE_ORDER.includes(value)) return value;
  return 'other';
}

export function getWorkTypeLabel(value: Task['work_type'] | WorkTypeKey) {
  return WORK_TYPE_LABELS[normalizeWorkType(value as Task['work_type'])];
}

export function sortWorkTypes(types: WorkTypeKey[]) {
  return [...types].sort(
    (a, b) => WORK_TYPE_ORDER.indexOf(a) - WORK_TYPE_ORDER.indexOf(b),
  );
}

export function groupTasksByWorkType(tasks: Task[]) {
  const groups = new Map<WorkTypeKey, Task[]>();
  const evaluableTasks = getEffectiveEvaluableTasks(tasks);

  for (const task of tasks) {
    const key = normalizeWorkType(task.work_type);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }

  return sortWorkTypes(Array.from(groups.keys())).map((workType) => {
    const groupTasks = groups.get(workType) ?? [];
    const groupEvaluableTasks = evaluableTasks.filter(
      (task) => normalizeWorkType(task.work_type) === workType,
    );

    return {
      workType,
      label: getWorkTypeLabel(workType),
      tasks: groupTasks,
      effectiveWeightTotal: groupEvaluableTasks.reduce(
        (sum, task) => sum + getPositiveWeight(task.weight),
        0,
      ),
      ...calculateAssigneeWeightSummary(groupEvaluableTasks),
    };
  });
}

export function groupTasksByAssigneeAndWorkType(tasks: Task[]) {
  const groups = new Map<string, Task[]>();

  for (const task of tasks) {
    const key = task.assignee || 'Unassigned';
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([assignee, assigneeTasks]) => ({
      assignee,
      effectiveWeightTotal: calculateEffectiveWeightTotal(assigneeTasks),
      ...calculateAssigneeWeightSummary(assigneeTasks),
      workTypeGroups: groupTasksByWorkType(assigneeTasks),
    }));
}

export function getHierarchicalTaskRows(tasks: Task[]) {
  const taskIds = new Set(tasks.map((task) => task.id));
  const childrenByParent = new Map<string, Task[]>();

  for (const task of tasks) {
    const parentKey =
      task.parent_id && taskIds.has(task.parent_id) ? task.parent_id : 'root';
    childrenByParent.set(parentKey, [
      ...(childrenByParent.get(parentKey) ?? []),
      task,
    ]);
  }

  const rows: Array<{ task: Task; depth: number }> = [];

  const walk = (parentId: string, depth: number) => {
    const list = [...(childrenByParent.get(parentId) ?? [])].sort((a, b) => {
      const aStart = a.start_date ?? '';
      const bStart = b.start_date ?? '';
      if (aStart !== bStart) return aStart.localeCompare(bStart);
      return a.name.localeCompare(b.name);
    });

    for (const task of list) {
      rows.push({ task, depth });
      walk(task.id, depth + 1);
    }
  };

  walk('root', 0);
  return rows;
}
