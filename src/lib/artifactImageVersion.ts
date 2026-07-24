// Image continuity across appended artifact versions.
//
// Rendered images live in IndexedDB keyed by the artifact version they belong
// to — `${versionId}:${screenId}:${quality}` (mockups),
// `${artifactVersionId}:${screenSlug}:${versionNumber}` (screen-inventory
// uploads) and `${versionId}:${screenId}:${variantId}:${quality}` (variants).
// Several store actions append a CLONE of an existing version under a fresh
// uuid — restore, "mark as up to date", and user overlay edits. Those clones
// carry the same content but a new id, so a naive key lookup finds nothing and
// the screens render image-less even though the bytes are still on disk.
//
// Rather than copying multi-megabyte PNG records on every clone (store actions
// are synchronous Zustand updaters while IndexedDB is async, and a user can
// click "Mark up to date" repeatedly), a clone records WHERE its images live:
// `metadata.imageSourceVersionId`. Every reader and writer resolves that
// pointer before building a key, so a clone and its source SHARE one image set.
//
// Sharing rather than forking is deliberate: these clones are content-identical
// by construction — restore, mark-current and overlay edits all copy `content`
// verbatim — so the same screens render the same mockups. Regenerating a screen
// from a clone updates the shared record, which is the behavior a user expects
// when the two versions describe the same screen. Versions that genuinely have
// different content come from `createArtifactVersion`, which never inherits and
// so always starts a fresh image set under its own id.
//
// Two invariants keep this predictable:
//
//   1. The pointer is COLLAPSED AT WRITE TIME — a clone of a clone copies the
//      original's pointer rather than pointing at its parent. Lookup is always
//      exactly one hop; there is never a chain to walk.
//   2. Only clone-appending actions set it. A regenerated version has its own
//      images and must not inherit.
//
// Anything that garbage-collects images must treat a version's records as live
// while any other version's `imageSourceVersionId` points at it.

import type { ArtifactVersion } from '../types';

const IMAGE_SOURCE_KEY = 'imageSourceVersionId';

type VersionLike = Pick<ArtifactVersion, 'id' | 'metadata'>;

/**
 * Where this version's images actually live: its own id unless it inherited
 * them from an earlier version. Use this everywhere an image key or key prefix
 * is built from a version.
 */
export function effectiveImageVersionId(version: VersionLike): string {
    const inherited = version.metadata?.[IMAGE_SOURCE_KEY];
    return typeof inherited === 'string' && inherited ? inherited : version.id;
}

/**
 * The metadata fragment a clone-appending action must merge in so the new
 * version keeps reaching the source's images. Collapses the chain (invariant 1)
 * by preferring the source's own pointer.
 *
 * Returns an empty object when there is nothing to inherit, so a caller can
 * spread it unconditionally without writing an `undefined` key.
 */
export function inheritedImageMetadata(source: VersionLike): Record<string, unknown> {
    return { [IMAGE_SOURCE_KEY]: effectiveImageVersionId(source) };
}

/**
 * Rewrite an inherited-image pointer through an id remap. Used by the
 * demo-namespaced snapshot restore, which reassigns every artifact version id
 * and would otherwise leave clones pointing at pre-remap ids.
 *
 * A pointer with no mapping is dropped rather than kept dangling — the version
 * then falls back to its own id, which is the honest "no images" state.
 */
export function remapInheritedImageMetadata(
    metadata: Record<string, unknown> | undefined,
    remap: (oldVersionId: string) => string | undefined,
): Record<string, unknown> | undefined {
    if (!metadata) return metadata;
    const current = metadata[IMAGE_SOURCE_KEY];
    if (typeof current !== 'string' || !current) return metadata;
    const mapped = remap(current);
    if (mapped === current) return metadata;
    const next = { ...metadata };
    if (mapped) next[IMAGE_SOURCE_KEY] = mapped;
    else delete next[IMAGE_SOURCE_KEY];
    return next;
}

export const IMAGE_SOURCE_METADATA_KEY = IMAGE_SOURCE_KEY;
