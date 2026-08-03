import type { PeerReviewResult, PeerReviewSummary, Profile } from '../types';

export const PEER_REVIEW_COLUMNS = [
  'ResponseID',
  'StartTime',
  'CompletionTime',
  'ResponderEmail',
  'ResponderName',
  'EmployeeName',
  'RaterRelation',
  'WorkFrequency',
  'Score_Reliability',
  'Score_CommunicationCollab',
  'Score_ProblemSolving',
  'StrengthComment',
  'ImprovementComment',
  'OverallScore',
  'CommentTextForAI',
  'ProcessStatus',
  'ProcessedAt',
  'ModelVersion',
  'SentimentLabel',
  'PositiveScore',
  'NeutralScore',
  'NegativeScore',
  'ErrorMessage',
] as const;

export type PeerReviewCsvColumn = (typeof PEER_REVIEW_COLUMNS)[number];
export type PeerReviewCsvRow = Record<PeerReviewCsvColumn, string>;
export const PEER_REVIEW_TEMPLATE_FILENAME =
  'peer_review_import_template.csv';

const PEER_REVIEW_TEMPLATE_SAMPLE_ROW: PeerReviewCsvRow = {
  ResponseID: 'sample-001',
  StartTime: '2026-07-14 09:00:00',
  CompletionTime: '2026-07-14 09:05:00',
  ResponderEmail: 'reviewer@example.com',
  ResponderName: 'Reviewer Name',
  EmployeeName: 'Employee Name',
  RaterRelation: 'เพื่อนร่วมงาน',
  WorkFrequency: 'ทำงานร่วมกันเป็นประจำ',
  Score_Reliability: '5',
  Score_CommunicationCollab: '4',
  Score_ProblemSolving: '4',
  StrengthComment: 'มีความรับผิดชอบและช่วยเหลือทีมดี',
  ImprovementComment: 'ควรเพิ่มการสื่อสารล่วงหน้าในบางงาน',
  OverallScore: '4',
  CommentTextForAI: 'มีความรับผิดชอบดี ทำงานร่วมกับผู้อื่นได้ดี',
  ProcessStatus: 'processed',
  ProcessedAt: '2026-07-14 09:10:00',
  ModelVersion: 'ml-v1',
  SentimentLabel: 'Positive',
  PositiveScore: '0.85',
  NeutralScore: '0.10',
  NegativeScore: '0.05',
  ErrorMessage: '',
};

export type PeerReviewValidationRow = {
  rowIndex: number;
  raw: Partial<PeerReviewCsvRow>;
  errors: string[];
  warnings: string[];
  normalized: Omit<
    PeerReviewResult,
    'id' | 'import_id' | 'period_id' | 'created_at'
  > | null;
};

function escapeCsvValue(value: string) {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function createPeerReviewTemplateCsv() {
  const header = PEER_REVIEW_COLUMNS.map(escapeCsvValue).join(',');
  const sample = PEER_REVIEW_COLUMNS.map((column) =>
    escapeCsvValue(PEER_REVIEW_TEMPLATE_SAMPLE_ROW[column]),
  ).join(',');

  return `\uFEFF${header}\r\n${sample}\r\n`;
}

function normalizeHeader(value: string) {
  return value.trim().replace(/^\uFEFF/, '').toLowerCase();
}

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

export function parsePeerReviewCsv(text: string) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  if (!lines.length) {
    return { rows: [] as Partial<PeerReviewCsvRow>[], missingColumns: [...PEER_REVIEW_COLUMNS] };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const columnMap = new Map<string, number>();
  headers.forEach((header, index) => columnMap.set(header, index));

  const missingColumns = PEER_REVIEW_COLUMNS.filter(
    (column) => !columnMap.has(normalizeHeader(column)),
  );

  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Partial<PeerReviewCsvRow> = {};

    for (const column of PEER_REVIEW_COLUMNS) {
      const index = columnMap.get(normalizeHeader(column));
      row[column] = index === undefined ? '' : clean(values[index]);
    }

    return row;
  });

  return { rows, missingColumns };
}

