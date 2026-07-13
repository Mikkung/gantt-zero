// components/GanttChart.tsx
'use client';

import 'frappe-gantt/dist/frappe-gantt.css';
import { useEffect, useMemo, useRef, useState } from 'react';
// @ts-ignore
import Gantt from 'frappe-gantt';
import { Task } from '../types';
import { supabase } from '../utils/supabase';

interface GanttProps {
  tasks: Task[];
  onTaskUpdate: () => void;
  onTaskClick: (task: Task) => void;
}

type ViewMode = 'Day' | 'Week' | 'Month';

// -------- helper: date utils --------
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatInputDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type DateSpan = { start: Date; end: Date } | null;

function makeSpan(
  start: string | null | undefined,
  end: string | null | undefined,
): DateSpan {
  const s = toDate(start) ?? toDate(end) ?? null;
  const e = toDate(end) ?? toDate(start) ?? null;

  if (!s && !e) return null;

  const startDate = s ?? e!;
  const endDate = e ?? s!;

  return startDate <= endDate
    ? { start: startDate, end: endDate }
    : { start: endDate, end: startDate };
}

function mergeSpans(spans: DateSpan[]): DateSpan {
  const valid = spans.filter(Boolean) as { start: Date; end: Date }[];
  if (!valid.length) return null;

  return {
    start: new Date(Math.min(...valid.map((s) => s.start.getTime()))),
    end: new Date(Math.max(...valid.map((s) => s.end.getTime()))),
  };
}

function clampSpan(
  span: DateSpan,
  from: Date | null,
  to: Date | null,
): DateSpan {
  if (!span) return null;

  let start = new Date(span.start);
  let end = new Date(span.end);

  if (from && start < from) start = new Date(from);
  if (to && end > to) end = new Date(to);

  if (end < start) end = new Date(start);

  return { start, end };
}

// check ว่างานตัดกับ range หรือไม่
function rangesIntersect(
  start: string | null | undefined,
  end: string | null | undefined,
  from: string | null,
  to: string | null,
): boolean {
  if (!from && !to) return true;

  const s = toDate(start) ?? toDate(end) ?? null;
  const e = toDate(end) ?? toDate(start) ?? null;
  if (!s && !e) return true;

  const rStart = s ?? e!;
  const rEnd = e ?? s!;

  const f = from ? toDate(from)! : null;
  const t = to ? toDate(to)! : null;

  if (f && rEnd < f) return false;
  if (t && rStart > t) return false;
  return true;
}

function getCalendarDurationDays(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const s = toDate(start) ?? toDate(end);
  const e = toDate(end) ?? toDate(start);

  if (!s || !e) return null;

  const startOnly = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const endOnly = new Date(e.getFullYear(), e.getMonth(), e.getDate());

  const diffMs = endOnly.getTime() - startOnly.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;

  return diffDays > 0 ? diffDays : 1;
}

function buildTaskDisplayLabel(task: Task): string {
  const count = (task as any).frequency_count;
  const unit = (task as any).frequency_unit;
  const minutes = (task as any).time_per_occurrence_minutes;

  if (
    typeof count === 'number' &&
    count > 0 &&
    typeof minutes === 'number' &&
    minutes > 0
  ) {
    const hours = (count * minutes) / 60;
    const unitText = unit === 'year' ? 'ปี' : 'เดือน';
    return `${task.name} (${hours.toFixed(1)} ชม./${unitText})`;
  }

  const days = getCalendarDurationDays(task.start_date, task.end_date);
  if (days) {
    return `${task.name} (${days} วัน)`;
  }

  return task.name;
}

// -------- Tree row model (user > category > task) --------

type TreeRowKind = 'user' | 'category' | 'task';

type TreeRow =
  | {
      kind: 'user';
      id: string;
      depth: number;
      label: string;
      userKey: string;
    }
  | {
      kind: 'category';
      id: string;
      depth: number;
      label: string;
      userKey: string;
      workType: string;
    }
  | {
      kind: 'task';
      id: string;
      depth: number;
      label: string;
      task: Task;
    };

