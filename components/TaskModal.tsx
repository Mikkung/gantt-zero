// components/TaskModal.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Task, Profile, TaskSource } from '../types';
import { generateDeterministicProgressSummary } from '../utils/taskProgress';
import { getTaskSourceLabel, isOriginalAsTask } from '../utils/taskSource';

// ถ้าคุณย้าย WorkType ไปไว้ใน types.ts แล้ว export ก็ลบ type นี้ออกได้
export type WorkType =
  | 'routine' // งานประจำ
  | 'strategic' // งานยุทธศาสตร์
  | 'process_improvement' // งานพัฒนากระบวนการ
  | 'self_development' // งานพัฒนาตนเอง
  | 'other'; // งานอื่นๆ

const WORK_TYPE_OPTIONS: { value: WorkType; label: string }[] = [
  { value: 'routine', label: 'งานประจำ' },
  { value: 'strategic', label: 'งานยุทธศาสตร์' },
  { value: 'process_improvement', label: 'งานพัฒนากระบวนการ' },
  { value: 'self_development', label: 'งานพัฒนาตนเอง' },
  { value: 'other', label: 'งานอื่นๆ' },
];

interface TaskModalProps {
  isOpen: boolean;
  task: Task | null;
  allTasks: Task[];

  users?: Profile[];
  currentUser?: Profile | null;
  canEdit?: boolean;
  defaultAssignee?: string | null;
  fixedParentTask?: Task | null;
  onClose: () => void;
  onSave: (partial: Partial<Task>) => void;
  onDelete: (id: string) => void;

  // 👇 ใหม่: ฟังก์ชันสำหรับ duplicate task
  onDuplicate?: (task: Task) => void;
  onAddSubtask?: (task: Task) => void;
}

