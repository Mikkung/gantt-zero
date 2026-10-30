# Unified Task Description And Progress Notes

Implemented 2026-10-29. TaskModal now has one textarea labelled:

รายละเอียดงานและสรุปความคืบหน้า
(Description / Progress Summary)

## Data Compatibility

- `description` is the canonical editable text. `utils/taskNotes.ts` combines existing
  description and legacy progress summary for display without changing database rows.
- Complete matching text/paragraphs and overlapping complete lines are deduplicated.
  Distinct text, Thai text and multiline content are retained. Substrings/fuzzy matches
  are not removed, so `Task 1` and `Task 10` remain distinct notes.
- An explicit TaskModal save writes the unified text to `description` and the same text
  to `progress_summary` as a compatibility mirror. This lets existing snapshot builders,
  import readers and other legacy consumers keep working without a schema migration.
  Reopening/saving cannot append the same mirrored text repeatedly.
- When an employee intentionally clears all notes, confirmation is required. Accepting
  saves an empty description and null legacy summary together; cancelling saves nothing.
  Editing the combined text is intentional replacement of that text, not an automatic
  preservation of deleted old phrases that could resurrect them on the next open.
- Generate Summary merges its generated text into the current textarea. It never replaces
  the existing context/progress notes, and repeated identical generation adds no duplicate.
- Import file schemas/flows and AS Revision configuration/history are unchanged. Legacy
  imports with two distinct fields remain readable through the merge helper. Because
  description participates in existing AS Revision business fingerprints, changing notes
  during a pending revision may trigger its existing live-data conflict check; that guard
  is deliberately not bypassed.

## Readers

- Task List, TaskModal, Monthly Progress Review and Gantt tooltip use the same merge helper.
  Tables retain line breaks. Gantt escapes HTML in notes and bounds the tooltip content;
  task names and assignee names in that HTML popup are escaped as well.
- AI supplementary live-task evidence supplies one merged `description`, not duplicate
  description/progress-summary entries. Official AI assessment inputs continue reading
  only the existing frozen snapshots. No current task text is injected into old snapshots.
- Snapshot creation/sync code is unchanged. New modal saves maintain the legacy mirror
  for those existing readers. No historical snapshots, answers, scores or stored AI summaries
  are rewritten. AI summaries are generated only through the existing requested workflow.
- All task readers audited use `select('*')`, including Monthly Review and AI source queries;
  no select-column additions or database changes are needed.

## Scope And Setup

No migration, new package or manual database/setup step is required. No production SQL
is applied. Tracking Progress slider/status behavior, recursive tracking calculation,
official AS weight, user-added weights/auto balance, scoring formulas, historical snapshots,
RLS and `MAINTENANCE_MODE` are unchanged.

Changed files:

- `utils/taskNotes.ts`
- `components/TaskModal.tsx`
- `app/page.tsx`
- `components/GanttChart.tsx`
- `components/monthly-reviews/MonthlyReviews.tsx`
- `utils/aiSummary.ts`
- `tests/user-added-progress.test.cjs`
- This document.

## Manual Checks

1. Open tasks with description only, legacy summary only, both distinct, and both identical.
   Confirm one notes textarea with all unique text. The slider and weights must not change.
2. Edit/save/reopen twice. Confirm `description` and the compatibility mirror agree and
   no repeated text appears. Clear notes and cancel confirmation; then confirm clearing.
3. Generate a parent summary twice and verify existing text remains, without duplicate
   generated content. Check readonly mode and creating a new task/child.
4. Check Task List, Gantt tooltip and Monthly Progress Review for both old and new records.
   HTML-looking notes must render as text, never execute.
5. Generate supplementary AI evidence and verify notes appear once. Existing official
   snapshot text, evaluation answers, weights, scores and historical AI inputs must remain
   unchanged.

Authenticated browser/database checks remain manual in this environment. Regression tests
exercise the actual modal, save callback/state, list, Gantt popup, monthly view and AI inputs.

Verification: all 77 tests passed with zero failures/skips, including four new note-specific
regression tests plus expanded list/Gantt/monthly/save-state coverage. TypeScript and
`npm run build` passed. Tests cover legacy-only/description-only/distinct/duplicate/multiline
Thai notes, repeat saves, editing/reopening, readonly state, clear confirmation, non-destructive
summary generation, HTML escaping and unchanged official snapshot text/scores/weights.
The existing non-blocking baseline-browser-mapping freshness warning remains; no dependency
was updated. Build-generated `next-env.d.ts` was restored to its original dev route-type import.
