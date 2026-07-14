import { beforeEach, describe, expect, it } from 'vitest';
import type { PlanningRecord, StructuredPRD } from '../../types';
import {
    appendDecisionEvent,
    buildDecisionImpact,
    buildReviewedDecisionImpact,
    planningContentHash,
} from '../../lib/planning';
import { useProjectStore } from '../projectStore';
import { alignmentProposalContentHash } from '../../lib/planning/proposalIntegrity';

const prd = (overrides: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'Help teams coordinate.',
    targetUsers: ['Enterprise administrators'],
    coreProblem: 'Shared planning is fragmented.',
    features: [],
    architecture: 'Cloud-synchronized web application.',
    risks: [],
    ...overrides,
});

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        planningRecords: {},
        reviewRuns: {},
        specialistRuns: {},
        reviewFindings: {},
        reviewIssues: {},
    });
    localStorage.clear();
});

describe('Phase 1 guarded partial propagation', () => {
    it('rejects a tampered partial result while preserving reviewed dispositions and append-only history', () => {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('P', 'idea');
        const baseline = prd();
        store.updateSpineStructuredPRD(projectId, spineId, baseline, 'baseline');

        const record: PlanningRecord = {
            id: 'audience',
            projectId,
            type: 'decision',
            status: 'confirmed',
            title: 'Primary user',
            statement: 'Choose the primary audience.',
            evidence: [],
            sourceFindingIds: [],
            createdBy: 'user',
            createdAt: 1,
            updatedAt: 2,
            events: [{
                id: 'audience-verdict',
                planningRecordId: 'audience',
                type: 'custom_answered',
                actor: 'user',
                answer: 'Independent creators',
                at: 2,
            }],
            alignmentHints: [
                {
                    target: {
                        kind: 'claim',
                        section: 'Target Users',
                        label: 'Primary users',
                        jsonPath: '$.targetUsers',
                        excerpt: 'Enterprise administrators',
                    },
                    operation: 'replace',
                    proposedValue: ['Independent creators'],
                    proposedSummary: 'Independent creators',
                    reason: 'The chosen audience changes this exact claim.',
                    confidence: 'definite',
                },
                {
                    target: {
                        kind: 'claim',
                        section: 'Architecture',
                        label: 'Architecture approach',
                        jsonPath: '$.architecture',
                        excerpt: baseline.architecture,
                    },
                    operation: 'replace',
                    proposedValue: 'Creator-focused cloud application.',
                    proposedSummary: 'Creator-focused cloud application.',
                    reason: 'The existing enterprise framing may no longer fit.',
                    confidence: 'likely',
                },
            ],
        };
        const impact = buildDecisionImpact({
            projectId,
            record,
            baselineSpineVersionId: spineId,
            structuredPRD: baseline,
            now: () => 3,
        });
        if (!impact.ok) throw new Error(impact.reason);
        let reviewedRecord: PlanningRecord = { ...record, assessments: [impact.assessment] };
        const [audienceProposal, architectureProposal] = impact.preview.alignmentProposals ?? [];
        for (const event of [
            {
                id: 'accept-audience',
                planningRecordId: record.id,
                type: 'alignment_change_reviewed' as const,
                actor: 'user' as const,
                impactPreviewId: impact.preview.id,
                proposalId: audienceProposal.id,
                disposition: 'accepted' as const,
                proposalContentHash: audienceProposal.contract?.proposalContentHash,
                at: 4,
            },
            {
                id: 'defer-architecture',
                planningRecordId: record.id,
                type: 'alignment_change_reviewed' as const,
                actor: 'user' as const,
                impactPreviewId: impact.preview.id,
                proposalId: architectureProposal.id,
                disposition: 'deferred' as const,
                at: 5,
            },
        ]) {
            const appended = appendDecisionEvent(reviewedRecord, event);
            if (!appended.ok) throw new Error(appended.reason);
            reviewedRecord = appended.record;
        }

        // The store boundary must reject an otherwise-valid subset when a
        // second accepted proposal was changed after the user's review.
        const acceptedArchitecture = appendDecisionEvent(reviewedRecord, {
            id: 'accept-architecture', planningRecordId: record.id, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: impact.preview.id, proposalId: architectureProposal.id, disposition: 'accepted',
            proposalContentHash: architectureProposal.contract?.proposalContentHash, at: 6,
        });
        if (!acceptedArchitecture.ok) throw new Error(acceptedArchitecture.reason);
        const changedArchitectureBase = {
            ...architectureProposal,
            proposedValue: 'Tampered architecture wording.',
            proposedSummary: 'Tampered architecture wording.',
        };
        const changedArchitecture = {
            ...changedArchitectureBase,
            contract: {
                ...architectureProposal.contract!,
                proposalContentHash: alignmentProposalContentHash(changedArchitectureBase),
            },
        };
        const tamperedPreview = {
            ...impact.preview,
            alignmentProposals: [audienceProposal, changedArchitecture],
            proposedPrdPatch: impact.preview.proposedPrdPatch?.map(patch => patch.proposalId === architectureProposal.id
                ? { ...patch, value: 'Tampered architecture wording.' }
                : patch),
        };
        const acceptedBothRecord: PlanningRecord = {
            ...acceptedArchitecture.record,
            assessments: acceptedArchitecture.record.assessments?.map(assessment => assessment.impactPreview?.id === impact.preview.id
                ? { ...assessment, impactPreview: tamperedPreview }
                : assessment),
        };
        useProjectStore.setState({ planningRecords: { [projectId]: [acceptedBothRecord] } });
        const unsafeSubset = buildReviewedDecisionImpact({ record: acceptedBothRecord, preview: tamperedPreview, structuredPRD: baseline });
        expect(unsafeSubset.acceptedProposalIds).toEqual([audienceProposal.id]);
        expect(unsafeSubset.rejectedProposalIds).toEqual([architectureProposal.id]);
        const beforeAtomicCheck = useProjectStore.getState().spineVersions[projectId];
        const atomicResult = useProjectStore.getState().compareAndAppendStructuredPRD(projectId, spineId, unsafeSubset.nextPrd!, {
            expectedPrdHash: planningContentHash(baseline),
            decisionApplication: {
                planningRecordId: record.id, decisionEventId: 'audience-verdict',
                impactPreviewId: impact.preview.id, appliedEventId: 'unsafe-subset-apply',
            },
        });
        expect(atomicResult).toMatchObject({ status: 'stale', reason: 'decision_changed' });
        expect(useProjectStore.getState().spineVersions[projectId]).toBe(beforeAtomicCheck);
        expect(useProjectStore.getState().planningRecords[projectId][0].events?.some(event => event.id === 'unsafe-subset-apply')).toBe(false);

        const restoredDeferred = appendDecisionEvent(acceptedArchitecture.record, {
            id: 'defer-architecture-again', planningRecordId: record.id, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: impact.preview.id, proposalId: architectureProposal.id, disposition: 'deferred', at: 7,
        });
        if (!restoredDeferred.ok) throw new Error(restoredDeferred.reason);
        reviewedRecord = restoredDeferred.record;
        useProjectStore.setState({ planningRecords: { [projectId]: [reviewedRecord] } });

        const reviewed = buildReviewedDecisionImpact({
            record: reviewedRecord,
            preview: impact.preview,
            structuredPRD: baseline,
        });
        expect(reviewed.nextPrd).toMatchObject({
            targetUsers: ['Independent creators'],
            architecture: baseline.architecture,
        });
        expect(reviewed.deferredCount).toBe(1);

        const tamperedResult = {
            ...reviewed.nextPrd!,
            architecture: 'Local-only application silently added to the patch.',
        };
        const beforeSpines = useProjectStore.getState().spineVersions[projectId];
        const tampered = useProjectStore.getState().compareAndAppendStructuredPRD(projectId, spineId, tamperedResult, {
            expectedPrdHash: planningContentHash(baseline),
            decisionApplication: {
                planningRecordId: record.id,
                decisionEventId: 'audience-verdict',
                impactPreviewId: impact.preview.id,
                appliedEventId: 'tampered-apply',
            },
        });

        expect(tampered).toMatchObject({ status: 'stale', reason: 'decision_changed' });
        expect(useProjectStore.getState().spineVersions[projectId]).toBe(beforeSpines);
        expect(useProjectStore.getState().planningRecords[projectId][0].events?.some(event => event.id === 'tampered-apply')).toBe(false);

        const applied = useProjectStore.getState().compareAndAppendStructuredPRD(projectId, spineId, reviewed.nextPrd!, {
            expectedPrdHash: planningContentHash(baseline),
            decisionApplication: {
                planningRecordId: record.id,
                decisionEventId: 'audience-verdict',
                impactPreviewId: impact.preview.id,
                appliedEventId: 'valid-partial-apply',
            },
        });
        expect(applied.status).toBe('applied');
        const latest = useProjectStore.getState().spineVersions[projectId].find(version => version.isLatest);
        expect(latest?.structuredPRD).toMatchObject({
            targetUsers: ['Independent creators'],
            architecture: baseline.architecture,
        });
        const finalEvents = useProjectStore.getState().planningRecords[projectId][0].events ?? [];
        expect(finalEvents.filter(event => event.type === 'applied_to_plan')).toHaveLength(1);
        expect(finalEvents.find(event => event.id === 'defer-architecture')).toBeDefined();
    });
});
