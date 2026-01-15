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

// -------- Tree row model (user > category > task) --------

type TreeRowKind = 'user' | 'category' | 'task';

type TreeRow =
  | {
      kind: 'user';
      id: string; // e.g. "user:abcd"
      depth: number;
      label: string;
      userKey: string; // assignee key
    }
  | {
      kind: 'category';
      id: string; // e.g. "cat:userKey:routine"
      depth: number;
      label: string;
      userKey: string;
      workType: string;
    }
  | {
      kind: 'task';
      id: string; // task.id
      depth: number;
      label: string;
      task: Task;
    };

// mapping ประเภทงาน (work_type) → label ภาษาไทย
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

  // ช่วงวันที่ให้ user เลือก
  const [viewFrom, setViewFrom] = useState<string | null>(null);
  const [viewTo, setViewTo] = useState<string | null>(null);

  // default: 7 วันก่อนวันนี้ → 90 วันหลังจากวันนี้
  useEffect(() => {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 7);

    const to = new Date(today);
    to.setDate(to.getDate() + 90);

    setViewFrom(formatInputDate(from));
    setViewTo(formatInputDate(to));
  }, []);

  // 1) filter งานตามช่วงวันที่
  const dateFilteredTasks = useMemo(() => {
    return (tasks || []).filter((t) =>
      rangesIntersect(t.start_date, t.end_date, viewFrom, viewTo),
    );
  }, [tasks, viewFrom, viewTo]);

  // map สำหรับหา Task จาก id ได้เร็ว ๆ (ใช้ใน popup / update)
  const taskById = useMemo(() => {
    const map: Record<string, Task> = {};
    for (const t of dateFilteredTasks) {
      if (t.id) map[t.id] = t;
    }
    return map;
  }, [dateFilteredTasks]);

  // ใช้บอกว่า task ไหนมีลูก (subtask) เอาไปแสดง caret ใน tree
  const taskHasChildren = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const t of dateFilteredTasks) {
      if (t.parent_id) {
        map[t.parent_id] = true;
      }
    }
    return map;
  }, [dateFilteredTasks]);

  /**
   * 2) เตรียม treeRows = [ user > category > task/subtask ... ]
   *    เพื่อให้ทั้ง tree ซ้าย และ Gantt ขวา ใช้ลำดับ row เดียวกัน
   */
  const treeRows = useMemo<TreeRow[]>(() => {
    const rows: TreeRow[] = [];

    if (!dateFilteredTasks.length) return rows;

    // group tasks ตาม assignee (user)
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

      // User row (depth 0)
      rows.push({
        kind: 'user',
        id: userRowId,
        depth: 0,
        label: userInfo.label,
        userKey,
      });

      // ถ้า user ถูก collapse → ไม่สร้าง category / task ใต้ user นี้เลย
      if (userCollapsed) {
        continue;
      }

      // แยก task ตาม work_type ภายใน user นี้
      for (const wt of WORK_TYPES) {
        // ถ้า filter ประเภทงานไม่เลือก type นี้ → ข้าม
        if (!workTypeFilter.includes(wt.value)) continue;

        const catTasksAll = userInfo.tasks.filter((t) => {
          const norm = normalizeWorkType((t as any).work_type);
          return norm === wt.value;
        });

        const catRowId = `cat:${userKey}:${wt.value}`;
        const catCollapsed = collapsedParents.has(catRowId);

        // สร้าง category row เสมอถ้ามี task อย่างน้อย 1 ใน type นี้
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

        // ภายใน category นี้ สร้าง tree parent_id → children
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

        // เริ่มจาก root parent (depth = 2 เพราะ 0=user, 1=category)
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

  // 3) สร้าง / อัปเดต Gantt
  useEffect(() => {
    if (!ganttRef.current || treeRows.length === 0) {
      if (ganttRef.current) ganttRef.current.innerHTML = '';
      return;
    }

    ganttRef.current.innerHTML = '';

    const fromD = viewFrom ? toDate(viewFrom) : null;
    const toD = viewTo ? toDate(viewTo) : null;

    // สร้าง task list ให้ Gantt โดยให้มี 1 row ต่อ 1 treeRow เสมอ
    const ganttTasks = treeRows.map((row) => {
      if (row.kind === 'task') {
        const t = row.task;
        const origStart = toDate(t.start_date);
        const origEnd = toDate(t.end_date);

        let displayStart = origStart;
        let displayEnd = origEnd;

        // clamp ให้ไม่ออกนอก view range
        if (fromD && displayStart && displayStart < fromD) {
          displayStart = fromD;
        }
        if (toD && displayEnd && displayEnd > toD) {
          displayEnd = toD;
        }

        const startStr =
          displayStart != null
            ? formatInputDate(displayStart)
            : t.start_date;
        const endStr =
          displayEnd != null ? formatInputDate(displayEnd) : t.end_date;

        return {
          id: row.id,
          name: row.label,
          start: startStr,
          end: endStr,
          progress: t.progress ?? 0,
          dependencies: t.dependencies || '',
          custom_class: `status-${(t.status || '')
            .toLowerCase()
            .replace(/\s/g, '')}`,
        };
      }

      // กรณี user / category → ใช้ "fake task" เพื่อเก็บ row height ให้ align กับ tree
      const baseDate =
        viewFrom && toDate(viewFrom) ? toDate(viewFrom)! : new Date();
      const startStr = formatInputDate(baseDate);

      // ให้ end = start + 1 day กัน error duration 0
      const endDate = new Date(baseDate);
      endDate.setDate(endDate.getDate() + 1);
      const endStr = formatInputDate(endDate);

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

        // ถ้าเป็น row header (user / category) ไม่ต้องขึ้น popup
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

        // header row → toggle collapse
        if (!original) {
          toggleCollapse(task.id);
          return;
        }

        // task row → เปิด modal
        onTaskClick(original);
      },
      on_date_change: async (task: any, start: Date, end: Date) => {
        const original = taskById[task.id];
        if (!original) return; // header row ไม่ต้อง update DB

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
        if (!original) return; // header row

        const { error } = await supabase
          .from('tasks')
          .update({ progress })
          .eq('id', task.id);

        if (error) console.error(error);
        onTaskUpdate();
      },
    });

    // scroll ให้ไปใกล้ viewFrom (หรือใช้ start งานอันแรก ถ้าไม่มี)
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

    // ====== วาดเส้น Today ลงใน SVG ของ Gantt ======
    try {
      const svgEl: SVGSVGElement | null = (gantt as any).$svg || null;
      const ganttStart: Date | undefined = (gantt as any).gantt_start;
      const ganttEnd: Date | undefined = (gantt as any).gantt_end;

      if (svgEl && ganttStart && ganttEnd) {
        // ลบเส้นเก่าก่อน (กันซ้อน)
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

        // วาดเฉพาะถ้าวันนี้อยู่ในช่วงของ Gantt
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
  }, [treeRows, viewMode, onTaskClick, onTaskUpdate, viewFrom, viewTo, taskById]);

  // 4) sync scroll: ให้ scrollDown Gantt แล้ว Tree เลื่อนตาม
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

  // toggle tree collapse (ใช้ได้กับทั้ง user, category, task parent)
  const toggleCollapse = (id: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      const next = prev.filter((v) => v !== value);
      return next;
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
          {/* legend */}
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

          {/* view mode + date range + work type filter */}
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

            {/* work type filter */}
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
        {/* Tree */}
        <div className="gantt-tree" ref={treeRef}>
          {treeRows.length ? (
            treeRows.map((row) => {
              const isCollapsed = collapsedParents.has(row.id);

              // มีลูกไหม? (user/category ให้ถือว่ามีลูกเสมอ, task ดูจาก map จริง)
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

        {/* Chart */}
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
