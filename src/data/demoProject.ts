/**
 * Demo & gallery project identity.
 *
 * The demo project is no longer a static fixture committed to the repo.
 * Instead, the Synapse owner saves a cloud snapshot via SnapshotsPanel and
 * pins it as the demo (Star button next to a snapshot). The home page's
 * "View demo project" button fetches that snapshot from the public
 * `/api/snapshots?demo=1` endpoint and hydrates it into the store at the
 * stable id below.
 *
 * The project gallery is the multi-project upgrade of the single demo: the
 * owner pins up to GALLERY_MAX_SIZE snapshots into ordered slots (via the
 * `?gallery=1` channel) and each slot hydrates under its own stable project
 * id so `/p/<slot id>` URLs are shareable and cacheable exactly like the
 * demo. Gallery projects are read-only showcase copies — every rule that
 * applies to DEMO_PROJECT_ID (capability policy, sync exclusion, route-owned
 * hydration) applies to each gallery id too.
 *
 * IMPORTANT: keep `DEMO_PROJECT_ID` and `GALLERY_PROJECT_IDS` stable. The
 * store's hydration actions key on them for idempotency, and the workspace
 * URLs `/p/<id>` use them.
 */

export const DEMO_PROJECT_ID = '00000000-0000-4000-8000-000000000d01';

/** Maximum gallery capacity (room to grow, not a target). Must match the
 * server's GALLERY_MAX_SIZE in `api/snapshots.js`. */
export const GALLERY_MAX_SIZE = 12;

/** Minimum pinned projects before the gallery can go live. A one-card grid
 * is a worse experience than the single demo, so launch needs at least two.
 * Must match the server's GALLERY_MIN_LIVE in `api/snapshots.js`. */
export const GALLERY_MIN_LIVE = 2;

/** Stable local project id for each gallery slot (slot = array index). */
export const GALLERY_PROJECT_IDS: readonly string[] = Object.freeze([
    '00000000-0000-4000-8000-000000000d11',
    '00000000-0000-4000-8000-000000000d12',
    '00000000-0000-4000-8000-000000000d13',
    '00000000-0000-4000-8000-000000000d14',
    '00000000-0000-4000-8000-000000000d15',
    '00000000-0000-4000-8000-000000000d16',
    '00000000-0000-4000-8000-000000000d17',
    '00000000-0000-4000-8000-000000000d18',
    '00000000-0000-4000-8000-000000000d19',
    '00000000-0000-4000-8000-000000000d1a',
    '00000000-0000-4000-8000-000000000d1b',
    '00000000-0000-4000-8000-000000000d1c',
]);

export const galleryProjectIdForSlot = (slot: number): string | null =>
    GALLERY_PROJECT_IDS[slot] ?? null;

/** The gallery slot a project id belongs to, or null when it isn't one. */
export const gallerySlotForProjectId = (projectId: string | undefined): number | null => {
    if (!projectId) return null;
    const idx = GALLERY_PROJECT_IDS.indexOf(projectId);
    return idx === -1 ? null : idx;
};

/**
 * True for every snapshot-backed showcase project id — the single demo and
 * all gallery slots. These projects are hydrated from pinned cloud snapshots,
 * are read-only, and must never sync to the per-user `/api/projects` backend.
 */
export const isShowcaseProjectId = (projectId: string | undefined): boolean =>
    projectId === DEMO_PROJECT_ID || gallerySlotForProjectId(projectId) !== null;
