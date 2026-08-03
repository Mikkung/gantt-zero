-- Phase 7B DEV/LOCAL ROLLBACK ONLY
--
-- Use only in a local/dev database if the draft migration needs to be backed
-- out during testing. Do not run in production without reviewing the precheck
-- policy output and deciding which old policies should be restored.
--
-- This rollback does not delete data and does not truncate data.
-- It disables RLS only on the newly enabled assessment/peer/AI tables.
-- It intentionally does not disable RLS on profiles, tasks, or teams because
-- those tables already had RLS enabled before Phase 7B.

BEGIN;

-- Drop Phase 7 policies from newly protected assessment/manager/peer/AI tables.
DROP POLICY IF EXISTS phase7_assessment_periods_all_admin ON public.assessment_periods;
DROP POLICY IF EXISTS phase7_assessment_periods_select_user ON public.assessment_periods;
DROP POLICY IF EXISTS phase7_assessment_periods_select_assigned_manager ON public.assessment_periods;

DROP POLICY IF EXISTS phase7_attribute_criteria_all_admin ON public.attribute_criteria;
DROP POLICY IF EXISTS phase7_attribute_criteria_select_active ON public.attribute_criteria;

DROP POLICY IF EXISTS phase7_assessment_task_snapshots_all_admin ON public.assessment_task_snapshots;
DROP POLICY IF EXISTS phase7_assessment_task_snapshots_select_self ON public.assessment_task_snapshots;
DROP POLICY IF EXISTS phase7_assessment_task_snapshots_insert_self ON public.assessment_task_snapshots;
DROP POLICY IF EXISTS phase7_assessment_task_snapshots_update_self ON public.assessment_task_snapshots;
DROP POLICY IF EXISTS phase7_assessment_task_snapshots_select_assigned_manager ON public.assessment_task_snapshots;

DROP POLICY IF EXISTS phase7_task_self_evaluations_all_admin ON public.task_self_evaluations;
DROP POLICY IF EXISTS phase7_task_self_evaluations_select_self ON public.task_self_evaluations;
DROP POLICY IF EXISTS phase7_task_self_evaluations_insert_self ON public.task_self_evaluations;
DROP POLICY IF EXISTS phase7_task_self_evaluations_update_self ON public.task_self_evaluations;
DROP POLICY IF EXISTS phase7_task_self_evaluations_select_assigned_manager ON public.task_self_evaluations;

DROP POLICY IF EXISTS phase7_attribute_self_evaluations_all_admin ON public.attribute_self_evaluations;
DROP POLICY IF EXISTS phase7_attribute_self_evaluations_select_self ON public.attribute_self_evaluations;
DROP POLICY IF EXISTS phase7_attribute_self_evaluations_insert_self ON public.attribute_self_evaluations;
DROP POLICY IF EXISTS phase7_attribute_self_evaluations_update_self ON public.attribute_self_evaluations;
DROP POLICY IF EXISTS phase7_attribute_self_evaluations_select_assigned_manager ON public.attribute_self_evaluations;

DROP POLICY IF EXISTS phase7_self_evaluation_submissions_all_admin ON public.self_evaluation_submissions;
DROP POLICY IF EXISTS phase7_self_evaluation_submissions_select_self ON public.self_evaluation_submissions;
DROP POLICY IF EXISTS phase7_self_evaluation_submissions_insert_self ON public.self_evaluation_submissions;
DROP POLICY IF EXISTS phase7_self_evaluation_submissions_update_self ON public.self_evaluation_submissions;
DROP POLICY IF EXISTS phase7_self_evaluation_submissions_select_assigned_manager ON public.self_evaluation_submissions;

DROP POLICY IF EXISTS phase7_manager_evaluation_assignments_all_admin ON public.manager_evaluation_assignments;
DROP POLICY IF EXISTS phase7_manager_evaluation_assignments_select_own_manager ON public.manager_evaluation_assignments;

DROP POLICY IF EXISTS phase7_task_manager_evaluations_all_admin ON public.task_manager_evaluations;
DROP POLICY IF EXISTS phase7_task_manager_evaluations_select_assigned_manager ON public.task_manager_evaluations;
DROP POLICY IF EXISTS phase7_task_manager_evaluations_insert_assigned_manager ON public.task_manager_evaluations;
DROP POLICY IF EXISTS phase7_task_manager_evaluations_update_assigned_manager ON public.task_manager_evaluations;

DROP POLICY IF EXISTS phase7_attribute_manager_evaluations_all_admin ON public.attribute_manager_evaluations;
DROP POLICY IF EXISTS phase7_attribute_manager_evaluations_select_assigned_manager ON public.attribute_manager_evaluations;
DROP POLICY IF EXISTS phase7_attribute_manager_evaluations_insert_assigned_manager ON public.attribute_manager_evaluations;
DROP POLICY IF EXISTS phase7_attribute_manager_evaluations_update_assigned_manager ON public.attribute_manager_evaluations;

