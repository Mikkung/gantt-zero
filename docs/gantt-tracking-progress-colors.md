# Gantt Tracking Progress Colors

Updated 2026-10-21. Gantt bar completion and color now share the same visual value:
`task.calculated_progress ?? task.progress ?? 0` (finite and clamped to 0-100).

- 0: gray.
- Above 0 and below 100: yellow.
- 100: green.
- Blocked / In Problem Need Help: red override, including computed parents.

`utils/ganttProgress.ts` supplies the display value, class, computed-progress flag
and legend labels. `app/globals.css` shares each color between the legend and SVG
using CSS variables. Remaining bar tracks stay gray; blocked tracks use light red.
Scoped selectors preserve these colors on hover/selection over Frappe defaults.

Changing task data rebuilds the existing Gantt effect through its task map/tree
dependencies; the new classes are recalculated even when task IDs/statuses do not
change. No browser refresh is needed after task data is reloaded.

Computed-progress handles are hidden and cannot receive pointer input. The save
callback also checks the original task's calculated value (including zero) and
refuses computed-progress writes even if an event is triggered programmatically.
Recorded/leaf progress editing and date resizing retain their existing behavior.

Task status and stored progress are not changed by color classification. Recursive
tracking formulas, official weights, assessment scoring/exports, auto-balancing,
RLS/permissions and MAINTENANCE_MODE are unchanged. No database migration/setup is
required. Deploy/restart, reload task data, and expand AS parents to inspect them.

## Verification

Verified 2026-10-21: all 37 automated checks passed without skips; `npm run build`
and `git diff --check` passed. The local app returned HTTP 200 at localhost:3000.
The Gantt component test uses a Frappe constructor stub to check the actual mapped
rows, effect-driven rebuilds, legend and database callbacks. CSS checks cover shared
colors and computed-handle hiding. No live Supabase task data was modified.

With the temporary PostgreSQL test engine configured as described in
`docs/monthly-progress-review.md`, run:

```powershell
node --test tests/user-added-progress.test.cjs tests/user-added-auto-weight.test.cjs tests/monthly-reviews.test.cjs
npm run build
```
