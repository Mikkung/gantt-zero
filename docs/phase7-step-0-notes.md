# Phase 7 Step 0 Notes

## Purpose

This document summarizes the confirmed pre-RLS findings before implementing Phase 7 Security Hardening + Supabase Row Level Security.

This file is used as context for Codex before Phase 7A RLS Audit.

Important:

- Do not enable additional RLS yet.
- Do not create RLS migration yet.
- Do not change MAINTENANCE_MODE.
- Do not change task identity logic.
- Do not create assignee_id.
- The tasks table uses `assignee`, not `assignee_id`.

---

## Current Project Context

This project is an internal Task Tracking and Staff Performance Assessment web app.

Tech stack:

- Next.js
- React
- TypeScript
- Tailwind CSS
- Supabase Postgres
- Supabase Auth

Current implemented modules:

- Task Tracking
- Task weight
- Assessment periods
- Employee self-evaluation
- Manager evaluation
- Admin return / resubmit workflow
- Manager assignment
- Peer review import
- Peer review CSV template download
- Peer review insight display
- Typhoon AI progress summary
- Export summary / admin reporting

---

## Maintenance Mode

Current setting:

```text
MAINTENANCE_MODE=false