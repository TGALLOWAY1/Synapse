import { describe, expect, it } from 'vitest';
import type {
    PlanningRecord,
    ReviewIssue,
    ReviewRun,
    SpecialistRun,
    StructuredPRD,
} from '../../../types';
import { hashEvidenceExcerpt, hashReviewValue } from '../../review/hash';
import { buildReviewContextManifest } from '../../review/manifest';
import type { ProjectOutputAlignmentSummary } from '../outputAlignment';
import { appendDecisionEvent } from '../decisionProjection';
import {
    appendAssumptionValidationEvent,
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    assumptionValidationDecisionEvent,
    projectAssumptionValidation,
    sealAssumptionEvidence,
    sealAssumptionValidationEvent,
    sealAssumptionValidationPlan,
} from '../assumptionValidation';
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
    risks: ['Teams may rely on an unvalidated product assumption.'],
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
    requiredSpecialistIds: ['product_scope'],
    status: 'complete', synthesisStatus: 'complete', createdAt: 10, completedAt: 20,
    ...overrides,
});

const coverageManifest = buildReviewContextManifest({
    projectId: 'p1', projectName: 'Readiness project',
    spine: { versionId: 'spine-1', content, structuredPRD: prd }, artifacts: [],
});

const coveragePathByArea = {
    problem: 'prd.coreProblem', primary_user: 'prd.targetUsers', intended_outcome: 'prd.successMetrics',
    first_release_scope: 'prd.features.f1', material_assumptions: 'prd.risks',
} as const;

const productCoverageChecks: NonNullable<SpecialistRun['coverageChecks']> = [
    'problem', 'primary_user', 'intended_outcome', 'first_release_scope', 'material_assumptions',
].map(area => ({
    area: area as NonNullable<SpecialistRun['coverageChecks']>[number]['area'],
    conclusion: `The ${area.replaceAll('_', ' ')} is explicitly represented in the reviewed plan.`,
    evidence: [(() => {
        const locator = coverageManifest.locators.find(item => item.path === coveragePathByArea[area as keyof typeof coveragePathByArea])!;
        return {
            id: locator.id, sourceType: 'spine' as const, sourceId: 'spine-1', sourceVersionId: 'spine-1',
            locator: { section: locator.label, jsonPath: locator.path },
            excerpt: locator.excerpt, excerptHash: locator.excerptHash, verified: true,
        };
    })()],
}));

