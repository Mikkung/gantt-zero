# System Architecture

This document describes the technical architecture of the Task Tracking and Staff Performance Assessment app.

## High-Level Architecture

```mermaid
flowchart TD
  Admin[Admin] --> NextApp[Next.js App]
  Employee[Employee / User] --> NextApp
  Manager[Manager] --> NextApp

  NextApp --> AdminPanel[Admin Panel]
  NextApp --> EmployeePage[Employee Assessment Page]
  NextApp --> ManagerWorkspace[Manager Evaluation Workspace]
  NextApp --> TaskTracker[Task Tracking Page]

  AdminPanel --> SupabaseAuth[Supabase Auth]
  EmployeePage --> SupabaseAuth
  ManagerWorkspace --> SupabaseAuth
  TaskTracker --> SupabaseAuth

  AdminPanel --> Postgres[(Supabase Postgres)]
  EmployeePage --> Postgres
  ManagerWorkspace --> Postgres
  TaskTracker --> Postgres

  Postgres --> RLS[Supabase RLS]

  ManagerWorkspace --> AISummaryAPI[Next API: /api/assessment/ai-summary]
  AISummaryAPI --> Typhoon[Typhoon API]
  AISummaryAPI --> Postgres

  CSV[Excel / SharePoint CSV] --> PeerImport[Peer Review Import Page]
  PeerImport --> Postgres
```

## Evaluation Workflow

```mermaid
flowchart LR
  A[Admin setup assessment period] --> B[Prepare tasks and weights]
  B --> C[Sync assessment task snapshots]
  C --> D[Assign managers]
  D --> E[Employee self-evaluation]
  E --> F[Admin imports peer review CSV]
  F --> G[Generate AI summary]
  G --> H[Manager evaluation]
  H --> I[Admin oversight / return if needed]
  I --> J[Export summary CSV]
```

## Data Flow

```mermaid
flowchart TD
  Tasks[tasks] --> Snapshots[assessment_task_snapshots]
  Snapshots --> SelfEval[task_self_evaluations]
  Criteria[attribute_criteria] --> AttrSelf[attribute_self_evaluations]
  SelfEval --> SelfSub[self_evaluation_submissions]
  AttrSelf --> SelfSub

  CSV[Peer Review CSV] --> Imports[peer_review_imports]
  Imports --> Results[peer_review_results]
  Results --> PeerSummaries[peer_review_summaries]

  Snapshots --> ManagerTask[task_manager_evaluations]
  AttrSelf --> ManagerAttr[attribute_manager_evaluations]
  ManagerTask --> ManagerSub[manager_evaluation_submissions]
  ManagerAttr --> ManagerSub

  Snapshots --> AIPrompt[AI prompt source]
  SelfEval --> AIPrompt
  AIPrompt --> Typhoon[Typhoon API]
  Typhoon --> AISummaries[assessment_ai_summaries]

  SelfSub --> Export[Export Summary]
  ManagerSub --> Export
  PeerSummaries --> Export
  AISummaries --> Export
  Snapshots --> Export
```

## Role Access

```mermaid
flowchart TD
  Admin[Admin] --> AdminAll[Full application data access]
  Manager[Manager] --> TeamContext[Same-team profiles and tasks]
  Manager --> AssignedData[Assigned employee assessment data]
  User[User / Employee] --> OwnTasks[Own tasks]
  User --> OwnSelf[Own self-evaluation data]

  AdminAll --> Tables[(All app tables)]
  TeamContext --> ProfilesTasks[(profiles, tasks)]
  AssignedData --> Assessment[(self eval, manager eval, peer summaries, AI summaries)]
  OwnTasks --> Tasks[(tasks)]
  OwnSelf --> OwnTables[(snapshots, self eval, self submissions)]
```

## Runtime Components

| Layer | Implementation | Notes |
| --- | --- | --- |
| Frontend | Next.js App Router under `app/` | Most pages are client components using Supabase browser client |
| Shared UI | `components/` | App shell, task modal, Gantt chart, peer insight panel |
| Data client | `utils/supabase.ts` | Uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Business logic | `utils/scoring.ts`, `utils/taskProgress.ts`, `utils/evaluationTasks.ts` | Scoring and task hierarchy helpers |
| Import logic | `utils/peerReview.ts` | CSV template, parser, validation, summary builder |
| AI logic | `utils/aiSummary.ts`, `app/api/assessment/ai-summary/route.ts` | Prompt building and server-only Typhoon call |
| Database | Supabase Postgres | Migrations in `supabase/migrations/` |
| Security | Supabase Auth and RLS | Phase 7B migration is draft until manually applied |

## Important Architectural Decisions

- `profiles.id = auth.uid()`.
- `employee_id = profiles.display_name`.
- `tasks.assignee = profiles.display_name`.
- Roles are `admin`, `manager`, `user`.
- `user` means employee/staff.
- No `team_members` table is currently used; team context uses `profiles.team_id`.
- Manager task/profile context is team-based.
- Manager evaluation authority is assignment-based through `manager_evaluation_assignments`.
- AI summary is stored and displayed as reference context only.

