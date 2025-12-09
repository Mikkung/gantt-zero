// components/TaskModal.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Task, Profile } from '../types';

export type WorkType =
  | 'routine'              // งานประจำ
  | 'strategic'            // งานยุทธศาสตร์
  | 'process_improvement'  // งานพัฒนากระบวนการ
  | 'self_development'     // งานพัฒนาตนเอง
  | 'other';               // งานอื่นๆ

const WORK_TYPE_OPTIONS: { value: WorkType; label: string }[] = [
  { value: 'routine',             label: 'งานประจำ' },
  { value: 'strategic',           label: 'งานยุทธศาสตร์' },
  { value: 'process_improvement', label: 'งานพัฒนากระบวนการ' },
  { value: 'self_development',    label: 'งานพัฒนาตนเอง' },
  { value: 'other',               label: 'งานอื่นๆ' },
];

interface TaskModalProps {
  isOpen: boolean;
  task: Task | null;
  allTasks: Task[];

  // list user จาก profiles ใช้สำหรับ assignee
  users?: Profile[];

  // current user (ใช้ set default assignee)
  currentUser?: Profile | null;

  canEdit?: boolean; // ถ้า false = view only
  onClose: () => void;
  onSave: (partial: Partial<Task>) => void;
  onDelete: (id: string) => void;
}

