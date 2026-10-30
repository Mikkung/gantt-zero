import type { Task } from '../types';
import { supabase } from './supabase';

export const AS_ORIGINAL_EDITABLE_FIELDS = [
  'description', 'progress_summary', 'start_date', 'end_date', 'output',
  'frequency_count', 'frequency_unit', 'priority', 'status', 'progress',
] as const;
export const AS_ORIGINAL_LOCK_HELP = 'แก้ไขได้ผ่าน AS Revision เท่านั้น';

export function pickAsOriginalTaskChanges(task: Partial<Task>): Partial<Task> {
  return Object.fromEntries(AS_ORIGINAL_EDITABLE_FIELDS
    .filter(key => task[key] !== undefined).map(key => [key, task[key]]));
}

export async function updateOwnAsOriginalTask(id: string, changes: Partial<Task>): Promise<Task> {
  const { data, error } = await supabase.rpc('update_own_as_original_task', {
    target_task_id: id, task_changes: pickAsOriginalTaskChanges(changes),
  }).single();
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) throw new Error('AS task editing setup is missing. Apply the pending AS editing migration.');
    if (error.code === 'PGRST116') throw new Error('No updated AS task was returned. Reload and check task ownership and access.');
    throw error;
  }
  const saved = data as Task | null;
  if (!saved?.id || saved.id !== id || !saved.name) throw new Error('No matching updated AS task was returned. Reload before editing again.');
  return saved;
}
