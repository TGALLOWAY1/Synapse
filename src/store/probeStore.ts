/**
 * Session-scoped probe telemetry store.
 *
 * MockupHtmlPreview reports every iframe post-load probe here so other parts
 * of the UI (e.g. the mockup version header) can aggregate and surface
 * whether a given artifact version's screens are rendering cleanly or
 * degrading. Kept *out* of projectStore so reports never leak into
 * localStorage — they describe this browser session's render health, not
 * the artifact itself.
 */

import { create } from 'zustand';

export type ProbeOutcome = 'ok' | 'degraded';

export interface ProbeRecord {
    outcome: ProbeOutcome;
    reason?: string;          // populated when outcome === 'degraded'
    at: number;               // Date.now() of the record
}

export interface VersionProbeStats {
    ok: number;
    degraded: number;
    total: number;
    lastReason?: string;
    lastAt: number;
}

interface ProbeState {
    byVersion: Record<string, VersionProbeStats>;
    recordProbe: (versionId: string, record: ProbeRecord) => void;
    getStats: (versionId: string) => VersionProbeStats | undefined;
    clear: (versionId?: string) => void;
}

export const useProbeStore = create<ProbeState>((set, get) => ({
    byVersion: {},

    recordProbe: (versionId, record) => {
        if (!versionId) return;
        set(state => {
            const prev = state.byVersion[versionId];
            const next: VersionProbeStats = {
                ok: (prev?.ok ?? 0) + (record.outcome === 'ok' ? 1 : 0),
                degraded: (prev?.degraded ?? 0) + (record.outcome === 'degraded' ? 1 : 0),
                total: (prev?.total ?? 0) + 1,
                lastReason: record.outcome === 'degraded' ? record.reason : prev?.lastReason,
                lastAt: record.at,
            };
            return { byVersion: { ...state.byVersion, [versionId]: next } };
        });
    },

    getStats: (versionId) => get().byVersion[versionId],

    clear: (versionId) => {
        if (!versionId) {
            set({ byVersion: {} });
            return;
        }
        set(state => {
            const { [versionId]: _removed, ...rest } = state.byVersion;
            void _removed;
            return { byVersion: rest };
        });
    },
}));
