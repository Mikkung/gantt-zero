import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type {
  AssessmentAiSummary,
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  ManagerEvaluationAssignment,
  Profile,
  Task,
  TaskSelfEvaluation,
} from '../../../../types';
import {
  AI_SUMMARY_SYSTEM_PROMPT,
  buildAiSummaryPrompt,
  getAiSummarySourceRows,
  type AiSummaryScope,
} from '../../../../utils/aiSummary';

type AiSummaryRequestBody = {
  period_id?: string;
  employee_id?: string;
  summary_scope?: AiSummaryScope;
  work_type?: string | null;
  regenerate?: boolean;
};

const TYPHOON_BASE_URL =
  process.env.TYPHOON_BASE_URL ?? 'https://api.opentyphoon.ai/v1';
const TYPHOON_MODEL =
  process.env.TYPHOON_MODEL ?? 'typhoon-v2.5-30b-a3b-instruct';

function createServerSupabase(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function callTyphoon(prompt: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(
      `${TYPHOON_BASE_URL.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.TYPHOON_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: TYPHOON_MODEL,
          messages: [
            { role: 'system', content: AI_SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Typhoon API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) throw new Error('Typhoon API did not return summary text.');
    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function saveSummary(
  supabase: ReturnType<typeof createServerSupabase>,
  payload: Omit<AssessmentAiSummary, 'id' | 'created_at' | 'updated_at'>,
) {
  let existingQuery = supabase
    .from('assessment_ai_summaries')
    .select('id')
    .eq('period_id', payload.period_id)
    .eq('employee_id', payload.employee_id)
    .eq('summary_scope', payload.summary_scope);

  existingQuery =
    payload.work_type === null
      ? existingQuery.is('work_type', null)
      : existingQuery.eq('work_type', payload.work_type);
  existingQuery =
    payload.parent_task_id === null
      ? existingQuery.is('parent_task_id', null)
      : existingQuery.eq('parent_task_id', payload.parent_task_id);
  existingQuery =
    payload.task_id === null
      ? existingQuery.is('task_id', null)
      : existingQuery.eq('task_id', payload.task_id);

  const { data: existingRows, error: existingError } = await existingQuery.limit(1);
  if (existingError) throw existingError;

  const existingId = (existingRows as Array<{ id: string }> | null)?.[0]?.id;

  if (existingId) {
    const { data, error } = await supabase
      .from('assessment_ai_summaries')
      .update(payload)
      .eq('id', existingId)
      .select('*')
      .single();
    if (error) throw error;
    return data as AssessmentAiSummary;
  }

  const { data, error } = await supabase
    .from('assessment_ai_summaries')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as AssessmentAiSummary;
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');

  if (!token) return jsonError('Unauthorized', 401);

  const supabase = createServerSupabase(token);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user?.email) return jsonError('Unauthorized', 401);

  const body = (await request.json()) as AiSummaryRequestBody;
  const periodId = body.period_id;
  const employeeId = body.employee_id;
  const summaryScope = body.summary_scope ?? 'employee_workload';
  const workType = body.work_type ?? null;

  if (!periodId || !employeeId) {
    return jsonError('period_id and employee_id are required');
  }

  if (!['employee_workload', 'work_type'].includes(summaryScope)) {
    return jsonError('Only employee_workload and work_type summaries are supported.');
  }

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', user.email)
    .limit(1);

  if (profileError) return jsonError(profileError.message, 500);

  const profile = ((profileRows ?? []) as Profile[])[0] ?? null;
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return jsonError('Forbidden', 403);
  }

  if (profile.role === 'manager') {
    const { data: assignmentRows, error: assignmentError } = await supabase
      .from('manager_evaluation_assignments')
      .select('*')
      .eq('period_id', periodId)
      .eq('employee_id', employeeId)
      .eq('evaluator_id', profile.id)
      .eq('active', true)
      .limit(1);

    if (assignmentError) return jsonError(assignmentError.message, 500);
    const assignment =
      ((assignmentRows ?? []) as ManagerEvaluationAssignment[])[0] ?? null;
    if (!assignment) {
      return jsonError(
        'คุณไม่ได้รับมอบหมายให้ประเมินเจ้าหน้าที่รายนี้',
        403,
      );
    }
  }

  const [periodResult, snapshotsResult, taskEvaluationsResult, tasksResult] =
    await Promise.all([
      supabase
        .from('assessment_periods')
        .select('*')
        .eq('id', periodId)
        .single(),
      supabase
        .from('assessment_task_snapshots')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId),
      supabase
        .from('task_self_evaluations')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId),
      supabase
        .from('tasks')
        .select('*')
        .eq('assignee', employeeId)
        .eq('include_in_ai_summary', true),
    ]);

  if (periodResult.error) return jsonError(periodResult.error.message, 500);
  if (snapshotsResult.error) return jsonError(snapshotsResult.error.message, 500);
  if (taskEvaluationsResult.error) {
    return jsonError(taskEvaluationsResult.error.message, 500);
  }
  if (tasksResult.error) return jsonError(tasksResult.error.message, 500);

  const period = periodResult.data as AssessmentPeriod;
  const snapshots = (snapshotsResult.data ?? []) as AssessmentTaskSnapshot[];
  const taskEvaluations =
    (taskEvaluationsResult.data ?? []) as TaskSelfEvaluation[];
  const supplementaryTasks = (tasksResult.data ?? []) as Task[];
  const sourceRows = getAiSummarySourceRows({
    snapshots,
    taskEvaluations,
    summaryScope,
    workType,
  });
  const promptText = buildAiSummaryPrompt({
    period,
    employeeId,
    snapshots,
    taskEvaluations,
    supplementaryTasks,
    summaryScope,
    workType,
  });
  const generatedAt = new Date().toISOString();
  const basePayload = {
    period_id: periodId,
    employee_id: employeeId,
    summary_scope: summaryScope,
    work_type: summaryScope === 'work_type' ? workType : null,
    parent_task_id: null,
    task_id: null,
    source_snapshot_ids: sourceRows.map((row) => row.snapshot_id),
    source_task_ids: sourceRows.map((row) => row.task_id),
    prompt_text: promptText,
    model_name: TYPHOON_MODEL,
    generated_by: profile.id,
    generated_at: generatedAt,
  };

  if (!process.env.TYPHOON_API_KEY) {
    const summary = await saveSummary(supabase, {
      ...basePayload,
      summary_text: null,
      status: 'failed',
      error_message: 'ยังไม่ได้ตั้งค่า TYPHOON_API_KEY',
    });
    return NextResponse.json(
      {
        summary,
        error: 'ยังไม่ได้ตั้งค่า TYPHOON_API_KEY',
      },
      { status: 503 },
    );
  }

  try {
    const summaryText = await callTyphoon(promptText);
    const summary = await saveSummary(supabase, {
      ...basePayload,
      summary_text: summaryText,
      status: 'generated',
      error_message: null,
    });

    return NextResponse.json({ summary });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'ไม่สามารถสร้างสรุปด้วย AI ได้ กรุณาลองใหม่อีกครั้ง';
    const summary = await saveSummary(supabase, {
      ...basePayload,
      summary_text: null,
      status: 'failed',
      error_message: errorMessage,
    });

    return NextResponse.json(
      {
        summary,
        error: 'ไม่สามารถสร้างสรุปด้วย AI ได้ กรุณาลองใหม่อีกครั้ง',
      },
      { status: 502 },
    );
  }
}
