// app/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../components/AppShell';
import GanttChart from '../components/GanttChart';
import TaskModal from '../components/TaskModal';
import { supabase } from '../utils/supabase';
import {
  calculateTaskProgressMetrics,
  calculateWorkloadSummary,
  formatNumber,
  formatProgress,
} from '../utils/taskProgress';
import {
  getHierarchicalTaskRows,
  groupTasksByAssigneeAndWorkType,
  groupTasksByWorkType,
} from '../utils/taskGrouping';
import {
  filterTasksBySource,
  getTaskSourceLabel,
  isOriginalAsTask,
  type TaskSourceFilter,
} from '../utils/taskSource';
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
  const [filterTaskSource, setFilterTaskSource] =
    useState<TaskSourceFilter>('all');

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
  const isAdmin = currentProfile?.role === 'admin';

  // ========= filters =========
  const roleFilteredTasks = useMemo(() => {
    if (!currentProfile || roleCanSeeAll(currentProfile.role)) return tasks;
    if (!currentProfile.team_id) return tasks;
    return tasks.filter(
      (t) =>
        t.team_id === currentProfile.team_id ||
        (!t.team_id && t.assignee === currentProfile.display_name),
    );
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

  const sourceFilteredTasks = useMemo(
    () => filterTasksBySource(timeFilteredTasks, filterTaskSource),
    [timeFilteredTasks, filterTaskSource],
  );

  const fullyFilteredTasks = useMemo(() => {
    return sourceFilteredTasks.filter((t) => {
      if (filterTeamId && t.team_id !== filterTeamId) return false;
      if (filterAssignee && t.assignee !== filterAssignee) return false;
      return true;
    });
  }, [sourceFilteredTasks, filterTeamId, filterAssignee]);

  const progressMetrics = useMemo(
    () => calculateTaskProgressMetrics(fullyFilteredTasks),
    [fullyFilteredTasks],
  );

  const tasksWithCalculatedProgress = useMemo(
    () =>
      fullyFilteredTasks.map((task) => ({
        ...task,
        calculated_progress:
          progressMetrics[task.id]?.calculatedProgress ?? null,
      })),
    [fullyFilteredTasks, progressMetrics],
  );

  const workloadSummary = useMemo(
    () => calculateWorkloadSummary(fullyFilteredTasks),
    [fullyFilteredTasks],
  );

  const visibleAssignees = useMemo(
    () =>
      Array.from(
        new Set(
          fullyFilteredTasks
            .map((task) => task.assignee?.trim())
            .filter((assignee): assignee is string => !!assignee),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [fullyFilteredTasks],
  );

  const weightTargetValue =
    workloadSummary.visibleAssigneeCount > 0
      ? workloadSummary.averageEffectiveWeightPerAssignee
      : workloadSummary.totalScoreableWeight;
  const shouldShowWeightTargetWarning =
    workloadSummary.scoreableTaskCount > 0 &&
    weightTargetValue !== null &&
    Math.abs(weightTargetValue - 100) > 0.01;

  // tasks ที่ไม่มีลูก = leaf tasks (งานจริง)
  const leafTasks = useMemo(() => {
    const parentIds = new Set(
      fullyFilteredTasks
        .filter((t) => t.parent_id) // แถวที่เป็นลูก
        .map((t) => t.parent_id as string), // id ของ parent
    );

    return fullyFilteredTasks.filter(
      (t) => !parentIds.has(t.id), // เอาเฉพาะตัวที่ไม่มีใครอ้างเป็น parent
    );
  }, [fullyFilteredTasks]);

  const summary = useMemo(() => {
    const total = fullyFilteredTasks.length;
    const inProgress = fullyFilteredTasks.filter(
      (t) => t.status === 'In Progress',
    ).length;

    const done = fullyFilteredTasks.filter((t) => t.status === 'Done').length;

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const overdue = fullyFilteredTasks.filter((t) => {
      if (!t.end_date) return false;
      const end = new Date(t.end_date);
      return end < now && t.status !== 'Done';
    }).length;

    return { total, inProgress, done, overdue };
  }, [fullyFilteredTasks]);

  const totalLabel = summary.total === 1 ? 'task' : 'tasks';

  const formatWeightGroupSummary = (
    total: number,
    assigneeCount?: number,
    averagePerAssignee?: number | null,
  ) => {
    if (assigneeCount && assigneeCount > 1 && typeof averagePerAssignee === 'number') {
      return `รวม Weight: ${formatNumber(total)} | เฉลี่ย/คน: ${formatNumber(
        averagePerAssignee,
      )}`;
    }

    return `รวม Weight: ${formatNumber(total)}`;
  };

  const renderTaskSourceBadge = (task: Task) => (
    <span
      style={{
        marginLeft: 8,
        borderRadius: 999,
        border: '1px solid #cbd5e1',
        background:
          task.task_source === 'as_original' || !task.task_source
            ? '#f8fafc'
            : '#ecfdf5',
        color:
          task.task_source === 'as_original' || !task.task_source
            ? '#475569'
            : '#047857',
        padding: '2px 7px',
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {getTaskSourceLabel(task)}
    </span>
  );

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

  const upsertTaskInState = (task: Task) => {
    setTasks((prev) => {
      const exists = prev.some((candidate) => candidate.id === task.id);
      const next = exists
        ? prev.map((candidate) =>
            candidate.id === task.id ? { ...candidate, ...task } : candidate,
          )
        : [...prev, task];

      return next.sort((a, b) =>
        (a.start_date ?? '').localeCompare(b.start_date ?? ''),
      );
    });
  };

  const handleSaveTask = async (partial: Partial<Task>) => {
    try {
      if (!canEditTasks) return;

      if (!partial.name || !partial.name.trim()) {
        alert('Please enter a task name.');
        return;
      }

      // assignee: ต้องเป็น uuid หรือ null เท่านั้น (ตอนนี้ใช้เป็น string ก็เซฟตรง ๆ ได้)
      const normalizedAssignee =
        partial.assignee === '' || partial.assignee == null
          ? null
          : partial.assignee;
      const parentTask = partial.parent_id
        ? tasks.find((task) => task.id === partial.parent_id)
        : null;
      const isUserRole = currentProfile?.role === 'user';
      const isCreating = !selectedTask;

      if (
        selectedTask &&
        isUserRole &&
        isOriginalAsTask(selectedTask) &&
        !window.confirm(
          'งานนี้เป็นงานต้นฉบับจาก AS และอาจถูกใช้ประกอบการประเมินผล หากต้องการแตกงานเพื่อจัดการรายละเอียด แนะนำให้เพิ่มเป็นงานย่อยแทนการแก้ไขงานต้นฉบับ ต้องการบันทึกการแก้ไขต่อหรือไม่?',
        )
      ) {
        return;
      }

      if (isCreating && isUserRole) {
        if (!parentTask || !isOriginalAsTask(parentTask)) {
          alert('Please select your original AS task as the parent task.');
          return;
        }
        if (parentTask.assignee !== currentProfile?.display_name) {
          alert('You can add child tasks only under your own AS tasks.');
          return;
        }
      }

      const defaultTeamId = roleCanSeeAll(currentProfile?.role)
        ? filterTeamId ?? currentProfile?.team_id ?? null
        : currentProfile?.team_id ?? null;
      const normalizedTeamId =
        parentTask?.team_id ??
        (partial as any).team_id ??
        defaultTeamId;
      const effectiveAssignee =
        isCreating && isUserRole
          ? currentProfile?.display_name ?? parentTask?.assignee ?? normalizedAssignee
          : normalizedAssignee;
      const normalizedTaskSource = selectedTask
        ? selectedTask.task_source ?? 'as_original'
        : isAdmin
          ? partial.task_source ?? 'admin_added'
          : 'user_added';
      const normalizedCountsTowardAssessment = selectedTask
        ? selectedTask.counts_toward_assessment ?? true
        : isAdmin
          ? partial.counts_toward_assessment ?? true
          : false;
      const normalizedIncludeInAiSummary = selectedTask
        ? selectedTask.include_in_ai_summary ?? true
        : partial.include_in_ai_summary ?? true;
      let savedTaskForState: Task | null = null;

      if (selectedTask) {
        // ========= UPDATE =========
        const { id, ...rest } = partial;
        const updatePayload = {
          ...rest,
          assignee: effectiveAssignee,
          team_id: normalizedTeamId,
        };
        if (!isAdmin) {
          delete (updatePayload as any).task_source;
          delete (updatePayload as any).counts_toward_assessment;
          delete (updatePayload as any).include_in_ai_summary;
        }

        const { error } = await supabase
          .from('tasks')
          .update(updatePayload)
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
        savedTaskForState = {
          ...selectedTask,
          ...updatePayload,
          id: selectedTask.id,
        } as Task;
      } else {
        // ========= INSERT =========
        const taskId =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : undefined;
        const insertPayload: any = {
          id: taskId,
          name: partial.name.trim(),
          description: partial.description ?? '',
          start_date: partial.start_date ?? null,
          end_date: partial.end_date ?? null,
          status: partial.status ?? 'To Do',
          priority: partial.priority ?? 'Medium',
          progress: partial.progress ?? 0,
          weight:
            normalizedCountsTowardAssessment === false
              ? 0
              : partial.weight ?? 0,
          calculated_progress: null,
          progress_summary: partial.progress_summary ?? null,

          assignee: effectiveAssignee,

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

          team_id: normalizedTeamId,
          parent_id: partial.parent_id ?? null,
          task_source: normalizedTaskSource,
          counts_toward_assessment: normalizedCountsTowardAssessment,
          include_in_ai_summary: normalizedIncludeInAiSummary,
        };

        // work_type (routine / strategic / process / self / other)
        (insertPayload as any).work_type =
          (partial as any).work_type ?? 'routine';

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
        savedTaskForState = insertPayload as Task;
      }

      setIsModalOpen(false);
      await loadTasks();
      if (savedTaskForState) {
        upsertTaskInState(savedTaskForState);
      }
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

  // 👇 ใหม่: duplicate task จาก task เดิม
  const handleDuplicateTask = async (task: Task) => {
    try {
      if (!canEditTasks) return;
      const duplicateAsUserAdded = currentProfile?.role === 'user';
      const originalParentTask =
        duplicateAsUserAdded && isOriginalAsTask(task)
          ? task
          : duplicateAsUserAdded
            ? tasks.find((candidate) => candidate.id === task.parent_id)
            : null;

      if (duplicateAsUserAdded) {
        if (
          !originalParentTask ||
          !isOriginalAsTask(originalParentTask) ||
          originalParentTask.assignee !== currentProfile?.display_name
        ) {
          alert('You can duplicate only into your own original AS task.');
          return;
        }
      }

      const insertPayload: any = {
        name: `${task.name} (copy)`,
        description: task.description ?? '',
        start_date: task.start_date ?? null,
        end_date: task.end_date ?? null,

        // reset สถานะให้เป็นงานใหม่
        status: 'To Do',
        priority: task.priority ?? 'Medium',
        progress: 0,

        assignee: duplicateAsUserAdded
          ? currentProfile?.display_name ?? null
          : task.assignee ?? null,

        is_recurring: task.is_recurring ?? false,
        recurring_type: task.is_recurring ? task.recurring_type ?? 'none' : 'none',
        recurring_interval: task.is_recurring ? task.recurring_interval ?? 1 : null,
        recurring_unit: task.is_recurring ? task.recurring_unit ?? 'month' : null,

        dependencies: task.dependencies ?? '',

        team_id:
          originalParentTask?.team_id ??
          task.team_id ??
          currentProfile?.team_id ??
          null,
        parent_id: originalParentTask?.id ?? task.parent_id ?? null,

        work_type: (task as any).work_type ?? 'routine',
        weight: duplicateAsUserAdded ? 0 : task.weight ?? 0,
        calculated_progress: null,
        progress_summary: task.progress_summary ?? null,
        task_source: isAdmin ? 'admin_added' : 'user_added',
        counts_toward_assessment: isAdmin,
        include_in_ai_summary: true,
      };

      const { error } = await supabase.from('tasks').insert(insertPayload);

      if (error) {
        console.error('Supabase DUPLICATE error:', {
          message: error.message,
          details: (error as any).details,
          hint: (error as any).hint,
        });
        alert(
          'Cannot duplicate task: ' +
            (error.message || JSON.stringify(error)),
        );
        return;
      }

      setIsModalOpen(false); // ถ้าอยากให้ modal ยังเปิดอยู่ก็ลบบรรทัดนี้ได้
      await loadTasks();
      upsertTaskInState(insertPayload as Task);
    } catch (err) {
      console.error('handleDuplicateTask unexpected error:', err);
      alert('Unexpected error when duplicating task.');
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
    groupByAssignee = true,
  }: {
    tasks: Task[];
    onTaskClick: (t: Task) => void;
    groupByAssignee?: boolean;
  }) {
    const listMetrics = useMemo(
      () => calculateTaskProgressMetrics(tasks),
      [tasks],
    );
    const assigneeGroups = useMemo(
      () => groupTasksByAssigneeAndWorkType(tasks),
      [tasks],
    );
    const workTypeGroups = useMemo(() => groupTasksByWorkType(tasks), [tasks]);

    const renderTaskRows = (groupTasks: Task[]) =>
      getHierarchicalTaskRows(groupTasks).map(({ task: t, depth }) => {
        const metric = listMetrics[t.id];
        const isParent = metric?.isParent ?? false;

        return (
          <tr
            key={t.id}
            style={{ cursor: 'pointer' }}
            onClick={() => onTaskClick(t)}
          >
            <td
              style={{
                padding: 6,
                paddingLeft: 6 + depth * 18,
                fontWeight: isParent ? 600 : 400,
              }}
            >
              {depth > 0 ? '↳ ' : ''}
              {t.name}
              {renderTaskSourceBadge(t)}
            </td>
            <td style={{ padding: 6, textAlign: 'center' }}>
              {t.assignee}
            </td>
            <td style={{ padding: 6, textAlign: 'center' }}>{t.status}</td>
            <td style={{ padding: 6, textAlign: 'center' }}>
              <div>{formatNumber(metric?.displayWeight ?? 0)}</div>
              {metric?.isComputedWeight && (
                <div style={{ fontSize: 10, color: '#64748b' }}>คำนวณ</div>
              )}
            </td>
            <td style={{ padding: 6, textAlign: 'center' }}>
              {formatProgress(metric?.displayProgress)}
            </td>
            <td style={{ padding: 6, textAlign: 'center' }}>
              {metric?.isParent ? formatProgress(metric.calculatedProgress) : '-'}
            </td>
            <td style={{ padding: 6, textAlign: 'center' }}>
              {formatNumber(metric?.weightedContribution ?? 0)}
            </td>
            <td style={{ padding: 6, textAlign: 'center' }}>
              {t.start_date}
            </td>
            <td style={{ padding: 6, textAlign: 'center' }}>{t.end_date}</td>
            <td style={{ padding: 6, color: '#64748b' }}>
              {t.progress_summary || '-'}
            </td>
          </tr>
        );
      });

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
              <th style={{ padding: 6 }}>Weight</th>
              <th style={{ padding: 6 }}>Progress</th>
              <th style={{ padding: 6 }}>Calculated</th>
              <th style={{ padding: 6 }}>Contribution</th>
              <th style={{ padding: 6 }}>Start</th>
              <th style={{ padding: 6 }}>End</th>
              <th style={{ padding: 6, textAlign: 'left' }}>Summary</th>
            </tr>
          </thead>
          <tbody>
            {groupByAssignee
              ? assigneeGroups.flatMap((assigneeGroup) => [
                  <tr key={`assignee:${assigneeGroup.assignee}`}>
                    <td
                      colSpan={10}
                      style={{
                        padding: '8px 6px',
                        background: '#f1f5f9',
                        color: '#0f172a',
                        fontWeight: 700,
                      }}
                    >
                      {assigneeGroup.assignee} —{' '}
                      {formatWeightGroupSummary(
                        assigneeGroup.effectiveWeightTotal,
                        assigneeGroup.visibleAssigneeCount,
                        assigneeGroup.averageEffectiveWeightPerAssignee,
                      )}
                    </td>
                  </tr>,
                  ...assigneeGroup.workTypeGroups.flatMap((workTypeGroup) => [
                    <tr
                      key={`worktype:${assigneeGroup.assignee}:${workTypeGroup.workType}`}
                    >
                      <td
                        colSpan={10}
                        style={{
                          padding: '6px 6px 6px 18px',
                          background: '#f8fafc',
                          color: '#8b2332',
                          fontWeight: 600,
                        }}
                      >
                        ประเภทงาน: {workTypeGroup.label} —{' '}
                        {formatWeightGroupSummary(
                          workTypeGroup.effectiveWeightTotal,
                          workTypeGroup.visibleAssigneeCount,
                          workTypeGroup.averageEffectiveWeightPerAssignee,
                        )}
                      </td>
                    </tr>,
                    ...renderTaskRows(workTypeGroup.tasks),
                  ]),
                ])
              : workTypeGroups.flatMap((workTypeGroup) => [
                  <tr key={`worktype:${workTypeGroup.workType}`}>
                    <td
                      colSpan={10}
                      style={{
                        padding: '8px 6px',
                        background: '#f8fafc',
                        color: '#8b2332',
                        fontWeight: 600,
                      }}
                    >
                      ประเภทงาน: {workTypeGroup.label} —{' '}
                      {formatWeightGroupSummary(
                        workTypeGroup.effectiveWeightTotal,
                        workTypeGroup.visibleAssigneeCount,
                        workTypeGroup.averageEffectiveWeightPerAssignee,
                      )}
                    </td>
                  </tr>,
                  ...renderTaskRows(workTypeGroup.tasks),
                ])}
            {!tasks.length && (
              <tr>
                <td colSpan={10} style={{ padding: 16, color: '#64748b' }}>
                  No tasks found.
                </td>
              </tr>
            )}
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
                gap: 10,
              }}
            >
              {groupTasksByWorkType(
                tasks.filter((t) => t.status === col.key),
              ).map((workTypeGroup) => (
                <div key={workTypeGroup.workType}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#8b2332',
                      marginBottom: 4,
                    }}
                  >
                    ประเภทงาน: {workTypeGroup.label} —{' '}
                    {formatWeightGroupSummary(
                      workTypeGroup.effectiveWeightTotal,
                      workTypeGroup.visibleAssigneeCount,
                      workTypeGroup.averageEffectiveWeightPerAssignee,
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    {workTypeGroup.tasks.map((t) => (
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
                        <div style={{ fontWeight: 500 }}>
                          {t.name}
                          {renderTaskSourceBadge(t)}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: '#94a3b8',
                            marginTop: 2,
                          }}
                        >
                          {t.assignee || 'Unassigned'}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: '#64748b',
                            marginTop: 2,
                          }}
                        >
                          Weight {formatNumber(t.weight ?? 0)} · Progress{' '}
                          {formatProgress(t.calculated_progress ?? t.progress)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!tasks.some((t) => t.status === col.key) && (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  No tasks
                </div>
              )}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groupTasksByWorkType(byDate[d]).map((workTypeGroup) => (
                <div key={workTypeGroup.workType}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#8b2332',
                      marginBottom: 4,
                    }}
                  >
                    ประเภทงาน: {workTypeGroup.label} —{' '}
                    {formatWeightGroupSummary(
                      workTypeGroup.effectiveWeightTotal,
                      workTypeGroup.visibleAssigneeCount,
                      workTypeGroup.averageEffectiveWeightPerAssignee,
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {workTypeGroup.tasks.map((t) => (
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
                        {renderTaskSourceBadge(t)} ·{' '}
                        {formatProgress(t.calculated_progress ?? t.progress)}
                      </div>
                    ))}
                  </div>
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
      activeTaskSourceFilter={filterTaskSource}
      onSelectTeam={setFilterTeamId}
      onSelectAssignee={setFilterAssignee}
      onSelectTaskSourceFilter={setFilterTaskSource}
      onFilterMyTasks={() => {
        if (!currentProfile) return;
        const found = users.find((u) => u.id === currentProfile.id);
        if (!found) return;

        setFilterAssignee((prev) =>
          prev === found.display_name ? null : found.display_name,
        );
      }}
      onFilterThisWeek={() =>
        setFilterDateRange((prev) =>
          prev === 'thisWeek' ? 'all' : 'thisWeek',
        )
      }
      onFilterOverdue={() =>
        setFilterDateRange((prev) =>
          prev === 'overdue' ? 'all' : 'overdue',
        )
      }
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
            <div className="summary-title">Overdue</div>
            <div className="summary-value">{summary.overdue}</div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div className="summary-card">
            <div className="summary-title">Total visible weight</div>
            <div className="summary-value">
              {formatNumber(workloadSummary.totalScoreableWeight)}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-title">Assignees</div>
            <div className="summary-value">
              {workloadSummary.visibleAssigneeCount}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-title">Avg weight / person</div>
            <div className="summary-value">
              {workloadSummary.averageEffectiveWeightPerAssignee === null
                ? '-'
                : formatNumber(workloadSummary.averageEffectiveWeightPerAssignee)}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-title">Scoreable tasks</div>
            <div className="summary-value">
              {workloadSummary.scoreableTaskCount}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-title">Subtasks</div>
            <div className="summary-value">
              {workloadSummary.subtaskCount}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-title">Avg calculated</div>
            <div className="summary-value">
              {formatProgress(workloadSummary.averageCalculatedProgress)}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-title">Weighted total</div>
            <div className="summary-value">
              {formatNumber(workloadSummary.totalWeightedContribution)}
            </div>
          </div>
        </div>

        {shouldShowWeightTargetWarning && weightTargetValue !== null && (
          <div
            style={{
              marginTop: -8,
              marginBottom: 14,
              borderRadius: 10,
              border: '1px solid #fed7aa',
              background: '#fffbeb',
              color: '#92400e',
              padding: '8px 10px',
              fontSize: 12,
            }}
          >
            {workloadSummary.visibleAssigneeCount > 1
              ? `ค่าเฉลี่ยน้ำหนักงานต่อคนขณะนี้คือ ${formatNumber(
                  weightTargetValue,
                )} แนะนำให้ใกล้ 100`
              : `รวมน้ำหนักงานของ ${
                  visibleAssignees[0] ?? 'Unassigned'
                } ขณะนี้คือ ${formatNumber(
                  weightTargetValue,
                )} แนะนำให้เป็น 100`}
          </div>
        )}

        {workloadSummary.unassignedTaskCount > 0 && (
          <div
            style={{
              marginTop: -8,
              marginBottom: 14,
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              color: '#475569',
              padding: '8px 10px',
              fontSize: 12,
            }}
          >
            มีงานที่ยังไม่ระบุผู้รับผิดชอบ {workloadSummary.unassignedTaskCount}{' '}
            รายการ จึงไม่นำไปรวมในค่าเฉลี่ยต่อคน
          </div>
        )}

        {workloadSummary.parentChildWeightWarnings.length > 0 && (
          <div
            style={{
              marginTop: -8,
              marginBottom: 14,
              borderRadius: 10,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#991b1b',
              padding: '8px 10px',
              fontSize: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {workloadSummary.parentChildWeightWarnings.map((warning) => (
              <div key={warning.taskId}>
                งานหลัก "{warning.taskName}" มี weight ={' '}
                {formatNumber(warning.parentWeight)} แต่ผลรวมงานย่อย ={' '}
                {formatNumber(warning.childrenWeight)}
              </div>
            ))}
          </div>
        )}

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
              tasks={tasksWithCalculatedProgress}
              onTaskUpdate={loadTasks}
              onTaskClick={handleTaskClick}
            />
          ) : view === 'list' ? (
            <TasksListView
              tasks={tasksWithCalculatedProgress}
              onTaskClick={handleTaskClick}
              groupByAssignee={!filterAssignee}
            />
          ) : view === 'board' ? (
            <TasksBoardView
              tasks={tasksWithCalculatedProgress}
              onTaskClick={handleTaskClick}
            />
          ) : (
            <TasksCalendarView
              tasks={tasksWithCalculatedProgress}
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
        defaultAssignee={filterAssignee}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        onDuplicate={handleDuplicateTask}  
      />
    </AppShell>
  );
}
