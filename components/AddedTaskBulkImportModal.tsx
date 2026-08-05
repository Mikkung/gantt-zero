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
  progress: number;
  progressSummary: string | null;
  clientRef: string;
  workType: WorkType;
  teamId: string | null;
  result: PreviewStatus;
  messages: string[];
};

const TASK_SHEET_NAME = 'เพิ่มงานย่อย';
const INSTRUCTION_SHEET_NAME = 'คำแนะนำ';
const SYSTEM_PARENT_MAP_SHEET_NAME = '_SYSTEM_PARENT_MAP';

const TASK_TEMPLATE_HEADERS = [
  'เลือกงานหลักจาก AS',
  'งานย่อยที่ต้องการเพิ่ม',
  'รายละเอียด',
  'วันเริ่ม',
  'วันครบกำหนด',
  'สถานะ',
  'ความคืบหน้า %',
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

const STATUS_MAP: Record<string, Task['status']> = {
  '': 'To Do',
  todo: 'To Do',
  'to do': 'To Do',
  'ยังไม่เริ่ม': 'To Do',
  'in progress': 'In Progress',
  inprogress: 'In Progress',
  doing: 'In Progress',
  'กำลังดำเนินการ': 'In Progress',
  blocked: 'Blocked',
  block: 'Blocked',
  'ติดปัญหา': 'Blocked',
  'in problem need help': 'In problem Need Help',
  'in problem - need help': 'In problem Need Help',
  'in problem – need help': 'In problem Need Help',
  'ต้องการความช่วยเหลือ': 'In problem Need Help',
  done: 'Done',
  complete: 'Done',
  completed: 'Done',
  'เสร็จแล้ว': 'Done',
};

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

function parseDateValue(value: unknown): { value: string | null; error?: string } {
  if (value === null || value === undefined || value === '') {
    return { value: null };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { value: value.toISOString().slice(0, 10) };
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const year = String(parsed.y).padStart(4, '0');
      const month = String(parsed.m).padStart(2, '0');
      const day = String(parsed.d).padStart(2, '0');
      return { value: `${year}-${month}-${day}` };
    }
  }

  const raw = normalizeCell(value);
  if (!raw) return { value: null };

  const normalized = raw.replace(/\//g, '-');
  const ymd = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const [, year, month, day] = ymd;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
    );
    if (
      date.getFullYear() === Number(year) &&
      date.getMonth() === Number(month) - 1 &&
      date.getDate() === Number(day)
    ) {
      return {
        value: `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
      };
    }
  }

  return { value: null, error: `รูปแบบวันที่ไม่ถูกต้อง: ${raw}` };
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
  const mapped = STATUS_MAP[raw.toLowerCase()] ?? STATUS_MAP[raw];
  if (mapped) return { value: mapped };
  return {
    value: 'To Do',
    error: `สถานะงานไม่อยู่ในรายการที่ระบบรองรับ: ${raw}`,
  };
}

function normalizeWorkType(value: unknown): WorkType {
  const raw = normalizeCell(value);
  if (
    raw === 'routine' ||
    raw === 'strategic' ||
    raw === 'process_improvement' ||
    raw === 'self_development' ||
    raw === 'other'
  ) {
    return raw;
  }

  return 'routine';
}

function isBlankImportRow(row: Record<string, unknown>) {
  return TASK_TEMPLATE_HEADERS.every((header) => !normalizeCell(row[header]));
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
      'ความคืบหน้า %': '0',
      สรุปความคืบหน้า: '',
      client_ref: '',
    });
  }

  return rows;
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

  const handleDownloadTemplate = () => {
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
      { wch: 18 },
      { wch: 14 },
      { wch: 36 },
      { wch: 18 },
    ];
    (taskSheet as any)['!dataValidation'] = [
      {
        sqref: `A2:A${Math.max(200, parentMapRows.length + 25)}`,
        type: 'list',
        formulas: [
          `'${SYSTEM_PARENT_MAP_SHEET_NAME}'!$A$2:$A$${parentMapRows.length + 1}`,
        ],
      },
    ];

    const instructionSheet = XLSX.utils.aoa_to_sheet([
      ['คำแนะนำการเพิ่มงานย่อย'],
      ['1 row = 1 added child task'],
      ['เลือกงานหลักจาก AS จาก dropdown หรือใช้ label ที่มีใน template เท่านั้น'],
      ['กรอกชื่องานย่อยใน column "งานย่อยที่ต้องการเพิ่ม"'],
      ['งานที่เพิ่มจะไม่กระทบคะแนนประเมินอย่างเป็นทางการ'],
      ['งานที่เพิ่มอาจถูกใช้เป็นหลักฐานประกอบ AI summary'],
      ['กรุณาอย่าแก้ไข sheet ที่ขึ้นต้นด้วย _SYSTEM'],
      ['แนะนำรูปแบบวันที่ YYYY-MM-DD'],
      ['ถ้าต้องการช่วยตรวจ import ซ้ำ ให้ใส่ client_ref'],
    ]);
    instructionSheet['!cols'] = [{ wch: 96 }];

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
    workbook.Workbook = {
      Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }],
    };

    const fileName = `added-task-template-${currentProfile.display_name.replace(
      /[\\/:*?"<>|\s]+/g,
      '-',
    )}-${getTodayFilePart()}.xlsx`;
    XLSX.writeFile(workbook, fileName);
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
            messages.push('วันเริ่มอยู่หลังวันครบกำหนด กรุณาตรวจสอบ');
            if (result !== 'error') result = 'warning';
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
            progress: progress.value,
            progressSummary,
            clientRef,
            workType:
              dbParent?.work_type ?? normalizeWorkType(mapRow?.parent_work_type),
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
        priority: 'Medium',
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
                disabled={selectedParents.length === 0}
              >
                Download Added Task Template
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
