'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { Profile, Task, WorkType } from '../types';
import { supabase } from '../utils/supabase';
import { isOriginalAsTask } from '../utils/taskSource';

type AddedTaskBulkImportMode = 'download' | 'import';

interface AddedTaskBulkImportModalProps {
  isOpen: boolean;
  initialMode: AddedTaskBulkImportMode;
  tasks: Task[];
  currentProfile: Profile | null;
  onClose: () => void;
  onImported: () => Promise<void>;
}

type ParentMapRow = {
  parent_label: string;
  parent_task_id: string;
  parent_task_name: string;
  parent_work_type: WorkType | '';
  assignee: string;
  task_source: string;
};

type PreviewStatus = 'valid' | 'warning' | 'error';

type PreviewRow = {
  rowNumber: number;
  parentLabel: string;
  parentTaskId: string | null;
  childName: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  status: Task['status'];
  priority: Task['priority'];
  progress: number;
  progressSummary: string | null;
  clientRef: string;
  workType: WorkType;
  teamId: string | null;
  result: PreviewStatus;
  messages: string[];
};

const TASK_SHEET_NAME = '+ Create Subtask';
const INSTRUCTION_SHEET_NAME = 'คำแนะนำ';
const SYSTEM_PARENT_MAP_SHEET_NAME = '_SYSTEM_PARENT_MAP';
const LOOKUP_SHEET_NAME = '_LOOKUP';
const TEMPLATE_MIN_DATA_ROWS = 200;

const TASK_TEMPLATE_HEADERS = [
  'เลือกงานหลักจาก AS',
  'งานย่อยที่ต้องการเพิ่ม',
  'รายละเอียด',
  'วันเริ่ม',
  'วันครบกำหนด',
  'สถานะ',
  'Priority',
  'Work Type',
  'ความคืบหน้า %',
  'สรุปความคืบหน้า',
  'client_ref',
];

const USER_INPUT_HEADERS = [
  'เลือกงานหลักจาก AS',
  'งานย่อยที่ต้องการเพิ่ม',
  'รายละเอียด',
  'วันเริ่ม',
  'วันครบกำหนด',
  'สรุปความคืบหน้า',
  'client_ref',
];

const SYSTEM_PARENT_MAP_HEADERS = [
  'parent_label',
  'parent_task_id',
  'parent_task_name',
  'parent_work_type',
  'assignee',
  'task_source',
];

const LOOKUP_HEADERS = [
  'allowed_status',
  'allowed_priority',
  'allowed_work_type',
  'work_type_label',
];

const ALLOWED_TASK_STATUSES: Task['status'][] = [
  'To Do',
  'In Progress',
  'Blocked',
  'In problem Need Help',
  'Done',
];

const ALLOWED_TASK_PRIORITIES: Task['priority'][] = ['Low', 'Medium', 'High'];

const WORK_TYPE_OPTIONS: Array<{ value: WorkType; label: string }> = [
  { value: 'routine', label: 'งานประจำ' },
  { value: 'strategic', label: 'งานยุทธศาสตร์' },
  { value: 'process_improvement', label: 'งานพัฒนากระบวนการ' },
  { value: 'self_development', label: 'งานพัฒนาตนเอง' },
  { value: 'other', label: 'งานอื่นๆ' },
];

const ALLOWED_WORK_TYPES = WORK_TYPE_OPTIONS.map((option) => option.value);

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function createParentLabel(task: Task) {
  const shortId = task.id.slice(0, 8);
  const workType = task.work_type ?? 'routine';
  return `${task.name} | ${workType} | ${shortId}`;
}

