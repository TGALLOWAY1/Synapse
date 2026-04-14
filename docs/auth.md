# Authentication

Synapse supports four ways to sign in:

| Provider | Flow | Notes |
|---|---|---|
| Email + password | `POST /api/auth/signup` / `POST /api/auth/login` | Password hashed with scrypt. |
| Google | `GET /api/auth/google` → callback | OIDC userinfo. Email auto-verified. |
| GitHub | `GET /api/auth/github` → callback | Primary verified email from `/user/emails`. |
| LinkedIn | `GET /api/auth/linkedin` → callback | OIDC userinfo. Email auto-verified. |

All four issue the same `synapse_session` HttpOnly cookie (30-day max-age,
HMAC-SHA256 signed). `GET /api/session` reads the cookie and returns the
canonical user record.

## User record (`recruiters` collection)

The collection name is retained from the LinkedIn-only era. New documents use
these fields:

| Field | Type | Notes |
|---|---|---|
| `userId` | string (UUID) | Primary identifier, stable across providers. |
| `authProvider` | `'linkedin' \| 'email' \| 'google' \| 'github'` | Set on every record. |
| `providerUserId` | string | LinkedIn `sub`, Google `sub`, GitHub `id`, or email address. |
| `email` | string \| null | Always lowercased on write. |
| `emailVerified` | boolean | `true` for OIDC providers, `false` for email signups. |
| `passwordHash` | string \| null | `scrypt$<saltB64url>$<hashB64url>`. Only for `authProvider='email'`. |
| `name`, `avatarUrl`, `profileUrl`, `headline`, `company` | | Unchanged. |
| `linkedinId` | string | Retained on LinkedIn records for back-compat reads. |
| `createdAt`, `firstLoginAt`, `lastActiveAt`, `updatedAt`, `loginCount` | | Unchanged. |

### Recommended indexes

```js
db.recruiters.createIndex({ userId: 1 }, { unique: true });
db.recruiters.createIndex(
  { email: 1, authProvider: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);
```

### One-time migration for existing LinkedIn records

If you already have LinkedIn users in `recruiters`, run:

```js
db.recruiters.find({ userId: { $exists: false } }).forEach((doc) => {
  db.recruiters.updateOne(
    { _id: doc._id },
    {
      $set: {
        userId: doc.linkedinId,
        providerUserId: doc.linkedinId,
        emailVerified: true,
      },
    }
  );
});
```

A read-only version of this lives in `scripts/migrate-recruiters-to-users.mjs`.
Session tokens issued before the migration still resolve because
`/api/session` falls back to `linkedinId` lookup when `userId` is absent from
the token claims.

## Session token

HMAC-SHA256 over a base64url-encoded JSON payload. Current claim shape:

```json
{
  "userId": "…uuid…",
  "authProvider": "google",
  "name": "Alex Example",
  "email": "alex@example.com",
  "avatarUrl": "https://…",
  "profileUrl": null,
  "issuedAt": 1712345678901,
  "recruiterId": "…uuid or linkedinId…"
}
```

`recruiterId` is preserved so legacy endpoints (`/api/activity`,
`/api/admin/recruiters`) keep working.

## Environment variables

```bash
# Session signing (required for all providers)
SESSION_SECRET=change-me

# MongoDB Data API (required)
MONGODB_DATA_API_URL=
MONGODB_DATA_API_KEY=
MONGODB_DATA_SOURCE=
MONGODB_DB_NAME=synapse

# LinkedIn (optional)
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=   # optional; defaults to ${baseUrl}/api/auth/linkedin/callback

# Google (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=     # optional; defaults to ${baseUrl}/api/auth/google/callback

# GitHub (optional)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=     # optional; defaults to ${baseUrl}/api/auth/github/callback

# Admin dashboard
ADMIN_DASHBOARD_KEY=
```

Add each OAuth app's redirect URI exactly as shown above to the provider's
developer console:

- Google Cloud Console → Credentials → OAuth 2.0 Client ID → Authorized
  redirect URIs
- GitHub → Settings → Developer settings → OAuth Apps → Authorization
  callback URL
- LinkedIn Developer Portal → App → Auth → Redirect URLs

## Account-linking policy

If a user signs up with email `alex@example.com` and later tries to sign in
with Google using the same address, the callback **rejects** the attempt and
redirects to `/?auth_error=email_in_use_other_provider`. The same applies to
every cross-provider combination. Each email may only exist under one
provider at a time.

Automatic linking is intentionally out of scope — it requires careful
trust-on-verification logic (only linking when the *new* provider asserts the
email is verified) and dedicated UX affordances (e.g. "we found an existing
account for alex@… — sign in first to link Google to it"). We'll add it in a
follow-up PR.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/signup` | Create email user, set session, return user. |
| `POST` | `/api/auth/login` | Verify email password, set session, return user. |
| `POST` | `/api/auth/logout` | Clear session cookie. |
| `GET`  | `/api/auth/google` | Begin Google OAuth redirect. |
| `GET`  | `/api/auth/google/callback` | Exchange code, upsert user, set session. |
| `GET`  | `/api/auth/github` | Begin GitHub OAuth redirect. |
| `GET`  | `/api/auth/github/callback` | Exchange code, upsert user, set session. |
| `GET`  | `/api/auth/linkedin` | Begin LinkedIn OAuth redirect. |
| `GET`  | `/api/auth/linkedin/callback` | Exchange code, upsert user, set session. |
| `GET`  | `/api/session` | Return the current session user (or `authenticated: false`). |

## Error codes

Signup and login return `{ error, field?, message? }` on failure:

| Code | Status | Meaning |
|---|---|---|
| `invalid_email` | 400 | Malformed or missing email. |
| `weak_password` | 400 | Shorter than 8 characters. |
| `invalid_name` | 400 | Missing or too long. |
| `email_in_use` | 409 | Email already registered (any provider). |
| `invalid_credentials` | 401 | Email or password mismatch (deliberately generic to avoid enumeration). |
| `signup_failed` / `login_failed` | 500 | Unexpected server error — check logs. |

OAuth redirects surface errors through the `?auth_error=…` query param on
`/`. Common codes: `email_in_use_other_provider`, `{provider}_callback_failed`,
`{provider}_invalid_state`, `{provider}_missing_code`, `{provider}_config`.

## Not included (future work)

- Email verification (new email users are created with `emailVerified: false`;
  nothing currently enforces verification).
- Password reset / "Forgot password?" flow (the UI affordance exists but is
  disabled).
- Account linking (see policy above).
- Two-factor authentication.
- Rate limiting on signup/login (Vercel has no built-in limiter; consider
  Upstash Ratelimit).
- The `/admin/recruiters` dashboard still filters via `linkedinId` and only
  surfaces LinkedIn-provider users; email/Google/GitHub users will show up as
  separate records once the projection is generalized.
