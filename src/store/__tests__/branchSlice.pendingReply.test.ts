import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../projectStore';

// Branch.pendingReply marks an assistant reply in flight. It is persisted so
// a reload mid-request leaves evidence (the request itself can't be resumed);
// it must be cleared on the normal paths so a settled thread never reads as
// interrupted.

let projectId = '';
let branchId = '';
const branch = () => useProjectStore.getState().branches[projectId]?.find((b) => b.id === branchId);

beforeEach(() => {
    useProjectStore.setState({ projects: {}, spineVersions: {}, branches: {}, historyEvents: {} });
    const store = useProjectStore.getState();
    ({ projectId } = store.createProject('P', 'idea'));
    ({ branchId } = store.createBranch(projectId, 'v1', 'anchor', 'Clarify: why?'));
});

describe('branch pending-reply marker', () => {
    it('is set and cleared explicitly', () => {
        useProjectStore.getState().setBranchPendingReply(projectId, branchId, { startedAt: 5, message: 'why?' });
        expect(branch()?.pendingReply).toEqual({ startedAt: 5, message: 'why?' });

        useProjectStore.getState().setBranchPendingReply(projectId, branchId, null);
        expect(branch()?.pendingReply).toBeUndefined();
    });

    it('is cleared when the assistant reply lands, but not by a user message', () => {
        const store = useProjectStore.getState();
        store.setBranchPendingReply(projectId, branchId, { startedAt: 5, message: 'why?' });

        store.addBranchMessage(projectId, branchId, 'user', 'also, how?');
        expect(branch()?.pendingReply).toBeDefined();

        store.addBranchMessage(projectId, branchId, 'assistant', 'Because.');
        expect(branch()?.pendingReply).toBeUndefined();
    });

    it('leaves state untouched when clearing a branch with no marker', () => {
        const before = useProjectStore.getState().branches;
        useProjectStore.getState().setBranchPendingReply(projectId, branchId, null);
        expect(useProjectStore.getState().branches).toBe(before);
    });
});
