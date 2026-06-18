# Deployment

The Synapse product workspace is a fully client-side SPA: users bring their
own Gemini API key, stored in their browser's `localStorage` (or the encrypted
provider-key vault) via the in-app Settings modal. The public product tour at
`/tour` needs no key at all — it runs on local demo data. A separate
recruiter-portal sub-product adds Vercel serverless functions under `api/`
(MongoDB-backed); those are Vercel-specific and unrelated to the tour.

## Local development

```bash
npm install
npm run dev
```

The Vite dev server boots on `http://localhost:5173`. Open it, click the
Settings gear in the top right, paste a Gemini API key from
[Google AI Studio](https://aistudio.google.com/apikey), and you're done.
Projects and keys persist across reloads via `localStorage`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | `tsc -b && vite build` — typechecks the whole project, then emits the production bundle to `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run lint` | ESLint (flat config, TS / TSX only) |
| `npm run test` | Vitest suite (jsdom environment) |
| `npx tsc --noEmit` | Typecheck without emitting |

## Vercel (recommended)

Deployment configuration lives in `vercel.json`. The recruiter-portal backend
runs as serverless functions under `api/`, so the SPA rewrite uses a
negative-lookahead to leave `/api/*` server-side and send everything else to
`index.html`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

That rewrite makes React Router's client-side routes — including the public,
unauthenticated product tour at `/tour` (aliased `/about`), plus
`/p/:projectId` and `/privacy` — resolve on direct navigation and page refresh
instead of 404ing.

## Static SPA routing on other hosts

The product tour is a fully client-side, demo-data-only route, so it can be
served from any static host as a portfolio link. Every host just needs an
SPA fallback to `index.html`:

- **Netlify** — `public/_redirects` (shipped in the repo) is copied into
  `dist/` on build and provides `/*  /index.html  200`.
- **GitHub Pages** — has no rewrite engine; after `npm run build`, copy
  `dist/index.html` to `dist/404.html` so unknown paths still load the SPA. If
  you serve from a project subpath (`https://<user>.github.io/<repo>/`), set
  Vite's `base` to `/<repo>/` as well.

Note the `api/` serverless functions are Vercel-specific — Netlify and GitHub
Pages serve the static front end (including the tour) only.

### Environment variables

None. The Gemini API key is supplied by the user in-app and never leaves
the browser. If you fork this repo and want to hardcode a build-time key,
add it to `src/lib/geminiClient.ts` — but be aware the key would then be
embedded in the shipped JS bundle.

## Self-hosting

Any static host works. After `npm run build`, upload the contents of
`dist/` to your host of choice. Configure it to fall back to
`index.html` for unknown paths so the SPA router keeps working.
