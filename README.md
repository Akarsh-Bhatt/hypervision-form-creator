# Hypervision Form Platform

An intelligent, cyber-sleek form builder and dynamic data intake system engineered for high-velocity teams. Hypervision Form provides a real-time visual schema builder, collaborative workspace management, instant public submission runners, automated response analytics, and strict administrative approval gating.

---

## Architecture Overview

```
                                      ┌─────────────────────────────────┐
                                      │        Client / Browser         │
                                      │  (Admin, Member, or Respondent) │
                                      └──────────────┬──────────────────┘
                                                     │
                             ┌───────────────────────┴───────────────────────┐
                             │ HTTPS / WebSocket                             │ HTTPS
                             ▼                                               ▼
              ┌─────────────────────────────┐                 ┌─────────────────────────────┐
              │     Next.js 15 Frontend     │                 │       FastAPI Backend       │
              │   (App Router, React 19)    │                 │       (Python 3.11+)        │
              │                             │                 │                             │
              │ • Edge Middleware Auth Gate │                 │ • Pydantic Schema Validator │
              │ • Dynamic Form Canvas       │                 │ • REST API Endpoints        │
              │ • Shared Team Dashboard     │                 │ • Health & Telemetry        │
              │ • Public Intake Runner      │                 │ • Admin Utilities           │
              │ • Realtime Analytics Viewer │                 └──────────────┬──────────────┘
              └──────────────┬──────────────┘                                │
                             │                                               │
                             └───────────────────────┬───────────────────────┘
                                                     │ PostgREST / GoTrue Auth / Service Role
                                                     ▼
                                      ┌─────────────────────────────────┐
                                      │      Supabase (PostgreSQL)      │
                                      │                                 │
                                      │ • Row-Level Security (RLS)      │
                                      │ • Atomic Submission RPCs        │
                                      │ • Auth & User Metadata          │
                                      │ • Triggers & Automated Counters │
                                      └─────────────────────────────────┘
```

---

## Key Features

* **Unified Shared Workspace:** All authorized members share a single common dashboard to view, configure, duplicate, deploy, and analyze all team forms.
* **Real-Time Visual Editor:** Drag-and-drop ordering, instant debounced auto-saving, configurable required rules, placeholders, and multiple input types (Short Text, Paragraph, Email, Multiple Choice, Checkboxes, Dropdown, Rating / Linear Scale, Date, and File Upload).
* **Controlled Access & Approval Gate:**
  * **Single Administrator:** Platform administration is strictly reserved for the designated owner (`Admin`, `admin@gmail.com`).
  * **Account Request Workflow:** Self-registration is staged as a pending request (`is_approved: false`). Unapproved users are blocked at the edge and shown an immediate `Admin approval pending.` notice.
  * **Admin Approvals Console:** Built-in dashboard modal for the administrator to review, approve, or reject account requests.
* **High-Throughput Public Runner (`/f/[slug]`):**
  * Stripped of internal creator IDs and administrative telemetry to prevent PII exposure.
  * Direct client-generated UUID submission pipeline with database RPC fallbacks to guarantee 100% submission reliability across RLS policies.
  * Response capacity limiters and dynamic form availability schedules.
* **Telemetry & Analytics (`/responses/[id]`):**
  * Real-time submission counter, completion time distributions, and tabular answer breakdowns.
* **Security Hardened:**
  * OWASP Top 10 mitigation across all routes.
  * Strict Row-Level Security (RLS) on `forms`, `form_questions`, `form_responses`, `form_answers`, and `profiles`.
  * HTTP Security Headers (Content-Security-Policy, X-Frame-Options `DENY`, X-Content-Type-Options `nosniff`, Referrer-Policy).
  * Safe callback validation preventing open redirects.

---

## Tech Stack & Dependencies

### Frontend (`/frontend`)
* **Framework:** Next.js 15.1 (App Router, Turbopack ready)
* **UI Library:** React 19, Tailwind CSS 3.4
* **Icons & Styling:** Lucide React, Google Material Symbols, Custom ASCII Rain Canvas
* **State & Data:** `@supabase/ssr`, `@supabase/supabase-js`, `clsx`, `tailwind-merge`

### Backend (`/backend`)
* **Framework:** FastAPI 0.115+, Uvicorn 0.30+
* **Validation & Settings:** Pydantic v2, Pydantic Settings
* **Database Client:** `supabase-py` 2.8+, `httpx`
* **Environment:** `python-dotenv`, `python-multipart`

