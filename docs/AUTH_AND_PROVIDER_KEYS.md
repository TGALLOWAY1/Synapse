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
| **Auth** | Already existed: email+password (scrypt) and Google/GitHub/LinkedIn OAuth, HMAC-signed `synapse_session` cookie, MongoDB Data API backend (`api/_lib/`). **But the client bypassed it** (`DEV_SKIP_AUTH = true` in `authStore.ts`). |
| **Database** | MongoDB Atlas **Data API** (REST, no ORM) via `runMongoAction()`. Vercel Blob for snapshots. |
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

*(documented as the implementation lands)*

## 3. API key encryption

*(documented as the implementation lands)*

## 4. Required environment variables

See `.env.example`. The new variable for this feature:

```bash
# 32+ random bytes (base64 or hex). Used to derive the AES-256-GCM key that
# encrypts user provider API keys at rest. Rotating this invalidates all stored
# provider keys (users must re-enter them). NEVER commit a real value.
SYNAPSE_KEY_ENCRYPTION_SECRET=
```

## 5. Gemini key setup

*(documented as the implementation lands)*

## 6. OpenAI key setup

*(documented as the implementation lands)*

## 7. Demo / recruiter mode

*(documented as the implementation lands)*

## 8. Security considerations

*(documented as the implementation lands)*

## 9. Limitations / future billing plan

*(documented as the implementation lands)*
