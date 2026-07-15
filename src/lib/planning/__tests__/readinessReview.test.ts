import { describe, expect, it } from 'vitest';
import type {
    PlanningRecord,
    ReviewRun,
    SpecialistRun,
    StructuredPRD,
} from '../../../types';
import { hashReviewValue } from '../../review/hash';
import type { ProjectOutputAlignmentSummary } from '../outputAlignment';
import {
    compareReadinessReviewCurrentness,
    deriveReadinessReview,
    type ReadinessReviewInput,
    validateReadinessReviewIntegrity,
} from '../readinessReview';

const content = '# Product plan\nA complete visible planning foundation.';

const prd: StructuredPRD = {
    vision: 'Help teams decide what deserves to be built.',
    coreProblem: 'Teams commit implementation effort before resolving consequential uncertainty.',
    targetUsers: ['Product teams preparing a consequential implementation plan.'],
    architecture: 'A versioned planning workspace.',
    risks: [],
    successMetrics: [{ name: 'Validated plans', target: 'Material uncertainty resolved before implementation.' }],
    features: [{
        id: 'f1', name: 'Decision workflow', description: 'Resolve consequential choices.',
        userValue: 'A plan the team can trust.', complexity: 'medium', tier: 'mvp', confirmed: true,
    }],
};

const reviewRun = (overrides: Partial<ReviewRun> = {}): ReviewRun => ({
    id: 'review-1', projectId: 'p1', sequenceNumber: 1,
    scope: { kind: 'project' },
    sourceManifest: {
        spineVersionId: 'spine-1', spineContentHash: hashReviewValue(content), artifactRefs: [],
        capturedAt: 10, contextSignature: 'context-1',
    },
    selectedSpecialists: [{ specialistId: 'product_scope', label: 'Product & Scope', reason: 'Required coverage.' }],
    status: 'complete', synthesisStatus: 'complete', createdAt: 10, completedAt: 20,
    ...overrides,
});

const specialistRun = (overrides: Partial<SpecialistRun> = {}): SpecialistRun => ({
    id: 'specialist-1', projectId: 'p1', reviewId: 'review-1', specialistId: 'product_scope',
    responsibility: 'Test scope and assumptions.', boundaries: [], contextRefIds: [], status: 'complete',
    attemptCount: 1, findingIds: [], coverageSummary: 'Reviewed product scope and material uncertainty.',
    validation: { valid: true, unsupportedEvidenceIds: [], warnings: [] }, createdAt: 10, completedAt: 20,
    ...overrides,
});

const emptyAlignment: ProjectOutputAlignmentSummary = {
    outputs: [], alignedCount: 0, possiblyAffectedCount: 0, staleCount: 0, blockingCount: 0,
};

const input = (overrides: Partial<ReadinessReviewInput> = {}): ReadinessReviewInput => ({
    projectId: 'p1',
    spine: { versionId: 'spine-1', content, structuredPRD: prd, incompleteSectionCount: 0 },
    planningRecords: [], reviewRuns: [reviewRun()], specialistRuns: [specialistRun()], reviewIssues: [],
    outputAlignment: emptyAlignment, createdAt: 100,
    ...overrides,
});

const record = (overrides: Partial<PlanningRecord> = {}): PlanningRecord => ({
    id: 'record-1', projectId: 'p1', type: 'assumption', status: 'open', title: 'Material assumption',
    statement: 'Teams will trust generated recommendations without seeing their basis.', evidence: [],
    sourceFindingIds: [], createdBy: 'user', createdAt: 1, updatedAt: 1,
    ...overrides,
});