function getTodayFilePart() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatDateParts(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(
    2,
    '0',
  )}-${String(day).padStart(2, '0')}`;
}

function isValidDateParts(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function parseDateValue(value: unknown): { value: string | null; error?: string } {
  if (value === null || value === undefined || value === '') {
    return { value: null };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      value: formatDateParts(
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate(),
      ),
    };
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (
      parsed &&
      isValidDateParts(Number(parsed.y), Number(parsed.m), Number(parsed.d))
    ) {
      return {
        value: formatDateParts(Number(parsed.y), Number(parsed.m), Number(parsed.d)),
      };
    }
  }

  const raw = normalizeCell(value);
  if (!raw) return { value: null };

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const [, year, month, day] = ymd;
    if (isValidDateParts(Number(year), Number(month), Number(day))) {
      return { value: raw };
    }
  }

  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(raw) || raw.includes('/')) {
    return {
      value: null,
      error: `date "${raw}" is ambiguous. Please use YYYY-MM-DD, e.g. 2026-09-09.`,
    };
  }

  return {
    value: null,
    error: `date "${raw}" is invalid. Please use YYYY-MM-DD, e.g. 2026-09-09.`,
  };
}

function parseProgress(value: unknown): { value: number; error?: string } {
  const raw = normalizeCell(value);
  if (!raw) return { value: 0 };

  const parsed = Number(raw.replace('%', ''));
  if (!Number.isFinite(parsed)) {
    return { value: 0, error: `ความคืบหน้าต้องเป็นตัวเลข: ${raw}` };
  }
  if (parsed < 0 || parsed > 100) {
    return { value: parsed, error: 'ความคืบหน้าต้องอยู่ระหว่าง 0-100' };
  }

  return { value: parsed };
}

function parseStatus(value: unknown): { value: Task['status']; error?: string } {
  const raw = normalizeCell(value);
  if (!raw) return { value: 'To Do' };
  if (ALLOWED_TASK_STATUSES.includes(raw as Task['status'])) {
    return { value: raw as Task['status'] };
  }

  return {
    value: 'To Do',
    error: `status "${raw}" is invalid. Please choose one of: ${ALLOWED_TASK_STATUSES.join(
      ', ',
    )}.`,
  };
}

function parsePriority(value: unknown): { value: Task['priority']; error?: string } {
  const raw = normalizeCell(value);
  if (!raw) return { value: 'Medium' };
  if (ALLOWED_TASK_PRIORITIES.includes(raw as Task['priority'])) {
    return { value: raw as Task['priority'] };
  }

  return {
    value: 'Medium',
    error: `priority "${raw}" is invalid. Please choose one of: ${ALLOWED_TASK_PRIORITIES.join(
      ', ',
    )}.`,
  };
}

function parseWorkType(
  value: unknown,
  fallback: WorkType,
): { value: WorkType; error?: string } {
  const raw = normalizeCell(value);
  if (!raw) return { value: fallback };
  if (ALLOWED_WORK_TYPES.includes(raw as WorkType)) {
    return { value: raw as WorkType };
  }

  return {
    value: fallback,
    error: `work_type "${raw}" is invalid. Please choose one of: ${ALLOWED_WORK_TYPES.join(
      ', ',
    )}.`,
  };
}

function normalizeWorkType(value: unknown): WorkType {
  const raw = normalizeCell(value);
  return ALLOWED_WORK_TYPES.includes(raw as WorkType)
    ? (raw as WorkType)
    : 'routine';
}

function isBlankImportRow(row: Record<string, unknown>) {
  const hasUserInput = USER_INPUT_HEADERS.some(
    (header) => !!normalizeCell(row[header]),
  );
  if (hasUserInput) return false;

  const status = normalizeCell(row['สถานะ']);
  const priority = normalizeCell(row.Priority);
  const workType = normalizeCell(row['Work Type']);
  const progress = normalizeCell(row['ความคืบหน้า %']);

  return (
    (!status || status === 'To Do') &&
    (!priority || priority === 'Medium') &&
    (!workType || workType === 'routine') &&
    (!progress || progress === '0' || progress === '0%')
  );
}

function makeRowsForTemplate(parentMapRows: ParentMapRow[]) {
  const rows: Record<string, string>[] = [];

  parentMapRows.forEach((parentRow) => {
    rows.push({
      'เลือกงานหลักจาก AS': parentRow.parent_label,
      'งานย่อยที่ต้องการเพิ่ม': '',
      รายละเอียด: '',
      วันเริ่ม: '',
      วันครบกำหนด: '',
      สถานะ: 'To Do',
      Priority: 'Medium',
      'Work Type': parentRow.parent_work_type || 'routine',
      'ความคืบหน้า %': '0',
      สรุปความคืบหน้า: '',
      client_ref: '',
    });
  });

  while (rows.length < Math.max(parentMapRows.length + 20, 30)) {
    rows.push({
      'เลือกงานหลักจาก AS': '',
      'งานย่อยที่ต้องการเพิ่ม': '',
      รายละเอียด: '',
      วันเริ่ม: '',
      วันครบกำหนด: '',
      สถานะ: 'To Do',
      Priority: 'Medium',
      'Work Type': 'routine',
      'ความคืบหน้า %': '0',
      สรุปความคืบหน้า: '',
      client_ref: '',
    });
  }

  return rows;
}

function makeLookupRows() {
  const rowCount = Math.max(
    ALLOWED_TASK_STATUSES.length,
    ALLOWED_TASK_PRIORITIES.length,
    WORK_TYPE_OPTIONS.length,
  );

  return Array.from({ length: rowCount }, (_, index) => ({
    allowed_status: ALLOWED_TASK_STATUSES[index] ?? '',
    allowed_priority: ALLOWED_TASK_PRIORITIES[index] ?? '',
    allowed_work_type: WORK_TYPE_OPTIONS[index]?.value ?? '',
    work_type_label: WORK_TYPE_OPTIONS[index]?.label ?? '',
  }));
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type SheetValidationRule = {
  sqref: string;
  type: 'list' | 'date' | 'decimal';
  formula1: string;
  formula2?: string;
  allowBlank?: boolean;
  operator?: 'between';
  errorTitle: string;
  error: string;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createDataValidationsXml(rules: SheetValidationRule[]) {
  const entries = rules.map((rule) => {
    const operator = rule.operator ? ` operator="${rule.operator}"` : '';
    const formula2 = rule.formula2
      ? `<formula2>${escapeXml(rule.formula2)}</formula2>`
      : '';

    return [
      `<dataValidation type="${rule.type}" allowBlank="${
        rule.allowBlank ? 1 : 0
      }" showErrorMessage="1" errorStyle="stop"${operator} sqref="${escapeXml(
        rule.sqref,
      )}" errorTitle="${escapeXml(rule.errorTitle)}" error="${escapeXml(
        rule.error,
      )}">`,
      `<formula1>${escapeXml(rule.formula1)}</formula1>`,
      formula2,
      '</dataValidation>',
    ].join('');
  });

  return `<dataValidations count="${rules.length}">${entries.join(
    '',
  )}</dataValidations>`;
}

