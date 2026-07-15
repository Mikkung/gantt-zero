import type {
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  TaskSelfEvaluation,
} from '../types';
import {
  getEvaluableTasks,
  getEvaluationTaskIdentity,
  getEvaluationTaskName,
  getEvaluationTaskWeight,
} from './evaluationTasks';

export type AiSummaryScope = 'employee_workload' | 'work_type';

type BuildAiSummaryPromptArgs = {
  period: AssessmentPeriod;
  employeeId: string;
  snapshots: AssessmentTaskSnapshot[];
  taskEvaluations: TaskSelfEvaluation[];
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

export function buildAiSummaryPrompt(args: BuildAiSummaryPromptArgs) {
  const sourceRows = getAiSummarySourceRows(args);
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
    'Task rows:',
    JSON.stringify(sourceRows, null, 2),
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