function parseOptionalNumber(value: string | undefined) {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseTimestamp(value: string | undefined) {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return NaN;
  return date.toISOString();
}

function isInvalidTimestamp(value: string | null | number): value is number {
  return typeof value === 'number' && Number.isNaN(value);
}

function validateScore(
  label: string,
  value: string | undefined,
  min: number,
  max: number,
  errors: string[],
) {
  const parsed = parseOptionalNumber(value);
  if (parsed === null) return null;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    errors.push(`${label} must be a number between ${min} and ${max}`);
    return null;
  }

  return parsed;
}

function average(values: Array<number | null | undefined>) {
  const numbers = values.filter(
    (value): value is number =>
      value !== null && value !== undefined && Number.isFinite(value),
  );

  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function increment(summary: Record<string, number>, value: string | null) {
  const key = clean(value);
  if (!key) return;
  summary[key] = (summary[key] ?? 0) + 1;
}

function normalizeSentiment(value: string | null | undefined) {
  const label = clean(value).toLowerCase();
  if (['positive', 'pos', 'บวก'].includes(label)) return 'positive';
  if (['neutral', 'neu', 'กลาง'].includes(label)) return 'neutral';
  if (['negative', 'neg', 'ลบ'].includes(label)) return 'negative';
  return label || null;
}

export function validatePeerReviewRows(
  rows: Partial<PeerReviewCsvRow>[],
  profiles: Profile[],
) {
  const profileByDisplayName = new Map(
    profiles.map((profile) => [profile.display_name.trim().toLowerCase(), profile]),
  );

  return rows.map((row, index): PeerReviewValidationRow => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rowIndex = index + 2;
    const employeeName = clean(row.EmployeeName);
    const responseId = clean(row.ResponseID) || `row-${rowIndex}`;

    if (!employeeName) errors.push('EmployeeName is required');

    const matchedProfile = employeeName
      ? profileByDisplayName.get(employeeName.toLowerCase())
      : null;

    if (employeeName && !matchedProfile) {
      warnings.push('EmployeeName does not match profiles.display_name');
    }

    const scoreReliability = validateScore(
      'Score_Reliability',
      row.Score_Reliability,
      1,
      5,
      errors,
    );
    const scoreCommunicationCollab = validateScore(
      'Score_CommunicationCollab',
      row.Score_CommunicationCollab,
      1,
      5,
      errors,
    );
    const scoreProblemSolving = validateScore(
      'Score_ProblemSolving',
      row.Score_ProblemSolving,
      1,
      5,
      errors,
    );
    const overallScore = validateScore('OverallScore', row.OverallScore, 1, 5, errors);

    if (
      scoreReliability === null &&
      scoreCommunicationCollab === null &&
      scoreProblemSolving === null &&
      overallScore === null
    ) {
      errors.push('At least one peer score is required');
    }

    const positiveScore = validateScore('PositiveScore', row.PositiveScore, 0, 1, errors);
    const neutralScore = validateScore('NeutralScore', row.NeutralScore, 0, 1, errors);
    const negativeScore = validateScore('NegativeScore', row.NegativeScore, 0, 1, errors);
    const startTime = parseTimestamp(row.StartTime);
    const completionTime = parseTimestamp(row.CompletionTime);
    const processedAt = parseTimestamp(row.ProcessedAt);

    if (isInvalidTimestamp(startTime)) {
      errors.push('StartTime is not a valid timestamp');
    }
    if (isInvalidTimestamp(completionTime)) {
      errors.push('CompletionTime is not a valid timestamp');
    }
    if (isInvalidTimestamp(processedAt)) {
      errors.push('ProcessedAt is not a valid timestamp');
    }

    if (errors.length) {
      return { rowIndex, raw: row, errors, warnings, normalized: null };
    }

    return {
      rowIndex,
      raw: row,
      errors,
      warnings,
      normalized: {
        response_id: responseId,
        start_time: startTime as string | null,
        completion_time: completionTime as string | null,
        responder_email: clean(row.ResponderEmail) || null,
        responder_name: clean(row.ResponderName) || null,
        employee_name: employeeName,
        employee_id: matchedProfile?.display_name ?? employeeName,
        rater_relation: clean(row.RaterRelation) || null,
        work_frequency: clean(row.WorkFrequency) || null,
        score_reliability: scoreReliability,
        score_communication_collab: scoreCommunicationCollab,
        score_problem_solving: scoreProblemSolving,
        overall_score: overallScore,
        strength_comment: clean(row.StrengthComment) || null,
        improvement_comment: clean(row.ImprovementComment) || null,
        comment_text_for_ai: clean(row.CommentTextForAI) || null,
        process_status: clean(row.ProcessStatus) || null,
        processed_at: processedAt as string | null,
        model_version: clean(row.ModelVersion) || null,
        sentiment_label: clean(row.SentimentLabel) || null,
        positive_score: positiveScore,
        neutral_score: neutralScore,
        negative_score: negativeScore,
        error_message: clean(row.ErrorMessage) || null,
      },
    };
  });
}

