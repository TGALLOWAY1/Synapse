/**
 * Demo project identity.
 *
 * The demo project is no longer a static fixture committed to the repo.
 * Instead, the Synapse owner saves a cloud snapshot via SnapshotsPanel and
 * pins it as the demo (Star button next to a snapshot). The home page's
 * "View demo project" button fetches that snapshot from the public
 * `/api/snapshots?demo=1` endpoint and hydrates it into the store at the
 * stable id below.
 *
 * IMPORTANT: keep `DEMO_PROJECT_ID` stable. The store's `loadDemoProject()`
 * action keys on it for idempotency, and the workspace URL `/p/<id>` uses it.
 */

export const DEMO_PROJECT_ID = '00000000-0000-4000-8000-000000000d01';
