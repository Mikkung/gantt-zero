// types.ts

export type Role = 'admin' | 'manager' | 'user';

export type WorkType =
  | 'routine'              // งานประจำ
  | 'strategic'            // งานยุทธศาสตร์
  | 'process_improvement'  // งานพัฒนากระบวนการ
  | 'self_development'     // งานพัฒนาตนเอง
  | 'other';               // งานอื่นๆ


export interface Team {
  id: string;
  name: string;
  color?: string | null;
}

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  team_id: string | null;
  avatar_url?: string | null;
}

export interface Task {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: 'To Do' | 'In Progress' | 'Blocked' | 'In problem Need Help'| 'Done';
  priority: 'Low' | 'Medium' | 'High';
  progress: number;
  assignee: string | null;
  is_recurring: boolean;
  recurring_type?: 'none' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
  recurring_interval?: number | null;
  recurring_unit?: 'day' | 'week' | 'month' | 'year' | null;
  dependencies?: string | null;
  team_id?: string | null;
  parent_id?: string | null;
  description?: string | null;

  work_type?: WorkType | null;
}