### Database & Storage (`/supabase`)
* **Database:** PostgreSQL 15+ (Hosted via Supabase)
* **Auth:** Supabase Auth (GoTrue) with JWT metadata (`app_metadata.is_approved`, `role`)
* **Security:** Row Level Security (RLS) with custom definer helper functions (`is_authorized_workspace_user`)

---

## Project Structure

```
hypervision-form/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # FastAPI routers (health, forms, responses)
│   │   ├── core/            # Configuration, CORS, Supabase client
│   │   ├── schemas/         # Pydantic validation models
│   │   └── main.py          # Application entrypoint & middleware
│   ├── tests/               # Backend unit and integration tests
│   ├── requirements.txt     # Python package dependencies
│   └── .env.example         # Backend environment template
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/admin/   # Server route handlers for user approvals
│   │   │   ├── auth/        # OAuth & magic link callback handler
│   │   │   ├── dashboard/   # Shared team dashboard & metrics
│   │   │   ├── editor/      # Real-time visual form builder
│   │   │   ├── f/[slug]/    # Public respondent form intake runner
│   │   │   ├── responses/   # Response tables and analytics
│   │   │   ├── layout.tsx   # Global root layout & font definitions
│   │   │   └── page.tsx     # Landing & authentication portal
│   │   ├── components/      # UI components (AuthForm, Canvas, ASCII Rain)
│   │   ├── lib/             # Supabase browser/server client helpers
│   │   └── middleware.ts    # Edge route protection & approval verifier
│   ├── next.config.ts       # Security headers & Next.js config
│   ├── package.json         # Node dependencies and build scripts
│   └── .env.local           # Frontend environment configuration
│
└── supabase/
    └── migrations/          # Version-controlled SQL schemas and RLS policies
        ├── 20261102000001_initial_schema.sql
        ├── 20261105000002_security_hardening.sql
        ├── 20261105000003_admin_approval_gate.sql
        └── 20261105000004_shared_workspace_common_dashboard.sql
```

---

## Getting Started & Setup

### Prerequisites
* **Node.js:** `v18.18+` or `v20+`
* **Python:** `v3.11+`
* **Package Manager:** `npm` or `pnpm`
* **Supabase Project:** Active Supabase project with PostgreSQL database

---

### 1. Database Setup
Apply migrations in sequential order using the Supabase SQL Editor or Supabase CLI:

```bash
# Migrations reside in supabase/migrations/:
1. 20261102000001_initial_schema.sql
2. 20261105000002_security_hardening.sql
3. 20261105000003_admin_approval_gate.sql
4. 20261105000004_shared_workspace_common_dashboard.sql
```

---

### 2. Frontend Configuration & Launch

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create or update `frontend/.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ADMIN_EMAIL=admin-email-id
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### 3. Backend Configuration & Launch

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create and activate a Python virtual environment:
   ```bash
   # Windows
   python -m venv .venv
   .venv\Scripts\activate

   # macOS / Linux
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. Install requirements:
   ```bash
   pip install -r requirements.txt
   ```

4. Create `backend/.env` (using `.env.example` as a template):
   ```env
   PROJECT_NAME="Hypervision Form Platform API"
   ENVIRONMENT="development"
   SUPABASE_URL="https://your-project.supabase.co"
   SUPABASE_ANON_KEY="your-anon-key"
   SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
   CORS_ORIGINS=["http://localhost:3000", "http://localhost:3001"]
   ```

5. Start the FastAPI development server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   API interactive documentation will be available at [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs).

---

## Authentication & Access Control

| Role | Email / Criteria | Capabilities |
| :--- | :--- | :--- |
| **Platform Administrator** | `admin@gmail.com` | Full workspace access; Form creation, editing, publishing, deleting; Access to Admin Approvals modal to approve/reject account requests. |
| **Approved Team Member** | Approved by Admin (`is_approved: true`) | Full shared workspace access; Can view, create, edit, deploy, and delete any form and view responses. |
| **Pending Applicant** | Any new email self-registration | Blocked at login with `"Admin approval pending."`; Cannot access dashboard, editor, or responses until approved. |
| **Public Respondent** | Anonymous visitor via `/f/[slug]` | Can view active published forms and submit responses; Zero access to private admin workspace or other respondents' data. |

---

## Verification & Scripts

* **Type Safety:**
  ```bash
  cd frontend
  npx tsc --noEmit
  ```
* **Frontend Production Build:**
  ```bash
  cd frontend
  npm run build
  ```
* **Backend Health Check:**
  ```bash
  curl http://localhost:8000/health
  ```