function addDataValidationsToSheetXml(
  sheetXml: string,
  rules: SheetValidationRule[],
) {
  const withoutExistingRules = sheetXml.replace(
    /<dataValidations[\s\S]*?<\/dataValidations>/,
    '',
  );
  const validationXml = createDataValidationsXml(rules);
  const insertBeforeTags = [
    '<hyperlinks',
    '<printOptions',
    '<pageMargins',
    '<pageSetup',
    '<headerFooter',
    '<ignoredErrors',
    '</worksheet>',
  ];

  for (const tag of insertBeforeTags) {
    const index = withoutExistingRules.indexOf(tag);
    if (index >= 0) {
      return `${withoutExistingRules.slice(
        0,
        index,
      )}${validationXml}${withoutExistingRules.slice(index)}`;
    }
  }

  return withoutExistingRules;
}

async function downloadWorkbookWithValidation(
  workbook: XLSX.WorkBook,
  taskSheetValidationRules: SheetValidationRule[],
  fileName: string,
) {
  const workbookBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
  });
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(workbookBuffer);
  const taskSheetPath = 'xl/worksheets/sheet1.xml';
  const taskSheetFile = zip.file(taskSheetPath);

  if (!taskSheetFile) {
    throw new Error('Cannot find task worksheet in XLSX package.');
  }

  const taskSheetXml = await taskSheetFile.async('string');
  zip.file(
    taskSheetPath,
    addDataValidationsToSheetXml(taskSheetXml, taskSheetValidationRules),
  );

  const patchedWorkbook = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
  });
  const blob = new Blob([patchedWorkbook], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, fileName);
}

