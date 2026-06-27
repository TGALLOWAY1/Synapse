import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import { applyProjectUser } from '../projectUserSync';
import { setActiveProjectUser, namespaceFor } from '../userScope';

// Flush the 500ms debounced persist writer deterministically.
vi.useFakeTimers();
function flushPersist() {
  vi.runOnlyPendingTimers();
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

describe('project persistence lifecycle', () => {
  it('persists a created project to the active user namespace and survives a rehydrate', () => {
    applyProjectUser('userA');
    const { projectId } = useProjectStore.getState().createProject('Mine', 'idea');
    flushPersist();

    // Written under userA's namespace.
    const raw = localStorage.getItem(namespaceFor('userA'));
    expect(raw).toContain(projectId);

    // Simulate a "refresh": wipe in-memory state, rehydrate from storage.
    useProjectStore.setState({ projects: {}, spineVersions: {} });
    void useProjectStore.persist.rehydrate();
    expect(useProjectStore.getState().projects[projectId]).toBeDefined();
  });

  it('does NOT leak one user\'s projects into another user\'s namespace', () => {
    applyProjectUser('userA');
    const { projectId: aProj } = useProjectStore.getState().createProject('A', 'idea');
    flushPersist();

    // Switch to userB — should see an empty list, not A's projects.
    applyProjectUser('userB');
    expect(Object.keys(useProjectStore.getState().projects)).toHaveLength(0);

    const { projectId: bProj } = useProjectStore.getState().createProject('B', 'idea');
    flushPersist();

    // Switch back to A — A's project is intact and B's is absent.
    applyProjectUser('userA');
    expect(useProjectStore.getState().projects[aProj]).toBeDefined();
    expect(useProjectStore.getState().projects[bProj]).toBeUndefined();
  });

  it('does NOT clobber a pre-existing namespace with empty when switching in without mutating (R8 regression)', () => {
    // Seed userA's namespace as if from a previous session, with the store
    // pointed at the anonymous namespace (mirrors a fresh page load where the
    // store hydrated the base key before auth resolved).
    localStorage.setItem(
      namespaceFor('userA'),
      JSON.stringify({ state: { projects: { keep: { id: 'keep', name: 'Keep', createdAt: 1 } } }, version: 0 }),
    );

    // Auth resolves → switch into userA. Crucially, the user then does NOTHING
    // that mutates the store (just views their list), so only the debounced
    // writes queued by the switch itself can fire.
    applyProjectUser('userA');
    expect(useProjectStore.getState().projects.keep).toBeDefined();

    // Let every queued debounced write flush.
    flushPersist();

    // The stored namespace must still contain the project — the empty wipe
    // queued during the switch must have been superseded by a re-persist.
    const stored = JSON.parse(localStorage.getItem(namespaceFor('userA'))!);
    expect(stored.state.projects.keep).toBeDefined();
  });

  it('switching users back and forth never overwrites a namespace with an empty list', () => {
    applyProjectUser('userA');
    useProjectStore.getState().createProject('A', 'idea');
    flushPersist();
    const aBlobBefore = localStorage.getItem(namespaceFor('userA'));

    // Going to an empty user and back must not blank out A's stored blob.
    applyProjectUser('userB'); // empty namespace, wipes in-memory state
    flushPersist();
    applyProjectUser('userA');
    flushPersist();

    const aBlobAfter = localStorage.getItem(namespaceFor('userA'));
    expect(aBlobAfter).toContain('"A"');
    // The A namespace still holds its project (not clobbered by the B detour).
    expect(JSON.parse(aBlobAfter!).state.projects).toEqual(
      JSON.parse(aBlobBefore!).state.projects,
    );
  });
});
