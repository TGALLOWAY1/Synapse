import { describe, expect, it } from 'vitest';
import type { PlanningRecord, StructuredPRD } from '../../../types';
import { appendDecisionEvent } from '../decisionProjection';
import { alignmentProposalReviews, buildDecisionImpact, buildResidualDecisionImpact, buildReviewedDecisionImpact, isDecisionImpactStale } from '../decisionImpact';
import { planningRecordNeedsAlignment } from '../planningReadiness';

const prd: StructuredPRD = {
    vision: 'v', targetUsers: [], coreProblem: 'p', features: [], architecture: 'a', risks: [],
    assumptions: [{ id: 'a1', statement: 'Guests can start anonymously', confidence: 'med' }],
};

const record: PlanningRecord = {
    id: 'd1', projectId: 'p1', type: 'assumption', status: 'confirmed',
    title: 'Guest access', statement: 'Guests can start anonymously', evidence: [], sourceFindingIds: [],
    createdBy: 'migration', createdAt: 1, updatedAt: 2, confirmedAt: 2,
    sources: [{ key: 'prd_assumption:a1', sourceType: 'prd_assumption', sourceId: 'a1', sourceVersionId: 's1' }],
    affectedPrdSections: ['Target Users', 'Features'],
    events: [
        { id: 'import', planningRecordId: 'd1', type: 'imported', actor: 'migration', at: 1 },
        { id: 'verdict', planningRecordId: 'd1', type: 'custom_answered', actor: 'user', at: 2, answer: 'Allow a limited guest session' },
    ],
};

