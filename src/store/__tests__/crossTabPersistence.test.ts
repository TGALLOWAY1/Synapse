import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import { applyProjectUser } from '../projectUserSync';
import { setActiveProjectUser, namespaceFor } from '../userScope';

// Regression for the "mockups vanished after reopening Synapse" data loss:
// two tabs each persist the WHOLE store as one debounced localStorage value,
// so a stale background tab's write used to last-writer-win over the entire
// namespace and silently revert the fresher tab's work — in a freshly
// generated project, the mockup spec version (the last thing generation
// writes). The cross-tab guard (storage.ts + lib/crossTabMerge.ts) must merge
// instead: the fresher tab's copy of the project survives a stale tab's write.

vi.useFakeTimers();
function flushPersist() {
    vi.runOnlyPendingTimers();
}

interface PersistedBlob {
    state: Record<string, Record<string, unknown>>;
    version: number;
}

beforeEach(() => {
    localStorage.clear();
    setActiveProjectUser(null);
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        tasks: {},
        workflowRuns: {},
    });
});

describe('cross-tab persistence guard', () => {
    it('a stale tab\'s write does not revert another tab\'s newer mockup version', async () => {
        applyProjectUser('tab-user');

        // THIS test store plays the STALE tab: it created the project but never
        // saw the mockup generation finish.
        const { projectId } = useProjectStore.getState().createProject('My product', 'the idea');
        flushPersist();
        const ns = namespaceFor('tab-user');
        const staleBlob = localStorage.getItem(ns);
        expect(staleBlob).toContain(projectId);

        // ANOTHER tab finished mockup generation and persisted a NEWER blob:
        // same project, plus the mockup artifact + preferred version (with its
        // spine source ref) and a newer history event.
        const later = Date.now() + 10_000;
        const otherTab = JSON.parse(staleBlob!) as PersistedBlob;
        const mockupArtifact = {
            id: 'mock-art',
            projectId,
            type: 'mockup',
            title: 'Mockup',
            status: 'active',
            currentVersionId: 'mock-v1',
            createdAt: later,
            updatedAt: later,
        };
        const mockupVersion = {
            id: 'mock-v1',
            artifactId: 'mock-art',
            versionNumber: 1,
            parentVersionId: null,
            content: '{"screens":[]}',
            metadata: {},
            sourceRefs: [{
                id: 'ref-1',
                sourceArtifactId: projectId,
                sourceArtifactVersionId: 'spine-1',
                sourceType: 'spine',
            }],
            generationPrompt: 'Auto-generate mockup',
            isPreferred: true,
            createdAt: later,
        };
        otherTab.state.artifacts = {
            ...otherTab.state.artifacts,
            [projectId]: [
                ...((otherTab.state.artifacts?.[projectId] as unknown[] | undefined) ?? []),
                mockupArtifact,
            ],
        };
        otherTab.state.artifactVersions = {
            ...otherTab.state.artifactVersions,
            [projectId]: [
                ...((otherTab.state.artifactVersions?.[projectId] as unknown[] | undefined) ?? []),
                mockupVersion,
            ],
        };
        otherTab.state.historyEvents = {
            ...otherTab.state.historyEvents,
            [projectId]: [
                ...((otherTab.state.historyEvents?.[projectId] as unknown[] | undefined) ?? []),
                { id: 'h-mock', projectId, type: 'ArtifactGenerated', createdAt: later },
            ],
        };
        localStorage.setItem(ns, JSON.stringify(otherTab));

        // The stale tab now makes an unrelated change and its debounced write
        // flushes — pre-guard, this overwrote the whole namespace with the
        // stale state and the mockup version was gone on the next boot.
        const { projectId: otherProjectId } = useProjectStore.getState().createProject('Second', 'idea');
        flushPersist();

        const stored = JSON.parse(localStorage.getItem(ns)!) as PersistedBlob;
        const storedVersions = (stored.state.artifactVersions?.[projectId] ?? []) as Array<{ id: string }>;
        // The other tab's mockup version survived the stale tab's write…
        expect(storedVersions.some(v => v.id === 'mock-v1')).toBe(true);
        // …and the stale tab's own new work survived too (union, not clobber).
        expect(stored.state.projects[otherProjectId]).toBeDefined();
        expect(stored.state.projects[projectId]).toBeDefined();

        // The stale tab also adopts the merged state into memory (onApplied →
        // rehydrate on the next microtask), so its next write carries the
        // mockup natively and the UI shows it.
        await Promise.resolve();
        const versions = useProjectStore.getState().getArtifactVersions(projectId, 'mock-art');
        expect(versions.map(v => v.id)).toContain('mock-v1');
        const preferred = useProjectStore.getState().getPreferredVersion(projectId, 'mock-art');
        expect(preferred?.sourceRefs.some(r => r.sourceType === 'spine')).toBe(true);
    });

    it('keeps the in-memory tab\'s copy when it is the newer one', () => {
        applyProjectUser('tab-user');

        const { projectId } = useProjectStore.getState().createProject('Mine', 'idea');
        flushPersist();
        const ns = namespaceFor('tab-user');

        // Another tab wrote an OLDER copy of the same project (no newer
        // activity than ours).
        const otherTab = JSON.parse(localStorage.getItem(ns)!) as PersistedBlob;
        otherTab.state.historyEvents = { [projectId]: [] };
        localStorage.setItem(ns, JSON.stringify(otherTab));

        // Our tab keeps working: a rename-style mutation bumps our activity.
        useProjectStore.getState().createProject('Newer work', 'idea');
        flushPersist();

        const stored = JSON.parse(localStorage.getItem(ns)!) as PersistedBlob;
        // Our newer history for the project won (it was not emptied by the
        // other tab's older copy).
        const events = (stored.state.historyEvents?.[projectId] ?? []) as unknown[];
        expect(events.length).toBeGreaterThan(0);
    });
});