DROP POLICY IF EXISTS phase7_manager_evaluation_submissions_all_admin ON public.manager_evaluation_submissions;
DROP POLICY IF EXISTS phase7_manager_evaluation_submissions_select_assigned_manager ON public.manager_evaluation_submissions;
DROP POLICY IF EXISTS phase7_manager_evaluation_submissions_insert_assigned_manager ON public.manager_evaluation_submissions;
DROP POLICY IF EXISTS phase7_manager_evaluation_submissions_update_assigned_manager ON public.manager_evaluation_submissions;

DROP POLICY IF EXISTS phase7_peer_review_imports_all_admin ON public.peer_review_imports;
DROP POLICY IF EXISTS phase7_peer_review_results_all_admin ON public.peer_review_results;
DROP POLICY IF EXISTS phase7_peer_review_summaries_all_admin ON public.peer_review_summaries;
DROP POLICY IF EXISTS phase7_peer_review_summaries_select_assigned_manager ON public.peer_review_summaries;

DROP POLICY IF EXISTS phase7_assessment_ai_summaries_all_admin ON public.assessment_ai_summaries;
DROP POLICY IF EXISTS phase7_assessment_ai_summaries_select_assigned_manager ON public.assessment_ai_summaries;
DROP POLICY IF EXISTS phase7_assessment_ai_summaries_insert_assigned_manager ON public.assessment_ai_summaries;
DROP POLICY IF EXISTS phase7_assessment_ai_summaries_update_assigned_manager ON public.assessment_ai_summaries;

-- Drop period write-window helpers added by this revision. Other Phase 7
-- helpers may still be referenced by profiles/tasks/teams policies unless
-- those policies are also rolled back.
DROP FUNCTION IF EXISTS public.is_self_period_writable(uuid);
DROP FUNCTION IF EXISTS public.is_manager_period_writable(uuid);

-- Disable RLS only on tables that Phase 7B newly enabled.
ALTER TABLE IF EXISTS public.assessment_periods DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.attribute_criteria DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.assessment_task_snapshots DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.task_self_evaluations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.attribute_self_evaluations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.self_evaluation_submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.manager_evaluation_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.task_manager_evaluations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.attribute_manager_evaluations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.manager_evaluation_submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.peer_review_imports DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.peer_review_results DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.peer_review_summaries DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.assessment_ai_summaries DISABLE ROW LEVEL SECURITY;

-- Existing RLS-enabled tables are not rolled back automatically.
-- If needed in local/dev, restore pre-Phase 7 policies for profiles/tasks/teams
-- from the saved output of docs/phase7b-rls-precheck.sql before dropping these:
--
-- DROP POLICY IF EXISTS phase7_profiles_select_admin ON public.profiles;
-- DROP POLICY IF EXISTS phase7_profiles_select_self ON public.profiles;
-- DROP POLICY IF EXISTS phase7_profiles_select_manager_team ON public.profiles;
-- DROP POLICY IF EXISTS phase7_profiles_insert_admin ON public.profiles;
-- DROP POLICY IF EXISTS phase7_profiles_insert_self_user ON public.profiles;
-- DROP POLICY IF EXISTS phase7_profiles_update_admin ON public.profiles;
-- DROP POLICY IF EXISTS phase7_profiles_delete_admin ON public.profiles;
--
-- DROP POLICY IF EXISTS phase7_tasks_all_admin ON public.tasks;
-- DROP POLICY IF EXISTS phase7_tasks_select_own_user ON public.tasks;
-- DROP POLICY IF EXISTS phase7_tasks_select_manager_team ON public.tasks;
--
-- DROP POLICY IF EXISTS phase7_teams_select_authenticated ON public.teams;
-- DROP POLICY IF EXISTS phase7_teams_insert_admin ON public.teams;
-- DROP POLICY IF EXISTS phase7_teams_update_admin ON public.teams;
-- DROP POLICY IF EXISTS phase7_teams_delete_admin ON public.teams;
--
-- The migration also drops the old policy named:
-- "Profiles are updatable by owner"
--
-- Recreating that policy is DEV/LOCAL rollback only and is not recommended for
-- production because it may allow users to update role/team_id/profile columns
-- too broadly. Restore the exact original policy from saved precheck output if
-- you truly need to reproduce pre-Phase 7 behavior. A likely broad version may
-- have looked similar to this, but review before using:
--
-- CREATE POLICY "Profiles are updatable by owner"
-- ON public.profiles
-- FOR UPDATE
-- TO authenticated
-- USING (id = auth.uid())
-- WITH CHECK (id = auth.uid());

COMMIT;
