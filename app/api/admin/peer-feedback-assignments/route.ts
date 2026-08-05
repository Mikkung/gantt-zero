import { readFile, writeFile } from 'fs/promises';
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

type PeerFeedbackConfig = {
  default_form_url: string;
};

const ASSIGNMENT_HEADERS = [
  'reviewer_employee_id',
  'reviewee_name',
  'round',
  'due_at',
  'active',
] as const;

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
    const raw = headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = cells[index] ?? '';
      return row;
    }, {});

    return {
      reviewer_employee_id: raw.reviewer_employee_id ?? '',
      reviewee_name: raw.reviewee_name ?? '',
      round: raw.round ?? '',
      due_at: raw.due_at ?? '',
      active: raw.active ?? 'true',
    };
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

function escapeCsvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function serializeAssignmentsCsv(rows: PeerFeedbackAssignment[]) {
  const body = rows.map((row) =>
    ASSIGNMENT_HEADERS.map((header) => escapeCsvCell(row[header])).join(','),
  );

  return [ASSIGNMENT_HEADERS.join(','), ...body].join('\r\n') + '\r\n';
}

function isBlankAssignmentRow(row: PeerFeedbackAssignment) {
  return (
    !row.reviewer_employee_id &&
    !row.reviewee_name &&
    !row.round &&
    !row.due_at
  );
}

function getPeriodRound(period: AssessmentPeriod | null) {
  if (!period) return '';
  if (period.year && period.cycle_name) {
    return `${period.year}-${period.cycle_name}`.trim();
  }
  if (period.title) return period.title.trim();
  if (period.cycle_name) return period.cycle_name.trim();
  if (period.year) return String(period.year);
  return '';
}

function formatDateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '';
}

async function getAdminProfile(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');

  if (!token) return { error: jsonError('Unauthorized', 401) };

  const supabase = createServerSupabase(token);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user?.email) {
    return { error: jsonError('Unauthorized', 401) };
  }

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', user.email)
    .limit(1);

  if (profileError) return { error: jsonError(profileError.message, 500) };

  const profile = (profileRows?.[0] ?? null) as Profile | null;
  if (profile?.role !== 'admin') {
    return { error: jsonError('Admin only', 403) };
  }

  return { profile, supabase };
}

export async function GET(request: NextRequest) {
  const auth = await getAdminProfile(request);
  if (auth.error) return auth.error;

  const csvText = await readFile(ASSIGNMENT_FILE_PATH, 'utf8');
  const config = await readConfig();
  return NextResponse.json({ rows: parseAssignmentsCsv(csvText), config });
}

export async function POST(request: NextRequest) {
  const auth = await getAdminProfile(request);
  if (auth.error) return auth.error;

  const body = (await request.json()) as {
    rows?: PeerFeedbackAssignment[];
    config?: Partial<PeerFeedbackConfig>;
  };

  const { data: periodRows, error: periodError } = await auth.supabase
    .from('assessment_periods')
    .select('*')
    .eq('status', 'self_open')
    .order('self_start_at', { ascending: false })
    .limit(1);

  if (periodError) return jsonError(periodError.message, 500);

  const defaultPeriod = (periodRows?.[0] ?? null) as AssessmentPeriod | null;
  const defaultRound = getPeriodRound(defaultPeriod);
  const defaultDueAt = formatDateOnly(defaultPeriod?.self_end_at);

  const normalizedRows = (body.rows ?? []).map((row) => ({
    reviewer_employee_id: String(row.reviewer_employee_id ?? '').trim(),
    reviewee_name: String(row.reviewee_name ?? '').trim(),
    round: String(row.round ?? '').trim(),
    due_at: String(row.due_at ?? '').trim(),
    active:
      String(row.active ?? 'true').trim().toLowerCase() === 'false'
        ? 'false'
        : 'true',
  }));

  const rows = normalizedRows
    .filter((row) => !isBlankAssignmentRow(row))
    .map((row) => ({
      ...row,
      round: row.round || defaultRound,
      due_at: row.due_at || defaultDueAt,
    }));

  const invalidRowIndex = rows.findIndex(
    (row) => !row.reviewer_employee_id || !row.reviewee_name || !row.round,
  );
  if (invalidRowIndex >= 0) {
    return jsonError(
      `Row ${invalidRowIndex + 1}: reviewer_employee_id, reviewee_name, and round are required.`,
    );
  }

  await writeFile(ASSIGNMENT_FILE_PATH, serializeAssignmentsCsv(rows), 'utf8');
  await writeFile(
    CONFIG_FILE_PATH,
    `${JSON.stringify(
      {
        default_form_url: String(body.config?.default_form_url ?? '').trim(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return NextResponse.json({
    rows,
    config: {
      default_form_url: String(body.config?.default_form_url ?? '').trim(),
    },
  });
}