const specialistRun = (overrides: Partial<SpecialistRun> = {}): SpecialistRun => ({
    id: 'specialist-1', projectId: 'p1', reviewId: 'review-1', specialistId: 'product_scope',
    responsibility: 'Test scope and assumptions.', boundaries: [], contextRefIds: ['spine:spine-1'], status: 'complete',
    attemptCount: 1, findingIds: [], coverageSummary: 'Reviewed product scope and material uncertainty.',
    resolvedAreas: ['Problem, primary user, outcome, and first-release scope were reviewed.'],
    coverageChecks: productCoverageChecks,
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

const evidenceValidatedRecord = (expiresAt?: number): PlanningRecord => {
    let current = record({ status: 'open', materiality: 'high', events: [] });
    const plan = sealAssumptionValidationPlan({
        id: 'validation-plan', question: 'Will teams use the reasoning trace before implementation?',
        method: { kind: 'usability_observation', label: 'Observed planning session' },
        supportSignals: ['Team reviews the trace before committing'], contradictionSignals: ['Team bypasses the trace'],
        inconclusiveConditions: [], limitations: ['One product team'], expiresAt, authoredBy: 'user', createdAt: 10,
    });
    const planned = appendAssumptionValidationEvent(current, sealAssumptionValidationEvent({
        id: 'plan-event', planningRecordId: current.id, actor: 'user', type: 'validation_plan_recorded', at: 10,
        assumptionStatementHash: assumptionStatementHash(current), plan, expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
    }));
    if (!planned.ok) throw new Error(planned.reason);
    current = planned.record;
    const evidence = sealAssumptionEvidence({
        id: 'observed-session', planningRecordId: current.id, sourceType: 'usability_observation',
        source: 'Observed team session', sourceIdentity: 'session-1', observedAt: 19, recordedAt: 20,
        observation: 'The team inspected decision reasoning before committing the implementation plan.',
        validationQuestion: plan.question, limitations: ['One product team'], character: 'direct', relation: 'supports',
        assumptionStatementHash: assumptionStatementHash(current), validationPlanHash: plan.contentHash, authoredBy: 'user',
    });
    const evidenced = appendAssumptionValidationEvent(current, sealAssumptionValidationEvent({
        id: 'evidence-event', planningRecordId: current.id, actor: 'user', type: 'validation_evidence_recorded', at: 20,
        assumptionStatementHash: assumptionStatementHash(current), evidence, expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
    }));
    if (!evidenced.ok) throw new Error(evidenced.reason);
    current = evidenced.record;
    const projection = projectAssumptionValidation(current, 30);
    const outcome = sealAssumptionValidationEvent({
        id: 'outcome-event', planningRecordId: current.id, actor: 'user', type: 'validation_outcome_recorded', at: 30,
        assumptionStatementHash: assumptionStatementHash(current), conclusion: 'supported',
        expectedValidationPlanHash: projection.currentPlan!.contentHash,
        expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
    });
    const concluded = appendAssumptionValidationEvent(current, outcome);
    if (!concluded.ok) throw new Error(concluded.reason);
    const verdict = appendDecisionEvent(concluded.record, assumptionValidationDecisionEvent(current, outcome)!);
    if (!verdict.ok) throw new Error(verdict.reason);
    return verdict.record;
};

const reviewIssue = (overrides: Partial<ReviewIssue> = {}): ReviewIssue => ({
    id: 'issue-1', projectId: 'p1', reviewId: 'review-1', title: 'Operational recovery is undefined',
    summary: 'The plan does not define how failed work is recovered.', kind: 'risk', findingIds: ['finding-1'],
    specialistIds: ['product_scope'], relationship: 'standalone', severity: 'high', confidence: 'high',
    implementationImpact: 'resolve_before_build', status: 'open', dispositions: [],
    relatedPlanningRecordIds: [], createdAt: 11, updatedAt: 11,
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

    it('records the exact validation evidence that supports a ready assumption', () => {
        const review = deriveReadinessReview(input({ planningRecords: [evidenceValidatedRecord()], createdAt: 40 }));
        expect(review.criteria.find(item => item.id === 'assumptions')).toMatchObject({ status: 'met', blocking: false });
        expect(review.criteria.find(item => item.id === 'assumptions')?.evidence).toEqual([
            expect.objectContaining({
                sourceId: 'observed-session', sourceType: 'planning_record', quality: 'direct',
                contentHash: expect.any(String),
            }),
        ]);
        expect(review.conclusion).toBe('ready_to_build');
        expect(validateReadinessReviewIntegrity(review)).toBe(true);
    });

    it('makes a review historical when validation expires even though raw project records did not change', () => {
        const assumption = evidenceValidatedRecord(50);
        const review = deriveReadinessReview(input({ planningRecords: [assumption], createdAt: 40 }));
        expect(review.conclusion).toBe('ready_to_build');
        const comparison = compareReadinessReviewCurrentness(review, input({ planningRecords: [assumption], createdAt: 51 }));
        expect(comparison).toMatchObject({ current: false, historical: true });
        expect(comparison.reasons).toContain('planning_state_changed');
        const current = deriveReadinessReview(input({ planningRecords: [assumption], createdAt: 51 }));
        expect(current.conclusion).toBe('not_ready');
        expect(current.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'assumption', consequence: expect.stringContaining('historical or expired') }),
        ]));
    });

    it('does not treat invalidation, missing supersession, or a confirmed material risk as resolution', () => {
        const invalidated = record({
            id: 'invalidated', type: 'decision', status: 'confirmed', materiality: 'blocking', schemaVersion: 1,
            events: [{ id: 'invalidated-event', planningRecordId: 'invalidated', type: 'invalidated', actor: 'user', at: 2, reason: 'The premise changed.' }],
        });
        const superseded = record({
            id: 'superseded', type: 'decision', status: 'confirmed', materiality: 'high', schemaVersion: 1,
            events: [{ id: 'superseded-event', planningRecordId: 'superseded', type: 'superseded', actor: 'user', at: 2, supersededById: 'missing' }],
        });
        const acceptedRisk = record({
            id: 'risk', type: 'risk', status: 'confirmed', materiality: 'high', schemaVersion: 1,
            events: [{ id: 'risk-answer', planningRecordId: 'risk', type: 'custom_answered', actor: 'user', at: 2, answer: 'We accept the exposure.' }],
        });
        const review = deriveReadinessReview(input({ planningRecords: [invalidated, superseded, acceptedRisk] }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.concerns.map(item => item.source.sourceId)).toEqual(expect.arrayContaining([
            'invalidated', 'superseded', 'risk',
        ]));
    });

    it('allows a superseded choice only when its durable replacement is resolved', () => {
        const superseded = record({
            id: 'superseded', type: 'decision', status: 'confirmed', materiality: 'high', schemaVersion: 1,
            sourceState: 'changed',
            events: [{ id: 'superseded-event', planningRecordId: 'superseded', type: 'superseded', actor: 'user', at: 2, supersededById: 'replacement' }],
        });
        const replacement = record({
            id: 'replacement', type: 'decision', status: 'confirmed', materiality: 'high', schemaVersion: 1,
            events: [{ id: 'replacement-answer', planningRecordId: 'replacement', type: 'custom_answered', actor: 'user', at: 3, answer: 'Use the replacement direction.' }],
        });
        const review = deriveReadinessReview(input({ planningRecords: [superseded, replacement] }));
        expect(review.criteria.find(item => item.id === 'decisions')).toMatchObject({ blocking: false });
        expect(review.concerns.some(item => item.source.sourceId === 'superseded')).toBe(false);
    });

    it('fails closed for a material legacy verdict without durable user provenance', () => {
        const legacy = record({
            id: 'legacy', type: 'decision', status: 'confirmed', resolution: 'Web first',
            materiality: undefined, schemaVersion: undefined, events: undefined,
        });
        const review = deriveReadinessReview(input({ planningRecords: [legacy] }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: expect.objectContaining({ sourceId: 'legacy' }) }),
        ]));
    });

    it('fails closed for a current-schema settled projection without a user verdict event', () => {
        const imported = record({
            id: 'imported-projection', type: 'decision', status: 'confirmed', resolution: 'Web first',
            materiality: 'high', schemaVersion: 1,
            events: [{
                id: 'created-only', planningRecordId: 'imported-projection', type: 'created',
                actor: 'user', at: 1,
            }],
        });
        const review = deriveReadinessReview(input({ planningRecords: [imported] }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: expect.objectContaining({ sourceId: 'imported-projection' }) }),
        ]));
    });

    it('does not mistake a grounded internal excerpt for validation of a material assumption', () => {
        const assumption = record({
            id: 'grounded-assumption', type: 'assumption', status: 'confirmed', materiality: 'high', schemaVersion: 1,
            evidence: [{
                id: 'evidence-1', sourceType: 'spine', sourceId: 'spine-1', sourceVersionId: 'spine-1',
                excerpt: 'Teams will revisit warnings during implementation.', excerptHash: 'grounded-hash', verified: true,
            }],
            events: [{
                id: 'assumption-answer', planningRecordId: 'grounded-assumption', type: 'custom_answered',
                actor: 'user', at: 2, answer: 'Proceed with this premise for now.',
            }],
        });
        const review = deriveReadinessReview(input({ planningRecords: [assumption] }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.criteria.find(item => item.id === 'assumptions')).toMatchObject({ blocking: true });
        expect(review.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: expect.objectContaining({ sourceId: 'grounded-assumption' }) }),
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

    it('rejects ceremonial challenge coverage with no finding or auditable resolved area', () => {
        const review = deriveReadinessReview(input({
            specialistRuns: [specialistRun({
                coverageSummary: 'This looks sufficiently covered.', resolvedAreas: [], findingIds: [], coverageChecks: [],
            })],
        }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.criteria.find(item => item.id === 'challenge')).toMatchObject({ blocking: true });
    });

    it('rejects generic source-free coverage even when prose passes length checks', () => {
        const review = deriveReadinessReview(input({
            specialistRuns: [specialistRun({
                contextRefIds: [],
                coverageSummary: 'Everything in the product area appears sufficiently covered.',
                resolvedAreas: ['Everything appears sufficiently resolved.'],
                findingIds: [],
                coverageChecks: [],
            })],
        }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.criteria.find(item => item.id === 'challenge')).toMatchObject({
            status: 'not_started', blocking: true,
        });
    });

    it('does not let a user omit an applicable specialist from readiness coverage', () => {
        const review = deriveReadinessReview(input({
            reviewRuns: [reviewRun({ requiredSpecialistIds: ['product_scope', 'security_privacy'] })],
            specialistRuns: [specialistRun()],
        }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.criteria.find(item => item.id === 'challenge')).toMatchObject({
            status: 'not_started', blocking: true,
        });
    });

    it('revalidates persisted coverage relevance and locator integrity against the exact PRD', () => {
        const riskLocator = coverageManifest.locators.find(item => item.path === 'prd.risks')!;
        const unrelatedCoverage = productCoverageChecks.map(check => ({
            ...check,
            evidence: [{
                id: riskLocator.id, sourceType: 'spine' as const, sourceId: 'spine-1', sourceVersionId: 'spine-1',
                locator: { section: riskLocator.label, jsonPath: riskLocator.path },
                excerpt: riskLocator.excerpt, excerptHash: riskLocator.excerptHash, verified: true,
            }],
        }));
        expect(deriveReadinessReview(input({
            specialistRuns: [specialistRun({ coverageChecks: unrelatedCoverage })],
        })).conclusion).toBe('not_ready');

        const fabricated = productCoverageChecks.map(check => ({
            ...check,
            evidence: check.evidence.map(evidence => ({
                ...evidence, id: 'fabricated-locator', excerptHash: 'fabricated-hash', verified: true,
            })),
        }));
        expect(deriveReadinessReview(input({
            specialistRuns: [specialistRun({ coverageChecks: fabricated })],
        })).conclusion).toBe('not_ready');
    });

    it('revalidates a meaningful bounded locator excerpt with the same rules used during challenge execution', () => {
        const excerpt = 'Teams commit implementation effort before resolving consequential uncertainty.';
        const boundedCoverage = productCoverageChecks.map(check => check.area === 'problem'
            ? {
                ...check,
                evidence: check.evidence.map(evidence => ({
                    ...evidence, excerpt, excerptHash: hashEvidenceExcerpt(excerpt),
                })),
            }
            : check);
        const review = deriveReadinessReview(input({
            specialistRuns: [specialistRun({ coverageChecks: boundedCoverage })],
        }));
        expect(review.conclusion).toBe('ready_to_build');
        expect(review.criteria.find(item => item.id === 'challenge')).toMatchObject({
            status: 'met', blocking: false,
        });
    });

    it('keeps an earlier exact-current unresolved finding after a newer empty challenge run', () => {
        const newerRun = reviewRun({ id: 'review-2', sequenceNumber: 2, createdAt: 30, completedAt: 40 });
        const review = deriveReadinessReview(input({
            reviewRuns: [reviewRun(), newerRun],
            specialistRuns: [
                specialistRun({ id: 'specialist-1', reviewId: 'review-1', findingIds: ['finding-1'] }),
                specialistRun({ id: 'specialist-2', reviewId: 'review-2', createdAt: 30, completedAt: 40 }),
            ],
            reviewIssues: [reviewIssue()],
        }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: expect.objectContaining({ sourceId: 'issue-1' }) }),
        ]));
    });

    it('blocks a consequential specialist finding that never entered durable issue triage', () => {
        const review = deriveReadinessReview(input({
            specialistRuns: [specialistRun({ findingIds: ['orphan-finding'] })],
            reviewIssues: [],
        }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({
                title: 'Untriaged challenge finding',
                source: expect.objectContaining({ sourceId: 'orphan-finding' }),
                actionTarget: {
                    kind: 'challenge',
                    reviewId: 'review-1',
                    findingId: 'orphan-finding',
                },
            }),
        ]));
    });

    it('preserves a challenge dismissal rationale as direct review evidence', () => {
        const dismissed = reviewIssue({
            status: 'dismissed',
            dispositions: [{ action: 'dismiss', actor: 'user', at: 15, contextSignature: 'context-1', reason: 'The first release never persists failed work.' }],
        });
        const review = deriveReadinessReview(input({
            specialistRuns: [specialistRun({ findingIds: ['finding-1'] })],
            reviewIssues: [dismissed],
        }));
        const evidence = review.criteria.find(item => item.id === 'challenge')?.evidence ?? [];
        expect(evidence).toEqual(expect.arrayContaining([
            expect.objectContaining({ quality: 'direct', summary: expect.stringContaining('never persists failed work') }),
        ]));
    });

    it('does not let a legacy dismissal without rationale satisfy challenge readiness', () => {
        const dismissed = reviewIssue({ status: 'dismissed', dispositions: [] });
        const review = deriveReadinessReview(input({
            specialistRuns: [specialistRun({ findingIds: ['finding-1'] })],
            reviewIssues: [dismissed],
        }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: expect.objectContaining({ sourceId: 'issue-1' }) }),
        ]));
    });

    it('does not let a model-authored stale-context dismissal satisfy challenge readiness', () => {
        const dismissed = reviewIssue({
            status: 'dismissed',
            dispositions: [{
                action: 'dismiss', actor: 'model', at: 15, contextSignature: 'stale-context',
                reason: 'The model decided this no longer matters for the first release.',
            } as unknown as ReviewIssue['dispositions'][number]],
        });
        const review = deriveReadinessReview(input({
            specialistRuns: [specialistRun({ findingIds: ['finding-1'] })],
            reviewIssues: [dismissed],
        }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: expect.objectContaining({ sourceId: 'issue-1' }) }),
        ]));
    });

    it('does not let a bare superseded issue erase a consequential finding', () => {
        const superseded = reviewIssue({ status: 'superseded', dispositions: [] });
        const review = deriveReadinessReview(input({
            specialistRuns: [specialistRun({ findingIds: ['finding-1'] })],
            reviewIssues: [superseded],
        }));
        expect(review.conclusion).toBe('not_ready');
        expect(review.concerns).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: expect.objectContaining({ sourceId: 'issue-1' }) }),
        ]));
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

    it('makes a review historical when the safety boundary changes', () => {
        const review = deriveReadinessReview(input({
            spine: { versionId: 'spine-1', content, structuredPRD: prd, safetyReview: {
                status: 'generated', classification: 'allowed', detectedConcerns: [], reviewedAt: 1,
            } },
        }));
        const comparison = compareReadinessReviewCurrentness(review, input({
            spine: { versionId: 'spine-1', content, structuredPRD: prd, safetyReview: {
                status: 'blocked', classification: 'disallowed', detectedConcerns: ['unsafe'], reviewedAt: 2,
            } },
        }));
        expect(comparison.reasons).toContain('planning_state_changed');
    });

    it('makes a persisted review historical when criteria semantics change', () => {
        const review = deriveReadinessReview(input());
        const comparison = compareReadinessReviewCurrentness(review, input(), { criteriaVersion: 2 });
        expect(comparison.reasons).toContain('criteria_changed');
        expect(comparison.current).toBe(false);
    });

    it('binds challenge freshness to applicable runs without invalidating on unrelated history', () => {
        const review = deriveReadinessReview(input());
        const unrelated = reviewRun({
            id: 'review-old-spine',
            sourceManifest: {
                spineVersionId: 'spine-old', spineContentHash: 'old-content', artifactRefs: [],
                capturedAt: 1, contextSignature: 'old-context',
            },
        });
        const comparison = compareReadinessReviewCurrentness(review, input({
            reviewRuns: [reviewRun(), unrelated],
            specialistRuns: [
                specialistRun(),
                specialistRun({ id: 'specialist-old', reviewId: 'review-old-spine' }),
            ],
        }));
        expect(comparison.current).toBe(true);
        expect(comparison.reasons).not.toContain('challenge_changed');
    });

    it('fails closed when a persisted review is tampered', () => {
        const review = deriveReadinessReview(input());
        const tampered = { ...review, conclusion: 'not_ready' as const };
        expect(validateReadinessReviewIntegrity(tampered)).toBe(false);
        expect(compareReadinessReviewCurrentness(tampered, input())).toMatchObject({
            current: false, historical: false, integrityValid: false,
        });
    });

    it('preserves integrity through the JSON persistence boundary', () => {
        const review = deriveReadinessReview(input());
        const restored = JSON.parse(JSON.stringify(review)) as typeof review;
        expect(validateReadinessReviewIntegrity(restored)).toBe(true);
        expect(compareReadinessReviewCurrentness(restored, input())).toMatchObject({
            current: true, historical: false, integrityValid: true,
        });
    });
});
