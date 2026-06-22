# Auth, Per-User Projects & Provider Keys

This document describes how Synapse turns the single-user PRD workspace into a
multi-user product with authenticated, user-scoped projects and **encrypted,
user-owned AI provider credentials**.

> Status: this is a living document. The "Assessment" section is the audit that
> preceded the work; the sections below it describe the implemented design.

---

## 1. Assessment (starting point)

| Area | Before this change |
|---|---|
| **Auth** | Already existed: email+password (scrypt) and GitHub/LinkedIn OAuth, HMAC-signed `synapse_session` cookie, MongoDB Data API backend (`api/_lib/`). **But the client bypassed it** (`DEV_SKIP_AUTH = true` in `authStore.ts`). |
| **Database** | MongoDB Atlas via the official **Node driver** (`api/_lib/db.js` exposes a `runMongoAction()` shim; the previous Atlas **Data API** REST gateway was retired by MongoDB on 2025-09-30). Vercel Blob for snapshots. |
| **Projects** | 100% client-side — Zustand `persist` → `localStorage` key `synapse-projects-storage`. Not user-scoped. |
| **Gemini calls** | Browser-direct (`src/lib/geminiClient.ts`), key in `localStorage.GEMINI_API_KEY`. 60–90s mobile-hardened streaming client. |
| **OpenAI image calls** | Browser-direct (`src/lib/openaiClient.ts`), `gpt-image-2`, key in `localStorage.OPENAI_API_KEY`. |
| **Provider keys** | Stored in **localStorage** (plaintext, client-side). No encrypted/server storage. |
| **Settings** | `SettingsModal.tsx` manages keys + models in localStorage. |
| **Deploy** | Vercel (SPA + serverless `api/`). **Hobby 12-function cap; 9 used.** |

### Chosen approach (smallest safe path)

- **Auth:** *extend* the existing system, don't replace it. Enable real auth in
  the client (turn off the dev bypass in production).
- **Projects:** **namespace the localStorage store per user** so each account
  has its own isolated project set in the browser, with a one-time migration of
  any pre-existing anonymous projects to the first account that signs in. No
  destructive change; the working client architecture is preserved.
- **Provider keys:** a **new, isolated, encrypted-at-rest server vault** keyed
  by `userId` (AES-256-GCM, secret from env). This is the security headline.
