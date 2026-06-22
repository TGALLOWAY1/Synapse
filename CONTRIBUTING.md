# Contributing to Synapse

Synapse is two products sharing one Vite build (see `CLAUDE.md` for the full
architecture):

1. **PRD workspace** — the main product. A 100% client-side React SPA. All
   state lives in `localStorage`; it calls the Google Gemini API directly from
   the browser and never touches the `api/` backend.
2. **Recruiter portal** — a separate sub-product backed by Vercel serverless
   functions (`api/`), MongoDB, and OAuth.

You can develop the PRD workspace with **no backend and no `.env` file**.

## Prerequisites

- Node.js 20+ and npm.
- A Google Gemini API key (free from [Google AI Studio](https://aistudio.google.com/app/apikey))
  to actually generate PRDs. You can browse the app and the interactive tour
  (`/tour`) without one.

## Getting started (PRD workspace)

```bash
npm install
npm run dev          # Vite dev server at http://localhost:5173
```

Open the app, click the **Settings** gear, and paste your Gemini API key. It is
stored in `localStorage` (key `GEMINI_API_KEY`) and sent directly to Gemini —
it never reaches any Synapse server.

Optional client-side settings, also `localStorage` keys (set via Settings or
the browser console), let you tune model routing without code changes:

- `GEMINI_MODEL` — default model (defaults to `gemini-3.5-flash`).
- `GEMINI_FAST_MODEL` / `GEMINI_STRONG_MODEL` — per-tier overrides for the DAG
  pipeline (low-risk sections use fast, high-risk use strong).
- `GEMINI_PROJECT_ID` — a GCP project id, forwarded as `x-goog-user-project`
  for billing/quota.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build (type-check is part of the build)
npm run lint         # ESLint (flat config, TS/TSX)
npm run preview      # preview the production build
npm test             # vitest run (one-shot)
npx vitest <file>    # run a single test file in watch mode
npx tsc --noEmit     # type-check without emitting
```

Other scripts: `npm run mockup:harness` (mockup-generation evaluation harness),
`npm run mockup-css:build` (compile Tailwind CSS for mockup iframes), and
`npm run capture:screenshots` (regenerate the README tour screenshots via
Playwright).

## Before opening a PR

- `npm run build` (this runs the TypeScript check) **and** `npm test` must pass.
- `npm run lint` must be clean.
- **Keep docs in sync in the same change.** Per `CLAUDE.md`, update `CLAUDE.md`
  when you change architecture, state, the LLM pipeline, or a cross-cutting
  pattern, and update `README.md` when you change a user-visible feature or
  workflow. Treat doc drift as a defect in the change.
- Tests live in `src/lib/__tests__/`, `src/store/__tests__/`,
  `src/components/**/__tests__/`, and `api/_lib/__tests__/`. Add coverage for
  new pure logic and store actions.

## Recruiter portal (backend) setup

Only needed if you are working on `api/` or the `/admin/recruiters` portal.

1. Copy `.env.example` to `.env` and fill in the values you need.
2. **Sessions:** set `SESSION_SECRET` to a random string (≥ 32 chars).
3. **Database:** create a MongoDB Atlas cluster and set `MONGODB_URI` to its
   driver connection string (plus optional `MONGODB_DB_NAME`). The retired Atlas
   Data API is no longer used — the backend connects with the official driver.
4. **OAuth:** configure any providers you want (GitHub / LinkedIn) by
   setting their client id/secret. Omit a provider to disable it.
5. **Snapshots:** set `SYNAPSE_OWNER_TOKEN` (≥ 24 chars) for owner-only cloud
   snapshots; `BLOB_READ_WRITE_TOKEN` is auto-provisioned by Vercel Blob in
   production.

The backend runs as Vercel serverless functions; use the Vercel CLI
(`vercel dev`) to run them locally. See `docs/auth.md` and `docs/deployment.md`
for the authentication model and deployment details.
