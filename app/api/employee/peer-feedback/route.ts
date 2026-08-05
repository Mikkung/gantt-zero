import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { AssessmentPeriod, Profile } from '../../../../types';

type PeerFeedbackAssignment = {
  reviewer_employee_id: string;
  reviewee_name: string;
  round: string;
  due_at: string;
  active: string;
};

type PeerFeedbackAssignmentResponse = {
  reviewee_name: string;
  form_url: string;
  round: string;
  due_at: string;
};

type PeerFeedbackConfig = {
  default_form_url: string;
};

const ASSIGNMENT_FILE_PATH = path.join(
  process.cwd(),
  'data',
  'peer-feedback-assignments.csv',
);
const CONFIG_FILE_PATH = path.join(
  process.cwd(),
  'data',
  'peer-feedback-config.json',
);

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

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseAssignmentsCsv(csvText: string): PeerFeedbackAssignment[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = cells[index] ?? '';
      return row;
    }, {}) as PeerFeedbackAssignment;
  });
}

async function readConfig(): Promise<PeerFeedbackConfig> {
  try {
    const raw = await readFile(CONFIG_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PeerFeedbackConfig>;
    return {
      default_form_url: String(parsed.default_form_url ?? ''),
    };
  } catch {
    return { default_form_url: '' };
  }
}

function getPeriodKeys(period: AssessmentPeriod | null) {
  if (!period) return new Set<string>();

  const keys = new Set<string>();
  if (period.title) keys.add(period.title.trim());
  if (period.cycle_name) keys.add(period.cycle_name.trim());
  if (period.year && period.cycle_name) {
    keys.add(`${period.year}-${period.cycle_name}`.trim());
    keys.add(`${period.year} ${period.cycle_name}`.trim());
  }
  if (period.year) keys.add(String(period.year));

  return keys;
}

function isActive(value: string) {
  return ['true', '1', 'yes', 'y', 'active'].includes(
    value.trim().toLowerCase(),
  );
}

export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');

  if (!token) return jsonError('Unauthorized', 401);

  const supabase = createServerSupabase(token);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user?.email) return jsonError('Unauthorized', 401);

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', user.email)
    .limit(1);

  if (profileError) return jsonError(profileError.message, 500);

  const profile = (profileRows?.[0] ?? null) as Profile | null;
  if (!profile?.display_name) return jsonError('Unauthorized', 403);

  const { data: periodRows, error: periodError } = await supabase
    .from('assessment_periods')
    .select('*')
    .eq('status', 'self_open')
    .order('self_start_at', { ascending: false })
    .limit(1);

  if (periodError) return jsonError(periodError.message, 500);

  const activeSelfPeriod = (periodRows?.[0] ?? null) as AssessmentPeriod | null;
  const activePeriodKeys = getPeriodKeys(activeSelfPeriod);

  const csvText = await readFile(ASSIGNMENT_FILE_PATH, 'utf8');
  const assignments = parseAssignmentsCsv(csvText);
  const config = await readConfig();

  const rows: PeerFeedbackAssignmentResponse[] = assignments
    .filter(
      (assignment) =>
        assignment.reviewer_employee_id === profile.display_name &&
        isActive(assignment.active) &&
        activePeriodKeys.has(assignment.round.trim()),
    )
    .map((assignment) => ({
      reviewee_name: assignment.reviewee_name,
      form_url: config.default_form_url,
      round: assignment.round,
      due_at: assignment.due_at,
    }));

  return NextResponse.json({
    employee_id: profile.display_name,
    active_self_period: activeSelfPeriod
      ? {
          id: activeSelfPeriod.id,
          title: activeSelfPeriod.title,
          cycle_name: activeSelfPeriod.cycle_name,
          year: activeSelfPeriod.year,
        }
      : null,
    rows,
  });
}
