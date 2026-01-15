// components/TaskModal.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Task, Profile } from '../types';

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

  // ทำเป็น optional แล้วให้ default เป็น [] ในตัว component
  users?: Profile[];
  currentUser?: Profile | null;
  canEdit?: boolean; // ถ้า false = view only
  onClose: () => void;
  onSave: (partial: Partial<Task>) => void;
  onDelete: (id: string) => void;

  // 👇 ใหม่: ฟังก์ชันสำหรับ duplicate task
  onDuplicate?: (task: Task) => void;
}

export default function TaskModal({
  isOpen,
  task,
  allTasks,
  users = [],
  currentUser,
  canEdit = true,
  onClose,
  onSave,
  onDelete,
  onDuplicate,
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

  // ประเภทงาน
  const [workType, setWorkType] = useState<WorkType | ''>('');

  // suggestions ของ assignee (จาก profiles)
  const assigneeSuggestions = useMemo(() => {
    const list = users || [];
    const names = new Set<string>();

    list.forEach((u) => {
      if (u.display_name) names.add(u.display_name);
      // ถ้าอยากใช้ email ด้วยก็ใส่เพิ่มได้
      // if (u.email) names.add(u.email);
    });

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [users]);

  // helper: สร้าง string วันที่แบบ yyyy-mm-dd ด้วย local time (กัน timezone เพี้ยน)
  const getTodayString = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // เมื่อเปิด modal โหลดค่าจาก task เดิม หรือเตรียมค่าตั้งต้นตอนสร้างใหม่
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
      setAssignee(task.assignee);
      setParentId(task.parent_id ?? null);
      setIsRecurring(task.is_recurring ?? false);
      setRecurringType(task.recurring_type ?? 'none');
      setRecurringInterval(task.recurring_interval ?? null);
      setRecurringUnit(task.recurring_unit ?? 'month');
      setDependencies(task.dependencies ?? '');
      setWorkType((task.work_type as WorkType | null) ?? '');
    } else {
      // ----- Create mode: reset + default -----
      setName('');
      setDescription('');

      // ✅ Start date default = วันนี้
      const today = getTodayString();
      setStartDate(today);

      setEndDate(null);
      setStatus('To Do');
      setPriority('Medium');
      setProgress(0);

      // ✅ Assignee default = current login account
      setAssignee(currentUser?.display_name ?? null);

      setParentId(null);
      setIsRecurring(false);
      setRecurringType('none');
      setRecurringInterval(null);
      setRecurringUnit('month');
      setDependencies('');
      setWorkType('');
    }
  }, [isOpen, task, currentUser]);

  if (!isOpen) return null;

  // ===== Logic: ผูก Progress ↔ Status =====

  const handleProgressChange = (value: number) => {
    setProgress(value);

    setStatus((prev) => {
      // ถ้า status = Blocked หรือ Need Help → ให้ user control เอง ไม่ auto เปลี่ยน
      if (prev === 'Blocked' || prev === 'In problem Need Help') {
        return prev;
      }

      if (value === 0) {
        return 'To Do';
      }
      if (value === 100) {
        return 'Done';
      }
      // 0 < progress < 100
      return 'In Progress';
    });
  };

  const handleStatusChange = (newStatus: Task['status']) => {
    setStatus(newStatus);

    setProgress((prev) => {
      if (newStatus === 'Done') {
        // ✅ ถ้าเลือก Done → progress = 100
        return 100;
      }
      if (newStatus === 'To Do') {
        // ✅ ถ้าเลือก To Do → progress = 0
        return 0;
      }
      // In Progress / Blocked / In problem Need Help ไม่บังคับ progress
      return prev;
    });
  };

  const handleSubmit = () => {
    if (!canEdit) {
      onClose();
      return;
    }

    // ===== Required fields validation =====
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

    onSave({
      id: task?.id,
      name: name.trim(),
      description: description || '',
      start_date: startDate,
      end_date: endDate,
      status,
      priority,
      progress,
      assignee,
      parent_id: parentId,
      is_recurring: isRecurring,
      recurring_type: isRecurring ? recurringType : 'none',
      recurring_interval: isRecurring ? recurringInterval : null,
      recurring_unit: isRecurring ? recurringUnit : null,
      dependencies,
      work_type: workType || null, // 👈 บันทึกประเภทงาน
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

  const RequiredMark = () => (
    <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>
  );

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
                  onChange={(e) =>
                    setStartDate(e.target.value || null)
                  }
                  disabled={disabled}
                />
                <div
                  className="field-label-small"
                  style={{ marginTop: 6 }}
                >
                  End date
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
                  ประเภทงาน
                  <RequiredMark />
                </div>
                <select
                  className="select"
                  value={workType || ''}
                  onChange={(e) =>
                    setWorkType(
                      (e.target.value || '') as WorkType | '',
                    )
                  }
                  disabled={disabled}
                >
                  <option value="">(ไม่ระบุ)</option>
                  {WORK_TYPE_OPTIONS.map((opt) => (
                    <option
                      key={opt.value}
                      value={opt.value}
                    >
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
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div className="field-label-small">
                    Status
                  </div>
                  <select
                    className="select"
                    value={status}
                    onChange={(e) =>
                      handleStatusChange(
                        e.target.value as Task['status'],
                      )
                    }
                    disabled={disabled}
                  >
                    <option value="To Do">To Do</option>
                    <option value="In Progress">
                      In Progress
                    </option>
                    <option value="Blocked">Blocked</option>
                    <option value="In problem Need Help">
                      In problem – Need Help
                    </option>
                    <option value="Done">Done</option>
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
                    handleProgressChange(
                      Number(e.target.value),
                    )
                  }
                  disabled={disabled}
                />
              </div>

              {/* Assignee with autocomplete */}
              <div style={{ marginTop: 12 }}>
                <div className="field-label">
                  Assignee
                  <RequiredMark />
                </div>
                <input
                  className="input"
                  list="assignee-options"
                  value={assignee ?? ''}
                  onChange={(e) =>
                    setAssignee(e.target.value || null)
                  }
                  placeholder="Name or email"
                  disabled={disabled}
                />
                <datalist id="assignee-options">
                  {assigneeSuggestions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
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
                    // 👇 ถ้ามี currentUser: แสดงเฉพาะที่ assignee ตรงกัน
                    .filter((t) => {
                      if (!currentUser?.display_name) return true;
                      return t.assignee === currentUser.display_name;
                    })
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="field-label">
                  Dependencies (comma separated IDs)
                </div>
                <input
                  className="input"
                  value={dependencies ?? ''}
                  onChange={(e) =>
                    setDependencies(
                      e.target.value || null,
                    )
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
          <div style={{ display: 'flex', gap: 8 }}>
            {isEdit && canEdit && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleDeleteClick}
                >
                  Delete
                </button>

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
                You have view-only access with your
                current role.
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
