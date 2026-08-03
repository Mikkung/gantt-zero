import type {
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  Task,
  TaskSelfEvaluation,
} from '../types';
import {
  getEvaluableTasks,
  getEvaluationTaskIdentity,
  getEvaluationTaskName,
  getEvaluationTaskWeight,
} from './evaluationTasks';
import {
  countsTowardAssessment,
  shouldIncludeInAiSummary,
} from './taskSource';

export type AiSummaryScope = 'employee_workload' | 'work_type';

type BuildAiSummaryPromptArgs = {
  period: AssessmentPeriod;
  employeeId: string;
  snapshots: AssessmentTaskSnapshot[];
  taskEvaluations: TaskSelfEvaluation[];
  supplementaryTasks?: Task[];
  summaryScope: AiSummaryScope;
  workType?: string | null;
};

export const AI_SUMMARY_SYSTEM_PROMPT = [
  'You are summarizing employee workload progress for management evaluation.',
  'Use only the provided data.',
  'Do not invent facts.',
  'Do not assign performance scores.',
  'Do not recommend promotion, penalty, or salary actions.',
  'Write in Thai.',
  'Be concise, factual, and useful for a manager.',
].join(' ');

export function getAiSummarySourceRows({
  snapshots,
  taskEvaluations,
  summaryScope,
  workType,
}: Pick<
  BuildAiSummaryPromptArgs,
  'snapshots' | 'taskEvaluations' | 'summaryScope' | 'workType'
>) {
  const selfEvaluationByTaskId = new Map(
    taskEvaluations.map((evaluation) => [evaluation.task_id, evaluation]),
  );
  const sourceSnapshots =
    summaryScope === 'work_type' && workType
      ? snapshots.filter((snapshot) => snapshot.work_type === workType)
      : snapshots;

  return getEvaluableTasks(sourceSnapshots).map((snapshot) => {
    const taskId = getEvaluationTaskIdentity(snapshot);
    const selfEvaluation = selfEvaluationByTaskId.get(taskId);

    return {
      snapshot_id: snapshot.id,
      task_id: taskId,
      task_name: getEvaluationTaskName(snapshot),
      work_type: snapshot.work_type,
      weight: getEvaluationTaskWeight(snapshot),
      progress: snapshot.progress,
      calculated_progress: snapshot.calculated_progress,
      progress_summary: snapshot.progress_summary,
      status: snapshot.status,
      priority: snapshot.priority,
      self_progress_score: selfEvaluation?.self_progress_score ?? null,
      self_comment: selfEvaluation?.self_comment ?? null,
      evidence_url: selfEvaluation?.evidence_url ?? null,
    };
  });
}

export function getAiSummarySupplementaryTaskRows({
  snapshots,
  supplementaryTasks = [],
  summaryScope,
  workType,
}: Pick<
  BuildAiSummaryPromptArgs,
  'snapshots' | 'supplementaryTasks' | 'summaryScope' | 'workType'
>) {
  const officialTaskIds = new Set(snapshots.map((snapshot) => snapshot.task_id));
  const workTypeOfficialTaskIds =
    summaryScope === 'work_type' && workType
      ? new Set(
          snapshots
            .filter((snapshot) => snapshot.work_type === workType)
            .map((snapshot) => snapshot.task_id),
        )
      : officialTaskIds;

  return supplementaryTasks
    .filter((task) => !countsTowardAssessment(task))
    .filter(shouldIncludeInAiSummary)
    .filter((task) => {
      if (summaryScope !== 'work_type' || !workType) return true;
      return (
        task.work_type === workType ||
        workTypeOfficialTaskIds.has(task.parent_id ?? '')
      );
    })
    .map((task) => ({
      task_id: task.id,
      task_name: task.name,
      parent_id: task.parent_id,
      parent_is_official_as_task: officialTaskIds.has(task.parent_id ?? ''),
      task_source: task.task_source ?? 'user_added',
      work_type: task.work_type,
      status: task.status,
      priority: task.priority,
      progress: task.progress,
      progress_summary: task.progress_summary,
      description: task.description,
    }));
}

export function buildAiSummaryPrompt(args: BuildAiSummaryPromptArgs) {
  const sourceRows = getAiSummarySourceRows(args);
  const supplementaryRows = getAiSummarySupplementaryTaskRows(args);
  const scopeText =
    args.summaryScope === 'work_type'
      ? `work_type: ${args.workType ?? '-'}`
      : 'employee workload';

  return [
    'กรุณาสรุปความคืบหน้าภาระงานของพนักงานจากข้อมูลที่ให้เท่านั้น',
    '',
    `Assessment period: ${args.period.title}`,
    `Employee: ${args.employeeId}`,
    `Summary scope: ${scopeText}`,
    '',
    'Official AS Tasks:',
    JSON.stringify(sourceRows, null, 2),
    '',
    'Additional User-Added Tasks / Supporting Evidence:',
    JSON.stringify(supplementaryRows, null, 2),
    '',
    'User-added tasks are supplementary evidence only and must not change official assessment scores.',
    '',
    'รูปแบบคำตอบที่ต้องการ:',
    '- ภาพรวมความคืบหน้า:',
    '- งานที่ดำเนินการได้ดี:',
    '- งานที่ยังต้องติดตาม:',
    '- ประเด็นที่ควรสอบถามเพิ่มเติม:',
    '',
    'ข้อห้าม:',
    '- ห้ามให้คะแนน',
    '- ห้ามตัดสินผลงานเกินกว่าข้อมูล',
    '- ห้ามเสนอผลตอบแทน การลงโทษ หรือการเลื่อนตำแหน่ง',
  ].join('\n');
}
