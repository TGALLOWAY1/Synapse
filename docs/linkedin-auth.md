# LinkedIn recruiter auth and follow-up pipeline

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
MONGODB_DATA_API_URL=
MONGODB_DATA_API_KEY=
MONGODB_DATA_SOURCE=
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