export default function AddedTaskBulkImportModal({
  isOpen,
  initialMode,
  tasks,
  currentProfile,
  onClose,
  onImported,
}: AddedTaskBulkImportModalProps) {
  const [mode, setMode] = useState<AddedTaskBulkImportMode>(initialMode);
  const [selectedParentIds, setSelectedParentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const eligibleParents = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            currentProfile?.display_name &&
            isOriginalAsTask(task) &&
            task.assignee === currentProfile.display_name,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [currentProfile?.display_name, tasks],
  );

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
  }, [initialMode, isOpen]);

  const selectedParents = useMemo(
    () =>
      eligibleParents.filter((task) =>
        selectedParentIds.size === 0
          ? false
          : selectedParentIds.has(task.id),
      ),
    [eligibleParents, selectedParentIds],
  );

  if (!isOpen) return null;

  const handleSelectAll = () => {
    setSelectedParentIds(new Set(eligibleParents.map((task) => task.id)));
  };

  const handleClearAll = () => {
    setSelectedParentIds(new Set());
  };

  const handleToggleParent = (taskId: string) => {
    setSelectedParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleDownloadTemplate = async () => {
    if (!currentProfile?.display_name) {
      alert('Cannot read your profile. Please sign in again.');
      return;
    }
    if (selectedParents.length === 0) {
      alert('Please select at least one AS parent task.');
      return;
    }

    const parentMapRows: ParentMapRow[] = selectedParents.map((task) => ({
      parent_label: createParentLabel(task),
      parent_task_id: task.id,
      parent_task_name: task.name,
      parent_work_type: (task.work_type as WorkType | null) ?? '',
      assignee: currentProfile.display_name,
      task_source: 'as_original',
    }));

    const fileName = `added-task-template-${currentProfile.display_name.replace(
      /[\\/:*?"<>|\s]+/g,
      '-',
    )}-${getTodayFilePart()}.xlsx`;

    setDownloadingTemplate(true);
    try {
      const workbook = XLSX.utils.book_new();
      const taskSheet = XLSX.utils.json_to_sheet(
        makeRowsForTemplate(parentMapRows),
        { header: TASK_TEMPLATE_HEADERS },
      );
      taskSheet['!cols'] = [
        { wch: 48 },
        { wch: 32 },
        { wch: 36 },
        { wch: 14 },
        { wch: 14 },
        { wch: 22 },
        { wch: 14 },
        { wch: 22 },
        { wch: 14 },
        { wch: 36 },
        { wch: 18 },
      ];
      taskSheet['!freeze'] = { xSplit: 0, ySplit: 1 };

      const instructionSheet = XLSX.utils.aoa_to_sheet([
        ['คำแนะนำการเพิ่มงานย่อย'],
        ['1 row = 1 added child task'],
        ['เลือกงานหลักจาก AS, สถานะ, Priority และ Work Type จาก dropdown'],
        ['กรอกชื่องานย่อยใน column "งานย่อยที่ต้องการเพิ่ม"'],
        ['วันที่ให้ใช้รูปแบบ YYYY-MM-DD เช่น 2026-09-09'],
        ['งานที่เพิ่มจะไม่กระทบคะแนนประเมินอย่างเป็นทางการ'],
        ['งานที่เพิ่มอาจถูกใช้เป็นหลักฐานประกอบ AI summary'],
        ['กรุณาอย่าแก้ไข sheet ที่ขึ้นต้นด้วย _SYSTEM หรือ _LOOKUP'],
        ['ถ้าต้องการช่วยตรวจ import ซ้ำ ให้ใส่ client_ref'],
      ]);
      instructionSheet['!cols'] = [{ wch: 104 }];

      const systemSheet = XLSX.utils.json_to_sheet(parentMapRows, {
        header: SYSTEM_PARENT_MAP_HEADERS,
      });
      systemSheet['!cols'] = [
        { wch: 48 },
        { wch: 38 },
        { wch: 36 },
        { wch: 20 },
        { wch: 24 },
        { wch: 16 },
      ];

      const lookupSheet = XLSX.utils.json_to_sheet(makeLookupRows(), {
        header: LOOKUP_HEADERS,
      });
      lookupSheet['!cols'] = [
        { wch: 24 },
        { wch: 18 },
        { wch: 24 },
        { wch: 28 },
      ];

      XLSX.utils.book_append_sheet(workbook, taskSheet, TASK_SHEET_NAME);
      XLSX.utils.book_append_sheet(
        workbook,
        instructionSheet,
        INSTRUCTION_SHEET_NAME,
      );
      XLSX.utils.book_append_sheet(
        workbook,
        systemSheet,
        SYSTEM_PARENT_MAP_SHEET_NAME,
      );
      XLSX.utils.book_append_sheet(workbook, lookupSheet, LOOKUP_SHEET_NAME);
      workbook.Workbook = {
        Sheets: [
          { Hidden: 0 },
          { Hidden: 0 },
          { Hidden: 2 },
          { Hidden: 2 },
        ],
      };

      const lastRow = Math.max(
        TEMPLATE_MIN_DATA_ROWS + 1,
        parentMapRows.length + 26,
      );
      const parentListFormula = `'${SYSTEM_PARENT_MAP_SHEET_NAME}'!$A$2:$A$${
        parentMapRows.length + 1
      }`;
      const statusListFormula = `'${LOOKUP_SHEET_NAME}'!$A$2:$A$${
        ALLOWED_TASK_STATUSES.length + 1
      }`;
      const priorityListFormula = `'${LOOKUP_SHEET_NAME}'!$B$2:$B$${
        ALLOWED_TASK_PRIORITIES.length + 1
      }`;
      const workTypeListFormula = `'${LOOKUP_SHEET_NAME}'!$C$2:$C$${
        WORK_TYPE_OPTIONS.length + 1
      }`;

      await downloadWorkbookWithValidation(
        workbook,
        [
          {
            sqref: `A2:A${lastRow}`,
            type: 'list',
            allowBlank: false,
            formula1: parentListFormula,
            errorTitle: 'Invalid parent task',
            error: 'Please choose an AS parent task from the dropdown.',
          },
          {
            sqref: `D2:E${lastRow}`,
            type: 'date',
            operator: 'between',
            allowBlank: true,
            formula1: 'DATE(2000,1,1)',
            formula2: 'DATE(2100,12,31)',
            errorTitle: 'Invalid date',
            error: 'Please use YYYY-MM-DD, e.g. 2026-09-09.',
          },
          {
            sqref: `F2:F${lastRow}`,
            type: 'list',
            allowBlank: true,
            formula1: statusListFormula,
            errorTitle: 'Invalid status',
            error: 'Please choose a status from the dropdown.',
          },
          {
            sqref: `G2:G${lastRow}`,
            type: 'list',
            allowBlank: true,
            formula1: priorityListFormula,
            errorTitle: 'Invalid priority',
            error: 'Please choose a priority from the dropdown.',
          },
          {
            sqref: `H2:H${lastRow}`,
            type: 'list',
            allowBlank: true,
            formula1: workTypeListFormula,
            errorTitle: 'Invalid work type',
            error: 'Please choose a work type from the dropdown.',
          },
          {
            sqref: `I2:I${lastRow}`,
            type: 'decimal',
            operator: 'between',
            allowBlank: true,
            formula1: '0',
            formula2: '100',
            errorTitle: 'Invalid progress',
            error: 'Progress must be a number from 0 to 100.',
          },
        ],
        fileName,
      );
    } catch (error) {
      console.error('Added task template download error:', error);
      alert('Cannot create XLSX template. Please try again.');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handlePreviewFile = async (file: File) => {
    setPreviewRows([]);
    setPreviewError(null);

    if (!currentProfile?.display_name) {
      setPreviewError('Cannot read your profile. Please sign in again.');
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const taskSheet = workbook.Sheets[TASK_SHEET_NAME];
      const systemSheet = workbook.Sheets[SYSTEM_PARENT_MAP_SHEET_NAME];

      if (!taskSheet) {
        setPreviewError(`ไม่พบ sheet "${TASK_SHEET_NAME}"`);
        return;
      }
      if (!systemSheet) {
        setPreviewError(`ไม่พบ sheet "${SYSTEM_PARENT_MAP_SHEET_NAME}"`);
        return;
      }

      const taskRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        taskSheet,
        { defval: '', raw: true },
      );
      const parentMapRows =
        XLSX.utils.sheet_to_json<Record<string, unknown>>(systemSheet, {
          defval: '',
          raw: true,
        });

      const parentMap = new Map<string, ParentMapRow>();
      parentMapRows.forEach((row) => {
        const label = normalizeCell(row.parent_label);
        const taskId = normalizeCell(row.parent_task_id);
        if (!label || !taskId) return;
        parentMap.set(label, {
          parent_label: label,
          parent_task_id: taskId,
          parent_task_name: normalizeCell(row.parent_task_name),
          parent_work_type: normalizeCell(row.parent_work_type) as WorkType | '',
          assignee: normalizeCell(row.assignee),
          task_source: normalizeCell(row.task_source),
        });
      });

      if (parentMap.size === 0) {
        setPreviewError('ไม่พบข้อมูล parent task ใน system map');
        return;
      }

      const parentIds = Array.from(
        new Set(Array.from(parentMap.values()).map((row) => row.parent_task_id)),
      );
      const { data: dbParents, error: parentError } = await supabase
        .from('tasks')
        .select('*')
        .in('id', parentIds);

      if (parentError) {
        setPreviewError(
          `Cannot validate parent tasks: ${parentError.message}`,
        );
        return;
      }

      const dbParentMap = new Map<string, Task>();
      (dbParents as Task[] | null)?.forEach((task) => {
        dbParentMap.set(task.id, task);
      });

      const seenClientRefs = new Set<string>();
      const existingChildKeys = new Set(
        tasks
          .filter((task) => task.assignee === currentProfile.display_name)
          .map(
            (task) =>
              `${task.parent_id ?? ''}::${task.name.trim().toLowerCase()}`,
          ),
      );

      const parsedRows: PreviewRow[] = taskRows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !isBlankImportRow(row))
        .map(({ row, index }) => {
          const messages: string[] = [];
          let result: PreviewStatus = 'valid';

          const parentLabel = normalizeCell(row['เลือกงานหลักจาก AS']);
          const childName = normalizeCell(row['งานย่อยที่ต้องการเพิ่ม']);
          const description = normalizeCell(row['รายละเอียด']);
          const progressSummary =
            normalizeCell(row['สรุปความคืบหน้า']) || null;
          const clientRef = normalizeCell(row.client_ref);
          const mapRow = parentMap.get(parentLabel);
          const dbParent = mapRow
            ? dbParentMap.get(mapRow.parent_task_id)
            : undefined;
          const fallbackWorkType =
            dbParent?.work_type ?? normalizeWorkType(mapRow?.parent_work_type);

          if (!parentLabel) {
            messages.push('กรุณาเลือกงานหลักจาก AS');
            result = 'error';
          } else if (!mapRow) {
            messages.push('ไม่พบงานหลักนี้ใน template system map');
            result = 'error';
          }

          if (mapRow && !dbParent) {
            messages.push('ไม่พบ parent_task_id นี้ใน database');
            result = 'error';
          }
          if (dbParent && !isOriginalAsTask(dbParent)) {
            messages.push('parent task ต้องเป็นงานต้นฉบับจาก AS เท่านั้น');
            result = 'error';
          }
          if (dbParent && dbParent.assignee !== currentProfile.display_name) {
            messages.push('ไม่สามารถเพิ่มงานใต้ AS task ของผู้อื่นได้');
            result = 'error';
          }

          if (!childName) {
            messages.push('กรุณากรอกชื่องานย่อย');
            result = 'error';
          }

          const startDate = parseDateValue(row['วันเริ่ม']);
          const endDate = parseDateValue(row['วันครบกำหนด']);
          if (startDate.error) {
            messages.push(startDate.error);
            result = 'error';
          }
          if (endDate.error) {
            messages.push(endDate.error);
            result = 'error';
          }
          if (
            startDate.value &&
            endDate.value &&
            startDate.value > endDate.value
          ) {
            messages.push('due_date must not be earlier than start_date.');
            result = 'error';
          }

          const progress = parseProgress(row['ความคืบหน้า %']);
          if (progress.error) {
            messages.push(progress.error);
            result = 'error';
          }

          const status = parseStatus(row['สถานะ']);
          if (status.error) {
            messages.push(status.error);
            result = 'error';
          }

          const priority = parsePriority(row.Priority);
          if (priority.error) {
            messages.push(priority.error);
            result = 'error';
          }

          const workType = parseWorkType(row['Work Type'], fallbackWorkType);
          if (workType.error) {
            messages.push(workType.error);
            result = 'error';
          }

          if (clientRef) {
            const refKey = `${mapRow?.parent_task_id ?? parentLabel}::${clientRef}`;
            if (seenClientRefs.has(refKey)) {
              messages.push(
                'พบ client_ref ซ้ำในไฟล์เดียวกันใต้ parent task เดียวกัน',
              );
              if (result !== 'error') result = 'warning';
            }
            seenClientRefs.add(refKey);
          }

          if (
            mapRow?.parent_task_id &&
            childName &&
            existingChildKeys.has(
              `${mapRow.parent_task_id}::${childName.toLowerCase()}`,
            )
          ) {
            messages.push(
              'พบชื่องานย่อยนี้อยู่ใต้ parent task เดียวกันแล้ว กรุณาตรวจสอบก่อน import',
            );
            if (result !== 'error') result = 'warning';
          }

          return {
            rowNumber: index + 2,
            parentLabel,
            parentTaskId: mapRow?.parent_task_id ?? null,
            childName,
            description,
            startDate: startDate.value,
            endDate: endDate.value,
            status: status.value,
            priority: priority.value,
            progress: progress.value,
            progressSummary,
            clientRef,
            workType: workType.value,
            teamId: dbParent?.team_id ?? currentProfile.team_id ?? null,
            result,
            messages,
          };
        });

      if (parsedRows.length === 0) {
        setPreviewError('ไม่พบแถวงานย่อยในไฟล์');
        return;
      }

      setPreviewRows(parsedRows);
    } catch (error) {
      console.error('Added task import preview error:', error);
      setPreviewError('Cannot read XLSX file. Please use the downloaded template.');
    }
  };

  const handleConfirmImport = async () => {
    if (!currentProfile?.display_name) return;
    const errorCount = previewRows.filter((row) => row.result === 'error').length;
    const validRows = previewRows.filter((row) => row.result !== 'error');

    if (errorCount > 0 || validRows.length === 0) {
      alert('Please fix validation errors before importing.');
      return;
    }

    setImporting(true);
    try {
      const insertRows = validRows.map((row) => ({
        name: row.childName,
        description: row.description,
        start_date: row.startDate,
        end_date: row.endDate,
        status: row.status,
        priority: row.priority,
        progress: row.progress,
        progress_summary: row.progressSummary,
        assignee: currentProfile.display_name,
        is_recurring: false,
        recurring_type: 'none',
        recurring_interval: null,
        recurring_unit: null,
        dependencies: '',
        team_id: row.teamId,
        parent_id: row.parentTaskId,
        work_type: row.workType,
        weight: 0,
        calculated_progress: null,
        task_source: 'user_added',
        counts_toward_assessment: false,
        include_in_ai_summary: true,
      }));

      const { error } = await supabase.from('tasks').insert(insertRows);
      if (error) {
        alert(`Cannot import added tasks: ${error.message}`);
        return;
      }

      await onImported();
      alert(`เพิ่มงานย่อยสำเร็จ ${insertRows.length} รายการ`);
      setPreviewRows([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onClose();
    } catch (error) {
      console.error('Added task import confirm error:', error);
      alert('Unexpected error while importing added tasks.');
    } finally {
      setImporting(false);
    }
  };

  const validCount = previewRows.filter((row) => row.result === 'valid').length;
  const warningCount = previewRows.filter(
    (row) => row.result === 'warning',
  ).length;
  const errorCount = previewRows.filter((row) => row.result === 'error').length;

  return (
    <div className="modal-backdrop">
      <div className="modal added-task-import-modal">
        <div className="modal-header">
          <div>
            <div className="modal-title-main">Added Task Bulk Import</div>
            <div className="modal-title-sub">
              เพิ่มงานย่อยใต้ AS task ของคุณโดยไม่กระทบคะแนนประเมิน
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="added-task-tabs">
            <button
              type="button"
              className={mode === 'download' ? 'is-active' : undefined}
              onClick={() => setMode('download')}
            >
              Download Template
            </button>
            <button
              type="button"
              className={mode === 'import' ? 'is-active' : undefined}
              onClick={() => setMode('import')}
            >
              Import Added Tasks
            </button>
          </div>

          {mode === 'download' ? (
            <div className="added-task-panel">
              <div className="added-task-panel-header">
                <div>
                  <div className="field-label">เลือก AS parent tasks</div>
                  <div className="field-label-small">
                    แสดงเฉพาะงานต้นฉบับจาก AS ที่ assign เป็นชื่อของคุณ
                  </div>
                </div>
                <div className="added-task-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleSelectAll}
                    disabled={eligibleParents.length === 0}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={handleClearAll}
                    disabled={selectedParentIds.size === 0}
                  >
                    Clear All
                  </button>
                </div>
              </div>

              <div className="added-task-parent-list">
                {eligibleParents.map((task) => (
                  <label key={task.id} className="added-task-parent-row">
                    <input
                      type="checkbox"
                      checked={selectedParentIds.has(task.id)}
                      onChange={() => handleToggleParent(task.id)}
                    />
                    <span>
                      <strong>{task.name}</strong>
                      <small>
                        {task.work_type ?? 'routine'} · {task.status} ·{' '}
                        {task.id.slice(0, 8)}
                      </small>
                    </span>
                  </label>
                ))}
                {eligibleParents.length === 0 && (
                  <div className="added-task-empty">
                    ยังไม่มี original AS task ที่ assign เป็นชื่อของคุณ
                  </div>
                )}
              </div>

              <div className="added-task-note">
                Template จะมี sheet เพิ่มงานย่อย, คำแนะนำ และ system parent map
                สำหรับจับคู่กลับไปยัง database task id
              </div>
            </div>
          ) : (
            <div className="added-task-panel">
              <div className="field-label">Upload completed XLSX template</div>
              <input
                ref={fileInputRef}
                type="file"
                className="input"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handlePreviewFile(file);
                }}
              />
              <div className="field-label-small">
                ระบบจะ preview และ validate ก่อน import จริงทุกครั้ง
              </div>

              {previewError && (
                <div className="added-task-error">{previewError}</div>
              )}

              {previewRows.length > 0 && (
                <>
                  <div className="added-task-preview-summary">
                    <span>Valid: {validCount}</span>
                    <span>Warnings: {warningCount}</span>
                    <span>Errors: {errorCount}</span>
                  </div>
                  <div className="added-task-preview-table-wrap">
                    <table className="added-task-preview-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Parent AS task</th>
                          <th>Added task</th>
                          <th>Status</th>
                          <th>Priority</th>
                          <th>Work Type</th>
                          <th>Progress</th>
                          <th>Result</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row) => (
                          <tr key={row.rowNumber} className={row.result}>
                            <td>{row.rowNumber}</td>
                            <td>{row.parentLabel}</td>
                            <td>{row.childName}</td>
                            <td>{row.status}</td>
                            <td>{row.priority}</td>
                            <td>{row.workType}</td>
                            <td>{row.progress}%</td>
                            <td>{row.result}</td>
                            <td>{row.messages.join(' | ') || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div className="field-label-small">
            Imported tasks force `user_added`, `weight = 0`, and do not count
            toward assessment.
          </div>
          <div className="added-task-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            {mode === 'download' ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleDownloadTemplate}
                disabled={selectedParents.length === 0 || downloadingTemplate}
              >
                {downloadingTemplate
                  ? 'Creating Template…'
                  : 'Download Added Task Template'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmImport}
                disabled={
                  importing ||
                  previewRows.length === 0 ||
                  errorCount > 0 ||
                  validCount + warningCount === 0
                }
              >
                {importing ? 'Importing…' : 'Confirm Import'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