export default function TaskModal({
  isOpen,
  task,
  allTasks,
  users = [],
  currentUser,
  canEdit = true,
  defaultAssignee,
  fixedParentTask,
  onClose,
  onSave,
  onDelete,
  onDuplicate,
  onAddSubtask,
}: TaskModalProps) {
  const isEdit = !!task;
  const disabled = !canEdit;
  const isUserRole = currentUser?.role === 'user';
  const isAdminRole = currentUser?.role === 'admin';
  const isCreateChildMode = !isEdit && !!fixedParentTask;

  // ----- local form state -----
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [status, setStatus] = useState<Task['status']>('To Do');
  const [priority, setPriority] = useState<Task['priority']>('Medium');
  const [progress, setProgress] = useState<number>(0);
  const [weight, setWeight] = useState<number | ''>(0);
  const [progressSummary, setProgressSummary] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [isRecurring, setIsRecurring] = useState<boolean>(false);
  const [recurringType, setRecurringType] =
    useState<Task['recurring_type']>('none');
  const [recurringInterval, setRecurringInterval] =
    useState<number | null>(null);
  const [recurringUnit, setRecurringUnit] =
    useState<Task['recurring_unit']>('month');
  const [dependencies, setDependencies] = useState<string | null>(null);
  const [taskSource, setTaskSource] = useState<TaskSource>('as_original');
  const [countsTowardAssessment, setCountsTowardAssessment] = useState(true);
  const [includeInAiSummary, setIncludeInAiSummary] = useState(true);

  // ประเภทงาน
  const [workType, setWorkType] = useState<WorkType | ''>('');

  // เพิ่ม ผลผลิต / ความถี่ / เวลาที่ใช้
  const [output, setOutput] = useState('');
  const [frequencyCount, setFrequencyCount] = useState<number | ''>('');
  const [frequencyUnit, setFrequencyUnit] = useState<'month' | 'year'>('month');
  const [timePerOccurrenceMinutes, setTimePerOccurrenceMinutes] =
    useState<number | ''>('');

  const assigneeSuggestions = useMemo(() => {
    const list = users || [];
    const names = new Set<string>();

    list.forEach((u) => {
      if (u.display_name) names.add(u.display_name);
    });

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [users]);

  const getTodayString = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  useEffect(() => {
    if (!isOpen) return;

    if (task) {
      // ----- Edit mode -----
      setName(task.name);
      setDescription(task.description ?? '');
      setStartDate(task.start_date);
      setEndDate(task.end_date);
      setStatus(task.status);
      setPriority(task.priority);
      setProgress(task.progress ?? 0);
      setWeight(task.weight ?? 0);
      setProgressSummary(task.progress_summary ?? '');
      setAssignee(task.assignee);
      setParentId(task.parent_id ?? null);
      setIsRecurring(task.is_recurring ?? false);
      setRecurringType(task.recurring_type ?? 'none');
      setRecurringInterval(task.recurring_interval ?? null);
      setRecurringUnit(task.recurring_unit ?? 'month');
      setDependencies(task.dependencies ?? '');
      setTaskSource(task.task_source ?? 'as_original');
      setCountsTowardAssessment(task.counts_toward_assessment ?? true);
      setIncludeInAiSummary(task.include_in_ai_summary ?? true);
      setWorkType((task.work_type as WorkType | null) ?? '');

      // เพิ่มผลผลิต / จำนวนครั้ง / เวลาที่ใช้
      setOutput(task.output ?? '');
      setFrequencyCount(task.frequency_count ?? '');
      setFrequencyUnit(task.frequency_unit ?? 'month');
      setTimePerOccurrenceMinutes(task.time_per_occurrence_minutes ?? '');
    } else {
      // ----- Create mode -----
      setName('');
      setDescription('');

      const today = getTodayString();
      setStartDate(today);

      setEndDate(null);
      setStatus('To Do');
      setPriority('Medium');
      setProgress(0);
      setWeight(0);
      setProgressSummary('');
      setAssignee(
        isCreateChildMode
          ? currentUser?.role === 'user'
            ? currentUser.display_name
            : fixedParentTask?.assignee ?? currentUser?.display_name ?? null
          : defaultAssignee ?? currentUser?.display_name ?? null,
      );
      setParentId(isCreateChildMode ? fixedParentTask?.id ?? null : null);
      setIsRecurring(false);
      setRecurringType('none');
      setRecurringInterval(null);
      setRecurringUnit('month');
      setDependencies('');
      setTaskSource(
        isCreateChildMode
          ? 'user_added'
          : isAdminRole
            ? 'admin_added'
            : 'user_added',
      );
      setCountsTowardAssessment(isCreateChildMode ? false : isAdminRole);
      setIncludeInAiSummary(true);
      setWorkType((fixedParentTask?.work_type as WorkType | null) ?? '');

      // reset ช่องใหม่
      setOutput('');
      setFrequencyCount('');
      setFrequencyUnit('month');
      setTimePerOccurrenceMinutes('');
    }
  }, [
    isOpen,
    task,
    currentUser,
    defaultAssignee,
    isAdminRole,
    isCreateChildMode,
    fixedParentTask,
  ]);

  const parentOptions = useMemo(
    () =>
      allTasks.filter((candidate) => {
        if (task && candidate.id === task.id) return false;
        if (!isUserRole) return true;
        return (
          isOriginalAsTask(candidate) &&
          candidate.assignee === currentUser?.display_name
        );
      }),
    [allTasks, currentUser?.display_name, isUserRole, task],
  );

  if (!isOpen) return null;

  const handleProgressChange = (value: number) => {
    setProgress(value);

    setStatus((prev) => {
      if (prev === 'Blocked' || prev === 'In problem Need Help') {
        return prev;
      }

      if (value === 0) return 'To Do';
      if (value === 100) return 'Done';
      return 'In Progress';
    });
  };

  const handleStatusChange = (newStatus: Task['status']) => {
    setStatus(newStatus);

    setProgress((prev) => {
      if (newStatus === 'Done') return 100;
      if (newStatus === 'To Do') return 0;
      return prev;
    });
  };

  const estimatedHours =
    frequencyCount === '' || timePerOccurrenceMinutes === ''
      ? null
      : (
          (Number(frequencyCount) * Number(timePerOccurrenceMinutes)) /
          60
        ).toFixed(1);

  const handleSubmit = () => {
    if (!canEdit) {
      onClose();
      return;
    }

    if (!name.trim()) {
      alert('Please enter a task name.');
      return;
    }
    if (!startDate) {
      alert('Please select a start date.');
      return;
    }
    if (!workType) {
      alert('Please select a work type.');
      return;
    }
    if (!assignee) {
      alert('Please choose an assignee.');
      return;
    }
    if (weight !== '' && Number(weight) < 0) {
      alert('Weight cannot be negative.');
      return;
    }

    onSave({
      id: task?.id,
      name: name.trim(),
      description: description || '',
      start_date: startDate,
      end_date: endDate,
      status,
      priority,
      progress,
      weight: isCreateChildMode ? 0 : weight === '' ? 0 : Number(weight),
      progress_summary: progressSummary.trim() || null,
      assignee: isCreateChildMode
        ? currentUser?.role === 'user'
          ? currentUser.display_name
          : fixedParentTask?.assignee ?? assignee
        : assignee,
      parent_id: isCreateChildMode ? fixedParentTask?.id ?? null : parentId,
      is_recurring: isRecurring,
      recurring_type: isRecurring ? recurringType : 'none',
      recurring_interval: isRecurring ? recurringInterval : null,
      recurring_unit: isRecurring ? recurringUnit : null,
      dependencies,
      work_type: workType || null,

      output: output || '',
      frequency_count: frequencyCount === '' ? null : Number(frequencyCount),
      frequency_unit: frequencyUnit,
      time_per_occurrence_minutes:
        timePerOccurrenceMinutes === ''
          ? null
          : Number(timePerOccurrenceMinutes),
      task_source: isCreateChildMode
        ? 'user_added'
        : isAdminRole
          ? taskSource
          : undefined,
      counts_toward_assessment: isCreateChildMode
        ? false
        : isAdminRole
          ? countsTowardAssessment
          : undefined,
      include_in_ai_summary: isCreateChildMode
        ? true
        : isAdminRole
          ? includeInAiSummary
          : undefined,
    });
  };

  const handleDeleteClick = () => {
    if (!task || !task.id || !canEdit) return;
    if (!confirm('Delete this task?')) return;
    onDelete(task.id);
  };

  // 👇 ใหม่: กด Duplicate
  const handleDuplicateClick = () => {
    if (!task || !canEdit) return;
    if (!onDuplicate) return;
    onDuplicate(task);
  };

  const handleGenerateSummary = () => {
    if (!task) return;
    setProgressSummary(generateDeterministicProgressSummary(task, allTasks));
  };

  const canGenerateSummary =
    !!task && allTasks.some((candidate) => candidate.parent_id === task.id);
  const canAddSubtaskFromModal =
    !!task &&
    !!onAddSubtask &&
    !disabled &&
    isOriginalAsTask(task) &&
    (isAdminRole ||
      (isUserRole && task.assignee === currentUser?.display_name));
  const canDeleteTask =
    !!task && canEdit && !(isUserRole && isOriginalAsTask(task));

  const RequiredMark = () => (
    <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="modal-header">
          <div>
            <div className="modal-title-main">
              {isCreateChildMode
                ? 'Create subtask'
                : isEdit
                  ? 'Edit task'
                  : 'Create task'}
            </div>
            <div className="modal-title-sub">
              Keep details clear so your team can move fast.
              {task && ` · ${getTaskSourceLabel(task)}`}
              {isCreateChildMode && ' · Added Task'}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ×
          </button>
        </div>

        {/* body */}
        <div className="modal-body">
          {isCreateChildMode && fixedParentTask && (
            <div
              style={{
                borderRadius: 10,
                border: '1px solid #bae6fd',
                background: '#f0f9ff',
                color: '#075985',
                padding: 10,
                marginBottom: 12,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <strong>เพิ่มงานย่อยใต้:</strong> {fixedParentTask.name}
              <div style={{ marginTop: 4 }}>
                งานที่เพิ่มเองจะไม่ถูกนำไปคิดคะแนนประเมิน
                แต่สามารถใช้เป็นข้อมูลประกอบ AI Summary ได้
              </div>
            </div>
          )}

          <div className="modal-form-grid-2">
            {/* Left column */}
            <div>
              <div className="field-label">
                Task name
                <RequiredMark />
              </div>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Prepare weekly report"
                disabled={disabled}
              />

              <div style={{ marginTop: 10 }}>
                <div className="field-label">Description</div>
                <textarea
                  className="textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add context, notes, links…"
                  disabled={disabled}
                />
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="field-label">Scheduling</div>
                <div className="field-label-small">
                  Start date
                  <RequiredMark />
                </div>
                <input
                  type="date"
                  className="input"
                  value={startDate ?? ''}
                  onChange={(e) => setStartDate(e.target.value || null)}
                  disabled={disabled}
                />
                <div className="field-label-small" style={{ marginTop: 6 }}>
                  End date
                </div>
                <input
                  type="date"
                  className="input"
                  value={endDate ?? ''}
                  onChange={(e) => setEndDate(e.target.value || null)}
                  disabled={disabled}
                />
              </div>

              {/* Work type */}
              <div style={{ marginTop: 14 }}>
                <div className="field-label">
                  ประเภทงาน
                  <RequiredMark />
                </div>
                <select
                  className="select"
                  value={workType || ''}
                  onChange={(e) =>
                    setWorkType((e.target.value || '') as WorkType | '')
                  }
                  disabled={disabled}
                >
                  <option value="">(ไม่ระบุ)</option>
                  {WORK_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* New fields */}
              <div style={{ marginTop: 14 }}>
                <div className="field-label">ผลผลิต</div>
                <input
                  className="input"
                  value={output}
                  onChange={(e) => setOutput(e.target.value)}
                  placeholder="เช่น รายงานสรุป / Dashboard / เอกสาร"
                  disabled={disabled}
                />
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="field-label">จำนวนครั้งของงาน</div>
                <input
                  type="number"
                  className="input"
                  value={frequencyCount}
                  onChange={(e) =>
                    setFrequencyCount(
                      e.target.value === '' ? '' : Number(e.target.value)
                    )
                  }
                  placeholder="เช่น 4"
                  min={0}
                  disabled={disabled}
                />
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="field-label">หน่วย</div>
                <select
                  className="select"
                  value={frequencyUnit}
                  onChange={(e) =>
                    setFrequencyUnit(e.target.value as 'month' | 'year')
                  }
                  disabled={disabled}
                >
                  <option value="month">ต่อเดือน</option>
                  <option value="year">ต่อปี</option>
                </select>
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="field-label">เวลาที่ใช้ต่อครั้ง (นาที)</div>
                <input
                  type="number"
                  className="input"
                  value={timePerOccurrenceMinutes}
                  onChange={(e) =>
                    setTimePerOccurrenceMinutes(
                      e.target.value === '' ? '' : Number(e.target.value)
                    )
                  }
                  placeholder="เช่น 90"
                  min={0}
                  disabled={disabled}
                />
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="field-label">ภาระงานรวมโดยประมาณ</div>
                <div
                  className="input"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    color: '#374151',
                    background: '#f9fafb',
                  }}
                >
                  {estimatedHours
                    ? `${estimatedHours} ชั่วโมง/${frequencyUnit === 'year' ? 'ปี' : 'เดือน'}`
                    : '-'}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div>
              <div className="field-label">Status &amp; priority</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="field-label-small">Status</div>
                  <select
                    className="select"
                    value={status}
                    onChange={(e) =>
                      handleStatusChange(e.target.value as Task['status'])
                    }
                    disabled={disabled}
                  >
                    <option value="To Do">To Do</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Blocked">Blocked</option>
                    <option value="In problem Need Help">
                      In problem – Need Help
                    </option>
                    <option value="Done">Done</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="field-label-small">Priority</div>
                  <select
                    className="select"
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as Task['priority'])
                    }
                    disabled={disabled}
                  >
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 12 }} className="range-row">
                <div className="field-label">Tracking</div>
                <div className="range-header">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <input
                  type="range"
                  className="range-input"
                  min={0}
                  max={100}
                  step={5}
                  value={progress}
                  onChange={(e) => handleProgressChange(Number(e.target.value))}
                  disabled={disabled}
                />
              </div>

              {!isCreateChildMode && (
                <div style={{ marginTop: 12 }}>
                  <div className="field-label">Weight</div>
                  <input
                    type="number"
                    className="input"
                    value={weight}
                    onChange={(e) =>
                      setWeight(
                        e.target.value === '' ? '' : Number(e.target.value),
                      )
                    }
                    placeholder="0"
                    min={0}
                    step="0.1"
                    disabled={disabled}
                  />
                </div>
              )}

              {isAdminRole && !isCreateChildMode && (
                <div style={{ marginTop: 12 }}>
                  <div className="field-label">Assessment source flags</div>
                  <div className="field-label-small">Task source</div>
                  <select
                    className="select"
                    value={taskSource}
                    onChange={(e) => setTaskSource(e.target.value as TaskSource)}
                    disabled={disabled}
                  >
                    <option value="as_original">AS Original</option>
                    <option value="admin_added">Admin Added</option>
                    <option value="user_added">User Added</option>
                  </select>
                  <label
                    style={{
                      marginTop: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: '#475569',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={countsTowardAssessment}
                      onChange={(e) =>
                        setCountsTowardAssessment(e.target.checked)
                      }
                      disabled={disabled}
                    />
                    Counts toward assessment
                  </label>
                  <label
                    style={{
                      marginTop: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: '#475569',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={includeInAiSummary}
                      onChange={(e) => setIncludeInAiSummary(e.target.checked)}
                      disabled={disabled}
                    />
                    Include in AI summary
                  </label>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <div className="field-label">Progress Summary</div>
                <textarea
                  className="textarea"
                  value={progressSummary}
                  onChange={(e) => setProgressSummary(e.target.value)}
                  placeholder="Optional progress note for this task"
                  disabled={disabled}
                />
                {canGenerateSummary && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleGenerateSummary}
                    disabled={disabled}
                    style={{ marginTop: 6 }}
                  >
                    Generate Summary
                  </button>
                )}
              </div>

              {/* Assignee */}
              <div style={{ marginTop: 12 }}>
                <div className="field-label">
                  Assignee
                  <RequiredMark />
                </div>
                {isCreateChildMode ? (
                  <div
                    className="input"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      color: '#475569',
                      background: '#f8fafc',
                    }}
                  >
                    {assignee || '-'}
                  </div>
                ) : (
                  <>
                    <input
                      className="input"
                      list="assignee-options"
                      value={assignee ?? ''}
                      onChange={(e) => setAssignee(e.target.value || null)}
                      placeholder="Name or email"
                      disabled={disabled}
                    />
                    <datalist id="assignee-options">
                      {assigneeSuggestions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="field-label">Parent task</div>
                {isCreateChildMode && fixedParentTask ? (
                  <div
                    className="input"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      color: '#475569',
                      background: '#f8fafc',
                    }}
                  >
                    {fixedParentTask.name}
                  </div>
                ) : (
                  <select
                    className="select"
                    value={parentId ?? ''}
                    onChange={(e) => setParentId(e.target.value || null)}
                    disabled={disabled}
                  >
                    <option value="">No parent</option>
                    {parentOptions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
                {isUserRole && !isEdit && (
                  <div className="field-label-small">
                    งานที่เพิ่มเองต้องอยู่ใต้งานต้นฉบับจาก AS ของคุณ
                  </div>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="field-label">
                  Dependencies (comma separated IDs)
                </div>
                <input
                  className="input"
                  value={dependencies ?? ''}
                  onChange={(e) => setDependencies(e.target.value || null)}
                  placeholder="task-id-1, task-id-2"
                  disabled={disabled}
                />
              </div>
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="modal-footer">
          <div style={{ display: 'flex', gap: 8 }}>
            {isEdit && canEdit && (
              <>
                {canDeleteTask && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={handleDeleteClick}
                  >
                    Delete
                  </button>
                )}

                {/* 👇 ปุ่ม Duplicate ใหม่ */}
                {onDuplicate && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleDuplicateClick}
                  >
                    Duplicate
                  </button>
                )}
                {canAddSubtaskFromModal && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (task) onAddSubtask(task);
                    }}
                  >
                    + Create Subtask
                  </button>
                )}
              </>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {!canEdit && (
              <span
                style={{
                  fontSize: 11,
                  color: '#b91c1c',
                  marginRight: 6,
                }}
              >
                You have view-only access with your current role.
              </span>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!canEdit}
            >
              {canEdit
                ? isEdit
                  ? 'Save changes'
                  : 'Create task'
                : 'View only'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
