# LinkedIn recruiter auth and follow-up pipeline

> See [`docs/auth.md`](auth.md) for the complete multi-provider auth overview
> (email/password, Google, GitHub, LinkedIn). This document covers only the
> LinkedIn-specific setup and the recruiter capture pipeline.

## What data Synapse collects

After a recruiter signs in with LinkedIn, Synapse stores:

- LinkedIn member ID (`sub` from LinkedIn OIDC userinfo)
- Name
- LinkedIn profile URL (if returned)
- Headline
- Company (if returned)
- Profile image URL
- Email address (only when LinkedIn returns it)
- First/last login timestamps and login count
- Activity events in-product (e.g. viewed mockups, generated artifacts, clicked sections)

Data is used to identify who evaluated Synapse and support direct, manual follow-up. No posting or automated outreach is performed.

## Required environment variables

```bash
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=synapse
SESSION_SECRET=change-me
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
# optional override
LINKEDIN_REDIRECT_URI=
# required for /admin/recruiters API access
ADMIN_DASHBOARD_KEY=
```

## Endpoints

- `GET /api/auth/linkedin` — begins OAuth redirect
- `GET /api/auth/linkedin/callback` — exchanges code and upserts recruiter profile
- `GET /api/session` — returns signed-in recruiter identity
- `POST /api/activity` — logs recruiter actions for visibility
- `GET /api/admin/recruiters` — admin dashboard data (requires `x-admin-key`)

## LinkedIn scopes

Synapse requests only:

- `openid`
- `profile`
- `email`

No posting, messaging, or write scopes are requested.

## Troubleshooting

If LinkedIn's OAuth page rejects the request with **"The redirect_uri
does not match the registered value"**, hit
`GET /api/auth/linkedin?debug=1` to see the exact `redirect_uri` Synapse
is sending, then register that URL in the LinkedIn Developer Portal
under App → Auth → Authorized redirect URLs (or set
`LINKEDIN_REDIRECT_URI` to one you have already registered). See the
debugging section in [`docs/auth.md`](auth.md) for the full
explanation.
