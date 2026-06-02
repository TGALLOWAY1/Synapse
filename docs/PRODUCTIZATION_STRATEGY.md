# Synapse Productization Strategy

_From localStorage prototype to production SaaS._

This document is grounded in how Synapse is **actually built today**, not a
generic SaaS template. Before recommending anything, here is the reality of the
current codebase, because it changes several answers:

| Area | Current state | Implication |
| --- | --- | --- |
| PRD workspace identity | **Anonymous, 100% localStorage** (Zustand `persist`) | No accounts, no server-side data, no way to bill or analyze per-user yet |
| LLM calls | Gemini called **directly from the browser**; key in `localStorage` (`geminiClient.ts`) | Today the **user** pays for inference (their key). This is BYOK by accident, and it is your biggest asset for cost control |
| Models implemented | Gemini text (Flash + Pro variants); OpenAI **image only**. Claude/GPT-text are **not** wired up | The "multiple models" framing is aspirational. Don't build cost strategy around models you haven't shipped |
| Backend that exists | Recruiter portal only: Vercel serverless, **MongoDB Data API**, OAuth (Google/GitHub/LinkedIn) + email/password, **HMAC-JWT sessions in HttpOnly cookies** (`api/_lib/`) | You already own a working, secure auth + session + DB pattern. Reuse it — don't adopt a second stack |
| Analytics / monitoring | `@vercel/analytics` only. No Stripe, PostHog, Sentry, flags | Greenfield on instrumentation — pick one tool that does many jobs |

**The single most important architectural fact:** the moment _you_ fund any
premium inference, you can no longer call the model from the browser — the key
would be shipped to every visitor. Funded inference **requires a server-side
proxy**. BYOK can stay client-side. This split runs through every section below.

---

## 1. Authentication & User Accounts

### Per-option analysis

| Method | Adoption impact | Security | Dev complexity | Maintenance |
| --- | --- | --- | --- | --- |
| **Email + password** | Universal, but adds friction (password creation, reset flows) and lowers conversion ~10–20% vs social | You own credential storage, hashing, breach exposure, reset-token security | Medium — you already have `api/_lib/password.js`, but resets/verification add surface | High — password resets, breach monitoring, support tickets |
| **Google OAuth** | Highest single-button conversion for this audience (PMs, founders, devs all have Google) | Strong — Google owns MFA/breach detection; you store no password | Low — already implemented in `api/_lib/google.js` | Low — token refresh, occasional consent-screen review |
| **GitHub OAuth** | High for the developer slice; signals "this is a builder tool" | Strong, same as above | Low — already in `api/_lib/github.js` | Low |
| **Microsoft OAuth** | Matters only for enterprise/EDU later; near-zero for indie launch | Strong | Low-medium — new provider glue | Low, but adds an app registration to keep alive |
| **Magic links** | Very low friction, no password — but email deliverability and the "go check your inbox" context-switch cost conversions on mobile | Good (no stored secret) but link interception / forwarded-link risk; needs short TTL + single use | Medium — email infra (Resend/Postmark), token store, rate limiting | Medium — deliverability is an ongoing chore |
| **Passkeys** | Best-in-class _returning_-user experience; still unfamiliar as a _primary_ signup for many | Strongest (phishing-resistant, no shared secret) | High — WebAuthn ceremony, cross-device sync edge cases, fallback paths | Medium — recovery flows are the hard part |

### Recommendation

**Launch with: Google OAuth + GitHub OAuth + email magic link.**

- Google covers the broad audience; GitHub both converts the developer slice and
  brands Synapse as a builder tool. You **already have both implemented** in
  `api/_lib/` — promoting them from the recruiter portal to the main product is
  days, not weeks.
- Magic link (not password) as the email fallback for people who won't use
  social. This avoids standing up password reset/verification surface entirely.
  Skip email+password at launch — it is the worst ratio of friction + liability
  to value.

**Add later:** Passkeys (as a returning-user upgrade once you have a retained
base — pitch it as "faster + more secure sign-in," never as the only option),
then Microsoft OAuth **only** when you have a concrete enterprise pipeline.

**Implementation technology — two viable paths:**

