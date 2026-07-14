import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { PlanningRecord, StructuredPRD } from '../../types';
import { renderPremiumMarkdown } from '../../lib/services/prdMarkdownRenderer';
import { buildDecisionImpact, buildReviewedDecisionImpact, planningContentHash } from '../../lib/planning';

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
    });
    localStorage.clear();
});

const prd = (vision: string): StructuredPRD => ({
    vision,
    targetUsers: ['PMs'],
    coreProblem: 'slow specs',
    features: [],
    architecture: 'SPA',
    risks: [],
});

describe('editSpineStructuredPRD', () => {
    it('appends a new version instead of mutating in place', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('original'), 'original md');

        store.editSpineStructuredPRD(projectId, v1.id, prd('edited'), {
            responseText: 'edited md',
            editSummary: 'Updated section: Vision',
        });

        const spines = useProjectStore.getState().spineVersions[projectId];
        expect(spines).toHaveLength(2);
        // Original content still retrievable.
        const original = spines.find(s => s.id === v1.id)!;
        expect(original.structuredPRD?.vision).toBe('original');
        expect(original.isLatest).toBe(false);
        // New version is latest with the edit + provenance.
        const latest = spines.find(s => s.isLatest)!;
        expect(latest.id).not.toBe(v1.id);
        expect(latest.structuredPRD?.vision).toBe('edited');
        expect(latest.responseText).toBe('edited md');
        expect(latest.isFinal).toBe(false);
        expect(latest.provenance?.changeSource).toBe('user_edit');
        expect(latest.provenance?.editSummary).toBe('Updated section: Vision');
    });

    it('pushes an Edited history event', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.editSpineStructuredPRD(projectId, v1.id, prd('edited'), { editSummary: 'Edited feature: X' });

        const events = useProjectStore.getState().historyEvents[projectId];
        const edited = events.find(e => e.type === 'Edited')!;
        expect(edited).toBeDefined();
        expect(edited.description).toBe('Edited feature: X');
    });

    it('keeps positional version labels correct (only one isLatest)', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.editSpineStructuredPRD(projectId, v1.id, prd('e1'));
        const latest1 = useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;
        store.editSpineStructuredPRD(projectId, latest1.id, prd('e2'));

        const spines = useProjectStore.getState().spineVersions[projectId];
        expect(spines).toHaveLength(3);
        expect(spines.filter(s => s.isLatest)).toHaveLength(1);
    });

    it('carries generation meta overrides onto the new version (section retry)', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.editSpineStructuredPRD(projectId, v1.id, prd('retried'), {
            changeSource: 'ai_section_retry',
            editSummary: 'Regenerated section: Architecture',
            meta: { model: 'gemini-x' },
        });
        const latest = useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;
        expect(latest.provenance?.changeSource).toBe('ai_section_retry');
        expect(latest.model).toBe('gemini-x');
    });

    it('rebuilds canonical metadata for the appended version id', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('original'), 'md', {
            generationMeta: { passes: [], totalMs: 1, revised: false, schemaVersion: 2 },
            prdVersion: 2,
        });

        const { newSpineId } = store.editSpineStructuredPRD(projectId, v1.id, prd('edited'));
        const latest = useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;

        expect(latest.id).toBe(newSpineId);
        expect(latest.canonicalSpine?.meta.sourceSpineVersionId).toBe(newSpineId);
        expect(latest.canonicalSpine?.meta.sourcePrdVersion).toBe(2);
        expect(latest.canonicalSpine?.identity.primaryGoal).toBe('edited');
    });
});