describe('deterministic readiness review', () => {
    it('produces an integrity-valid ready review only with substantive current challenge coverage', () => {
        const review = deriveReadinessReview(input());
        expect(review.conclusion).toBe('ready_to_build');
        expect(review.schemaVersion).toBe(1);
        expect(review.criteriaVersion).toBe(1);
        expect(review.criteria.map(item => item.id)).toEqual([
            'problem', 'user', 'outcome', 'scope', 'decisions', 'assumptions', 'risks',
            'plan_alignment', 'challenge', 'downstream_alignment',
        ]);
        expect(validateReadinessReviewIntegrity(review)).toBe(true);
    });

    it('does not treat an accepted material assumption without verified evidence as validated', () => {
        const assumption = record({
            status: 'confirmed', materiality: 'high',
            events: [{ id: 'verdict-1', planningRecordId: 'record-1', type: 'custom_answered', actor: 'user', at: 2, answer: 'Yes' }],
        });
        const review = deriveReadinessReview(input({ planningRecords: [assumption] }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.criteria.find(item => item.id === 'assumptions')).toMatchObject({ status: 'attention', blocking: true });
        expect(review.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'assumption', blocking: true, evidenceQuality: 'incomplete' }),
        ]));
    });

    it('keeps a deferred consequential propagation proposal blocking', () => {
        const decision: PlanningRecord = record({
            type: 'decision', status: 'confirmed', materiality: 'high',
            events: [
                { id: 'verdict-1', planningRecordId: 'record-1', type: 'custom_answered', actor: 'user', at: 2, answer: 'Independent creators' },
                { id: 'review-1', planningRecordId: 'record-1', type: 'alignment_change_reviewed', actor: 'user', at: 3, impactPreviewId: 'impact-1', proposalId: 'proposal-1', disposition: 'deferred' },
            ],
            assessments: [{
                id: 'assessment-1', projectId: 'p1', planningRecordId: 'record-1', sourceSpineVersionId: 'spine-1',
                status: 'fresh', evidence: [], inferredAssumptions: [], possibleConflictRecordIds: [], createdAt: 2,
                impactPreview: {
                    id: 'impact-1', projectId: 'p1', planningRecordId: 'record-1', decisionEventId: 'verdict-1', status: 'ready',
                    baseline: { spineVersionId: 'spine-1', spineContentHash: hashReviewValue(content) },
                    affectedPrdSections: ['Target users'], affectedArtifactSlots: [], possibleConflictRecordIds: [], createdAt: 2,
                    alignmentProposals: [{
                        id: 'proposal-1', target: { kind: 'claim', section: 'Target users', label: 'Primary user', jsonPath: '$.targetUsers' },
                        operation: 'replace', proposedValue: ['Independent creators'], proposedSummary: 'Independent creators',
                        reason: 'Reflect the verdict.', confidence: 'definite', requiredForVerdictAlignment: true,
                    }],
                },
            }],
        });
        const review = deriveReadinessReview(input({ planningRecords: [decision] }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.criteria.find(item => item.id === 'plan_alignment')).toMatchObject({ status: 'attention', blocking: true });
        expect(review.concerns.some(item => item.kind === 'propagation')).toBe(true);
    });

    it('rejects a shallow challenge with incomplete validation or coverage', () => {
        const review = deriveReadinessReview(input({
            specialistRuns: [specialistRun({ validation: { valid: false, unsupportedEvidenceIds: ['e1'], warnings: ['unsupported'] } })],
        }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.criteria.find(item => item.id === 'challenge')).toMatchObject({ status: 'not_started', blocking: true });
    });

    it('blocks a definite stale downstream output', () => {
        const outputAlignment: ProjectOutputAlignmentSummary = {
            outputs: [{
                artifactId: 'artifact-1', nodeId: 'implementation_plan', title: 'Implementation Plan', state: 'stale',
                confidence: 'definite', summary: 'The implementation plan contradicts current scope.', reasons: ['Removed scope remains.'],
                nextAction: 'Update it.', usefulForExploration: true, blocksBuildReadiness: true, generatedFromSpineId: 'spine-0',
            }],
            alignedCount: 0, possiblyAffectedCount: 0, staleCount: 1, blockingCount: 1,
        };
        const review = deriveReadinessReview(input({ outputAlignment }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.criteria.find(item => item.id === 'downstream_alignment')).toMatchObject({ blocking: true });
        expect(review.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'downstream', source: expect.objectContaining({ sourceId: 'artifact-1' }) }),
        ]));
    });

    it('treats the same visible content on a new spine as historical identity, not current', () => {
        const review = deriveReadinessReview(input());
        const comparison = compareReadinessReviewCurrentness(review, input({
            spine: { versionId: 'spine-2', content, structuredPRD: prd, incompleteSectionCount: 0 },
        }));
        expect(comparison).toMatchObject({ current: false, historical: true, integrityValid: true });
        expect(comparison.reasons).toContain('spine_identity_changed');
        expect(comparison.reasons).not.toContain('spine_content_changed');
    });

    it('detects stale content even when a spine id is reused', () => {
        const review = deriveReadinessReview(input());
        const comparison = compareReadinessReviewCurrentness(review, input({
            spine: { versionId: 'spine-1', content: `${content}\nChanged`, structuredPRD: prd, incompleteSectionCount: 0 },
        }));
        expect(comparison.reasons).toContain('spine_content_changed');
        expect(comparison.reasons).not.toContain('spine_identity_changed');
    });

    it('detects a changed planning state independently of visible spine content', () => {
        const review = deriveReadinessReview(input());
        const comparison = compareReadinessReviewCurrentness(review, input({
            planningRecords: [record({ id: 'low-risk', type: 'risk', materiality: 'low' })],
        }));
        expect(comparison.reasons).toContain('planning_state_changed');
    });

    it('makes a persisted review historical when criteria semantics change', () => {
        const review = deriveReadinessReview(input());
        const comparison = compareReadinessReviewCurrentness(review, input(), { criteriaVersion: 2 });
        expect(comparison.reasons).toContain('criteria_changed');
        expect(comparison.current).toBe(false);
    });

    it('fails closed when a persisted review is tampered', () => {
        const review = deriveReadinessReview(input());
        const tampered = { ...review, conclusion: 'not_ready' as const };
        expect(validateReadinessReviewIntegrity(tampered)).toBe(false);
        expect(compareReadinessReviewCurrentness(tampered, input())).toMatchObject({
            current: false, historical: false, integrityValid: false,
        });
    });
});