1. **Extend what you own (lowest new-vendor risk).** You already have OAuth
   callbacks, HMAC-JWT sessions, HttpOnly cookies, and MongoDB users in
   `api/_lib/`. Generalize that into a shared `api/auth/*` used by both the
   recruiter portal and the workspace. Add magic links via **Resend** (email)
   + a short-TTL single-use token collection. **Pro:** no new vendor, no new
   bill, full control. **Con:** you maintain passkeys/recovery yourself later.
2. **Adopt a managed auth provider (lowest maintenance).** **Clerk** is the
   best fit for a Vite SPA on Vercel: drop-in React components, Google/GitHub
   out of the box, **passkeys and magic links built in**, generous free tier,
   organizations for future team plans. **WorkOS** if enterprise SSO becomes a
   near-term need; **Supabase Auth** if you also want Supabase Postgres as your
   app DB (see §6).

> **My pick:** Clerk for launch. The 1–2 weeks you save on magic-link infra,
> passkey ceremonies, and account recovery is worth more than avoiding its bill
> at this stage, and it removes a whole category of security maintenance. Keep
> the existing `api/_lib` auth for the recruiter portal; don't rewrite it.

---

## 2. AI Cost Strategy

Your constraint — _"do not absorb premium inference at scale without a
compelling reason"_ — combined with the fact that Synapse **already runs on the
user's own key**, points clearly to one answer. Analysis first.

| | **A. All-inclusive subscription** | **B. Pure BYOK** | **C. Hybrid (free basic + BYOK/credits for premium)** | **D. Credits** |
| --- | --- | --- | --- | --- |
| Conversion | Highest _intent_ but a hard paywall before value | Low signup friction, but BYOK setup is a real activation cliff (~30–50% drop) | **Best blend** — try free instantly, pay only when you hit the ceiling | Good — "free credits" is a proven hook |
| User friction | Low after paying | High up front (get a key, paste it) | Low at entry, rises only for power users | Medium — users must reason about credit math |
| Profitability | You eat token cost + must price above it; margin risk on heavy users | **You eat ~zero inference** | **You eat only cheap-tier inference;** premium is on the user | High margin, but you carry premium cost between top-ups |
| Support burden | "Why is it slow/refusing?" is on you | High — users' own key/quota/billing errors land in _your_ inbox | Medium — split, but clearer | Medium — billing disputes, "where did my credits go" |
| Scalability | Cost scales linearly with usage — dangerous | Scales for free | **Scales cheaply** | Scales, but you pre-purchase capacity |
| Competitive position | Premium/managed feel | "Cheap but DIY" | "Free to start, yours to scale" — strongest | Familiar, slightly gamified |

### Recommendation: **Hybrid (C), structured as a freemium funnel.**

Launch with three tiers:

- **Free — funded by you, capped, cheap model only.** Gemini **Flash** behind a
  server proxy (your key), hard rate-limited (e.g. N PRD generations/day,
  M artifact bundles/day). Flash is cheap enough that a generous-but-capped free
  tier is a marketing cost, not an inference business. This is what makes
  activation instant — **no key, no card, working product in 30 seconds.**
