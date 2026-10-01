import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { Branch, StructuredPRD } from '../../types';

// Open branches (active conversations and staged edits) always target the
// latest spine version: every action that appends a spine version re-points
// them, while merged branches keep the version they were consolidated against.

const projectId = 'p-repoint';
const otherProjectId = 'p-other';
const v1 = 'spine-v1';

const prd = (vision: string): StructuredPRD => ({
    vision,
    targetUsers: ['Busy parents'],
    coreProblem: 'Habit apps punish missed days.',
    features: [],
    architecture: 'Local-first.',
    risks: [],
});

const branch = (id: string, status: Branch['status'], spineVersionId = v1, project = projectId): Branch => ({
    id,
    projectId: project,
    spineVersionId,
    anchorText: `anchor ${id}`,
    status,
    createdAt: 1,
    messages: [{ id: `${id}-m0`, role: 'user', content: `Clarify: anchor ${id}`, createdAt: 1 }],
    ...(status === 'resolved' ? { proposedReplacement: `replacement ${id}` } : {}),
});

const settledMeta = { passes: [], totalMs: 1, revised: false, schemaVersion: 2 };

beforeEach(() => {
    useProjectStore.setState({
        projects: {
            [projectId]: { id: projectId, name: 'Repoint', createdAt: 1 },
            [otherProjectId]: { id: otherProjectId, name: 'Other', createdAt: 1 },
        },
        spineVersions: {
            [projectId]: [{
                id: v1,
                projectId,
                promptText: 'idea',
                responseText: 'md',
                createdAt: 1,
                isLatest: true,
                isFinal: false,
                structuredPRD: prd('A calm habit tracker.'),
                generationPhase: 'complete',
                generationMeta: settledMeta,
            }],
        },
        branches: {
            [projectId]: [
                branch('active-1', 'active'),
                branch('staged-1', 'resolved'),
                branch('merged-0', 'merged', 'spine-v0'),
            ],
            [otherProjectId]: [branch('foreign', 'active', 'foreign-spine', otherProjectId)],
        },
        historyEvents: { [projectId]: [] },
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        planningRecords: {},
    });
});

const state = () => useProjectStore.getState();
const latestId = () => state().spineVersions[projectId].find(spine => spine.isLatest)!.id;
const byId = (id: string) => state().branches[projectId].find(item => item.id === id)!;

function expectOpenBranchesOnLatest() {
    const latest = latestId();
    expect(latest).not.toBe(v1);
    expect(byId('active-1').spineVersionId).toBe(latest);
    expect(byId('staged-1').spineVersionId).toBe(latest);
    // A staged edit keeps its held replacement when it follows the plan.
    expect(byId('staged-1').proposedReplacement).toBe('replacement staged-1');
    // History stays where it was; other projects are untouched.
    expect(byId('merged-0').spineVersionId).toBe('spine-v0');
    expect(state().branches[otherProjectId][0].spineVersionId).toBe('foreign-spine');
    // The rail (and BranchList) list exactly the open branches for the latest.
    expect(state().getBranchesForSpine(projectId, latest).map(item => item.id).sort())
        .toEqual(['active-1', 'staged-1']);
}

describe('open branches follow every spine append', () => {
    it('an inline edit (editSpineStructuredPRD)', () => {
        state().editSpineStructuredPRD(projectId, v1, prd('A forgiving habit tracker.'));
        expectOpenBranchesOnLatest();
    });

    it('a decision apply / section retry (compareAndAppendStructuredPRD)', () => {
        const result = state().compareAndAppendStructuredPRD(projectId, v1, prd('Decision applied.'));
        expect(result.status).toBe('applied');
        expectOpenBranchesOnLatest();
    });

    it('a revert / restore (revertSpineToVersion)', () => {
        state().editSpineStructuredPRD(projectId, v1, prd('Edited.'));
        state().revertSpineToVersion(projectId, v1);
        expectOpenBranchesOnLatest();
    });

    it('a regeneration (regenerateSpine)', () => {
        state().regenerateSpine(projectId);
        expectOpenBranchesOnLatest();
    });

    it('a consolidation: the merged branch stays on its version, the rest follow', () => {
        const { newSpineId } = state().mergeBranch(projectId, 'active-1', '# merged', {
            structuredPRD: prd('Merged.'),
        });
        expect(byId('active-1')).toMatchObject({ status: 'merged', spineVersionId: v1 });
        expect(byId('staged-1').spineVersionId).toBe(newSpineId);
        expect(state().getBranchesForSpine(projectId, newSpineId).map(item => item.id)).toEqual(['staged-1']);
    });

    it('a staged batch apply: applied branches stay, skipped staged and active branches follow', () => {
        state().stageBranch(projectId, 'active-1', 'replacement active-1');
        state().createBranch(projectId, v1, 'another anchor', 'Expand: another anchor');
        const { newSpineId } = state().applyStagedBranchesToSpine(
            projectId, v1, prd('Batch applied.'), '# batch', ['active-1'], 'Applied 1 staged edit',
        );
        expect(byId('active-1')).toMatchObject({ status: 'merged', spineVersionId: v1 });
        // staged-1 was skipped by the batch: still staged, still reachable.
        expect(byId('staged-1')).toMatchObject({ status: 'resolved', spineVersionId: newSpineId });
        const created = state().branches[projectId].find(item => item.anchorText === 'another anchor')!;
        expect(created).toMatchObject({ status: 'active', spineVersionId: newSpineId });
    });

    it('rescues a branch orphaned on an older version by an earlier append', () => {
        useProjectStore.setState({
            branches: { ...state().branches, [projectId]: [branch('orphan', 'active', 'spine-v0')] },
        });
        const { newSpineId } = state().editSpineStructuredPRD(projectId, v1, prd('Edited.'));
        expect(byId('orphan').spineVersionId).toBe(newSpineId);
    });

    it('keeps the branches map reference when no branch is open', () => {
        useProjectStore.setState({
            branches: { ...state().branches, [projectId]: [branch('merged-0', 'merged', 'spine-v0')] },
        });
        const before = state().branches;
        state().editSpineStructuredPRD(projectId, v1, prd('Edited.'));
        expect(state().branches).toBe(before);
    });

    it('needs no move for an in-place decision amend (the latest id is unchanged)', () => {
        state().editSpineStructuredPRD(projectId, v1, prd('Decided once.'), {
            changeSource: 'decision_edit',
            decisionDelta: { confirmed: 1 },
        });
        const decisionVersion = latestId();
        expect(byId('active-1').spineVersionId).toBe(decisionVersion);
        state().editSpineStructuredPRD(projectId, decisionVersion, prd('Decided twice.'), {
            changeSource: 'decision_edit',
            decisionDelta: { confirmed: 1 },
        });
        expect(latestId()).toBe(decisionVersion);
        expect(byId('active-1').spineVersionId).toBe(decisionVersion);
    });
});
