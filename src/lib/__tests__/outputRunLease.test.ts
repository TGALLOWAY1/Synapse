import { describe, expect, it } from 'vitest';
import {
    isHeartbeatOnlyProjectChange,
    isOutputRunLiveElsewhere,
    newestOutputRunMarker,
    OUTPUT_RUN_LEASE_MS,
    readOutputRunMarker,
    shouldInterruptOutputRunOnLoad,
} from '../outputRunLease';
import type { OutputRunMarker, Project } from '../../types';

// The output-run lease (src/lib/outputRunLease.ts) is what lets one tab tell
// "a run died with its page" from "a run is alive in another tab".

const NOW = 1_000_000;
const marker = (overrides: Partial<OutputRunMarker> = {}): OutputRunMarker => ({
    spineVersionId: 's1',
    runId: 'r1',
    startedAt: NOW - 60_000,
    phase: 'running',
    ownerTabId: 'tab-a',
    heartbeatAt: NOW - 5_000,
    ...overrides,
});

describe('isOutputRunLiveElsewhere', () => {
    it('is live for another tab\'s run with a fresh heartbeat', () => {
        expect(isOutputRunLiveElsewhere(marker(), NOW, 'tab-b')).toBe(true);
    });

    it('is not live once the heartbeat is older than the lease window', () => {
        expect(isOutputRunLiveElsewhere(marker({ heartbeatAt: NOW - OUTPUT_RUN_LEASE_MS }), NOW, 'tab-b')).toBe(false);
    });

    it('is never "elsewhere" for this tab\'s own run, nor for a settled-as-interrupted one', () => {
        expect(isOutputRunLiveElsewhere(marker(), NOW, 'tab-a')).toBe(false);
        expect(isOutputRunLiveElsewhere(marker({ phase: 'interrupted' }), NOW, 'tab-b')).toBe(false);
        expect(isOutputRunLiveElsewhere(undefined, NOW, 'tab-b')).toBe(false);
    });

    it('falls back to startedAt for a marker written before the lease existed', () => {
        const legacy = marker({ ownerTabId: undefined, heartbeatAt: undefined, startedAt: NOW - 10_000 });
        expect(isOutputRunLiveElsewhere(legacy, NOW, 'tab-b')).toBe(true);
        expect(isOutputRunLiveElsewhere({ ...legacy, startedAt: NOW - OUTPUT_RUN_LEASE_MS - 1 }, NOW, 'tab-b')).toBe(false);
    });
});

describe('shouldInterruptOutputRunOnLoad', () => {
    it('keeps another tab\'s live run running', () => {
        expect(shouldInterruptOutputRunOnLoad(marker(), NOW, 'tab-b')).toBe(false);
    });

    it('interrupts a run whose lease lapsed', () => {
        expect(shouldInterruptOutputRunOnLoad(marker({ heartbeatAt: NOW - OUTPUT_RUN_LEASE_MS - 1 }), NOW, 'tab-b')).toBe(true);
    });

    it('interrupts this same tab\'s run on its own reload, however fresh the heartbeat', () => {
        expect(shouldInterruptOutputRunOnLoad(marker({ heartbeatAt: NOW }), NOW, 'tab-a')).toBe(true);
    });

    it('leaves an already-interrupted marker alone', () => {
        expect(shouldInterruptOutputRunOnLoad(marker({ phase: 'interrupted' }), NOW, 'tab-a')).toBe(false);
    });
});

describe('newestOutputRunMarker (cross-tab merge rule)', () => {
    it('keeps the copy of the same run with the newest heartbeat', () => {
        const older = marker({ heartbeatAt: NOW - 20_000 });
        const newer = marker({ heartbeatAt: NOW - 1_000 });
        expect(newestOutputRunMarker(older, newer)).toBe(newer);
        expect(newestOutputRunMarker(newer, older)).toBe(newer);
    });

    it('does not mix markers of different runs', () => {
        const mine = marker({ runId: 'r1', heartbeatAt: NOW - 20_000 });
        const theirs = marker({ runId: 'r2', heartbeatAt: NOW });
        expect(newestOutputRunMarker(mine, theirs)).toBe(mine);
    });
});

describe('readOutputRunMarker', () => {
    it('accepts a well-formed marker and rejects junk', () => {
        expect(readOutputRunMarker(marker())).toEqual(marker());
        expect(readOutputRunMarker({ runId: 'r1' })).toBeUndefined();
        expect(readOutputRunMarker('running')).toBeUndefined();
    });
});

describe('isHeartbeatOnlyProjectChange', () => {
    const project = (overrides: Partial<Project> = {}): Project => ({
        id: 'p1', name: 'P', createdAt: 1, outputRun: marker(), ...overrides,
    });

    it('is true when only the lease heartbeat moved', () => {
        const before = project();
        const after = { ...before, outputRun: { ...before.outputRun!, heartbeatAt: NOW } };
        expect(isHeartbeatOnlyProjectChange(before, after)).toBe(true);
    });

    it('is false when anything else changed too', () => {
        const before = project();
        expect(isHeartbeatOnlyProjectChange(before, { ...before, name: 'Renamed', outputRun: { ...before.outputRun!, heartbeatAt: NOW } })).toBe(false);
        expect(isHeartbeatOnlyProjectChange(before, { ...before, outputRun: { ...before.outputRun!, heartbeatAt: NOW, phase: 'interrupted' } })).toBe(false);
        expect(isHeartbeatOnlyProjectChange(before, { ...before, outputRun: undefined })).toBe(false);
    });
});