describe('compareAndAppendStructuredPRD', () => {
    it('returns stale and writes nothing when the expected baseline is no longer latest', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        const { newSpineId: v2Id } = store.editSpineStructuredPRD(projectId, v1.id, prd('v2'));
        const beforeSpines = useProjectStore.getState().spineVersions[projectId];
        const beforeEvents = useProjectStore.getState().historyEvents[projectId];

        const result = store.compareAndAppendStructuredPRD(projectId, v1.id, prd('stale change'));

        expect(result).toEqual({
            status: 'stale',
            expectedLatestSpineId: v1.id,
            actualLatestSpineId: v2Id,
            reason: 'spine_changed',
        });
        expect(useProjectStore.getState().spineVersions[projectId]).toBe(beforeSpines);
        expect(useProjectStore.getState().historyEvents[projectId]).toBe(beforeEvents);
    });

    it('atomically appends rendered PRD, canonical metadata, provenance, and history', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('v1'), 'old markdown', {
            generationMeta: { passes: [], totalMs: 1, revised: false, schemaVersion: 2 },
            prdVersion: 2,
        });
        const revised = prd('decision-applied vision');

        const result = store.compareAndAppendStructuredPRD(projectId, v1.id, revised, {
            editSummary: 'Applied decision: onboarding mode',
        });

        expect(result.status).toBe('applied');
        if (result.status !== 'applied') throw new Error('expected applied result');
        const spines = useProjectStore.getState().spineVersions[projectId];
        const latest = spines.find(s => s.isLatest)!;
        expect(spines).toHaveLength(2);
        expect(latest.id).toBe(result.newSpineId);
        expect(latest.responseText).toBe(renderPremiumMarkdown(revised));
        expect(latest.canonicalSpine?.meta.sourceSpineVersionId).toBe(result.newSpineId);
        expect(latest.canonicalSpine?.meta.sourcePrdVersion).toBe(2);
        expect(latest.provenance).toMatchObject({
            changeSource: 'user_edit',
            editSummary: 'Applied decision: onboarding mode',
        });
        expect(useProjectStore.getState().historyEvents[projectId]).toContainEqual(
            expect.objectContaining({
                spineVersionId: result.newSpineId,
                type: 'Edited',
                description: 'Applied decision: onboarding mode',
            }),
        );
    });

    it('atomically records the applied decision and rejects a changed verdict', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('v1'), 'old markdown', {
            generationMeta: { passes: [], totalMs: 1, revised: false, schemaVersion: 2 },
        });
        useProjectStore.setState({
            planningRecords: {
                [projectId]: [{
                    id: 'decision-1', projectId, type: 'decision', status: 'confirmed', title: 'Guest access',
                    statement: 'Allow guests?', evidence: [], sourceFindingIds: [], createdBy: 'user',
                    createdAt: 1, updatedAt: 2, confirmedAt: 2,
                    events: [{ id: 'verdict-1', planningRecordId: 'decision-1', type: 'custom_answered', actor: 'user', answer: 'Yes', at: 2 }],
                    assessments: [{
                        id: 'assessment-1', projectId, planningRecordId: 'decision-1', sourceSpineVersionId: v1.id,
                        status: 'fresh', evidence: [], inferredAssumptions: [], possibleConflictRecordIds: [], createdAt: 3,
                        impactPreview: {
                            id: 'preview-1', projectId, planningRecordId: 'decision-1', decisionEventId: 'verdict-1',
                            status: 'ready', baseline: { spineVersionId: v1.id, spineContentHash: planningContentHash(prd('v1')) },
                            proposedResultHash: planningContentHash(prd('applied')), affectedPrdSections: ['Vision'],
                            affectedArtifactSlots: [], possibleConflictRecordIds: [], createdAt: 3,
                        },
                    }],
                }],
            },
        });

        const tampered = useProjectStore.getState().compareAndAppendStructuredPRD(projectId, v1.id, prd('not-the-previewed-result'), {
            expectedPrdHash: planningContentHash(prd('v1')),
            decisionApplication: {
                planningRecordId: 'decision-1', decisionEventId: 'verdict-1',
                impactPreviewId: 'preview-1', appliedEventId: 'tampered-apply',
            },
        });
        expect(tampered).toMatchObject({ status: 'stale', reason: 'decision_changed' });

        const result = useProjectStore.getState().compareAndAppendStructuredPRD(projectId, v1.id, prd('applied'), {
            expectedPrdHash: planningContentHash(prd('v1')),
            decisionApplication: {
                planningRecordId: 'decision-1', decisionEventId: 'verdict-1',
                impactPreviewId: 'preview-1', appliedEventId: 'applied-1',
            },
        });
        expect(result.status).toBe('applied');
        const appliedRecord = useProjectStore.getState().planningRecords[projectId][0];
        expect(appliedRecord.events?.at(-1)).toMatchObject({
            type: 'applied_to_plan', impactPreviewId: 'preview-1',
        });
        if (result.status === 'applied') {
            expect(appliedRecord.resultingSpineVersionId).toBe(result.newSpineId);
        }

        const before = useProjectStore.getState().spineVersions[projectId];
        const stale = useProjectStore.getState().compareAndAppendStructuredPRD(projectId, result.status === 'applied' ? result.newSpineId : v1.id, prd('bad'), {
            decisionApplication: {
                planningRecordId: 'decision-1', decisionEventId: 'older-verdict',
                impactPreviewId: 'preview-2', appliedEventId: 'applied-2',
            },
        });
        expect(stale).toMatchObject({ status: 'stale', reason: 'decision_changed' });
        expect(useProjectStore.getState().spineVersions[projectId]).toBe(before);
    });

    it('applies only user-accepted alignment proposals for a general decision', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const spine = useProjectStore.getState().spineVersions[projectId][0];
        const baseline = { ...prd('Serve enterprise teams'), targetUsers: ['Enterprise administrators'] };
        store.updateSpineStructuredPRD(projectId, spine.id, baseline, 'baseline');
        const record: PlanningRecord = {
            id: 'audience-decision', projectId, type: 'decision', status: 'confirmed',
            title: 'Primary audience', statement: 'Who should the first release serve?', evidence: [], sourceFindingIds: [],
            createdBy: 'user', createdAt: 1, updatedAt: 2,
            events: [{ id: 'audience-verdict', planningRecordId: 'audience-decision', type: 'custom_answered', actor: 'user', answer: 'Independent creators', at: 2 }],
            alignmentHints: [{
                target: { kind: 'claim', section: 'Target Users', label: 'Primary audience', jsonPath: '$.targetUsers', excerpt: 'Enterprise administrators' },
                operation: 'replace', proposedValue: ['Independent creators'], proposedSummary: 'Serve independent creators first.',
                reason: 'Reflect the selected audience.', confidence: 'definite',
            }],
        };
        const impact = buildDecisionImpact({ projectId, record, baselineSpineVersionId: spine.id, structuredPRD: baseline, now: () => 3 });
        if (!impact.ok) throw new Error(impact.reason);
        useProjectStore.setState({ planningRecords: { [projectId]: [{ ...record, assessments: [impact.assessment] }] } });
        const proposalId = impact.preview.alignmentProposals![0].id;
        const reviewedEvent = useProjectStore.getState().appendPlanningDecisionEvent(projectId, record.id, {
            id: 'accept-audience', planningRecordId: record.id, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: impact.preview.id, proposalId, disposition: 'accepted', at: 4,
        });
        expect(reviewedEvent.ok).toBe(true);
        const reviewedRecord = useProjectStore.getState().planningRecords[projectId][0];
        const reviewed = buildReviewedDecisionImpact({ record: reviewedRecord, preview: impact.preview, structuredPRD: baseline });
        if (!reviewed.nextPrd) throw new Error('Expected accepted change');
        const applied = useProjectStore.getState().compareAndAppendStructuredPRD(projectId, spine.id, reviewed.nextPrd, {
            expectedPrdHash: impact.preview.baseline.spineContentHash,
            decisionApplication: {
                planningRecordId: record.id, decisionEventId: 'audience-verdict', impactPreviewId: impact.preview.id, appliedEventId: 'apply-audience',
            },
        });
        expect(applied.status).toBe('applied');
        expect(useProjectStore.getState().spineVersions[projectId].find(item => item.isLatest)?.structuredPRD?.targetUsers).toEqual(['Independent creators']);
    });
});

