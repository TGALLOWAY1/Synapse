# Security Review — Synapse

**Date:** 2026-04-14
**Branch:** `claude/security-review-fixes-cHqqN`
**Scope:** Full-stack review of the Synapse web app (React SPA + Vercel
serverless functions + MongoDB Data API + Gemini-direct-from-browser).

## Executive summary

Synapse is a mostly-client-side app (all user artifacts live in
`localStorage`), but it has a thin server-side layer for authentication,
session management, activity logging, and an admin dashboard. The server
side is where almost all of the real risk lives.

Overall the codebase was in reasonable shape — scrypt-hashed passwords,
HttpOnly session cookies, server-signed HMAC tokens, markdown rendered
without `rehype-raw`, mockup HTML sanitized before being put into a
sandboxed iframe. That said, I found **two critical issues** (session
tokens with no effective expiration; unthrottled admin authentication)
and a cluster of **high-priority gaps** (no rate limiting on
authentication endpoints, weak activity-endpoint validation, missing
security headers, unvalidated OAuth-supplied URLs rendered as hrefs).
All of these have been fixed in this branch.

**Remaining residual risk** is primarily around things that need
infrastructure that this repo doesn't control (distributed rate
limiting, rotating the Tailwind CDN script to a self-hosted copy,
server-side session revocation) — these are documented in the "Manual
follow-up" section below.

---

## Findings

### Critical

#### C1. Session tokens were valid forever (no expiration check)
- **Where:** `api/_lib/session.js` → `verifySessionToken`.
- **Issue:** The HMAC signed an arbitrary JSON payload, and while
  `issueSessionForUser` stamped an `issuedAt` claim, the verifier never
  looked at it. The cookie had a 30-day `Max-Age`, but that only
  controls how long the **browser** keeps the cookie — a token captured
  out-of-band (e.g. from a compromised machine) was good for the
  lifetime of `SESSION_SECRET`.
- **Fix:** Reject any token where `Date.now() - issuedAt > 30 days` (or
  where `issuedAt` is in the future). `createSessionToken` now stamps
  `issuedAt` itself so the client can't forge a fresh one. HMAC
  comparison also switched to `crypto.timingSafeEqual`.
- **Tests:** `api/_lib/__tests__/session.test.js` covers expiration,
  tampering, wrong secret, and malformed inputs.

