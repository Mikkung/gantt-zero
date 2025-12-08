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

  /**
   * เตรียมข้อมูล tree + ลำดับ row กลาง (visibleTasks)
   * - childrenByParent: mapping parent_id → children
   * - visibleTasks: array ตามลำดับที่ต้องการให้แสดง (ทั้ง tree และ Gantt)
   * - depthById: ใช้กำหนด indent ของแต่ละ row ทางฝั่ง tree
   */
  const {
    childrenByParent,
    visibleTasks,
    depthById,
  } = useMemo(() => {
    const all = tasks || [];

    // 1) group ตาม parent
    const childrenByParent: Record<string, Task[]> = {};
    all.forEach((t) => {
      const key = t.parent_id || 'root';
      if (!childrenByParent[key]) childrenByParent[key] = [];
      childrenByParent[key].push(t);
    });

    // 2) flatten tree เป็นลิสต์เดียว พร้อม depth และเคารพ collapsedParents
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

        // parentHidden = true => แถวนี้ก็ไม่ต้องแสดง (เพราะ parent ถูกพับ)
        if (!parentHidden) {
          flat.push(t);
          depthById[t.id] = depth;
        }

        // ถ้า parent ถูกพับ หรือ parentHidden อยู่แล้ว → children ไม่ต้องแสดง
        const nextHidden = parentHidden || isCollapsed;
        walk(t.id, depth + 1, nextHidden);
      }
    };

    walk(null, 0, false);

    return { childrenByParent, visibleTasks: flat, depthById };
  }, [tasks, collapsedParents]);

  // ====== สร้าง / อัปเดต Gantt ======
  useEffect(() => {
    if (!ganttRef.current || visibleTasks.length === 0) {
      if (ganttRef.current) ganttRef.current.innerHTML = '';
      return;
    }

    ganttRef.current.innerHTML = '';

    const ganttTasks = visibleTasks.map((t) => ({
      id: t.id,
      name: t.name,
      start: t.start_date,
      end: t.end_date,
      progress: t.progress ?? 0,
      dependencies: t.dependencies || '',
      custom_class: `status-${(t.status || '')
        .toLowerCase()
        .replace(/\s/g, '')}`,
    }));

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

    try {
      gantt.set_scroll_position(new Date());
    } catch {
      // ignore
    }
  }, [visibleTasks, viewMode, onTaskClick, onTaskUpdate]);

  const toggleCollapse = (id: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasTasks = visibleTasks.length > 0;

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