export default function TaskModal({
  isOpen,
  task,
  allTasks,
  users = [],
  currentUser = null,
  canEdit = true,
  onClose,
  onSave,
  onDelete,
}: TaskModalProps) {
  const isEdit = !!task;
  const disabled = !canEdit;

  // ----- local form state -----
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [status, setStatus] = useState<Task['status']>('To Do');
  const [priority, setPriority] = useState<Task['priority']>('Medium');
  const [progress, setProgress] = useState<number>(0);

  // assignee เก็บค่าที่จะบันทึกลง DB (string – display_name หรือ email)
  const [assignee, setAssignee] = useState<string | null>(null);
  // ข้อความที่อยู่ใน input (ใช้ทำ autocomplete)
  const [assigneeInput, setAssigneeInput] = useState('');
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);

  const [parentId, setParentId] = useState<string | null>(null);
  const [isRecurring, setIsRecurring] = useState<boolean>(false);
  const [recurringType, setRecurringType] =
    useState<Task['recurring_type']>('none');
  const [recurringInterval, setRecurringInterval] =
    useState<number | null>(null);
  const [recurringUnit, setRecurringUnit] =
    useState<Task['recurring_unit']>('month');
  const [dependencies, setDependencies] = useState<string | null>(null);

  // ประเภทงาน – ตั้ง default เป็น routine
  const [workType, setWorkType] = useState<WorkType | ''>('routine');

  // ====== สร้าง suggestions ของ assignee จาก users ======
  const assigneeSuggestions: Profile[] = useMemo(() => {
    const keyword = assigneeInput.trim().toLowerCase();
    const list = users || [];

    const filtered = !keyword
      ? list
      : list.filter((u) => {
          const name = (u.display_name || '').toLowerCase();
          const email = (u.email || '').toLowerCase();
          return (
            name.includes(keyword) ||
            email.includes(keyword)
          );
        });

    return [...filtered].sort((a, b) =>
      (a.display_name || a.email || '').localeCompare(
        b.display_name || b.email || '',
      ),
    );
  }, [users, assigneeInput]);

  // ====== โหลดค่าเมื่อเปิด modal ======
  useEffect(() => {
    if (!isOpen) return;

    if (task) {
      // ----- edit -----
      setName(task.name);
      setDescription(task.description ?? '');
      setStartDate(task.start_date);
      setEndDate(task.end_date);
      setStatus(task.status);
      setPriority(task.priority);
      setProgress(task.progress ?? 0);

      setAssignee(task.assignee);
      setAssigneeInput(task.assignee ?? '');
      setParentId(task.parent_id ?? null);
      setIsRecurring(task.is_recurring ?? false);
      setRecurringType(task.recurring_type ?? 'none');
      setRecurringInterval(task.recurring_interval ?? null);
      setRecurringUnit(task.recurring_unit ?? 'month');
      setDependencies(task.dependencies ?? '');
      setWorkType(
        (task.work_type as WorkType | null) ?? 'routine',
      );
    } else {
      // ----- create ใหม่ -----
      setName('');
      setDescription('');
      setStartDate(null);
      setEndDate(null);
      setStatus('To Do');
      setPriority('Medium');
      setProgress(0);
      setParentId(null);
      setIsRecurring(false);
      setRecurringType('none');
      setRecurringInterval(null);
      setRecurringUnit('month');
      setDependencies('');
      setWorkType('routine'); // default งานประจำ

      // assignee default = current user
      if (currentUser) {
        const label =
          currentUser.display_name || currentUser.email || '';
        setAssignee(label);
        setAssigneeInput(label);
      } else {
        setAssignee(null);
        setAssigneeInput('');
      }
    }

    setAssigneeDropdownOpen(false);
  }, [isOpen, task, currentUser]);

  if (!isOpen) return null;

  // ====== validate required fields & ส่งค่าออกไป ======
  const handleSubmit = () => {
    if (!canEdit) {
      onClose();
      return;
    }

    const missing: string[] = [];

    if (!name.trim()) missing.push('Task name');
    if (!startDate) missing.push('Start date');
    if (!endDate) missing.push('End date');

    // ตรวจว่า assignee เลือกจากรายชื่อจริง ๆ
    const assigneeValid =
      !!assignee &&
      users.some(
        (u) =>
          u.display_name === assignee ||
          u.email === assignee,
      );

    if (!assigneeValid) {
      missing.push(
        'Assignee (กรุณาเลือกจากรายชื่อในระบบ ไม่พิมพ์เอง)',
      );
    }

    if (!workType) {
      missing.push('ประเภทงาน');
    }

    if (missing.length > 0) {
      alert(
        'Please fill all required fields:\n- ' +
          missing.join('\n- '),
      );
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
      assignee, // string จากรายชื่อ
      parent_id: parentId,
      is_recurring: isRecurring,
      recurring_type: isRecurring ? recurringType : 'none',
      recurring_interval: isRecurring ? recurringInterval : null,
      recurring_unit: isRecurring ? recurringUnit : null,
      dependencies,
      work_type: workType || null,
    });
  };

  const handleDeleteClick = () => {
    if (!task || !task.id || !canEdit) return;
    if (!confirm('Delete this task?')) return;
    onDelete(task.id);
  };

  const handleAssigneeChange = (value: string) => {
    setAssigneeInput(value);
    setAssignee(value || null);
    setAssigneeDropdownOpen(true);
  };

  const handleAssigneeSelect = (u: Profile) => {
    const label = u.display_name || u.email || '';
    setAssignee(label);
    setAssigneeInput(label);
    setAssigneeDropdownOpen(false);
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="modal-header">
          <div>
            <div className="modal-title-main">
              {isEdit ? 'Edit task' : 'Create task'}
            </div>
            <div className="modal-title-sub">
              Keep details clear so your team can move fast.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* body */}
        <div className="modal-body">
          <div className="modal-form-grid-2">
            {/* Left column */}
            <div>
              <div className="field-label">
                Task name{' '}
                <span style={{ color: '#dc2626' }}>*</span>
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
                  onChange={(e) =>
                    setDescription(e.target.value)
                  }
                  placeholder="Add context, notes, links…"
                  disabled={disabled}
                />
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="field-label">Scheduling</div>
                <div className="field-label-small">
                  Start date{' '}
                  <span style={{ color: '#dc2626' }}>*</span>
                </div>
                <input
                  type="date"
                  className="input"
                  value={startDate ?? ''}
                  onChange={(e) =>
                    setStartDate(e.target.value || null)
                  }
                  disabled={disabled}
                />
                <div
                  className="field-label-small"
                  style={{ marginTop: 6 }}
                >
                  End date{' '}
                  <span style={{ color: '#dc2626' }}>*</span>
                </div>
                <input
                  type="date"
                  className="input"
                  value={endDate ?? ''}
                  onChange={(e) =>
                    setEndDate(e.target.value || null)
                  }
                  disabled={disabled}
                />
              </div>

              {/* Work type */}
              <div style={{ marginTop: 14 }}>
                <div className="field-label">
                  ประเภทงาน{' '}
                  <span style={{ color: '#dc2626' }}>*</span>
                </div>
                <select
                  className="select"
                  value={workType || 'routine'}
                  onChange={(e) =>
                    setWorkType(
                      (e.target.value ||
                        '') as WorkType | '',
                    )
                  }
                  disabled={disabled}
                >
                  {WORK_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Right column */}
            <div>
              <div className="field-label">
                Status &amp; priority
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="field-label-small">
                    Status{' '}
                    <span style={{ color: '#dc2626' }}>*</span>
                  </div>
                  <select
                    className="select"
                    value={status}
                    onChange={(e) =>
                      setStatus(
                        e.target.value as Task['status'],
                      )
                    }
                    disabled={disabled}
                  >
                    <option>To Do</option>
                    <option>In Progress</option>
                    <option>Blocked</option>
                    <option>Done</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="field-label-small">
                    Priority
                  </div>
                  <select
                    className="select"
                    value={priority}
                    onChange={(e) =>
                      setPriority(
                        e.target.value as Task['priority'],
                      )
                    }
                    disabled={disabled}
                  >
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                  </select>
                </div>
              </div>

              <div
                style={{ marginTop: 12 }}
                className="range-row"
              >
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
                  onChange={(e) =>
                    setProgress(Number(e.target.value))
                  }
                  disabled={disabled}
                />
              </div>

              {/* Assignee with custom autocomplete */}
              <div
                style={{ marginTop: 12, position: 'relative' }}
              >
                <div className="field-label">
                  Assignee{' '}
                  <span style={{ color: '#dc2626' }}>*</span>
                </div>
                <input
                  className="input"
                  value={assigneeInput}
                  onChange={(e) =>
                    handleAssigneeChange(e.target.value)
                  }
                  placeholder="Name or email (เลือกจากรายชื่อ)"
                  disabled={disabled}
                  onFocus={() =>
                    !disabled &&
                    setAssigneeDropdownOpen(true)
                  }
                  onBlur={() =>
                    setTimeout(
                      () =>
                        setAssigneeDropdownOpen(false),
                      150,
                    )
                  }
                />
                {assigneeDropdownOpen &&
                  !disabled &&
                  assigneeSuggestions.length > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 8,
                        marginTop: 4,
                        maxHeight: 180,
                        overflowY: 'auto',
                        zIndex: 30,
                        fontSize: 13,
                      }}
                    >
                      {assigneeSuggestions.map((u) => (
                        <div
                          key={u.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleAssigneeSelect(u);
                          }}
                          style={{
                            padding: '6px 10px',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                          }}
                        >
                          <span>
                            {u.display_name || u.email}
                          </span>
                          {u.display_name && u.email && (
                            <span
                              style={{
                                fontSize: 11,
                                color: '#94a3b8',
                              }}
                            >
                              {u.email}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="field-label">Parent task</div>
                <select
                  className="select"
                  value={parentId ?? ''}
                  onChange={(e) =>
                    setParentId(e.target.value || null)
                  }
                  disabled={disabled}
                >
                  <option value="">No parent</option>
                  {allTasks
                    .filter((t) => !task || t.id !== task.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>

              {/*<div style={{ marginTop: 12 }}>
                <div className="field-label">Recurring</div>
                <button
                  type="button"
                  className={
                    isRecurring
                      ? 'recurring-toggle recurring-on'
                      : 'recurring-toggle'
                  }
                  onClick={() =>
                    !disabled && setIsRecurring((v) => !v)
                  }
                >
                  <span>
                    {isRecurring ? 'Repeats' : 'Does not repeat'}
                  </span>
                  <span>
                    {isRecurring ? 'Disable' : 'Enable'}
                  </span>
                </button>

                {isRecurring && (
                  <div
                    style={{
                      marginTop: 8,
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <input
                      type="number"
                      className="input"
                      style={{ width: 70 }}
                      min={1}
                      value={recurringInterval ?? 1}
                      onChange={(e) =>
                        setRecurringInterval(
                          Number(e.target.value) || 1,
                        )
                      }
                      disabled={disabled}
                    />
                    <select
                      className="select"
                      value={recurringUnit ?? 'month'}
                      onChange={(e) =>
                        setRecurringUnit(
                          e.target
                            .value as Task['recurring_unit'],
                        )
                      }
                      disabled={disabled}
                    >
                      <option value="day">day(s)</option>
                      <option value="week">week(s)</option>
                      <option value="month">month(s)</option>
                      <option value="year">year(s)</option>
                    </select>
                  </div>
                )}
              </div>*/}

              <div style={{ marginTop: 12 }}>
                <div className="field-label">
                  Dependencies (comma separated IDs)
                </div>
                <input
                  className="input"
                  value={dependencies ?? ''}
                  onChange={(e) =>
                    setDependencies(e.target.value || null)
                  }
                  placeholder="task-id-1, task-id-2"
                  disabled={disabled}
                />
              </div>
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="modal-footer">
          <div>
            {isEdit && canEdit && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleDeleteClick}
              >
                Delete
              </button>
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
