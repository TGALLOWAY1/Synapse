// In-memory registry of image refs pulled from the server, grouped by version
// id so the mockup image store can hydrate a version's images lazily (on
// mount / IndexedDB cache miss) without re-fetching refs each time.
//
// Refs are pulled on sign-in reconcile (and after each project save). This is a
// pure cache of server state — NOT the local source of truth (IndexedDB is).

import type { ImageRef } from './imageRef';
import { refVersionId } from './imageRef';

let allRefs: ImageRef[] = [];
const byVersion = new Map<string, ImageRef[]>();
const byKey = new Map<string, ImageRef>();

function reindex(): void {
  byVersion.clear();
  byKey.clear();
  for (const ref of allRefs) {
    byKey.set(ref.key, ref);
    const versionId = refVersionId(ref);
    if (versionId) {
      const list = byVersion.get(versionId);
      if (list) list.push(ref);
      else byVersion.set(versionId, [ref]);
    }
  }
}

/** Replace the registry's refs for one project with a freshly pulled set. */
export function setProjectRefs(projectId: string, refs: ImageRef[]): void {
  allRefs = allRefs.filter((r) => r.projectId !== projectId).concat(refs);
  reindex();
}

/** Every pulled ref for one artifact version (for lazy hydration). */
export function getRefsForVersion(versionId: string): ImageRef[] {
  return byVersion.get(versionId) ?? [];
}

/** One pulled ref by its composite key, if any. */
export function getImageRef(key: string): ImageRef | undefined {
  return byKey.get(key);
}

/** Drop all registry state (sign-out / namespace switch). */
export function clearImageRefRegistry(): void {
  allRefs = [];
  byVersion.clear();
  byKey.clear();
}