#### C2. Admin dashboard secret was brute-forceable and used non-constant-time compare
- **Where:** `api/admin/recruiters.js`.
- **Issue:** The endpoint compared the shared secret with `!==` and had
  no rate limiting. Combined with the fact that the only protection on
  the recruiter dump (which includes every registered user's email) was
  one HTTP header, a weak or misconfigured `ADMIN_DASHBOARD_KEY` could
  be brute-forced over the public internet.
- **Fix:**
  - `crypto.timingSafeEqual` for the header comparison.
  - Refuse to authenticate if `ADMIN_DASHBOARD_KEY` is unset or shorter
    than 24 characters (eliminates the "silent empty string accepts
    empty header" failure mode).
  - 20-req/min IP-scoped rate limit on the endpoint.

---

### High

#### H1. No rate limiting on auth endpoints
- **Where:** `api/auth/login.js`, `api/auth/signup.js`, `api/auth/*.js`
  (OAuth init), `api/activity.js`.
- **Issue:** Login allowed unlimited password guesses per IP, signup
  could flood the users table, and the activity endpoint accepted
  unlimited writes per session. The auth docs explicitly called this
  out as "future work".
- **Fix:** Added a lightweight in-memory rate limiter
  (`api/_lib/rateLimit.js`) and applied it to every sensitive endpoint:
  - `login`: 10/min per IP + 10/10min per (IP, email) pair
  - `signup`: 5/10min per IP
  - `activity`: 120/min per authenticated user
  - OAuth init routes: 20/min per IP
  - admin dashboard: 20/min per IP
- **Caveat:** Vercel serverless functions don't share memory across
  warm instances, so this limiter is best-effort. See "Manual
  follow-up" for a proper fix.

#### H2. Activity endpoint accepted arbitrary `type` and `metadata`
- **Where:** `api/activity.js`.
- **Issue:** Any authenticated user could push arbitrarily-typed events
  with arbitrarily-shaped metadata into the `recruiter_activity`
  collection. No type whitelist, no size cap, no shape check.
- **Fix:** Whitelist of allowed event types (`generated_artifact`,
  `viewed_mockups`, `clicked_section`, …); reject metadata that isn't
  a flat object with primitive values; cap 20 keys, 512 chars per
  string, 4 KiB serialized.

#### H3. Missing HTTP security headers
- **Where:** `vercel.json`.
- **Issue:** The deployed site served no CSP, HSTS, X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy, or Permissions-Policy.
- **Fix:** Added all of the above via the `headers` block in
  `vercel.json`. Key points:
  - `Content-Security-Policy` restricts scripts to self + the Vercel
    analytics bundle; `connect-src` to Gemini + Vercel; `frame-src` to
    `self blob:` (for the "Open in new tab" flow); `frame-ancestors
    'none'` to stop clickjacking; `object-src 'none'`.
  - `Strict-Transport-Security` with `max-age=31536000; includeSubDomains`.
  - `/api/*` gets additional `Cache-Control: no-store` and
    `Referrer-Policy: no-referrer`.

#### H4. OAuth-supplied URLs were persisted and rendered without protocol validation
- **Where:** `api/_lib/users.js` (upsertOAuthUser),
  `src/components/RecruiterAdminPage.tsx` (rendered as `<a href>`).
- **Issue:** `profileUrl` and `avatarUrl` came straight from an OAuth
  provider's profile response and were saved to Mongo + rendered as
  link hrefs with only a React runtime warning between `javascript:`
  and the DOM. Providers are generally trustworthy, but (a) React's
  `javascript:` blocking is not guaranteed for every shape and (b)
  defense in depth is cheap.
- **Fix:**
  - Server-side: added `sanitizeExternalUrl` and `sanitizeProviderString`
    in `api/_lib/users.js`. URLs are stored as `null` unless they parse
    as `http:` or `https:` and are under 2048 chars. Name/headline/company
    are control-stripped and length-capped at 512 chars.
  - Client-side: `RecruiterAdminPage` runs the URL through `safeHttpUrl`
    and renders a plain "No profile" span when the URL is rejected,
    rather than falling back to `href="#"`. Added `rel="noopener
    noreferrer"` (was `noreferrer` only) to the `<a target="_blank">`.

---

### Medium

#### M1. HMAC comparison was not constant-time
- Covered by the C1 fix — `crypto.timingSafeEqual` now used throughout.

#### M2. Cleared session cookie didn't carry `Secure`
- **Where:** `api/_lib/session.js` → `clearSessionCookie`.
- **Fix:** Emit `Secure` on the clear in production so intermediary
  proxies can't strip it. `SameSite=Lax` retained.

#### M3. External link lacked `noopener`
- **Where:** `src/components/RecruiterAdminPage.tsx`.
- **Issue:** `rel="noreferrer"` implies `noopener` in modern browsers
  but is easy to regress.
- **Fix:** Explicit `rel="noopener noreferrer"`.

---

### Low

#### L1. `rehype-raw` listed as a dependency but never imported
- **Observation:** The package is present in `package.json` but never
  used. It's harmless as long as it stays un-imported; someone adding
  `rehype-raw` later would reintroduce a large XSS surface because our
  rendered content includes LLM-generated markdown. Not removed to
  avoid touching lockfile discipline in this PR — noted as follow-up.

#### L2. Mockup iframe loads Tailwind from `https://cdn.tailwindcss.com`
- **Observation:** Mockup previews run inside an iframe with
  `sandbox="allow-scripts"` (no `allow-same-origin`) so the iframe is
  an opaque origin and can't touch Synapse state. The Tailwind CDN is
  still a third-party dependency — if it's compromised, malicious JS
  could execute in the sandboxed iframe. Because of the sandbox, the
  blast radius is contained. Noted as follow-up: self-host or pin via
  SRI.

#### L3. ErrorBoundary "Show technical details" reveals stack traces
- **Observation:** `GlobalErrorBoundary` lets end users toggle into a
  stack trace. Minor info leak; React stacks don't contain secrets.
  Left in place — the UX benefit for support outweighs the risk.

---

### Not an issue (verified)

- `npm audit` reports zero vulnerabilities across prod + dev deps.
- `react-markdown` is used without `rehype-raw`, so raw HTML in
  LLM-generated markdown is not rendered.
- Mockup HTML is sanitized (`sanitizeMockupHtmlForPreview` strips
  `<script>`, `<style>`, inline event handlers, `javascript:`/`data:`
  URLs) before being wrapped in a sandboxed iframe.
- The Gemini API key is user-supplied and stays in the user's own
  `localStorage` — never sent to Synapse's backend. Acceptable by
  design.
- No CORS headers are set; the API is same-origin on Vercel.
- `window.open` in `MockupViewer` already uses
  `'noopener,noreferrer'`.
- Password hashing uses Node's built-in `scrypt` with 16-byte random
  salt and `timingSafeEqual` compare — fine.

---

## What was fixed (files changed)

| File | Change |
|---|---|
| `api/_lib/session.js` | Enforce 30-day max session age; constant-time HMAC compare; `Secure` on cleared cookie; server-stamped `issuedAt`. |
| `api/_lib/rateLimit.js` | **New.** In-memory sliding-window rate limiter. |
| `api/_lib/users.js` | Added `sanitizeExternalUrl` + `sanitizeProviderString`; applied to every OAuth-profile write and email-signup name. |
| `api/_lib/__tests__/session.test.js` | **New.** Expiration, tampering, wrong-secret, malformed-input coverage. |
| `api/_lib/__tests__/rateLimit.test.js` | **New.** Limit boundary, window reset, scope isolation, 429 response. |
| `api/_lib/__tests__/users.test.js` | **New.** URL scheme rejection, control-char stripping, length caps. |
| `api/admin/recruiters.js` | Constant-time admin-key compare; reject short/unset keys; rate limit. |
| `api/auth/login.js` | IP + (IP, email) rate limits. |
| `api/auth/signup.js` | Per-IP signup rate limit. |
| `api/auth/github.js` | Per-IP OAuth init rate limit. |
| `api/auth/google.js` | Per-IP OAuth init rate limit. |
| `api/auth/linkedin.js` | Per-IP OAuth init rate limit. |
| `api/activity.js` | Allowlist of event types; size/shape cap on metadata; per-user rate limit. |
| `src/components/RecruiterAdminPage.tsx` | Client-side URL sanitization; explicit `noopener noreferrer`. |
| `vercel.json` | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, API no-store cache. |

**Test results:** `npm run test` → 9 files / 53 tests passing.
**Lint:** `npm run lint` clean.
**Build:** `npm run build` succeeds.

---

## Secrets/config to rotate or replace before deploying

- **`SESSION_SECRET`** — if this was ever committed or shared, rotate.
  Because tokens still verify against the current secret until they
  hit the new 30-day age cap, rotation is the only way to invalidate
  pre-existing sessions at once.
- **`ADMIN_DASHBOARD_KEY`** — must be ≥24 characters after this change
  or the endpoint will refuse authentication outright. If the current
  value is shorter, generate a new one with
  `openssl rand -base64 32`.
- **`MONGODB_DATA_API_KEY`** — unchanged, but confirm it's scoped to
  the `synapse` database only.
- **OAuth client secrets** — not touched in this review. Confirm
  redirect URIs on each provider match the deployed domain.

---

## Manual follow-up (recommended next steps for production hardening)

1. **Distributed rate limiting.** The in-memory limiter added here is
   best-effort; swap it for Upstash Ratelimit, Vercel KV, or a Redis
   store. The `enforceRateLimit`/`rateLimit` API was designed to allow
   a drop-in replacement.
2. **Server-side session revocation.** Tokens are signed JWT-style;
   there's no revocation list, so "logout" only clears the cookie on
   the current device. Consider (a) storing a session ID in the token
   and tracking active sessions in Mongo, or (b) shortening
   `MAX_SESSION_AGE_MS` in `session.js`. Password-change events should
   force session rotation via `SESSION_SECRET` rotation.
3. **Self-host or SRI-pin the Tailwind CDN** used in mockup iframes
   (`src/components/mockups/buildMockupSrcDoc.ts`).
4. **Drop the unused `rehype-raw` dep** (`package.json`) to avoid
   accidental future use.
5. **Email verification & password reset flow** — noted as TODO in
   `docs/auth.md`; neither is wired up today.
6. **Mongo unique indexes** — the auth docs describe the recommended
   indexes (`userId`, `(email, authProvider)`). Make sure those exist
   in production to prevent duplicate-account races at the DB level.
7. **`/admin/recruiters` projection still reads `linkedinId`.** The
   dashboard will under-report non-LinkedIn users until the projection
   is generalized to `userId`/`authProvider`. Not a security issue
   (the data is still correct), but it's inconsistent with the
   migration that's already happened.
8. **Add authenticated-user audit log** for admin accesses once you
   outgrow the single shared-key model. A real admin role on the user
   document is a better long-term fit than an environment variable
   secret.
9. **Consider stricter `SameSite=Strict`** on the session cookie for
   top-level navigations if you don't need third-party-initiated sign
   in flows to carry the cookie back on first navigation.
10. **Origin-header check** on state-changing POST endpoints
    (`/api/auth/login`, `/api/auth/signup`, `/api/auth/logout`,
    `/api/activity`) for defense-in-depth against CSRF on top of
    `SameSite=Lax`.

---

## Top risks at a glance

1. **Hard session expiration** now enforced server-side (was silently
   absent).
2. **Admin dashboard brute-forceable** — fixed with rate limit,
   constant-time compare, and a minimum key length.
3. **Unthrottled auth endpoints** — fixed with per-IP and per-user
   rate limits.
4. **Missing security headers** — fixed in `vercel.json`.
5. **Distributed rate limiting** remains a manual infra follow-up.