export function buildPeerReviewSummaries(
  periodId: string,
  rows: PeerReviewResult[],
) {
  const rowsByEmployee = new Map<string, PeerReviewResult[]>();

  for (const row of rows) {
    const employeeId = row.employee_id || row.employee_name;
    rowsByEmployee.set(employeeId, [...(rowsByEmployee.get(employeeId) ?? []), row]);
  }

  return Array.from(rowsByEmployee.entries()).map(([employeeId, employeeRows]) => {
    const relationSummary: Record<string, number> = {};
    const workFrequencySummary: Record<string, number> = {};
    const strengthComments: string[] = [];
    const improvementComments: string[] = [];
    const aiCommentTexts: string[] = [];
    const processingErrors: PeerReviewSummary['processing_errors'] = [];

    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;

    for (const row of employeeRows) {
      increment(relationSummary, row.rater_relation);
      increment(workFrequencySummary, row.work_frequency);

      if (row.strength_comment) strengthComments.push(row.strength_comment);
      if (row.improvement_comment) improvementComments.push(row.improvement_comment);
      if (row.comment_text_for_ai) aiCommentTexts.push(row.comment_text_for_ai);

      const sentiment = normalizeSentiment(row.sentiment_label);
      if (sentiment === 'positive') positiveCount += 1;
      if (sentiment === 'neutral') neutralCount += 1;
      if (sentiment === 'negative') negativeCount += 1;

      const hasProcessingError =
        !!row.error_message ||
        clean(row.process_status).toLowerCase().includes('error') ||
        clean(row.process_status).toLowerCase().includes('failed');

      if (hasProcessingError) {
        processingErrors.push({
          response_id: row.response_id,
          process_status: row.process_status,
          error_message: row.error_message,
        });
      }
    }

    return {
      period_id: periodId,
      employee_id: employeeId,
      employee_name: employeeRows[0]?.employee_name ?? employeeId,
      reviewer_count: employeeRows.length,
      avg_reliability: average(employeeRows.map((row) => row.score_reliability)),
      avg_communication_collab: average(
        employeeRows.map((row) => row.score_communication_collab),
      ),
      avg_problem_solving: average(
        employeeRows.map((row) => row.score_problem_solving),
      ),
      avg_overall_score: average(employeeRows.map((row) => row.overall_score)),
      positive_count: positiveCount,
      neutral_count: neutralCount,
      negative_count: negativeCount,
      avg_positive_score: average(employeeRows.map((row) => row.positive_score)),
      avg_neutral_score: average(employeeRows.map((row) => row.neutral_score)),
      avg_negative_score: average(employeeRows.map((row) => row.negative_score)),
      relation_summary: Object.keys(relationSummary).length ? relationSummary : null,
      work_frequency_summary: Object.keys(workFrequencySummary).length
        ? workFrequencySummary
        : null,
      strength_comments: strengthComments.length ? strengthComments : null,
      improvement_comments: improvementComments.length ? improvementComments : null,
      ai_comment_texts: aiCommentTexts.length ? aiCommentTexts : null,
      processing_errors: processingErrors?.length ? processingErrors : null,
      updated_at: new Date().toISOString(),
    };
  });
}