const WORK_TYPES: { value: string; label: string }[] = [
  { value: 'routine', label: 'งานประจำ' },
  { value: 'strategic', label: 'งานยุทธศาสตร์' },
  { value: 'process_improvement', label: 'งานพัฒนากระบวนการ' },
  { value: 'self_development', label: 'งานพัฒนาตนเอง' },
  { value: 'other', label: 'งานอื่นๆ' },
];

function normalizeWorkType(raw: string | null | undefined): string {
  const v = raw || 'routine';
  if (WORK_TYPES.some((w) => w.value === v)) return v;
  return 'other';
}

export default function GanttChart({
  tasks,
  onTaskUpdate,
  onTaskClick,
}: GanttProps) {
  const ganttRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('Week');
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(
    () => new Set(),
  );

  // ใช้จำว่าเรา set default collapse ไปแล้วหรือยัง (กันทำซ้ำ)
  const initialCollapseAppliedRef = useRef(false);

  // filter ประเภทงาน (ค่าเริ่มต้น = แสดงทุกประเภท)
  const [workTypeFilter, setWorkTypeFilter] = useState<string[]>(() =>
    WORK_TYPES.map((w) => w.value),
  );

  const [viewFrom, setViewFrom] = useState<string | null>(null);
  const [viewTo, setViewTo] = useState<string | null>(null);

  useEffect(() => {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 60);

    const to = new Date(today);
    to.setDate(to.getDate() + 60);

    setViewFrom(formatInputDate(from));
    setViewTo(formatInputDate(to));
  }, []);

  // 1) filter งานตามช่วงวันที่
  //const dateFilteredTasks = useMemo(() => {
  //  return (tasks || []).filter((t) =>
  //    rangesIntersect(t.start_date, t.end_date, viewFrom, viewTo),
  //  );
  //}, [tasks, viewFrom, viewTo]);

  const dateFilteredTasks = useMemo(() => {
    return tasks || [];
  }, [tasks]);

  const taskById = useMemo(() => {
    const map: Record<string, Task> = {};
    for (const t of dateFilteredTasks) {
      if (t.id) map[t.id] = t;
    }
    return map;
  }, [dateFilteredTasks]);

  const taskHasChildren = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const t of dateFilteredTasks) {
      if (t.parent_id) {
        map[t.parent_id] = true;
      }
    }
    return map;
  }, [dateFilteredTasks]);

  const treeRows = useMemo<TreeRow[]>(() => {
    const rows: TreeRow[] = [];

    if (!dateFilteredTasks.length) return rows;

    const byUser: Record<
      string,
      {
        label: string;
        tasks: Task[];
      }
    > = {};

    for (const t of dateFilteredTasks) {
      const key = t.assignee || '__unassigned__';
      if (!byUser[key]) {
        byUser[key] = {
          label: key === '__unassigned__' ? 'Unassigned' : key,
          tasks: [],
        };
      }
      byUser[key].tasks.push(t);
    }

    const sortedUserKeys = Object.keys(byUser).sort((a, b) =>
      byUser[a].label.localeCompare(byUser[b].label),
    );

    for (const userKey of sortedUserKeys) {
      const userInfo = byUser[userKey];
      const userRowId = `user:${userKey}`;
      const userCollapsed = collapsedParents.has(userRowId);

      rows.push({
        kind: 'user',
        id: userRowId,
        depth: 0,
        label: userInfo.label,
        userKey,
      });

      if (userCollapsed) {
        continue;
      }

      for (const wt of WORK_TYPES) {
        if (!workTypeFilter.includes(wt.value)) continue;

        const catTasksAll = userInfo.tasks.filter((t) => {
          const norm = normalizeWorkType((t as any).work_type);
          return norm === wt.value;
        });

        const catRowId = `cat:${userKey}:${wt.value}`;
        const catCollapsed = collapsedParents.has(catRowId);

        if (catTasksAll.length > 0) {
          rows.push({
            kind: 'category',
            id: catRowId,
            depth: 1,
            label: wt.label,
            userKey,
            workType: wt.value,
          });
        }

        if (catTasksAll.length === 0 || catCollapsed) {
          continue;
        }

        const childrenByParent: Record<string, Task[]> = {};
        catTasksAll.forEach((t) => {
          const key = t.parent_id || 'root';
          if (!childrenByParent[key]) childrenByParent[key] = [];
          childrenByParent[key].push(t);
        });

        const walkTasks = (
          parentId: string | null,
          depth: number,
          parentHidden: boolean,
        ) => {
          const list = childrenByParent[parentId || 'root'] || [];

          list.sort((a, b) => {
            const aStart = toDate(a.start_date)?.getTime() ?? 0;
            const bStart = toDate(b.start_date)?.getTime() ?? 0;
            if (aStart !== bStart) return aStart - bStart;
            return a.name.localeCompare(b.name);
          });

          for (const t of list) {
            const rowId = t.id;
            const isCollapsed = collapsedParents.has(rowId);

            if (!parentHidden) {
              rows.push({
                kind: 'task',
                id: rowId,
                depth,
                label: t.name,
                task: t,
              });
            }

            const nextHidden = parentHidden || isCollapsed;
            walkTasks(t.id, depth + 1, nextHidden);
          }
        };

        walkTasks(null, 2, false);
      }
    }

    return rows;
  }, [dateFilteredTasks, collapsedParents, workTypeFilter]);

  // ---------- NEW: default collapse category rows on first load ----------
  useEffect(() => {
    if (initialCollapseAppliedRef.current) return;
    if (!treeRows.length) return;

    initialCollapseAppliedRef.current = true;

    setCollapsedParents((prev) => {
      const next = new Set(prev);
      for (const row of treeRows) {
        if (row.kind === 'category') {
          next.add(row.id); // collapse ทุก category ตอนเริ่มต้น
        }
      }
      return next;
    });
  }, [treeRows]);
  // -----------------------------------------------------------------------

  const rowSpanById = useMemo(() => {
    const rowSpans: Record<string, DateSpan> = {};

    const byId: Record<string, Task> = {};
    const childrenByParent: Record<string, Task[]> = {};

    for (const t of dateFilteredTasks) {
      byId[t.id] = t;
      const key = t.parent_id || 'root';
      if (!childrenByParent[key]) childrenByParent[key] = [];
      childrenByParent[key].push(t);
    }

    const taskSpanCache = new Map<string, DateSpan>();

    const getTaskSpan = (taskId: string): DateSpan => {
      if (taskSpanCache.has(taskId)) {
        return taskSpanCache.get(taskId)!;
      }

      const task = byId[taskId];
      if (!task) {
        taskSpanCache.set(taskId, null);
        return null;
      }

      const ownSpan = makeSpan(task.start_date, task.end_date);
      const childSpans = (childrenByParent[taskId] || []).map((child) =>
        getTaskSpan(child.id),
      );

      const merged = mergeSpans([ownSpan, ...childSpans]);
      taskSpanCache.set(taskId, merged);
      return merged;
    };

    for (const row of treeRows) {
      if (row.kind === 'task') {
        rowSpans[row.id] = getTaskSpan(row.id);
        continue;
      }

      if (row.kind === 'category') {
        const spans = dateFilteredTasks
          .filter(
            (t) =>
              (t.assignee || '__unassigned__') === row.userKey &&
              normalizeWorkType((t as any).work_type) === row.workType,
          )
          .map((t) => getTaskSpan(t.id));

        rowSpans[row.id] = mergeSpans(spans);
        continue;
      }

      if (row.kind === 'user') {
        const spans = dateFilteredTasks
          .filter(
            (t) =>
              (t.assignee || '__unassigned__') === row.userKey &&
              workTypeFilter.includes(
                normalizeWorkType((t as any).work_type),
              ),
          )
          .map((t) => getTaskSpan(t.id));

        rowSpans[row.id] = mergeSpans(spans);
      }
    }

    return rowSpans;
  }, [dateFilteredTasks, treeRows, workTypeFilter]);

  const toggleCollapse = (id: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 3) สร้าง / อัปเดต Gantt
  useEffect(() => {
    if (!ganttRef.current || treeRows.length === 0) {
      if (ganttRef.current) ganttRef.current.innerHTML = '';
      return;
    }

    ganttRef.current.innerHTML = '';

    const fromD = viewFrom ? toDate(viewFrom) : null;
    const toD = viewTo ? toDate(viewTo) : null;

    const ganttTasks = treeRows.map((row) => {
      const rowSpan = clampSpan(rowSpanById[row.id] ?? null, fromD, toD);

      if (row.kind === 'task') {
        const t = row.task;

        const fallbackSpan = makeSpan(t.start_date, t.end_date);
        const finalSpan = rowSpan ?? fallbackSpan;

        const startStr = finalSpan
          ? formatInputDate(finalSpan.start)
          : (t.start_date ?? viewFrom ?? formatInputDate(new Date()));

        const endStr = finalSpan
          ? formatInputDate(finalSpan.end)
          : (t.end_date ?? t.start_date ?? viewFrom ?? formatInputDate(new Date()));

        return {
          id: row.id,
          name: buildTaskDisplayLabel(t),
          start: startStr,
          end: endStr,
          progress: t.progress ?? 0,
          dependencies: t.dependencies || '',
          custom_class: `status-${(t.status || '')
            .toLowerCase()
            .replace(/\s/g, '')}`,
        };
      }

      const baseDate =
        viewFrom && toDate(viewFrom) ? toDate(viewFrom)! : new Date();

      const fallbackStart = formatInputDate(baseDate);
      const fallbackEndDate = new Date(baseDate);
      fallbackEndDate.setDate(fallbackEndDate.getDate() + 1);
      const fallbackEnd = formatInputDate(fallbackEndDate);

      const startStr = rowSpan
        ? formatInputDate(rowSpan.start)
        : fallbackStart;

      const endStr = rowSpan
        ? formatInputDate(rowSpan.end)
        : fallbackEnd;

      const customClass =
        row.kind === 'user'
          ? 'row-user-header'
          : 'row-category-header';

      return {
        id: row.id,
        name: row.label,
        start: startStr,
        end: endStr,
        progress: 0,
        dependencies: '',
        custom_class: customClass,
      };
    });

    const gantt = new Gantt(ganttRef.current, ganttTasks, {
      view_mode: viewMode,
      date_format: 'YYYY-MM-DD',
      bar_height: 24,
      padding: 18,
      arrow_curve: 5,
      custom_popup_html: (task: any) => {
        const original = taskById[task.id];

        if (!original) return '';

        const formatDate = (value: any) => {
          const d = value instanceof Date ? value : new Date(value);
          if (Number.isNaN(d.getTime())) return '';
          return d.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });
        };

        const startLabel = formatDate(task._start);
        const endLabel = formatDate(task._end);

        return `
          <div style="
            background:#fff;
            box-shadow:0 10px 30px rgba(15,23,42,0.25);
            border-radius:12px;
            border:1px solid #e2e8f0;
            padding:8px 10px;
            font-size:12px;
          ">
            <div style="font-weight:600;color:#0f172a;margin-bottom:2px">${task.name}</div>
            <div style="color:#64748b;margin-bottom:4px">
              ${startLabel} – ${endLabel}
            </div>
            <div style="display:flex;justify-content:space-between;color:#64748b;margin-bottom:2px">
              <span>Progress</span>
              <span style="font-weight:600;color:#0f172a">${task.progress || 0}%</span>
            </div>
            ${
              original.assignee
                ? `<div style="color:#64748b">
                     <span>Assignee: </span>
                     <span style="font-weight:500;color:#0f172a">${original.assignee}</span>
                   </div>`
                : ''
            }
          </div>
        `;
      },
      on_click: (task: any) => {
        const original = taskById[task.id];

        if (!original) {
          toggleCollapse(task.id);
          return;
        }

        onTaskClick(original);
      },
      on_date_change: async (task: any, start: Date, end: Date) => {
        const original = taskById[task.id];
        if (!original) return;

        const newStart = start.toISOString().split('T')[0];
        const newEnd = end.toISOString().split('T')[0];

        const { error } = await supabase
          .from('tasks')
          .update({ start_date: newStart, end_date: newEnd })
          .eq('id', task.id);

        if (error) console.error(error);
        onTaskUpdate();
      },
      on_progress_change: async (task: any, progress: number) => {
        const original = taskById[task.id];
        if (!original) return;

        const { error } = await supabase
          .from('tasks')
          .update({ progress })
          .eq('id', task.id);

        if (error) console.error(error);
        onTaskUpdate();
      },
    });

    try {
      const firstTaskRow = treeRows.find((r) => r.kind === 'task') as
        | Extract<TreeRow, { kind: 'task' }>
        | undefined;

      const target =
        (viewFrom && toDate(viewFrom)) ??
        (firstTaskRow?.task.start_date
          ? toDate(firstTaskRow.task.start_date)!
          : new Date());

      gantt.set_scroll_position(target);
    } catch {
      // ignore
    }

    try {
      const svgEl: SVGSVGElement | null = (gantt as any).$svg || null;
      const ganttStart: Date | undefined = (gantt as any).gantt_start;
      const ganttEnd: Date | undefined = (gantt as any).gantt_end;

      if (svgEl && ganttStart && ganttEnd) {
        svgEl
          .querySelectorAll('.today-highlight-line')
          .forEach((el) => el.parentNode?.removeChild(el));

        const gridBgRect = svgEl.querySelector(
          '.grid .grid-background',
        ) as SVGRectElement | null;

        if (!gridBgRect) return;

        const width = parseFloat(gridBgRect.getAttribute('width') || '0');
        const height = parseFloat(gridBgRect.getAttribute('height') || '0');

        const today = new Date();
        const todayMidnight = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        );

        const startMs = ganttStart.getTime();
        const endMs = ganttEnd.getTime();
        const todayMs = todayMidnight.getTime();

        if (todayMs >= startMs && todayMs <= endMs && width > 0) {
          const ratio = (todayMs - startMs) / (endMs - startMs || 1);
          const x = ratio * width;

          const line = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'line',
          );
          line.setAttribute('class', 'today-highlight-line');
          line.setAttribute('x1', String(x));
          line.setAttribute('x2', String(x));
          line.setAttribute('y1', '0');
          line.setAttribute('y2', String(height || 9999));
          line.setAttribute('stroke', '#ef4444');
          line.setAttribute('stroke-width', '2');
          line.setAttribute('stroke-dasharray', '4 2');

          const gridGroup =
            svgEl.querySelector('.grid') || svgEl.firstChild;
          gridGroup?.appendChild(line);
        }
      }
    } catch (e) {
      console.error('Failed to draw today line', e);
    }
  }, [
    treeRows,
    viewMode,
    onTaskClick,
    onTaskUpdate,
    viewFrom,
    viewTo,
    taskById,
    rowSpanById,
  ]);

  useEffect(() => {
    const treeEl = treeRef.current;
    const bodyEl = bodyScrollRef.current;
    if (!treeEl || !bodyEl) return;

    const syncFromBody = () => {
      if (treeEl.scrollTop !== bodyEl.scrollTop) {
        treeEl.scrollTop = bodyEl.scrollTop;
      }
    };

    const onWheelTree = (e: WheelEvent) => {
      if (bodyEl) {
        bodyEl.scrollTop += e.deltaY;
        e.preventDefault();
      }
    };

    bodyEl.addEventListener('scroll', syncFromBody);
    treeEl.addEventListener('wheel', onWheelTree, { passive: false });

    return () => {
      bodyEl.removeEventListener('scroll', syncFromBody);
      treeEl.removeEventListener('wheel', onWheelTree);
    };
  }, [treeRows.length]);

  const hasAnyTaskRow = treeRows.some((r) => r.kind === 'task');

  const handleTodayRange = () => {
    const t = new Date();
    const from = new Date(t);
    from.setDate(from.getDate() - 7);
    const to = new Date(t);
    to.setDate(to.getDate() + 90);

    setViewFrom(formatInputDate(from));
    setViewTo(formatInputDate(to));
  };

  const handleToggleWorkType = (value: string, checked: boolean) => {
    setWorkTypeFilter((prev) => {
      if (checked) {
        if (prev.includes(value)) return prev;
        return [...prev, value];
      }
      return prev.filter((v) => v !== value);
    });
  };

  return (
    <div className="gantt-wrapper">
      <div className="gantt-header">
        <div>
          <div className="gantt-title-main">Project timeline</div>
          <div className="gantt-title-sub">
            Drag bars to adjust dates, click a task to edit details.
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div className="gantt-legend">
            <div className="gantt-legend-item">
              <span
                className="gantt-legend-color"
                style={{ backgroundColor: '#e5e7eb' }}
              />
              <span>To Do</span>
            </div>
            <div className="gantt-legend-item">
              <span
                className="gantt-legend-color"
                style={{ backgroundColor: '#f7d448' }}
              />
              <span>In Progress</span>
            </div>
            <div className="gantt-legend-item">
              <span
                className="gantt-legend-color"
                style={{ backgroundColor: '#5ada9e' }}
              />
              <span>Done</span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              marginTop: 6,
              alignItems: 'flex-end',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'flex-end',
              }}
            >
              <div style={{ fontSize: 11, color: '#64748b' }}>
                View range{' '}
                <input
                  type="date"
                  value={viewFrom ?? ''}
                  onChange={(e) => setViewFrom(e.target.value || null)}
                  style={{
                    fontSize: 11,
                    padding: '2px 4px',
                    borderRadius: 6,
                    border: '1px solid #cbd5f5',
                    marginLeft: 4,
                  }}
                />{' '}
                to{' '}
                <input
                  type="date"
                  value={viewTo ?? ''}
                  onChange={(e) => setViewTo(e.target.value || null)}
                  style={{
                    fontSize: 11,
                    padding: '2px 4px',
                    borderRadius: 6,
                    border: '1px solid #cbd5f5',
                    marginLeft: 4,
                  }}
                />
                <button
                  type="button"
                  onClick={handleTodayRange}
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 999,
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  Today + range
                </button>
              </div>

              <div className="gantt-view-switch">
                {(['Day', 'Week', 'Month'] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={mode === viewMode ? 'is-active' : ''}
                    onClick={() => setViewMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                fontSize: 11,
                color: '#64748b',
                justifyContent: 'flex-end',
              }}
            >
              {WORK_TYPES.map((wt) => {
                const active = workTypeFilter.includes(wt.value);
                return (
                  <label
                    key={wt.value}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                      padding: '2px 6px',
                      borderRadius: 999,
                      border: '1px solid #e2e8f0',
                      background: active ? '#fee2e2' : '#ffffff',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) =>
                        handleToggleWorkType(wt.value, e.target.checked)
                      }
                      style={{ margin: 0 }}
                    />
                    <span>{wt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="gantt-layout">
        <div className="gantt-tree" ref={treeRef}>
          {treeRows.length ? (
            treeRows.map((row) => {
              const isCollapsed = collapsedParents.has(row.id);

              let hasChildren = false;
              if (row.kind === 'user' || row.kind === 'category') {
                hasChildren = true;
              } else if (row.kind === 'task') {
                hasChildren = !!taskHasChildren[row.id];
              }

              const onRowClick = () => {
                if (row.kind === 'task') {
                  onTaskClick(row.task);
                } else {
                  toggleCollapse(row.id);
                }
              };

              return (
                <div key={row.id}>
                  <div
                    className="gantt-tree-row"
                    style={{ paddingLeft: row.depth * 16 }}
                    onClick={onRowClick}
                  >
                    {hasChildren ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCollapse(row.id);
                        }}
                      >
                        {isCollapsed ? '▶' : '▼'}
                      </span>
                    ) : (
                      <span style={{ width: 12 }} />
                    )}
                    <span>{row.label}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ fontSize: 13, color: '#64748b' }}>
              No tasks yet. Create one to see hierarchy.
            </div>
          )}
        </div>

        <div className="gantt-body" ref={bodyScrollRef}>
          <div ref={ganttRef} />
          {!hasAnyTaskRow && (
            <div className="gantt-empty">
              <div>No tasks scheduled yet</div>
              <div className="gantt-empty-sub">
                Create a task with start and end dates to see it on the
                timeline.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

