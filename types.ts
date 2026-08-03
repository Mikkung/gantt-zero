// types.ts

export type Role = 'admin' | 'manager' | 'user';

export type WorkType =
  | 'routine'              // งานประจำ
  | 'strategic'            // งานยุทธศาสตร์
  | 'process_improvement'  // งานพัฒนากระบวนการ
  | 'self_development'     // งานพัฒนาตนเอง
  | 'other';               // งานอื่นๆ


export interface Team {
  id: string;
  name: string;
  color?: string | null;
}

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  team_id: string | null;
  avatar_url?: string | null;
}


export type TaskFrequencyUnit = "month" | "year";
export type TaskSource = 'as_original' | 'user_added' | 'admin_added';

export interface Task {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: 'To Do' | 'In Progress' | 'Blocked' | 'In problem Need Help'| 'Done';
  priority: 'Low' | 'Medium' | 'High';
  progress: number;
  assignee: string | null;
  is_recurring: boolean;
  recurring_type?: 'none' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
  recurring_interval?: number | null;
  recurring_unit?: 'day' | 'week' | 'month' | 'year' | null;
  dependencies?: string | null;
  team_id?: string | null;
  parent_id?: string | null;
  description?: string | null;

  work_type?: WorkType | null;

  weight?: number | null;
  calculated_progress?: number | null;
  progress_summary?: string | null;

  output?: string | null;
  frequency_count?: number | null;
  frequency_unit?: TaskFrequencyUnit| null;
  time_per_occurrence_minutes?: number | null;
  task_source?: TaskSource | null;
  counts_toward_assessment?: boolean | null;
  include_in_ai_summary?: boolean | null;
}

export type AssessmentPeriodStatus =
  | 'draft'
  | 'self_open'
  | 'self_closed'
  | 'manager_open'
  | 'manager_closed'
  | 'completed';

export interface AssessmentPeriod {
  id: string;
  title: string;
  year: number | null;
  cycle_name: string | null;
  self_start_at: string | null;
  self_end_at: string | null;
  manager_start_at?: string | null;
  manager_end_at?: string | null;
  status: AssessmentPeriodStatus;
  score_level_values?: Record<string, number> | null;
  workload_factor?: number | null;
  attribute_factor?: number | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AttributeCriterion {
  id: string;
  code: string;
  title: string;
  description: string | null;
  sort_order: number;
  active: boolean;
  created_at?: string | null;
}

export interface TaskSelfEvaluation {
  id: string;
  period_id: string;
  employee_id: string;
  task_id: string;
  self_progress_score: number | null;
  self_comment: string | null;
  evidence_url: string | null;
  submitted_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AttributeSelfEvaluation {
  id: string;
  period_id: string;
  employee_id: string;
  criterion_id: string;
  self_score: number | null;
  self_comment: string | null;
  submitted_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AssessmentTaskSnapshot {
  id: string;
  period_id: string;
  employee_id: string;
  task_id: string;
  task_name: string;
  parent_id: string | null;
  weight: number | null;
  progress: number | null;
  calculated_progress: number | null;
  progress_summary: string | null;
  status: Task['status'] | null;
  priority: Task['priority'] | null;
  work_type: WorkType | null;
  snapshot_at: string;
  counts_toward_assessment?: boolean | null;
  include_in_ai_summary?: boolean | null;
}

export type SelfEvaluationSubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'returned';

export interface SelfEvaluationSubmission {
  id: string;
  period_id: string;
  employee_id: string;
  status: SelfEvaluationSubmissionStatus;
  submitted_at: string | null;
  returned_at: string | null;
  returned_by: string | null;
  return_reason: string | null;
  resubmitted_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TaskManagerEvaluation {
  id: string;
  period_id: string;
  employee_id: string;
  evaluator_id: string | null;
  task_id: string;
  manager_progress_score: number | null;
  manager_comment: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AttributeManagerEvaluation {
  id: string;
  period_id: string;
  employee_id: string;
  evaluator_id: string | null;
  criterion_id: string;
  manager_score: number | null;
  manager_comment: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type ManagerEvaluationSubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'returned';

export interface ManagerEvaluationSubmission {
  id: string;
  period_id: string;
  employee_id: string;
  evaluator_id: string | null;
  status: ManagerEvaluationSubmissionStatus;
  submitted_at: string | null;
  returned_at?: string | null;
  returned_by?: string | null;
  return_reason?: string | null;
  resubmitted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type PeerReviewImportStatus = 'imported' | 'replaced' | 'failed';

export interface PeerReviewImport {
  id: string;
  period_id: string;
  source_file_name: string | null;
  imported_by: string | null;
  imported_at: string;
  row_count: number;
  valid_row_count: number;
  invalid_row_count: number;
  status: PeerReviewImportStatus;
  notes: string | null;
  created_at?: string | null;
}

export interface PeerReviewResult {
  id: string;
  import_id: string;
  period_id: string;
  response_id: string | null;
  start_time: string | null;
  completion_time: string | null;
  responder_email: string | null;
  responder_name: string | null;
  employee_name: string;
  employee_id: string | null;
  rater_relation: string | null;
  work_frequency: string | null;
  score_reliability: number | null;
  score_communication_collab: number | null;
  score_problem_solving: number | null;
  overall_score: number | null;
  strength_comment: string | null;
  improvement_comment: string | null;
  comment_text_for_ai: string | null;
  process_status: string | null;
  processed_at: string | null;
  model_version: string | null;
  sentiment_label: string | null;
  positive_score: number | null;
  neutral_score: number | null;
  negative_score: number | null;
  error_message: string | null;
  created_at?: string | null;
}

export interface PeerReviewSummary {
  id: string;
  period_id: string;
  employee_id: string;
  employee_name: string;
  reviewer_count: number;
  avg_reliability: number | null;
  avg_communication_collab: number | null;
  avg_problem_solving: number | null;
  avg_overall_score: number | null;
  positive_count: number;
  neutral_count: number;
  negative_count: number;
  avg_positive_score: number | null;
  avg_neutral_score: number | null;
  avg_negative_score: number | null;
  relation_summary: Record<string, number> | null;
  work_frequency_summary: Record<string, number> | null;
  strength_comments: string[] | null;
  improvement_comments: string[] | null;
  ai_comment_texts: string[] | null;
  processing_errors: Array<{
    response_id?: string | null;
    process_status?: string | null;
    error_message?: string | null;
  }> | null;
  updated_at?: string | null;
}

export interface ManagerEvaluationAssignment {
  id: string;
  period_id: string;
  employee_id: string;
  evaluator_id: string;
  assigned_by: string | null;
  assigned_at: string;
  active: boolean;
  notes: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type AssessmentAiSummaryScope =
  | 'employee_workload'
  | 'work_type'
  | 'parent_task'
  | 'task';

export type AssessmentAiSummaryStatus = 'generated' | 'failed';

export interface AssessmentAiSummary {
  id: string;
  period_id: string;
  employee_id: string;
  summary_scope: AssessmentAiSummaryScope;
  work_type: string | null;
  parent_task_id: string | null;
  task_id: string | null;
  source_snapshot_ids: string[] | null;
  source_task_ids: string[] | null;
  summary_text: string | null;
  prompt_text: string | null;
  model_name: string | null;
  status: AssessmentAiSummaryStatus;
  error_message: string | null;
  generated_by: string | null;
  generated_at: string;
  created_at?: string | null;
  updated_at?: string | null;
}
