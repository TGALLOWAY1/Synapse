// Output-run lease — which tab owns a live artifact output run.
//
// `Project.outputRun` is persisted, and every Synapse tab of the same user
// shares one persisted store. So a second tab loading (or a long-open tab
// deciding to resume) while the FIRST tab is still generating outputs sees the
// same 'running' marker. Run ids and the job controller's run registry are
// tab-local, so they cannot tell "a run died with its page" from "a run is
// alive in another tab" — and treating a live run as crashed launches the same
// paid generation twice. The lease makes the difference observable:
// - the marker records the owning tab (`ownerTabId`, a per-tab id kept in
//   sessionStorage so it survives that tab's own reload) and a `heartbeatAt`
//   the owner refreshes every OUTPUT_RUN_HEARTBEAT_MS while the run is live;
// - a 'running' marker is LIVE ELSEWHERE while its heartbeat is younger than
//   OUTPUT_RUN_LEASE_MS and the owner is another tab: never interrupt it,
//   never resume it, never start generation over it from this tab;
// - on page load it becomes 'interrupted' only when the owner is this same tab
//   (its own reload killed the run) or the lease has lapsed (the owner died).
//
// Pure apart from `getTabId` (sessionStorage) — crossTabMerge and the store's
// rehydrate fixup use the predicates.

import { v4 as uuidv4 } from 'uuid';
import type { OutputRunMarker, Project } from '../types';

/** How often the owning tab refreshes `outputRun.heartbeatAt` while its run is live. */
export const OUTPUT_RUN_HEARTBEAT_MS = 10_000;

/**
 * How long a heartbeat keeps a run "live elsewhere". Several heartbeats long,
 * so ordinary background-tab timer throttling (≈1 wake-up/second) never lapses
 * a live lease. Known limit: Chrome's intensive throttling (a tab hidden for
 * 5+ minutes wakes about once a minute) can let a still-running owner's lease
 * lapse; another tab may then resume the run.
 */
export const OUTPUT_RUN_LEASE_MS = 45_000;

const TAB_ID_KEY = 'synapse-tab-id';
let cachedTabId: string | null = null;

// Keep a stored tab id only across this tab's OWN reload: "Duplicate tab"
// (and similar) copies sessionStorage into a new tab, which must not inherit
// the original tab's live run. Browsers without navigation timing keep it.
function isReloadNavigation(): boolean {
    try {
        const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        return entry ? entry.type === 'reload' : true;
    } catch {
        return true;
    }
}

/**
 * This tab's id: stable for the life of the page and across this tab's own
 * reloads (sessionStorage); a fresh id for every other tab. Falls back to a
 * per-page-load id when sessionStorage is unavailable (then a reload is
 * treated like another tab and resumes once the lease lapses).
 */
export function getTabId(): string {
    if (cachedTabId) return cachedTabId;
    let id: string | null = null;
    try {
        const stored = sessionStorage.getItem(TAB_ID_KEY);
        if (stored && isReloadNavigation()) id = stored;
    } catch {
        // sessionStorage unavailable — fall through to a page-load id.
    }
    if (!id) {
        id = uuidv4();
        try {
            sessionStorage.setItem(TAB_ID_KEY, id);
        } catch {
            // Memory-only id.
        }
    }
    cachedTabId = id;
    return id;
}

/** The newest proof of life for a marker: its heartbeat, else (legacy markers) its start. */
export function outputRunHeartbeatAt(marker: OutputRunMarker): number {
    return marker.heartbeatAt ?? marker.startedAt;
}

/** Whether the run that owns `marker` has proven itself alive within the lease window. */
export function isOutputRunLeaseFresh(marker: OutputRunMarker, now: number): boolean {
    return now - outputRunHeartbeatAt(marker) < OUTPUT_RUN_LEASE_MS;
}

/**
 * A 'running' marker owned by ANOTHER tab whose lease is fresh: that run is
 * alive there. This tab must not interrupt, resume, or duplicate it.
 */
export function isOutputRunLiveElsewhere(
    marker: OutputRunMarker | undefined,
    now: number,
    tabId: string,
): boolean {
    return !!marker
        && marker.phase === 'running'
        && marker.ownerTabId !== tabId
        && isOutputRunLeaseFresh(marker, now);
}

/**
 * Page-load rule for a persisted 'running' marker: it was interrupted only if
 * this same tab owned it (its own reload killed the run) or the lease lapsed
 * (the owner stopped heartbeating). A fresh lease from another tab stays
 * 'running'.
 */
export function shouldInterruptOutputRunOnLoad(marker: OutputRunMarker, now: number, tabId: string): boolean {
    return marker.phase === 'running'
        && (marker.ownerTabId === tabId || !isOutputRunLeaseFresh(marker, now));
}

/** Validate an untrusted persisted value as an output-run marker. */
export function readOutputRunMarker(value: unknown): OutputRunMarker | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const m = value as Record<string, unknown>;
    if (typeof m.spineVersionId !== 'string' || typeof m.runId !== 'string') return undefined;
    if (typeof m.startedAt !== 'number' || (m.phase !== 'running' && m.phase !== 'interrupted')) return undefined;
    return {
        spineVersionId: m.spineVersionId,
        runId: m.runId,
        startedAt: m.startedAt,
        phase: m.phase,
        ...(typeof m.ownerTabId === 'string' ? { ownerTabId: m.ownerTabId } : {}),
        ...(typeof m.heartbeatAt === 'number' ? { heartbeatAt: m.heartbeatAt } : {}),
    };
}

/**
 * Cross-tab merge rule for two copies of the same run's marker: the one with
 * the newest heartbeat is the freshest knowledge of that run. Returns `a`
 * unless `b` is the same run with a strictly newer heartbeat.
 */
export function newestOutputRunMarker(
    a: OutputRunMarker | undefined,
    b: OutputRunMarker | undefined,
): OutputRunMarker | undefined {
    if (!a || !b || a.runId !== b.runId) return a;
    return outputRunHeartbeatAt(b) > outputRunHeartbeatAt(a) ? b : a;
}

const sameExcept = (a: object, b: object, ignored: string): boolean => {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    keys.delete(ignored);
    for (const key of keys) {
        if (ra[key] !== rb[key]) return false;
    }
    return true;
};

/**
 * True when the only difference between two versions of a project record is
 * a refreshed `outputRun.heartbeatAt` — cross-tab coordination bookkeeping,
 * not content, so it must not trigger a cloud push of the whole bundle.
 */
export function isHeartbeatOnlyProjectChange(prev: Project | undefined, next: Project | undefined): boolean {
    if (!prev || !next || prev === next) return false;
    const a = prev.outputRun;
    const b = next.outputRun;
    if (!a || !b || a === b || a.heartbeatAt === b.heartbeatAt) return false;
    return sameExcept(a, b, 'heartbeatAt') && sameExcept(prev, next, 'outputRun');
}