describe('decision impact preview', () => {
    it('builds a version-bound assumption patch without changing the input PRD', () => {
        const result = buildDecisionImpact({ projectId: 'p1', record, baselineSpineVersionId: 's1', structuredPRD: prd, now: () => 10 });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.reason);
        if (!result.nextPrd) throw new Error('Expected an applicable PRD preview');
        expect(prd.assumptions?.[0].decision).toBeUndefined();
        expect(result.nextPrd.assumptions?.[0]).toMatchObject({
            decision: 'confirmed', decisionNote: 'Allow a limited guest session', decidedAt: 2,
        });
        expect(result.preview).toMatchObject({
            status: 'ready',
            baseline: { spineVersionId: 's1' },
            affectedPrdSections: ['Assumptions', 'Target Users', 'Features'],
        });
        expect(result.preview.affectedArtifactSlots).toContain('implementation_plan');
    });

    it('detects a changed spine or changed PRD content', () => {
        const result = buildDecisionImpact({ projectId: 'p1', record, baselineSpineVersionId: 's1', structuredPRD: prd, now: () => 10 });
        if (!result.ok) throw new Error(result.reason);
        expect(isDecisionImpactStale(result.preview, 's1', prd)).toBe(false);
        expect(isDecisionImpactStale(result.preview, 's2', prd)).toBe(true);
        expect(isDecisionImpactStale(result.preview, 's1', { ...prd, vision: 'changed' })).toBe(true);
    });

    it('refuses unresolved decisions and gives source-less decisions an advisory-only preview', () => {
        expect(buildDecisionImpact({ projectId: 'p1', record: { ...record, status: 'open', events: record.events?.slice(0, 1) }, baselineSpineVersionId: 's1', structuredPRD: prd }).ok).toBe(false);
        const advisory = buildDecisionImpact({ projectId: 'p1', record: { ...record, sources: [] }, baselineSpineVersionId: 's1', structuredPRD: prd });
        expect(advisory.ok).toBe(true);
        if (!advisory.ok) throw new Error(advisory.reason);
        expect(advisory.nextPrd).toBeUndefined();
        expect(advisory.preview.proposedPrdPatch).toBeUndefined();
        expect(advisory.preview.explanation).toContain('will not offer Apply to plan');
        expect(advisory.preview.alignmentProposals?.[0]).toMatchObject({ requiresInput: true });
    });

    it('turns a normal decision with a precise hint into a reviewable, non-destructive proposal', () => {
        const decision: PlanningRecord = {
            ...record,
            id: 'primary-user',
            type: 'decision',
            title: 'Who is the primary user?',
            statement: 'Choose the first audience',
            sources: [{
                key: 'user:primary-user', sourceType: 'user', sourceId: 'primary-user',
                locator: { section: 'Target Users', entityType: 'claim', jsonPath: '$.targetUsers' },
            }],
            events: [{ id: 'user-verdict', planningRecordId: 'primary-user', type: 'custom_answered', actor: 'user', at: 3, answer: 'Independent creators' }],
            affectedPlanLocations: [{ kind: 'claim', section: 'Target Users', label: 'Primary user', jsonPath: '$.targetUsers', excerpt: 'Enterprise administrators' }],
            alignmentHints: [{
                target: { kind: 'claim', section: 'Target Users', label: 'Primary user', jsonPath: '$.targetUsers', excerpt: 'Enterprise administrators' },
                operation: 'replace', proposedValue: ['Independent creators'], proposedSummary: 'Independent creators',
                reason: 'This exact claim records the selected primary audience.', requiredForVerdictAlignment: true,
            }],
        };
        const result = buildDecisionImpact({
            projectId: 'p1', record: decision, baselineSpineVersionId: 's1',
            structuredPRD: { ...prd, targetUsers: ['Enterprise administrators'] }, now: () => 10,
        });
        if (!result.ok) throw new Error(result.reason);
        expect(result.preview.alignmentProposals?.[0]).toMatchObject({
            target: { label: 'Primary user', jsonPath: '$.targetUsers' },
            proposedSummary: 'Independent creators',
        });
        // A proposal never changes the source PRD before user review.
        expect(prd.targetUsers).toEqual([]);

        const withAssessment = { ...decision, assessments: [result.assessment] };
        const accepted = appendDecisionEvent(withAssessment, {
            id: 'accept-change', planningRecordId: decision.id, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: result.preview.id, proposalId: result.preview.alignmentProposals![0].id,
            disposition: 'accepted', proposalContentHash: result.preview.alignmentProposals![0].contract?.proposalContentHash, at: 11,
        });
        if (!accepted.ok) throw new Error(accepted.reason);
        const reviewed = buildReviewedDecisionImpact({
            record: accepted.record, preview: result.preview,
            structuredPRD: { ...prd, targetUsers: ['Enterprise administrators'] },
        });
        expect(reviewed.nextPrd?.targetUsers).toEqual(['Independent creators']);
        expect(reviewed.acceptedProposalIds).toHaveLength(1);

        const edited = appendDecisionEvent(accepted.record, {
            id: 'edit-change', planningRecordId: decision.id, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: result.preview.id, proposalId: result.preview.alignmentProposals![0].id,
            disposition: 'edited', editedValue: 'Independent professional creators',
            proposalContentHash: result.preview.alignmentProposals![0].contract?.proposalContentHash, at: 12,
        });
        if (!edited.ok) throw new Error(edited.reason);
        expect(buildReviewedDecisionImpact({
            record: edited.record, preview: result.preview,
            structuredPRD: { ...prd, targetUsers: ['Enterprise administrators'] },
        }).nextPrd?.targetUsers).toEqual(['Independent professional creators']);
    });

    it('binds a technical contradiction verdict to only its exact workflow and architecture targets', () => {
        const contradicted: PlanningRecord = {
            ...record,
            id: 'browser-workflow-assumption',
            title: 'Browser automation is feasible',
            statement: 'The browser can complete the cross-origin workflow.',
            sources: [{
                key: 'prd_assumption:a1', sourceType: 'prd_assumption', sourceId: 'a1', sourceVersionId: 's1',
                locator: { section: 'Assumptions', entityType: 'assumption', entityId: 'a1', jsonPath: '$.assumptions' },
            }],
            events: [{
                id: 'assumption-validation-verdict-technical-outcome', planningRecordId: 'browser-workflow-assumption',
                type: 'premise_rejected', actor: 'user', at: 30,
                reason: 'A technical spike proved browser security prevents the workflow.',
            }],
            affectedPrdSections: [],
            affectedPlanLocations: [
                { kind: 'behavior', section: 'Features', label: 'Cross-origin workflow branch', entityType: 'feature', entityId: 'f-browser', jsonPath: '$.features' },
                { kind: 'claim', section: 'Architecture', label: 'Browser integration approach', jsonPath: '$.architecture' },
            ],
            affectedArtifactSlots: ['user_flows', 'architecture'],
        };
        const result = buildDecisionImpact({
            projectId: 'p1', record: contradicted, baselineSpineVersionId: 's1',
            structuredPRD: {
                ...prd,
                assumptions: [{ id: 'a1', statement: contradicted.statement, confidence: 'med' }],
                features: [{ id: 'f-browser', name: 'Browser workflow', description: 'Complete the cross-origin branch.', userValue: 'Automation', complexity: 'high' }],
                architecture: 'Browser-only cross-origin automation.',
            },
            now: () => 40,
        });
        if (!result.ok) throw new Error(result.reason);
        expect(result.preview.decisionEventId).toBe('assumption-validation-verdict-technical-outcome');
        expect(result.preview.alignmentProposals?.map(item => item.target.jsonPath)).toEqual(expect.arrayContaining([
            '$.assumptions', '$.features', '$.architecture',
        ]));
        expect(result.preview.alignmentProposals?.some(item => item.target.jsonPath === '$.dataModel')).toBe(false);
        expect(result.preview.affectedArtifactSlots).toEqual(['user_flows']);
        expect(result.preview.affectedArtifactSlots).not.toContain('data_model');
        expect(result.nextPrd?.assumptions?.[0]).toMatchObject({ decision: 'rejected' });
        expect(result.nextPrd?.architecture).toBe('Browser-only cross-origin automation.');
    });

    it('never turns a broad affected location into an automatic rewrite', () => {
        const decision: PlanningRecord = {
            ...record,
            id: 'scope-choice',
            type: 'decision',
            title: 'Should collaboration remain in the first release?',
            statement: 'Choose the first-release scope',
            sources: [{
                key: 'user:scope', sourceType: 'user', sourceId: 'scope',
                locator: { section: 'Features', entityType: 'feature', entityId: 'collaboration', jsonPath: '$.features' },
            }],
            events: [{
                id: 'scope-verdict', planningRecordId: 'scope-choice', type: 'custom_answered', actor: 'user', at: 3,
                answer: 'Remove collaboration from the first release',
            }],
            affectedPlanLocations: [
                { kind: 'scope', section: 'Features', label: 'Collaboration scope', entityType: 'feature', entityId: 'collaboration', jsonPath: '$.features' },
                { kind: 'claim', section: 'Architecture', label: 'Architecture approach', jsonPath: '$.architecture' },
            ],
        };
        const result = buildDecisionImpact({
            projectId: 'p1', record: decision, baselineSpineVersionId: 's1',
            structuredPRD: { ...prd, architecture: 'Shared cloud workspaces with realtime collaboration.' }, now: () => 10,
        });
        if (!result.ok) throw new Error(result.reason);

        expect(result.nextPrd).toBeUndefined();
        expect(result.preview.proposedPrdPatch).toBeUndefined();
        expect(result.preview.alignmentProposals).toEqual(expect.arrayContaining([
            expect.objectContaining({
                target: expect.objectContaining({ jsonPath: '$.architecture' }),
                operation: 'review', requiresInput: true,
            }),
        ]));
        expect(result.preview.alignmentProposals).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                target: expect.objectContaining({ jsonPath: '$.architecture' }),
                proposedSummary: 'Remove collaboration from the first release',
            }),
        ]));
    });

    it('preserves partial alignment dispositions and user-edited wording independently of the verdict', () => {
        const result = buildDecisionImpact({ projectId: 'p1', record, baselineSpineVersionId: 's1', structuredPRD: prd, now: () => 10 });
        if (!result.ok) throw new Error(result.reason);
        const proposals = result.preview.alignmentProposals!;
        let current: PlanningRecord = { ...record, assessments: [result.assessment] };
        const events = [
            {
                id: 'edit-source', planningRecordId: record.id, type: 'alignment_change_reviewed' as const, actor: 'user' as const,
                impactPreviewId: result.preview.id, proposalId: proposals[0].id, disposition: 'edited' as const,
                proposalContentHash: proposals[0].contract?.proposalContentHash,
                editedValue: 'Allow one guest project before signup', editedSummary: 'Use the preferred guest-limit wording', at: 11,
            },
            {
                id: 'defer-dependent', planningRecordId: record.id, type: 'alignment_change_reviewed' as const, actor: 'user' as const,
                impactPreviewId: result.preview.id, proposalId: proposals[1].id, disposition: 'deferred' as const, at: 12,
            },
        ];
        for (const event of events) {
            const appended = appendDecisionEvent(current, event);
            if (!appended.ok) throw new Error(appended.reason);
            current = appended.record;
        }
        expect(current.resolution).toBe('Allow a limited guest session');
        expect(alignmentProposalReviews(current, result.preview).map(item => item.disposition)).toEqual(['edited', 'deferred', 'pending']);
        const reviewed = buildReviewedDecisionImpact({ record: current, preview: result.preview, structuredPRD: prd });
        expect(reviewed.nextPrd?.assumptions?.[0].decisionNote).toBe('Allow one guest project before signup');
        expect(reviewed.deferredCount).toBe(1);
    });

    it('keeps deferred residual work actionable after a partial apply', () => {
        const partialRecord: PlanningRecord = {
            ...record,
            affectedPrdSections: [],
            affectedPlanLocations: [{ kind: 'behavior', section: 'Features', label: 'Guest save behavior', jsonPath: '$.features' }],
        };
        const result = buildDecisionImpact({ projectId: 'p1', record: partialRecord, baselineSpineVersionId: 's1', structuredPRD: prd, now: () => 10 });
        if (!result.ok) throw new Error(result.reason);
        const proposals = result.preview.alignmentProposals!;
        let current: PlanningRecord = { ...partialRecord, assessments: [result.assessment] };
        for (const event of [
            {
                id: 'accept-source', planningRecordId: current.id, type: 'alignment_change_reviewed' as const, actor: 'user' as const,
                impactPreviewId: result.preview.id, proposalId: proposals[0].id, disposition: 'accepted' as const, at: 11,
                proposalContentHash: proposals[0].contract?.proposalContentHash,
            },
            {
                id: 'defer-dependent', planningRecordId: current.id, type: 'alignment_change_reviewed' as const, actor: 'user' as const,
                impactPreviewId: result.preview.id, proposalId: proposals[1].id, disposition: 'deferred' as const, at: 12,
            },
        ]) {
            const appended = appendDecisionEvent(current, event);
            if (!appended.ok) throw new Error(appended.reason);
            current = appended.record;
        }
        const reviewed = buildReviewedDecisionImpact({ record: current, preview: result.preview, structuredPRD: prd });
        if (!reviewed.nextPrd) throw new Error('Expected the accepted source change');
        const applied = appendDecisionEvent(current, {
            id: 'apply-source', planningRecordId: current.id, type: 'applied_to_plan', actor: 'user',
            impactPreviewId: result.preview.id, baselineSpineVersionId: 's1', resultingSpineVersionId: 's2', at: 13,
        });
        if (!applied.ok) throw new Error(applied.reason);
        const residual = buildResidualDecisionImpact({
            record: applied.record, preview: result.preview, structuredPRD: reviewed.nextPrd,
            baselineSpineVersionId: 's2', appliedProposalIds: reviewed.acceptedProposalIds, now: () => 14,
        });
        if (!residual) throw new Error('Expected a residual review');
        expect(residual.preview.status).toBe('ready');
        expect(residual.preview.alignmentProposals).toHaveLength(1);
        expect(residual.preview.alignmentProposals?.[0]).toMatchObject({ target: { label: 'Guest save behavior' }, requiresInput: true });

        const withResidual = { ...applied.record, assessments: [...(applied.record.assessments ?? []), residual.assessment] };
        expect(planningRecordNeedsAlignment(withResidual)).toBe(true);
        const dismissed = appendDecisionEvent(withResidual, {
            id: 'not-affected', planningRecordId: current.id, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: residual.preview.id, proposalId: residual.preview.alignmentProposals![0].id,
            disposition: 'rejected', at: 15,
        });
        if (!dismissed.ok) throw new Error(dismissed.reason);
        expect(planningRecordNeedsAlignment(dismissed.record)).toBe(false);
    });
});
