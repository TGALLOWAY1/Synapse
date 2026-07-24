import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../projectStore';
import { applyStagedEditsToStructuredPRD, getStagedEdits } from '../../lib/stagedBranchEdits';
import type { StructuredPRD } from '../../types';

const projectId = 'p-staged';
const spineId = 's-1';

const structuredPRD: StructuredPRD = {
    vision: 'A calm habit tracker.',
    targetUsers: ['Busy parents'],
    coreProblem: 'Habit apps punish missed days.',
    features: [],
    architecture: 'Local-first.',
    risks: [],
};

const makeBranch = (id: string, anchorText: string) => ({
    id,
    projectId,
    spineVersionId: spineId,
    anchorText,
    status: 'active' as const,
    createdAt: 1,
    messages: [{ id: `${id}-m0`, role: 'user' as const, content: `Replace: ${anchorText}`, createdAt: 1 }],
});

beforeEach(() => {
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Staged test', createdAt: 1 } },
        spineVersions: {
            [projectId]: [{
                id: spineId,
                projectId,
                promptText: 'idea',
                responseText: '# Plan\nA calm habit tracker.',
                createdAt: 1,
                isLatest: true,
                isFinal: false,
                structuredPRD,
                prdVersion: 2,
            }],
        },
        branches: {
            [projectId]: [
                makeBranch('b-1', 'A calm habit tracker.'),
                makeBranch('b-2', 'Habit apps punish missed days.'),
            ],
        },
        historyEvents: { [projectId]: [] },
    });
});

describe('stageBranch / unstageBranch', () => {
    it('stages a branch as resolved with a held replacement', () => {
        useProjectStore.getState().stageBranch(projectId, 'b-1', 'A forgiving habit tracker.');
        const branch = useProjectStore.getState().branches[projectId].find(b => b.id === 'b-1')!;
        expect(branch.status).toBe('resolved');
        expect(branch.proposedReplacement).toBe('A forgiving habit tracker.');
    });

    it('unstages back to active and clears the held replacement', () => {
        const store = useProjectStore.getState();
        store.stageBranch(projectId, 'b-1', 'A forgiving habit tracker.');
        store.unstageBranch(projectId, 'b-1');
        const branch = useProjectStore.getState().branches[projectId].find(b => b.id === 'b-1')!;
        expect(branch.status).toBe('active');
        expect(branch.proposedReplacement).toBeUndefined();
    });
});

describe('applyStagedBranchesToSpine', () => {
    it('applies several staged edits as ONE new spine version and merges the branches', () => {
        const store = useProjectStore.getState();
        store.stageBranch(projectId, 'b-1', 'A forgiving habit tracker.');
        store.stageBranch(projectId, 'b-2', 'Habit apps shame you for one slip.');

        const branches = useProjectStore.getState().branches[projectId];
        const staged = getStagedEdits(branches);
        expect(staged).toHaveLength(2);

        const { structuredPRD: finalPrd, applied, skipped } =
            applyStagedEditsToStructuredPRD(structuredPRD, staged);
        expect(applied).toHaveLength(2);
        expect(skipped).toHaveLength(0);
        expect(finalPrd.vision).toBe('A forgiving habit tracker.');
        expect(finalPrd.coreProblem).toBe('Habit apps shame you for one slip.');

        const before = useProjectStore.getState().spineVersions[projectId].length;
        const { newSpineId } = store.applyStagedBranchesToSpine(
            projectId, spineId, finalPrd, '# Plan\nA forgiving habit tracker.', applied, 'Applied 2 staged edits',
        );

        const spines = useProjectStore.getState().spineVersions[projectId];
        // Exactly one new version, and it is the latest.
        expect(spines).toHaveLength(before + 1);
        const merged = spines.find(s => s.id === newSpineId)!;
        expect(merged.isLatest).toBe(true);
        expect(merged.structuredPRD).toEqual(finalPrd);
        expect(merged.provenance?.changeSource).toBe('branch_merge');
        expect(merged.provenance?.editSummary).toBe('Applied 2 staged edits');

        // Both branches flip to merged; one history event records the batch.
        const after = useProjectStore.getState().branches[projectId];
        expect(after.every(b => b.status === 'merged')).toBe(true);
        const events = useProjectStore.getState().historyEvents[projectId];
        expect(events).toHaveLength(1);
        expect(events[0].diff?.matches).toHaveLength(2);
    });
});
