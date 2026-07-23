import { describe, expect, it } from 'vitest';
import { latestProjectActivity, mergePersistedProjectBlobs } from '../crossTabMerge';

// Minimal persisted-envelope builder mirroring the Zustand persist shape the
// project store writes: { state: { projects, <collections> }, version }.
interface BlobSpec {
    projects?: Record<string, Record<string, unknown>>;
    artifacts?: Record<string, Record<string, unknown>[]>;
    artifactVersions?: Record<string, Record<string, unknown>[]>;
    historyEvents?: Record<string, Record<string, unknown>[]>;
    spineVersions?: Record<string, Record<string, unknown>[]>;
}

function blob(spec: BlobSpec, extraState: Record<string, unknown> = {}): string {
    return JSON.stringify({
        state: {
            projects: spec.projects ?? {},
            artifacts: spec.artifacts ?? {},
            artifactVersions: spec.artifactVersions ?? {},
            historyEvents: spec.historyEvents ?? {},
            spineVersions: spec.spineVersions ?? {},
            ...extraState,
        },
        version: 0,
    });
}

type PersistedState = Record<string, Record<string, unknown>>;

function stateOf(raw: string): PersistedState {
    return (JSON.parse(raw) as { state: PersistedState }).state;
}

describe('latestProjectActivity', () => {
    it('takes the max over project stamps and collection record stamps', () => {
        const state = JSON.parse(blob({
            projects: { p1: { id: 'p1', createdAt: 100 } },
            artifacts: { p1: [{ id: 'a1', createdAt: 150, updatedAt: 900 }] },
            historyEvents: { p1: [{ id: 'h1', createdAt: 500 }] },
        })).state;
        expect(latestProjectActivity(state, 'p1')).toBe(900);
    });

    it('returns 0 for an unknown project and ignores non-numeric stamps', () => {
        const state = JSON.parse(blob({
            projects: { p1: { id: 'p1', createdAt: 'not-a-number' } },
        })).state;
        expect(latestProjectActivity(state, 'p1')).toBe(0);
        expect(latestProjectActivity(state, 'missing')).toBe(0);
    });
});

