import type { Task } from '../types';
import { supabase } from './supabase';

// Authoritative database writes, separate from the display-only preview helper.
export async function rebalanceUserAddedWeights(parentId: string, resetManual = false): Promise<Task[]> {
  const { data, error } = await supabase.rpc('rebalance_user_added_task_weights', {
    target_parent_id: parentId,
    reset_manual: resetManual,
  });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      throw new Error('Auto-balance setup is missing. Apply 20261014010000_persist_existing_user_added_weight_balance.sql in Supabase.');
    }
    throw new Error(error.message);
  }
  if (!Array.isArray(data)) throw new Error('Auto-balance did not return the saved task rows.');
  return data as Task[];
}