- **Pro — flat subscription ($X/mo), still funded by you, higher caps + Pro
  model.** Gemini **Pro** for the high-risk sections, higher rate limits,
  priority. Price the subscription to comfortably cover a typical Pro user's
  Flash+Pro spend with margin; protect the tail with per-account monthly token
  ceilings (soft-degrade to Flash, don't hard-cut).
- **BYOK — free or cheap add-on, unlimited, user-funded.** Power users and the
  cost-sensitive paste their **own** key and get uncapped access to any model
  (and, as you wire them up, Claude/GPT). This is your pressure-release valve:
  it neutralizes "the free tier is too small" churn **without** putting their
  usage on your bill.

This directly satisfies every optimization target: low compute cost (you only
fund Flash + bounded Pro), high conversion (free is real and instant), scalable
(heavy users self-fund via BYOK), and competitively strong ("free to start,
yours to scale").

> Avoid pure credits (D) at launch — credit accounting, top-up billing, and
> "where did my credits go" support are real overhead, and they add purchase
> friction at exactly the wrong moment. You can introduce **credit packs as an
> à-la-carte top-up _on top of_ Pro** later, once you have usage data to price
> them. Avoid pure-A: it puts an unbounded inference liability on your P&L.

---

## 3. User-Owned Model Access (BYOK UX)

You are unusually well-positioned here: BYOK **already works** (the app reads a
Gemini key from `localStorage`). The job is to productize it, not invent it.

**Where keys live.** A dedicated **Settings → Model & Keys** page, plus an
inline "Use your own key for unlimited access" nudge at the moment a free user
hits a rate limit (contextual conversion beats a buried settings page).

**Security & encryption — the critical decision:**

- **BYOK keys should stay client-side, encrypted at rest in the browser**, and
  go **directly** to the provider — never through your server. This is a
  feature, not a limitation: "your key never touches our servers" is a strong
  trust message and removes you from the breach blast radius entirely. The
  current direct-to-Gemini path already does this; formalize it.
- Encrypt the stored key (Web Crypto `SubtleCrypto`, AES-GCM with a
  device-derived key) rather than plain `localStorage`, and **never log keys, never put them in analytics events, never include them in error reports** (Sentry scrubbing — see §6).
- **Funded (your-key) traffic is the opposite:** it must go through a
  server proxy, and **your** keys live in Vercel env vars / a secrets manager,
  never shipped to the client. Keep these two paths cleanly separated in code.

**Validation workflow.** On paste, fire a cheap, throwaway validation call
(e.g. a 1-token completion or a `models.list`) and show inline state:
`✓ Valid · Gemini · billing project detected` vs a specific error. Validate
**before** saving, and re-validate lazily on first use each session.

**Supported providers (in rollout order).** Gemini (live) → OpenAI text (you
already have the image client; text is a small extension) → Anthropic Claude →
optional OpenRouter as a single key for "everything else." One row per provider,
each with its own key field, validation badge, and model dropdown.

**Key rotation.** Let users replace a key in place (re-validate on save) and
"Remove key." Detect `401/403` at call time and surface a non-destructive
"Your <provider> key looks invalid or expired — update it?" banner instead of a
generic failure.

**Error handling.** Map provider errors to plain language at the proxy/client
boundary: quota exceeded → "You've hit your Gemini quota — try again later or
upgrade your Google billing"; bad key → rotation prompt; safety refusal →
route to your existing safety-gate UX. Never surface a raw provider JSON error.

**Usage monitoring & cost transparency.** For BYOK you can't see their bill, but
you _can_ show **estimated** usage from your own token accounting:
"This generation used ~42k tokens (~$0.02 at Gemini Flash pricing)." A small
**Usage** panel — generations this month, est. tokens, est. cost by model —
turns an opaque cost into a controlled one and is a top requested BYOK feature.

**Mockup concept (Settings → Model & Keys):**

```
┌─ Model & Keys ──────────────────────────────────────────────┐
│ Plan: Free  ·  12/15 daily generations used   [Upgrade ▸]   │
│                                                              │
│  Bring your own key — unlimited, billed to you, never        │
│  stored on our servers.                                      │
│                                                              │
│  ● Google Gemini      [ •••••••••••••••• ]  ✓ Valid          │
│      Default model:   [ Gemini Flash      ▾ ]                │
│  ○ OpenAI             [ Add key            ]                  │
│  ○ Anthropic Claude   [ Add key            ]                  │
│                                                              │
│  Usage this month (estimated):                               │
│    Generations 38 · ~1.2M tokens · ~$0.71  [details ▸]       │
│                                                              │
│  🔒 Keys are encrypted in your browser and sent directly to  │
│     the provider. We never see them.                         │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Product Analytics

Use **one tool that covers product analytics + session replay + feature flags +
surveys** rather than four point tools. **PostHog** is the right call for a
solo/small team (generous free tier, EU hosting option, all four jobs in one
SDK). Keep `@vercel/analytics` for traffic; PostHog for product.

Because the workspace is anonymous today, the first instrumentation job is a
**stable anonymous device id now**, upgraded to a real user id at sign-up, so
you don't lose the pre-account funnel.

### Metrics ranked by importance

**Tier 1 — must-have at launch (instrument before you ship):**

1. **Activation rate** — % of signups who generate their first PRD. _The_ number
   for a tool like this; everything downstream depends on it.
2. **Signups** (by source) — volume + where they come from.
3. **Time-to-first-PRD** — onboarding friction proxy; watch it like a hawk.
4. **PRD generation success rate** — % of generations that complete without
   error/safety-block. Directly tied to your pipeline's reliability.
5. **Free→Paid conversion** — the business exists or doesn't here.
6. **D1 / D7 retention** — is there any reason to come back?
7. **Cost per active user** (your funded inference ÷ active users) — your unit
   economics guardrail; without it you can't price tiers.

**Tier 2 — add in the first few weeks:**

8. Projects completed / reach the Assets stage (depth of value).
9. Artifact + mockup generation counts (which outputs deliver value).
10. Tokens consumed per user & per generation (cost attribution + tier design).
11. Model selection mix (Flash vs Pro vs BYOK).
12. Retry rates per pipeline section (reliability hot-spots — you already log
    section status; pipe it to analytics).
13. D30 retention & returning project creators.

**Tier 3 — nice to have later:**

14. Referral sources / viral coefficient, revenue per user (ARPU/ARPPU),
    workspace engagement depth (branches, refinements per PRD), feature-level
    adoption.

> Rule: every metric should map to a decision. Activation → onboarding work;
> success/retry rates → pipeline reliability; cost-per-active-user → pricing;
> conversion + retention → is this a business.

---

## 5. User Feedback Systems

| Mechanism | Captures | Why it matters | When to introduce |
| --- | --- | --- | --- |
| **Post-generation micro-rating** (👍/👎 + optional one-liner on each PRD/artifact) | Output-quality signal tied to the exact prompt/model/section | This is your highest-signal, highest-volume feedback and it directly improves the core pipeline. You already have a `feedbackSlice` to build on | **Launch** |
| **In-app feature request / bug widget** (PostHog or a lightweight board like Canny/Featurebase) | Prioritization signal, reproductions | Cheap to add, gives early users a voice, builds public roadmap goodwill | **Launch** |
| **Session replay** (PostHog) | Where users get stuck, rage-clicks, drop-offs | Invaluable for fixing the activation funnel in the first weeks; watch real first-runs | **Launch / week 1** (respect privacy — mask inputs, never record keys) |
| **NPS** (in-app, triggered after N sessions) | Loyalty trend, promoter/detractor split | Benchmarkable retention proxy; promoters → referrals/testimonials | **First 100 users** |
| **Churn / cancel survey** | _Why_ people leave or downgrade | The single most actionable retention input — name the real reasons (price, quality, didn't get value) | **When billing launches** |
| **User interviews** (5–8 with engaged + churned users) | Deep qualitative "why" | Numbers tell you what, interviews tell you why; irreplaceable early | **First 100 users**, ongoing |
| **Satisfaction-after-generation CSAT** (periodic, sampled) | Trend in perceived output quality over time | Complements the per-generation thumbs with a trackable trend line | **First 1,000 users** |
| **In-app store-style rating prompt** | Public proof / testimonials | Low signal, mainly for social proof; gate behind a positive moment | **Later** |

Principle: **passive + high-volume at launch** (thumbs, replay, a widget),
**active + qualitative as you grow** (NPS, interviews, churn surveys). Don't
interrupt the first run with surveys — let the product prove itself first.

---

## 6. Launch Architecture (30-day public launch)

Bias: **reuse what you already run** (Vercel + serverless + Mongo pattern) and
add only managed services that remove maintenance. One new architectural piece
is non-negotiable: a **server-side inference proxy** for funded traffic.

```
                         ┌──────────────────────────────┐
   Browser (Vite SPA)    │  Vercel (existing)            │
   ┌──────────────┐      │                              │
   │ Workspace UI │      │  /api/llm/*  ← NEW proxy      │
   │              │─────▶│   • auth check (Clerk JWT)    │──▶ Gemini (your key)
   │ BYOK keys    │      │   • per-user rate limit       │      Pro/Flash
   │ (encrypted,  │──┐   │   • token metering → analytics│
   │  client-side)│  │   │  /api/auth/* (existing glue)  │
   └──────────────┘  │   │  /api/billing/* (Stripe hook) │
        direct to    │   │  /api/feedback/*              │
        provider ────┼──────────────────────────────────┘
        (BYOK path)  │                 │
                     │                 ▼
                     │        ┌──────────────────┐
                     ▼        │ DB (users, subs,  │
              Provider APIs   │ usage, feedback)  │
                              └──────────────────┘
   Clerk (auth) · Stripe (billing) · PostHog (analytics/replay/flags/surveys)
   · Sentry (errors) · Resend (transactional email)
```

**Component choices, justified by your four priorities (simplicity, security,
scalability, cost):**

- **Auth:** Clerk (§1). Simplicity + security; offloads passkeys/recovery.
- **Database:** You already use MongoDB. For the new app data (users, subs,
  usage, feedback) I'd lean **Postgres via Supabase or Neon** — relational
  fits subscriptions/usage/billing far better than Mongo's Data API, both have
  serverless-friendly pooling, and Supabase doubles as an auth fallback. If you
  want zero new vendors, the existing Mongo pattern is acceptable for launch —
  just don't model billing ledgers in it long-term.
- **Inference proxy:** New `/api/llm/*` Vercel functions. **This is the keystone**
  — it lets you fund Flash/Pro without exposing keys, enforce per-user rate
  limits, and meter tokens. BYOK stays client-direct and bypasses the proxy.
- **Billing:** **Stripe** (Checkout + Customer Portal + webhooks). The default
  for a reason; don't build billing yourself.
- **Analytics:** PostHog (§4) + keep `@vercel/analytics`.
- **Error monitoring:** **Sentry** (frontend + serverless), with strict PII/key
  scrubbing in `beforeSend`.
- **Feedback:** Post-generation thumbs into your DB; PostHog surveys/replay;
  a lightweight request board (Canny/Featurebase) if you want a public roadmap.
- **Email:** **Resend** for magic links + transactional (receipts, resets).
- **Key management:** Funded keys in Vercel env / secrets manager (server only);
  BYOK encrypted client-side, never sent to your servers (§3).

### Phased rollout

**MVP launch (Day 0):**
- Auth (Google + GitHub + magic link). Accounts replace anonymous localStorage,
  with a one-time **migration of existing local projects into the account** on
  first sign-in (don't strand current users' work).
- Free tier via the inference proxy (Flash, hard caps) + BYOK (already works).
- PostHog + Sentry wired. Post-generation thumbs. Feedback widget.
- **No billing yet** — validate activation and unit cost first. Use a waitlist /
  "Pro coming soon" to gauge demand.

**First 100 users:**
- Turn on **Stripe Pro** once you've watched cost-per-active-user on real data.
- NPS + 5–8 user interviews (engaged _and_ churned). Watch session replays of
  first-runs and fix the top activation drop-offs.
- Per-user rate limits tuned from actual Flash spend.

**First 1,000 users:**
- Harden the proxy: per-user + global rate limits, abuse/cost circuit-breakers,
  queueing for the DAG pipeline under load.
- Add OpenAI/Claude via BYOK; introduce Pro-tier token ceilings with
  soft-degrade. Churn survey on cancel. CSAT trend. Move billing ledger to
  Postgres if you haven't.
- Passkeys as a returning-user upgrade.

**First 10,000 users:**
- Cost controls become a real discipline: batch/cache where possible, monitor
  cost-per-user per cohort, consider **negotiated/committed Gemini pricing** or
  a cheaper default model for free tier.
- Optional **credit packs** as Pro add-ons (now you have pricing data).
- Team/Org plans (Clerk orgs), SSO/Microsoft OAuth for inbound enterprise,
  SOC 2 groundwork if enterprise demand is real. Read replicas / connection
  pooling; consider a queue (e.g. Vercel Queue / Upstash) for generation jobs.

---

## TL;DR

1. **Auth:** Launch Google + GitHub + magic link (you already have the OAuth
   glue); use Clerk to avoid maintaining passkeys/recovery; add passkeys later.
2. **AI cost:** Hybrid freemium — you fund a capped **Flash** free tier and a
   bounded **Pro** subscription; **BYOK** is the unlimited self-funded valve.
   You already run on the user's key today, so this is an evolution, not a pivot.
3. **BYOK:** Keep keys **client-side and encrypted**, sent direct to providers,
   never to your server — and make "we never see your key" a trust feature.
4. **Analytics:** PostHog (one tool, four jobs). Tier-1 metrics: activation,
   signups, time-to-first-PRD, generation success rate, free→paid, D1/D7,
   cost-per-active-user.
5. **Feedback:** Passive/high-volume at launch (post-generation thumbs, replay,
   widget); active/qualitative as you grow (NPS, interviews, churn survey).
6. **Architecture:** Reuse Vercel + your auth pattern; add Stripe, PostHog,
   Sentry, Resend. The one mandatory new build is a **server-side inference
   proxy** — without it you cannot fund premium inference without leaking keys.
