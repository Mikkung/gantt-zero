// app/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../components/AppShell';
import GanttChart from '../components/GanttChart';
import TaskModal from '../components/TaskModal';
import { supabase } from '../utils/supabase';
import type { Task, Team, Profile, Role } from '../types';

type ViewType = 'gantt' | 'list' | 'board' | 'calendar';

function roleCanSeeAll(role: Role | undefined | null) {
  return role === 'admin' || role === 'manager';
}

export default function HomePage() {
  const router = useRouter();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [view, setView] = useState<ViewType>('gantt');

  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);

  const [filterTeamId, setFilterTeamId] = useState<string | null>(null);
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);
  const [filterDateRange, setFilterDateRange] = useState<
    'all' | 'thisWeek' | 'overdue'
  >('all');

  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // ========= โหลด tasks =========
  const loadTasks = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('start_date', { ascending: true });

      if (error) {
        console.error('loadTasks error:', {
          message: error.message,
          details: (error as any).details,
          hint: (error as any).hint,
        });
      } else if (data) {
        setTasks(data as Task[]);
      }
    } catch (err) {
      console.error('loadTasks unexpected error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ========= Initial load: auth session + profile + teams + users + tasks =========
  useEffect(() => {
    const init = async () => {
      try {
        // 1) อ่าน session ปัจจุบัน (ไม่ error ถ้าไม่มี session)
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('auth getSession error:', sessionError);
          setInitError('Cannot read auth session.');
          setLoading(false);
          return;
        }

        const user = session?.user;

        if (!user) {
          // ยังไม่ login → ส่งไปหน้า /login
          router.push('/login');
          return;
        }

        // 2) profile: ใช้ email เป็น key หลัก
        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', user.email ?? '')
          .limit(1);

        if (profileError) {
          console.error('profiles select error:', {
            message: profileError.message,
            details: (profileError as any).details,
            hint: (profileError as any).hint,
          });
          setInitError(
            'Cannot read your profile (database error). Please contact the administrator.',
          );
          setLoading(false);
          return;
        }

        const profile = profileRows && profileRows[0];

        if (!profile) {
          setInitError(
            'Your account is not registered in the system. Please contact the administrator.',
          );
          setLoading(false);
          return;
        }

        setCurrentProfile(profile as Profile);

        // 3) teams
        try {
          const { data: teamRows, error: teamError } = await supabase
            .from('teams')
            .select('*')
            .order('name', { ascending: true });

          if (teamError) {
            console.error('teams error:', {
              message: teamError.message,
              details: (teamError as any).details,
              hint: (teamError as any).hint,
            });
          } else if (teamRows) {
            setTeams(teamRows as Team[]);
          }
        } catch (errTeams) {
          console.error('teams unexpected error:', errTeams);
        }

        // 4) users list (profiles)
        try {
          const { data: userRows, error: usersError } = await supabase
            .from('profiles')
            .select('*')
            .order('display_name', { ascending: true });

          if (usersError) {
            console.error('users (profiles) error:', {
              message: usersError.message,
              details: (usersError as any).details,
              hint: (usersError as any).hint,
            });
          } else if (userRows) {
            setUsers(userRows as Profile[]);
          }
        } catch (errUsers) {
          console.error('users unexpected error:', errUsers);
        }

        // 5) tasks
        await loadTasks();
      } catch (err) {
        console.error('init unexpected error:', err);
        setInitError('Unexpected error while loading workspace.');
        setLoading(false);
      }
    };

    init();
  }, [router]);

  // ========= ถ้า init ผิดพลาด =========
  if (initError) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f1f5f9',
          color: '#0f172a',
          fontSize: 14,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            background: '#ffffff',
            padding: 20,
            borderRadius: 16,
            boxShadow: '0 10px 30px rgba(15,23,42,0.18)',
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>
            Cannot load workspace
          </h2>
          <p style={{ margin: 0 }}>{initError}</p>
        </div>
      </div>
    );
  }

  // ========= สิทธิ์ของ role =========
  const canEditTasks =
    !!currentProfile && currentProfile.role !== 'manager';

  // ========= filters =========
  const roleFilteredTasks = useMemo(() => {
    if (!currentProfile || roleCanSeeAll(currentProfile.role)) return tasks;
    if (!currentProfile.team_id) return tasks;
    return tasks.filter((t) => t.team_id === currentProfile.team_id);
  }, [tasks, currentProfile]);

  const timeFilteredTasks = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    return roleFilteredTasks.filter((t) => {
      const end = t.end_date ? new Date(t.end_date) : null;
      const start = t.start_date ? new Date(t.start_date) : null;

      if (filterDateRange === 'thisWeek') {
        if (!start && !end) return false;
        const d = end || start!;
        return d >= weekStart && d < weekEnd;
      }
      if (filterDateRange === 'overdue') {
        if (!end) return false;
        return end < now && t.status !== 'Done';
      }
      return true;
    });
  }, [roleFilteredTasks, filterDateRange]);

  const fullyFilteredTasks = useMemo(() => {
    return timeFilteredTasks.filter((t) => {
      if (filterTeamId && t.team_id !== filterTeamId) return false;
      if (filterAssignee && t.assignee !== filterAssignee) return false;
      return true;
    });
  }, [timeFilteredTasks, filterTeamId, filterAssignee]);

  const summary = useMemo(() => {
    const total = fullyFilteredTasks.length;
    const inProgress = fullyFilteredTasks.filter(
      (t) => t.status === 'In Progress',
    ).length;
    const done = fullyFilteredTasks.filter((t) => t.status === 'Done').length;
    const withoutDates = fullyFilteredTasks.filter(
      (t) => !t.start_date || !t.end_date,
    ).length;
    return { total, inProgress, done, withoutDates };
  }, [fullyFilteredTasks]);

  const totalLabel = summary.total === 1 ? 'task' : 'tasks';

  // ========= CRUD handlers =========

  const handleNewTask = () => {
    if (!canEditTasks) {
      alert(
        'You currently have view-only access. Please contact an admin if you need to create or edit tasks.',
      );
      return;
    }
    setSelectedTask(null);
    setIsModalOpen(true);
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const handleSaveTask = async (partial: Partial<Task>) => {
    try {
      if (!canEditTasks) return;

      if (!partial.name || !partial.name.trim()) {
        alert('Please enter a task name.');
        return;
      }

      // assignee: ต้องเป็น uuid หรือ null เท่านั้น
      const normalizedAssignee =
        partial.assignee === '' || partial.assignee == null
          ? null
          : partial.assignee;

      if (selectedTask) {
        // ========= UPDATE =========
        const { id, ...rest } = partial;

        const { error } = await supabase
          .from('tasks')
          .update({
            ...rest,
            assignee: normalizedAssignee,
          })
          .eq('id', selectedTask.id);

        if (error) {
          console.error('Supabase UPDATE error:', {
            message: error.message,
            details: (error as any).details,
            hint: (error as any).hint,
          });
          alert(
            'Cannot update task: ' +
              (error.message || JSON.stringify(error)),
          );
          return;
        }
      } else {
        // ========= INSERT =========
        const insertPayload: any = {
          name: partial.name.trim(),
          description: partial.description ?? '',
          start_date: partial.start_date ?? null,
          end_date: partial.end_date ?? null,
          status: partial.status ?? 'To Do',
          priority: partial.priority ?? 'Medium',
          progress: partial.progress ?? 0,

          assignee: normalizedAssignee,

          is_recurring: partial.is_recurring ?? false,
          recurring_type: partial.is_recurring
            ? partial.recurring_type ?? 'none'
            : 'none',
          recurring_interval: partial.is_recurring
            ? partial.recurring_interval ?? 1
            : null,
          recurring_unit: partial.is_recurring
            ? partial.recurring_unit ?? 'month'
            : null,

          dependencies: partial.dependencies ?? '',

          team_id:
            (partial as any).team_id ?? currentProfile?.team_id ?? null,
          parent_id: partial.parent_id ?? null,
        };

        // ถ้าตารางมีคอลัมน์ task_type (routine / strategic / process / self / other)
        // ให้ใช้ค่า default เป็น 'routine'
        // ถ้าไม่มีคอลัมน์นี้ ให้ลบบรรทัดนี้ออก
        (insertPayload as any).work_type =
          (partial as any).work_type ?? 'routine';

        console.log('Insert payload', insertPayload);

        const { error } = await supabase.from('tasks').insert(insertPayload);

        if (error) {
          console.error('Supabase INSERT error:', {
            message: error.message,
            details: (error as any).details,
            hint: (error as any).hint,
          });
          alert(
            'Cannot create task: ' +
              (error.message || JSON.stringify(error)),
          );
          return;
        }
      }

      setIsModalOpen(false);
      await loadTasks();
    } catch (err) {
      console.error('handleSaveTask unexpected error:', err);
      alert('Unexpected error when saving task.');
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      if (!canEditTasks) return;

      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) {
        console.error('Supabase DELETE error:', {
          message: error.message,
          details: (error as any).details,
          hint: (error as any).hint,
        });
        alert(
          'Cannot delete task: ' +
            (error.message || JSON.stringify(error)),
        );
        return;
      }
      setIsModalOpen(false);
      await loadTasks();
    } catch (err) {
      console.error('handleDeleteTask unexpected error:', err);
      alert('Unexpected error when deleting task.');
    }
  };

  // ========= Auth handlers =========

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setCurrentProfile(null);
      setFilterAssignee(null);
      router.push('/login');
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const handleSignIn = () => {
    router.push('/login');
  };

  // ========= Helper views (list / board / calendar) =========
  function TasksListView({
    tasks,
    onTaskClick,
  }: {
    tasks: Task[];
    onTaskClick: (t: Task) => void;
  }) {
    return (
      <div style={{ overflow: 'auto' }}>
        <table
          style={{
            width: '100%',
            fontSize: 13,
            borderCollapse: 'collapse',
          }}
        >
          <thead>
            <tr style={{ background: '#f8fafc', color: '#64748b' }}>
              <th style={{ padding: 6, textAlign: 'left' }}>Task</th>
              <th style={{ padding: 6 }}>Assignee</th>
              <th style={{ padding: 6 }}>Status</th>
              <th style={{ padding: 6 }}>Start</th>
              <th style={{ padding: 6 }}>End</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr
                key={t.id}
                style={{ cursor: 'pointer' }}
                onClick={() => onTaskClick(t)}
              >
                <td style={{ padding: 6 }}>{t.name}</td>
                <td style={{ padding: 6, textAlign: 'center' }}>
                  {t.assignee}
                </td>
                <td style={{ padding: 6, textAlign: 'center' }}>{t.status}</td>
                <td style={{ padding: 6, textAlign: 'center' }}>
                  {t.start_date}
                </td>
                <td style={{ padding: 6, textAlign: 'center' }}>
                  {t.end_date}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function TasksBoardView({
    tasks,
    onTaskClick,
  }: {
    tasks: Task[];
    onTaskClick: (t: Task) => void;
  }) {
    const columns: Array<{ key: Task['status']; label: string }> = [
      { key: 'To Do', label: 'To Do' },
      { key: 'In Progress', label: 'In Progress' },
      { key: 'Blocked', label: 'Blocked' },
      { key: 'Done', label: 'Done' },
    ];

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4,minmax(0,1fr))',
          gap: 12,
          height: '100%',
        }}
      >
        {columns.map((col) => (
          <div
            key={col.key}
            style={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#64748b',
                marginBottom: 6,
              }}
            >
              {col.label}
            </div>
            <div
              style={{
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {tasks
                .filter((t) => t.status === col.key)
                .map((t) => (
                  <div
                    key={t.id}
                    style={{
                      borderRadius: 10,
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      padding: '6px 8px',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                    onClick={() => onTaskClick(t)}
                  >
                    <div style={{ fontWeight: 500 }}>{t.name}</div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#94a3b8',
                        marginTop: 2,
                      }}
                    >
                      {t.assignee || 'Unassigned'}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function TasksCalendarView({
    tasks,
    onTaskClick,
  }: {
    tasks: Task[];
    onTaskClick: (t: Task) => void;
  }) {
    const byDate: Record<string, Task[]> = {};
    tasks.forEach((t) => {
      const key = t.end_date || 'No date';
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(t);
    });

    const dates = Object.keys(byDate).sort();

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflowY: 'auto',
        }}
      >
        {dates.map((d) => (
          <div
            key={d}
            style={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              padding: 8,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#64748b',
                marginBottom: 4,
              }}
            >
              {d === 'No date' ? 'No due date' : d}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {byDate[d].map((t) => (
                <div
                  key={t.id}
                  style={{
                    borderRadius: 999,
                    padding: '4px 10px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                  onClick={() => onTaskClick(t)}
                >
                  {t.name}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ========= Render =========
  return (
    <AppShell
      onNewTask={handleNewTask}
      activeView={view}
      onChangeView={setView}
      teams={teams}
      users={users}
      activeTeamId={filterTeamId}
      activeAssignee={filterAssignee}
      onSelectTeam={setFilterTeamId}
      onSelectAssignee={setFilterAssignee}
      onFilterMyTasks={() => {
        if (!currentProfile) return;
        const found = users.find((u) => u.id === currentProfile.id);
        if (found) setFilterAssignee(found.display_name);
      }}
      onFilterThisWeek={() => setFilterDateRange('thisWeek')}
      onFilterOverdue={() => setFilterDateRange('overdue')}
      currentProfile={currentProfile}
      onSignIn={handleSignIn}
      onSignOut={handleSignOut}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 120px)',
        }}
      >
        {/* Summary cards */}
        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-title">Total</div>
            <div className="summary-value">
              {summary.total}{' '}
              <span className="summary-label">{totalLabel}</span>
            </div>
          </div>

          <div className="summary-card in-progress">
            <div className="summary-title">In progress</div>
            <div className="summary-value">{summary.inProgress}</div>
          </div>

          <div className="summary-card done">
            <div className="summary-title">Done</div>
            <div className="summary-value">{summary.done}</div>
          </div>

          <div className="summary-card">
            <div className="summary-title">Missing dates</div>
            <div className="summary-value">{summary.withoutDates}</div>
          </div>
        </div>

        {/* Main view area */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {loading ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                color: '#64748b',
              }}
            >
              Loading tasks…
            </div>
          ) : view === 'gantt' ? (
            <GanttChart
              tasks={fullyFilteredTasks}
              onTaskUpdate={loadTasks}
              onTaskClick={handleTaskClick}
            />
          ) : view === 'list' ? (
            <TasksListView
              tasks={fullyFilteredTasks}
              onTaskClick={handleTaskClick}
            />
          ) : view === 'board' ? (
            <TasksBoardView
              tasks={fullyFilteredTasks}
              onTaskClick={handleTaskClick}
            />
          ) : (
            <TasksCalendarView
              tasks={fullyFilteredTasks}
              onTaskClick={handleTaskClick}
            />
          )}
        </div>
      </div>

      <TaskModal
        isOpen={isModalOpen}
        task={selectedTask}
        allTasks={tasks}
        users={users}
        currentUser={currentProfile}
        canEdit={canEditTasks}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
      />
    </AppShell>
  );
}
