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

export default function GanttChart({
  tasks,
  onTaskUpdate,
  onTaskClick,
}: GanttProps) {
  const ganttRef = useRef<HTMLDivElement | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('Week');
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(
    () => new Set(),
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

  /**
   * 2) เตรียม tree + ลำดับ row สำหรับทั้ง tree & Gantt
   */
  const {
    childrenByParent,
    visibleTasks,
    depthById,
  } = useMemo(() => {
    const all = dateFilteredTasks || [];

    const childrenByParent: Record<string, Task[]> = {};
    all.forEach((t) => {
      const key = t.parent_id || 'root';
      if (!childrenByParent[key]) childrenByParent[key] = [];
      childrenByParent[key].push(t);
    });

    const flat: Task[] = [];
    const depthById: Record<string, number> = {};

    const walk = (
      parentId: string | null,
      depth: number,
      parentHidden: boolean,
    ) => {
      const list = childrenByParent[parentId || 'root'] || [];
      for (const t of list) {
        const isCollapsed = collapsedParents.has(t.id);
        if (!parentHidden) {
          flat.push(t);
          depthById[t.id] = depth;
        }
        const nextHidden = parentHidden || isCollapsed;
        walk(t.id, depth + 1, nextHidden);
      }
    };

    walk(null, 0, false);

    return { childrenByParent, visibleTasks: flat, depthById };
  }, [dateFilteredTasks, collapsedParents]);

  // 3) สร้าง / อัปเดต Gantt
  useEffect(() => {
    if (!ganttRef.current || visibleTasks.length === 0) {
      if (ganttRef.current) ganttRef.current.innerHTML = '';
      return;
    }

    ganttRef.current.innerHTML = '';

    const fromD = viewFrom ? toDate(viewFrom) : null;
    const toD = viewTo ? toDate(viewTo) : null;

    const ganttTasks = visibleTasks.map((t) => {
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
        id: t.id,
        name: t.name,
        start: startStr,
        end: endStr,
        progress: t.progress ?? 0,
        dependencies: t.dependencies || '',
        custom_class: `status-${(t.status || '')
          .toLowerCase()
          .replace(/\s/g, '')}`,
      };
    });

    const gantt = new Gantt(ganttRef.current, ganttTasks, {
      view_mode: viewMode,
      date_format: 'YYYY-MM-DD',
      bar_height: 24,
      padding: 18,
      arrow_curve: 5,
      custom_popup_html: (task: any) => {
        const original = visibleTasks.find((t) => t.id === task.id);

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
              original?.assignee
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
        const full = visibleTasks.find((t) => t.id === task.id);
        if (full) onTaskClick(full);
      },
      on_date_change: async (task: any, start: Date, end: Date) => {
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
      const target =
        (viewFrom && toDate(viewFrom)) ??
        (visibleTasks[0]?.start_date
          ? toDate(visibleTasks[0].start_date)!
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
  }, [visibleTasks, viewMode, onTaskClick, onTaskUpdate, viewFrom, viewTo]);

  // toggle tree
  const toggleCollapse = (id: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasTasks = visibleTasks.length > 0;

  const handleTodayRange = () => {
    const t = new Date();
    const from = new Date(t);
    from.setDate(from.getDate() - 7);
    const to = new Date(t);
    to.setDate(to.getDate() + 90);

    setViewFrom(formatInputDate(from));
    setViewTo(formatInputDate(to));
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
                style={{ backgroundColor: '#fb923c' }}
              />
              <span>In Progress</span>
            </div>
            <div className="gantt-legend-item">
              <span
                className="gantt-legend-color"
                style={{ backgroundColor: '#22c55e' }}
              />
              <span>Done</span>
            </div>
          </div>

          {/* view mode + date range */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 6,
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
        </div>
      </div>

      <div className="gantt-layout">
        {/* Tree */}
        <div className="gantt-tree">
          {hasTasks ? (
            visibleTasks.map((t) => {
              const depth = depthById[t.id] ?? 0;
              const hasChildren =
                (childrenByParent[t.id] || []).length > 0;
              const isCollapsed = collapsedParents.has(t.id);

              return (
                <div key={t.id}>
                  <div
                    className="gantt-tree-row"
                    style={{ paddingLeft: depth * 16 }}
                    onClick={() => onTaskClick(t)}
                  >
                    {hasChildren ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCollapse(t.id);
                        }}
                      >
                        {isCollapsed ? '▶' : '▼'}
                      </span>
                    ) : (
                      <span style={{ width: 12 }} />
                    )}
                    <span>{t.name}</span>
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
        <div className="gantt-body">
          <div ref={ganttRef} />
          {!hasTasks && (
            <div className="gantt-empty">
              <div>No tasks scheduled yet</div>
              <div className="gantt-empty-sub">
                Create a task with start and end dates to see it on
                the timeline.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
