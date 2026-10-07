import type { Profile, Task } from '../types';
import { supabase } from './supabase';

export interface MonthlyReviewPeriod {
  id: string;
  name: string;
  year: number;
  month: number;
  status: 'open' | 'closed';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyProgressReview {
  id: string;
  period_id: string;
  employee_id: string;
  team_id: string | null;
  reviewer_id: string | null;
  review_status: 'not_reviewed' | 'reviewed';
  review_comment: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type MonthlyReviewTask = Task & { updated_at?: string | null };
export type MonthlyReviewMode = 'admin' | 'manager';

export function canAccessMonthlyReviews(profile: Profile | null, mode: MonthlyReviewMode) {
  return profile?.role === 'admin' || (mode === 'manager' && profile?.role === 'manager');
}

export function canReviewEmployee(reviewer: Profile, employee: Profile) {
  return employee.role === 'user' && (
    reviewer.role === 'admin' ||
    (reviewer.role === 'manager' && !!reviewer.team_id && reviewer.team_id === employee.team_id)
  );
}

export function monthlyReviewHref(mode: MonthlyReviewMode, periodId?: string, employeeId?: string) {
  const base = `/${mode}/monthly-reviews`;
  if (!periodId) return base;
  return `${base}/${encodeURIComponent(periodId)}${employeeId ? `/${encodeURIComponent(employeeId)}` : ''}`;
}

export function formatMonthlyReviewDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(date);
}

export function getBangkokReviewMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`;
}

export function monthlyReviewError(error: { message: string; code?: string }) {
  if (['42P01', 'PGRST205', 'PGRST202'].includes(error.code ?? '')) {
    return 'Monthly review setup is missing. Please apply the Monthly Progress Review migration in Supabase first.';
  }
  if (error.code === '23505') return 'A monthly review period already exists for this month.';
  return error.message;
}

// Supabase limits each response; paginate to include every employee/task.
export async function loadMonthlyRows<T>(table: string, filters: Record<string, string> = {}) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabase.from(table).select('*').order('id').range(offset, offset + 499);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []) as T[]);
    if (!data || data.length < 500) return rows;
  }
}