describe('revertSpineToVersion', () => {
    it('appends a new latest version cloning the source and preserves history', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('v1 content'), 'v1 md');
        // Two edits → v2, v3.
        store.editSpineStructuredPRD(projectId, v1.id, prd('v2 content'));
        const v2 = useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;
        store.editSpineStructuredPRD(projectId, v2.id, prd('v3 content'));

        // Revert to v1.
        store.revertSpineToVersion(projectId, v1.id);

        const spines = useProjectStore.getState().spineVersions[projectId];
        expect(spines).toHaveLength(4);
        // v1 still exists.
        expect(spines.find(s => s.id === v1.id)).toBeDefined();
        const latest = spines.find(s => s.isLatest)!;
        expect(latest.structuredPRD?.vision).toBe('v1 content');
        expect(latest.responseText).toBe('v1 md');
        expect(latest.provenance?.changeSource).toBe('revert');
        expect(latest.provenance?.revertedFromVersionId).toBe(v1.id);
        expect(latest.isFinal).toBe(false);
    });

    it('pushes a Reverted history event', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.editSpineStructuredPRD(projectId, v1.id, prd('v2'));
        store.revertSpineToVersion(projectId, v1.id);
        const events = useProjectStore.getState().historyEvents[projectId];
        expect(events.some(e => e.type === 'Reverted')).toBe(true);
    });

    it('rebuilds canonical metadata for the restored version id', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('v1'), 'v1 md', {
            generationMeta: { passes: [], totalMs: 1, revised: false, schemaVersion: 2 },
            prdVersion: 2,
        });
        store.editSpineStructuredPRD(projectId, v1.id, prd('v2'));

        const { newSpineId } = store.revertSpineToVersion(projectId, v1.id);
        const latest = useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;

        expect(latest.id).toBe(newSpineId);
        expect(latest.canonicalSpine?.meta.sourceSpineVersionId).toBe(newSpineId);
        expect(latest.canonicalSpine?.identity.primaryGoal).toBe('v1');
    });
});

describe('legacy spines without provenance', () => {
    it('edit works on a spine that has no provenance field', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        expect(v1.provenance).toBeUndefined();
        expect(() => store.editSpineStructuredPRD(projectId, v1.id, prd('x'))).not.toThrow();
    });
});