- **Model routing:**
  - **OpenAI image generation is fully proxied server-side** — the decrypted
    key never reaches the browser.
  - **Gemini** keeps its client-side streaming path (proxying a 60–90s SSE
    pipeline through Vercel serverless risks `maxDuration` timeouts) but the key
    is **served to the authenticated client at call time and held in memory
    only** — never written to localStorage. This is a deliberate, documented
    tradeoff; see [Security considerations](#8-security-considerations).

---

## 2. User & project ownership model

**Auth** is the existing system (see `docs/auth.md`): email+password (scrypt) and
GitHub/LinkedIn OAuth, all issuing the HMAC-signed `synapse_session`
HttpOnly cookie. The client previously bypassed auth (`DEV_SKIP_AUTH`); that
bypass is now off by default and only available in local dev via
`VITE_DEV_SKIP_AUTH=true`. Production builds never bypass.

- **Client gate:** `RequireAuth`/`ProjectRoute` in `App.tsx` redirect
  unauthenticated users away from private routes. This is UX only.
- **Server gate:** every private API route calls `requireUser(req, res)`
  (`api/_lib/requireUser.js`), which resolves identity **only** from the
  verified session cookie — a client can never name another user.

**Projects** remain client-side (Zustand `persist` → localStorage), but the
storage key is **namespaced per user**:

- `src/store/userScope.ts` maps the active `userId` to a storage key
  (`synapse-projects-storage::u:<userId>`; anonymous/legacy data keeps the
  original key).
- `src/store/projectUserSync.ts` wipes in-memory state and rehydrates from the
  active user's namespace on every auth transition, so two accounts never share
  projects in one browser.
- **Migration (non-destructive):** the first account to sign in on a browser
  that has pre-existing anonymous projects *adopts* them (copy into its
  namespace; original left intact; marked "claimed" so a second account can't
  also inherit them).

> Note: per-user isolation here is per-browser. True cross-device project
> ownership would require moving the store to MongoDB — see Limitations.

## 3. API key encryption

Provider keys are stored encrypted at rest in the `provider_keys` MongoDB
collection — one document per `(userId, provider)`:

```
{ userId, provider: 'gemini'|'openai', ciphertext, last4, createdAt, updatedAt }
```

- **Cipher:** AES-256-GCM (`api/_lib/cryptoVault.js`). The 256-bit key is
  derived (scrypt) from `SYNAPSE_KEY_ENCRYPTION_SECRET`.
- **Per-record random IV**; ciphertext format `v1.<iv>.<tag>.<ct>` (base64url).
- **Owner binding:** AES-GCM AAD = `userId:provider`. A ciphertext copied to a
  different user/provider row fails authentication instead of decrypting — this
  is the cryptographic backstop for cross-user isolation.
- **Masking:** only a `last4` preview (e.g. `…cdef`) is stored separately, so
  status display never needs to decrypt. Plaintext keys are never logged,
  returned in status, or persisted outside the ciphertext.

## 4. Required environment variables

See `.env.example`. The new variable for this feature:

```bash
# 32+ random bytes (base64 or hex), e.g. `openssl rand -base64 48`. Derives the
# AES-256-GCM key that encrypts user provider API keys at rest. Rotating it
# invalidates all stored provider keys (users must re-enter them). Never commit
# a real value.
SYNAPSE_KEY_ENCRYPTION_SECRET=
```

`SESSION_SECRET` and `MONGODB_URI` (+ optional `MONGODB_DB_NAME`) are also
required (they already were, for auth — `MONGODB_URI` replaces the retired
`MONGODB_DATA_API_*` vars). Recommended index:
`db.provider_keys.createIndex({ userId: 1, provider: 1 }, { unique: true })`.

## 5. Gemini key setup

1. Get a key from <https://aistudio.google.com/app/apikey>.
2. In Synapse → **Settings → AI Providers**, paste it under **Google Gemini**.
   It is encrypted and stored server-side; you won't see it again (only `…last4`).
3. PRD generation runs **client-side** (a 60–90s streaming pipeline), so the key
   is fetched into memory at call time via
   `GET /api/provider-keys?material=gemini` (authenticated) and used directly.
   It is **never written to localStorage**. A local-browser key remains as an
   offline/dev fallback (see Settings → "Local browser keys").

Missing-key UX: *"Add a Gemini API key in Settings to generate PRDs."*

## 6. OpenAI key setup

1. Get a key from <https://platform.openai.com/api-keys>.
2. In **Settings → AI Providers**, paste it under **OpenAI**.
3. Image generation (gpt-image-2) is **fully proxied** through
   `POST /api/image/generate`: the key is decrypted server-side, used for the
   outbound call, and **never reaches the browser**.

Missing-key UX: *"Add an OpenAI API key in Settings to generate mockups."*

## 7. Demo / recruiter mode

The read-only **demo project** (`DEMO_PROJECT_ID`) is public — `ProjectRoute`
lets it through without authentication — so recruiters can explore Synapse with
no account and no paid keys. Generation affordances disable themselves with a
Settings callout when no key is configured. There is **no shared server key**,
so no path allows unbounded paid usage on someone else's dime.

Cost-safety UX: image generation shows the provider/model (gpt-image-2), an
explicit "paid OpenAI operation" note, and a confirmation dialog before the
expensive high-quality render.

## 8. Security considerations

- Keys are **encrypted at rest** and bound to their owner via AES-GCM AAD.
- The OpenAI key **never** leaves the server (image gen is proxied).
- Status responses never include key material — only `configured` + `…last4`.
- Every private route validates the session via `requireUser`; ownership is
  enforced by `(userId, provider)` filters the client can't influence.
- Logs and error responses are sanitized (status/code only, never key or body).
- Per-user rate limits on the paid image endpoint blunt session-abuse cost.
- **Known tradeoff:** the **Gemini** key is returned to the authenticated client
  at call time (in-memory only) because proxying its 60–90s SSE pipeline through
  Vercel serverless would hit `maxDuration` limits. This is strictly better than
  the previous state (plaintext in localStorage), but it is not as strong as the
  fully-proxied OpenAI path. Closing this gap (a streaming Gemini proxy on an
  Edge/streaming runtime) is future work.

## 9. Limitations / future billing plan

- Project data is per-browser (namespaced localStorage), not yet a server DB —
  no cross-device sync. Full server-side project ownership is the next step.
- Gemini is client-routed (see tradeoff above); a streaming proxy would make all
  model calls fully server-side.
- No billing/metering yet. Each user brings their own keys and pays their own
  provider costs. A future plan could add per-user usage metering and optional
  managed credits, but that is intentionally out of scope here.
