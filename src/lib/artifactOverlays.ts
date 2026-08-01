// User-authored overlays on an artifact version's metadata bag.
//
// Artifact `content` is never user-editable — everything a user hand-tunes
// about a generated output lives in `ArtifactVersion.metadata` under one of the
// keys below. That makes these keys the ONLY record of manual work on an
// output, which is why they are versioned (see `updateArtifactOverlay` in
// `store/slices/artifactSlice.ts`) rather than patched in place.
//
// The rest of the metadata bag is generation/authority state — validation
// blockers and acceptances, design tokens, repair markers, dependency status.
// Those belong to the version that produced them and must NOT travel across a
// restore, so they are deliberately absent from this list.

/** Metadata keys that hold user-authored work. */
export const OVERLAY_METADATA_KEYS = [
    'screenEdits',           // per-screen field edits, review status, sign-off, variant status
    'extraScreens',          // screens the user added to mockup coverage
    'screenLinks',           // manual mockup↔inventory relinks
    'dismissedScreenIssues', // advisory issues the user chose to dismiss
    'planProgress',          // implementation-plan task progress
    'mockupApproval',        // reviewed flows + approved screen set
    'buildPacketApproval',   // Final Review sign-off + the pinned artifact-version manifest
    'promptEdits',           // legacy prompt packs (no live writer; read by the dependency graph)
] as const;

export type OverlayMetadataKey = typeof OVERLAY_METADATA_KEYS[number];

const OVERLAY_KEY_SET: ReadonlySet<string> = new Set(OVERLAY_METADATA_KEYS);

export const isOverlayMetadataKey = (key: string): key is OverlayMetadataKey =>
    OVERLAY_KEY_SET.has(key);

/**
 * The user-authored subset of a metadata bag. Used when restoring old content
 * while keeping the edits the user has made since.
 */
export function pickOverlayKeys(
    metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
    if (!metadata) return {};
    const picked: Record<string, unknown> = {};
    for (const key of OVERLAY_METADATA_KEYS) {
        if (key in metadata) picked[key] = metadata[key];
    }
    return picked;
}

/** True when a patch touches any user-authored overlay key. */
export function patchTouchesOverlay(patch: Record<string, unknown>): boolean {
    return Object.keys(patch).some(isOverlayMetadataKey);
}

/**
 * Does applying `patch` overwrite or drop user work that already exists?
 *
 * Overlay edits normally COALESCE into a single version per editing session, so
 * a burst of tweaks doesn't produce a version per keystroke. But a patch that
 * replaces or removes existing overlay state is the one thing versioning has to
 * catch — "reset to generated", overwriting a screen's edits, clearing plan
 * progress. Those always append, so the prior state stays restorable.
 *
 * Conservative by construction: any key whose existing value is non-empty and
 * is being replaced with something different counts as destructive. Adding a
 * brand-new key (e.g. the first edit to a screen) does not.
 */
export function patchDestroysOverlayWork(
    existing: Record<string, unknown> | undefined,
    patch: Record<string, unknown>,
): boolean {
    if (!existing) return false;
    return Object.entries(patch).some(([key, nextValue]) => {
        if (!isOverlayMetadataKey(key)) return false;
        const prevValue = existing[key];
        if (prevValue === undefined || prevValue === null) return false;
        if (isEmptyOverlayValue(prevValue)) return false;
        // Removing the key outright, or replacing a populated overlay with an
        // empty one, drops user work.
        if (nextValue === undefined || nextValue === null) return true;
        if (isEmptyOverlayValue(nextValue)) return true;
        return dropsExistingEntries(prevValue, nextValue);
    });
}

const isEmptyOverlayValue = (value: unknown): boolean => {
    if (value === undefined || value === null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value as object).length === 0;
    return false;
};

/**
 * For map-shaped overlays (screenEdits, planProgress, …) an edit that removes
 * or rewrites an existing entry is destructive; adding a new entry is not.
 * Non-map overlays are treated as destructive whenever the value changes.
 */
const dropsExistingEntries = (prevValue: unknown, nextValue: unknown): boolean => {
    const prevIsMap = typeof prevValue === 'object' && prevValue !== null && !Array.isArray(prevValue);
    const nextIsMap = typeof nextValue === 'object' && nextValue !== null && !Array.isArray(nextValue);
    if (!prevIsMap || !nextIsMap) return true;
    const prev = prevValue as Record<string, unknown>;
    const next = nextValue as Record<string, unknown>;
    return Object.keys(prev).some(key => {
        if (!(key in next)) return true; // entry removed
        return JSON.stringify(prev[key]) !== JSON.stringify(next[key]); // entry rewritten
    });
};