describe('mergePersistedProjectBlobs', () => {
    // The reported bug: tab A generated a mockup (its blob holds the mockup
    // artifact + version and newer stamps); a stale tab B — hydrated before the
    // mockup landed — flushes a write. The merge must keep tab A's copy of the
    // project so the mockup version survives.
    it('keeps the stored side of a project wholesale when it has newer activity', () => {
        const stored = blob({
            projects: { p1: { id: 'p1', name: 'P', createdAt: 100 } },
            artifacts: { p1: [{ id: 'mock-art', type: 'mockup', createdAt: 100, updatedAt: 2000 }] },
            artifactVersions: { p1: [{ id: 'mock-v1', artifactId: 'mock-art', isPreferred: true, createdAt: 2000 }] },
            historyEvents: { p1: [{ id: 'h1', createdAt: 2000 }] },
        });
        const ours = blob({
            projects: { p1: { id: 'p1', name: 'P', createdAt: 100 } },
            artifacts: { p1: [] },
            artifactVersions: { p1: [] },
            historyEvents: { p1: [{ id: 'h0', createdAt: 500 }] },
        });

        const merged = stateOf(mergePersistedProjectBlobs(stored, ours));
        expect(merged['artifactVersions']['p1']).toEqual([
            { id: 'mock-v1', artifactId: 'mock-art', isPreferred: true, createdAt: 2000 },
        ]);
        expect(merged['artifacts']['p1']).toHaveLength(1);
        expect(merged['historyEvents']['p1']).toEqual([{ id: 'h1', createdAt: 2000 }]);
    });

    it('keeps our side when our activity is newer (ties also go to ours)', () => {
        const stored = blob({
            projects: { p1: { id: 'p1', createdAt: 100 } },
            historyEvents: { p1: [{ id: 'old', createdAt: 1000 }] },
        });
        const ours = blob({
            projects: { p1: { id: 'p1', createdAt: 100 } },
            historyEvents: { p1: [{ id: 'new', createdAt: 3000 }] },
        });
        const merged = stateOf(mergePersistedProjectBlobs(stored, ours));
        expect(merged['historyEvents']['p1']).toEqual([{ id: 'new', createdAt: 3000 }]);

        const tie = blob({
            projects: { p1: { id: 'p1', createdAt: 100 } },
            historyEvents: { p1: [{ id: 'theirs', createdAt: 3000 }] },
        });
        const oursTie = blob({
            projects: { p1: { id: 'p1', createdAt: 100 } },
            historyEvents: { p1: [{ id: 'ours', createdAt: 3000 }] },
        });
        const tieMerged = stateOf(mergePersistedProjectBlobs(tie, oursTie));
        expect(tieMerged['historyEvents']['p1']).toEqual([{ id: 'ours', createdAt: 3000 }]);
    });

    it('unions projects that exist on only one side', () => {
        const stored = blob({
            projects: { theirs: { id: 'theirs', createdAt: 50 } },
            historyEvents: { theirs: [{ id: 'ht', createdAt: 60 }] },
        });
        const ours = blob({
            projects: { mine: { id: 'mine', createdAt: 70 } },
            historyEvents: { mine: [{ id: 'hm', createdAt: 80 }] },
        });
        const merged = stateOf(mergePersistedProjectBlobs(stored, ours));
        expect(Object.keys(merged['projects'])).toEqual(expect.arrayContaining(['theirs', 'mine']));
        expect(merged['historyEvents']['theirs']).toEqual([{ id: 'ht', createdAt: 60 }]);
        expect(merged['historyEvents']['mine']).toEqual([{ id: 'hm', createdAt: 80 }]);
    });

    it('takes the winning side of a project as one coherent snapshot, including collection absence', () => {
        // Stored side wins but has NO entry for a collection ours has — the
        // grafted project must not mix stored records with our stale rows.
        const stored = blob({
            projects: { p1: { id: 'p1', createdAt: 100 } },
            historyEvents: { p1: [{ id: 'h-new', createdAt: 5000 }] },
        });
        const ours = blob({
            projects: { p1: { id: 'p1', createdAt: 100 } },
            historyEvents: { p1: [{ id: 'h-old', createdAt: 400 }] },
            artifactVersions: { p1: [{ id: 'stale-version', createdAt: 400 }] },
        });
        const merged = stateOf(mergePersistedProjectBlobs(stored, ours));
        expect(merged['artifactVersions']['p1']).toBeUndefined();
        expect(merged['historyEvents']['p1']).toEqual([{ id: 'h-new', createdAt: 5000 }]);
    });

    it('leaves non-project state and the envelope version from our write', () => {
        const stored = blob({
            projects: { p1: { id: 'p1', createdAt: 100 } },
            historyEvents: { p1: [{ id: 'h1', createdAt: 9000 }] },
        }, { somethingElse: 'stored' });
        const ours = blob({ projects: {} }, { somethingElse: 'ours' });
        const raw = mergePersistedProjectBlobs(stored, ours);
        expect(JSON.parse(raw).version).toBe(0);
        expect(stateOf(raw)['somethingElse']).toBe('ours');
        // The stored-only project was still grafted in.
        expect(stateOf(raw)['projects']['p1']).toEqual({ id: 'p1', createdAt: 100 });
    });

    it('returns our write unchanged when either blob is unparseable', () => {
        const ours = blob({ projects: { p1: { id: 'p1', createdAt: 1 } } });
        expect(mergePersistedProjectBlobs('not-json', ours)).toBe(ours);
        expect(mergePersistedProjectBlobs('"a-string"', ours)).toBe(ours);
        expect(mergePersistedProjectBlobs(ours, 'not-json')).toBe('not-json');
    });

    it('returns our write unchanged when nothing needs grafting', () => {
        const ours = blob({
            projects: { p1: { id: 'p1', createdAt: 100 } },
            historyEvents: { p1: [{ id: 'h', createdAt: 900 }] },
        });
        const stored = blob({
            projects: { p1: { id: 'p1', createdAt: 100 } },
            historyEvents: { p1: [{ id: 'h', createdAt: 800 }] },
        });
        expect(mergePersistedProjectBlobs(stored, ours)).toBe(ours);
    });
});
