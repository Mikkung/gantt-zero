// components/AppShell.tsx
'use client';

import { ReactNode, useState } from 'react';
import Link from 'next/link';
import type { Profile, Team } from '../types';

type ViewType = 'gantt' | 'list' | 'board' | 'calendar';

interface AppShellProps {
  children: ReactNode;

  // top-right: new task
  onNewTask: () => void;

  // views : List / Board / Calendar / Gantt
  activeView: ViewType;
  onChangeView: (view: ViewType) => void;

  // filters
  teams: Team[];
  users: Profile[];
  activeTeamId: string | null;
  activeAssignee: string | null;
  onSelectTeam: (teamId: string | null) => void;
  onSelectAssignee: (name: string | null) => void;
  onFilterMyTasks: () => void;
  onFilterThisWeek: () => void;
  onFilterOverdue: () => void;

  // auth / profile
  currentProfile: Profile | null;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function AppShell({
  children,
  onNewTask,
  activeView,
  onChangeView,
  teams,
  users,
  activeTeamId,
  activeAssignee,
  onSelectTeam,
  onSelectAssignee,
  onFilterMyTasks,
  onFilterThisWeek,
  onFilterOverdue,
  currentProfile,
  onSignIn,
  onSignOut,
}: AppShellProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const viewItems: { key: ViewType; label: string }[] = [
    { key: 'list', label: 'List' },
    { key: 'board', label: 'Board' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'gantt', label: 'Gantt' },
  ];

  const displayName =
    currentProfile?.display_name || currentProfile?.email || 'User';
  const initials = displayName.charAt(0).toUpperCase();

  // role label ที่ให้ user เห็น
  const roleLabel =
    currentProfile?.role === 'admin'
      ? 'admin'
      : currentProfile?.role === 'manager'
      ? 'user.M'
      : 'user';

  // manager (user.M) = read only → ไม่ให้สร้าง task
  const canCreateTask =
    !!currentProfile && currentProfile.role !== 'manager';

  return (
    <div className="app-shell">
      {/* ========== Sidebar ========== */}
      <aside className="app-sidebar">
        {/* logo / workspace */}
        <div className="app-sidebar-header">
          <div className="app-logo">ISE</div>
          <div>
            <div className="app-logo-text-main">Work Tracker</div>
            <div className="app-logo-text-sub">
              Internal tasks &amp; timeline
            </div>
          </div>
        </div>

        {/* views */}
        <div>
          <div className="app-sidebar-section-title">VIEWS</div>
          <nav className="app-sidebar-nav">
            {viewItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onChangeView(item.key)}
                className={item.key === activeView ? 'is-active' : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* filters */}
        <div>
          <div className="app-sidebar-section-title">FILTERS</div>
          <div className="app-sidebar-nav">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onFilterMyTasks}
            >
              My tasks
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 4 }}
              onClick={onFilterThisWeek}
            >
              This week
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 4 }}
              onClick={onFilterOverdue}
            >
              Overdue
            </button>
          </div>
        </div>

        {/* team / assignee */}
        <div>
          <div className="app-sidebar-section-title">Team</div>
          <div className="app-sidebar-nav">
            <select
              className="filter-select"
              value={activeTeamId ?? ''}
              onChange={(e) => onSelectTeam(e.target.value || null)}
            >
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="app-sidebar-section-title">Assigned to</div>
          <div className="app-sidebar-nav">
            <select
              className="filter-select"
              value={activeAssignee ?? ''}
              onChange={(e) => onSelectAssignee(e.target.value || null)}
            >
              <option value="">Anyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.display_name}>
                  {u.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* footer */}
        <div className="app-sidebar-footer">
          <div className="app-sidebar-footer-title">v0.1 · Internal use</div>
        </div>
      </aside>

      {/* ========== Main area ========== */}
      <div className="app-main">
        {/* top bar */}
        <header className="app-topbar">
          <div>
            <div className="app-topbar-title">Project timeline &amp; tasks</div>
            <div className="app-topbar-subtitle">
              Track progress, dates, and ownership in one place.
            </div>
          </div>

          <div className="app-topbar-right">
            {/* search */}
            <div className="app-search">
              <span>🔍</span>
              <input placeholder="Search tasks..." aria-label="Search tasks" />
            </div>

            {/* new task (ซ่อนถ้า role = manager) */}
            {canCreateTask && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onNewTask}
              >
                + New Task
              </button>
            )}

            {/* profile or login */}
            {currentProfile ? (
              <div className="profile-wrapper">
                {/* avatar (click to open menu) */}
                <button
                  type="button"
                  className="profile-avatar"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setUserMenuOpen((v) => !v)}
                >
                  {initials}
                </button>

                {userMenuOpen && (
                  <div className="profile-menu">
                    <div className="profile-menu-name">{displayName}</div>
                    <div className="profile-menu-email">
                      {currentProfile.email}
                    </div>
                    <div className="profile-menu-role">
                      Role: {roleLabel}
                    </div>

                    {/* ไปหน้าเปลี่ยน password */}
                    <Link href="/account" className="profile-menu-item">
                      Change password
                    </Link>

                    {/* Logout button */}
                    <button
                      type="button"
                      className="profile-menu-item profile-menu-item-logout"
                      onClick={() => {
                        setUserMenuOpen(false);
                        onSignOut();
                      }}
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onSignIn}
              >
                Log in
              </button>
            )}
          </div>
        </header>

        {/* content card */}
        <main className="app-main-content">
          <div className="app-card">{children}</div>
        </main>
      </div>
    </div>
  );
}
