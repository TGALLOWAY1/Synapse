# Deployment

Synapse is a fully static SPA. There are no server secrets, no managed
database, and no serverless functions. Users bring their own Gemini API
key, which is stored in their browser's `localStorage` via the in-app
Settings modal.

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

## Vercel

Deployment is a straight static upload. The entire configuration lives in
`vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

The single SPA rewrite makes React Router's client-side routes (`/about`,
`/p/:projectId`) work on direct navigation and page refresh.

### Environment variables

None. The Gemini API key is supplied by the user in-app and never leaves
the browser. If you fork this repo and want to hardcode a build-time key,
add it to `src/lib/geminiClient.ts` — but be aware the key would then be
embedded in the shipped JS bundle.

## Self-hosting

Any static host works. After `npm run build`, upload the contents of
`dist/` to your host of choice. Configure it to fall back to
`index.html` for unknown paths so the SPA router keeps working.
