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
                                                     │ HTTPS / WebSocket (PostgREST / GoTrue)
                                                     ▼
                                      ┌─────────────────────────────────┐
                                      │       Next.js 15 Frontend       │
                                      │     (App Router, React 19)      │
                                      │                                 │
                                      │ • Direct Supabase Client (RLS)  │
                                      │ • Dynamic Form Canvas           │
                                      │ • Shared Team Dashboard         │
                                      │ • Public Intake Runner          │
                                      │ • Realtime Analytics Viewer     │
                                      └──────────────┬──────────────────┘
                                                     │
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

   [Note: Direct client-to-Supabase architecture; the legacy FastAPI backend has been decommissioned.]
```

---

## Key Features

* **Instant Open Workspace:** Zero-friction access — opening the website directly loads the forms dashboard. No login, registration, or password entry required.
* **Real-Time Visual Editor:** Drag-and-drop ordering, instant debounced auto-saving, configurable required rules, placeholders, and multiple input types (Short Text, Paragraph, Email, Multiple Choice, Checkboxes, Dropdown, Rating / Linear Scale, Date, and File Upload).
* **Collaborative Form Management:** Anyone opening the workspace can immediately create new forms, customize existing schemas, toggle live deployments, and review telemetry.
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

### Database & Storage (`/supabase`)
* **Database:** PostgreSQL 15+ (Hosted via Supabase)
* **Auth:** Supabase Auth (GoTrue) with JWT metadata (`app_metadata.is_approved`, `role`)
* **Security:** Row Level Security (RLS) with custom definer helper functions (`submit_form_response_secure`, `get_public_form`)

---

## Project Structure

```
hypervision-form/
├── frontend/                              # Next.js 15 web application
│   ├── public/                            # Static assets
│   │   ├── favicon.ico                    # Hypervision tab favicon
│   │   └── hypervision-logo.png           # Neon circular brand logo
│   ├── src/
│   │   ├── app/
│   │   │   ├── auth/                      # OAuth & magic link callback handler
│   │   │   ├── dashboard/                 # Shared team dashboard & metrics
│   │   │   ├── editor/                    # Real-time visual form builder
│   │   │   ├── f/[slug]/                  # Public respondent form intake runner
│   │   │   ├── responses/                 # Response tables and analytics
│   │   │   ├── layout.tsx                 # Global root layout & font definitions
│   │   │   └── page.tsx                   # Central landing & dashboard portal
│   │   ├── components/                    # UI components (AsciiRainBackdrop, AuthForm)
│   │   ├── lib/                           # Supabase browser/server client helpers
│   │   └── middleware.ts                  # Edge HTTP middleware
│   ├── next.config.ts                     # Security headers & Next.js config
│   ├── package.json                       # Node dependencies and build scripts
│   └── .env.local                         # Frontend environment configuration
│
└── supabase/
    └── migrations/                        # Version-controlled SQL schemas and RLS policies
        ├── 20261102000001_initial_schema.sql
        └── 20261106000002_zero_backend_rls_audit.sql
```

---

## Getting Started & Setup

### Prerequisites
* **Node.js:** `v18.18+` or `v20+`
* **Package Manager:** `npm` or `pnpm`
* **Supabase Project:** Active Supabase project with PostgreSQL database

---

### 1. Database Setup
Apply migrations in sequential order using the Supabase SQL Editor or Supabase CLI:

```bash
# Migrations reside in supabase/migrations/:
1. 20261102000001_initial_schema.sql
2. 20261106000002_zero_backend_rls_audit.sql
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
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Workspace Access & Roles

| Role | Access | Capabilities |
| :--- | :--- | :--- |
| **Workspace Operator** | Direct Access (No login required) | Full dashboard and editor access; can create, edit, deploy, rename, duplicate, and delete forms and review response analytics. |
| **Public Respondent** | Direct via `/f/[slug]` | Can view active published forms and submit responses; zero access to internal configuration or other respondents' data. |

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

