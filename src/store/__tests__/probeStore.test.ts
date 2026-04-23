import { beforeEach, describe, expect, it } from 'vitest';
import { useProbeStore } from '../probeStore';

describe('probeStore', () => {
    beforeEach(() => {
        useProbeStore.getState().clear();
    });

    it('aggregates ok + degraded outcomes per version', () => {
        const { recordProbe, getStats } = useProbeStore.getState();
        recordProbe('v1', { outcome: 'ok', at: 1 });
        recordProbe('v1', { outcome: 'degraded', reason: 'Tailwind styles did not apply.', at: 2 });
        recordProbe('v1', { outcome: 'ok', at: 3 });

        const stats = getStats('v1');
        expect(stats).toBeDefined();
        expect(stats?.ok).toBe(2);
        expect(stats?.degraded).toBe(1);
        expect(stats?.total).toBe(3);
        expect(stats?.lastReason).toBe('Tailwind styles did not apply.');
    });

    it('isolates stats across versions', () => {
        const { recordProbe, getStats } = useProbeStore.getState();
        recordProbe('v1', { outcome: 'ok', at: 1 });
        recordProbe('v2', { outcome: 'degraded', reason: 'overflow', at: 2 });
        expect(getStats('v1')?.total).toBe(1);
        expect(getStats('v2')?.total).toBe(1);
        expect(getStats('v1')?.degraded).toBe(0);
        expect(getStats('v2')?.degraded).toBe(1);
    });

    it('ignores records with no versionId', () => {
        const before = useProbeStore.getState().byVersion;
        useProbeStore.getState().recordProbe('', { outcome: 'ok', at: 1 });
        expect(useProbeStore.getState().byVersion).toEqual(before);
    });

    it('clears stats for a single version without touching others', () => {
        const { recordProbe, clear, getStats } = useProbeStore.getState();
        recordProbe('v1', { outcome: 'ok', at: 1 });
        recordProbe('v2', { outcome: 'ok', at: 1 });
        clear('v1');
        expect(getStats('v1')).toBeUndefined();
        expect(getStats('v2')).toBeDefined();
    });

    it('preserves lastReason across subsequent ok probes', () => {
        const { recordProbe, getStats } = useProbeStore.getState();
        recordProbe('v1', { outcome: 'degraded', reason: 'horizontal overflow', at: 1 });
        recordProbe('v1', { outcome: 'ok', at: 2 });
        expect(getStats('v1')?.lastReason).toBe('horizontal overflow');
    });
});
