# Adorable Windows build worker (public repository scaffold)

On-demand native Windows builds for Adorable, running on standard
`windows-latest` GitHub-hosted runners. The user's PC is never involved.

## What lives here

- `.github/workflows/adorable-windows-build.yml` — the only workflow.
  Pinned to `runs-on: windows-latest` (free minutes on public repos).
- `scripts/` — reviewed worker mechanics (fetch → validate → build →
  smoke → upload → report → clean). No secrets, no user source.

## What NEVER lives here

- API keys, tokens, R2 credentials, callback secrets (Actions secrets only)
- Generated project source (arrives per-run via R2, hash-verified, deleted)
- Provider credentials, Supabase keys, user data

## Setup (operator, one time)

1. Create a **public** GitHub repository (e.g. `adorable-build-worker`)
   and copy this directory's contents into it.
2. In the worker repo → Settings → Secrets and variables → Actions,
   add repository secrets:
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
   - `ADORABLE_CALLBACK_SECRET` (shared secret, also set on Render)
3. On Render (backend), set environment:
   - `ADORABLE_WORKER=remote-github`
   - `GH_WORKER_REPO=<owner>/<repo>`, `GH_WORKER_WORKFLOW=adorable-windows-build.yml`
   - `GH_WORKER_REF=<pinned-commit-sha>`
   - `GH_WORKER_PAT=<fine-grained PAT with Actions:write on the worker repo>`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ADORABLE_CALLBACK_SECRET` (same value as the Actions secret)
   - `ADORABLE_PUBLIC_URL=https://<your-render-service>.onrender.com`
     (or rely on `RENDER_EXTERNAL_URL`)
   - `SUPABASE_ANON_KEY` (Auth verification)
4. Apply `../supabase/migrations/001_projects.sql` in Supabase once.
5. Verify: `bun run provider:health`-equivalent for builds is
   `POST /api/projects` → `POST build` → `GET job` → callback completes.

## Script pinning

- `scripts/r2.ts` is a reviewed copy of the backend signer
  (`builder/src/cloud/signer.ts`). Change the backend first, then copy.
- `scripts/capture-window.ps1` is a copy of
  (`builder/src/preview/scripts/capture-window.ps1`).
- Record backend commit hashes here when syncing:
  - r2.ts synced from backend commit: (fill in on first sync)
  - capture-window.ps1 synced from backend commit: (fill in on first sync)

## Free-tier guardrails

- Workflow hardcodes `runs-on: windows-latest`; there is no input or
  matrix that could select larger runners.
- R2 usage is standard PUT/GET only (no tiers/versioning configured).
- The workflow `timeout-minutes: 45` bounds stuck runs.
- Concurrency groups per job id; cancel-in-progress is false so a
  dispatched build always reports instead of vanishing.
