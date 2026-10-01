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
import {
    deriveChallengeCoverage,
    MIN_CLOSURE_REASON_LENGTH,
    type ChallengeCoverageInput,
} from '../challengeCoverage';

// Ported from the deleted readiness-review suite: the challenge-coverage rules
// outlived the Finalize checkpoint (they still feed the advisory planning
// readiness projection and the generation/export checkpoint critique rows).

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
    projectId: 'p1', projectName: 'Coverage project',
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

const input = (overrides: Partial<ChallengeCoverageInput> = {}): ChallengeCoverageInput => ({
    projectId: 'p1',
    spine: { versionId: 'spine-1', content, structuredPRD: prd },
    planningRecords: [], reviewRuns: [reviewRun()], specialistRuns: [specialistRun()], reviewIssues: [],
    evaluatedAt: 100,
    ...overrides,
});

const reviewIssue = (overrides: Partial<ReviewIssue> = {}): ReviewIssue => ({
    id: 'issue-1', projectId: 'p1', reviewId: 'review-1', title: 'Operational recovery is undefined',
    summary: 'The plan does not define how failed work is recovered.', kind: 'risk', findingIds: ['finding-1'],
    specialistIds: ['product_scope'], relationship: 'standalone', severity: 'high', confidence: 'high',
    implementationImpact: 'resolve_before_build', status: 'open', dispositions: [],
    relatedPlanningRecordIds: [], createdAt: 11, updatedAt: 11,
    ...overrides,
});

const dismissal = (reason: string): ReviewIssue['dispositions'][number] => ({
    action: 'dismiss', actor: 'user', at: 15, contextSignature: 'context-1', reason,
});

describe('deriveChallengeCoverage', () => {
    it('recognises substantive, source-grounded coverage of the exact current plan', () => {
        const coverage = deriveChallengeCoverage(input());
        expect(coverage.substantive?.id).toBe('review-1');
        expect(coverage.shallow?.id).toBe('review-1');
        expect(coverage.blockingIssues).toEqual([]);
        expect(coverage.untriagedFindings).toEqual([]);
    });

    it('ignores runs bound to another spine or to drifted content', () => {
        expect(deriveChallengeCoverage(input({
            spine: { versionId: 'spine-2', content, structuredPRD: prd },
        })).shallow).toBeUndefined();
        expect(deriveChallengeCoverage(input({
            spine: { versionId: 'spine-1', content: `${content}\nChanged`, structuredPRD: prd },
        })).shallow).toBeUndefined();
    });

    it('rejects a shallow challenge with incomplete validation or coverage', () => {
        const coverage = deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({ validation: { valid: false, unsupportedEvidenceIds: ['e1'], warnings: ['unsupported'] } })],
        }));
        expect(coverage.substantive).toBeUndefined();
        expect(coverage.shallow?.id).toBe('review-1');
    });

    it('rejects ceremonial or generic source-free coverage', () => {
        expect(deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({
                coverageSummary: 'This looks sufficiently covered.', resolvedAreas: [], findingIds: [], coverageChecks: [],
            })],
        })).substantive).toBeUndefined();
        expect(deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({
                contextRefIds: [],
                coverageSummary: 'Everything in the product area appears sufficiently covered.',
                resolvedAreas: ['Everything appears sufficiently resolved.'],
                findingIds: [],
                coverageChecks: [],
            })],
        })).substantive).toBeUndefined();
    });

    it('does not let a user omit an applicable specialist from coverage', () => {
        const coverage = deriveChallengeCoverage(input({
            reviewRuns: [reviewRun({ requiredSpecialistIds: ['product_scope', 'security_privacy'] })],
            specialistRuns: [specialistRun()],
        }));
        expect(coverage.substantive).toBeUndefined();
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
        expect(deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({ coverageChecks: unrelatedCoverage })],
        })).substantive).toBeUndefined();

        const fabricated = productCoverageChecks.map(check => ({
            ...check,
            evidence: check.evidence.map(evidence => ({
                ...evidence, id: 'fabricated-locator', excerptHash: 'fabricated-hash', verified: true,
            })),
        }));
        expect(deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({ coverageChecks: fabricated })],
        })).substantive).toBeUndefined();
    });

    it('accepts a meaningful bounded locator excerpt under the challenge-execution rules', () => {
        const excerpt = 'Teams commit implementation effort before resolving consequential uncertainty.';
        const boundedCoverage = productCoverageChecks.map(check => check.area === 'problem'
            ? {
                ...check,
                evidence: check.evidence.map(evidence => ({
                    ...evidence, excerpt, excerptHash: hashEvidenceExcerpt(excerpt),
                })),
            }
            : check);
        expect(deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({ coverageChecks: boundedCoverage })],
        })).substantive?.id).toBe('review-1');
    });

    it('keeps an earlier exact-current unresolved finding after a newer empty challenge run', () => {
        const newerRun = reviewRun({ id: 'review-2', sequenceNumber: 2, createdAt: 30, completedAt: 40 });
        const coverage = deriveChallengeCoverage(input({
            reviewRuns: [reviewRun(), newerRun],
            specialistRuns: [
                specialistRun({ id: 'specialist-1', reviewId: 'review-1', findingIds: ['finding-1'] }),
                specialistRun({ id: 'specialist-2', reviewId: 'review-2', createdAt: 30, completedAt: 40 }),
            ],
            reviewIssues: [reviewIssue()],
        }));
        expect(coverage.substantive?.id).toBe('review-2');
        expect(coverage.blockingIssues.map(issue => issue.id)).toEqual(['issue-1']);
    });

    it('reports a consequential specialist finding that never entered durable issue triage', () => {
        const coverage = deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({ findingIds: ['orphan-finding'] })],
            reviewIssues: [],
        }));
        expect(coverage.untriagedFindings).toEqual([{
            id: 'orphan-finding',
            reviewId: 'review-1',
            title: 'Untriaged challenge finding',
            summary: 'A specialist finding has not been reviewed into durable project state.',
        }]);
    });

    it('treats a user dismissal with a substantive reason as addressed', () => {
        const dismissed = reviewIssue({
            status: 'dismissed',
            dispositions: [dismissal('The first release never persists failed work.')],
        });
        const coverage = deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({ findingIds: ['finding-1'] })],
            reviewIssues: [dismissed],
        }));
        expect(coverage.blockingIssues).toEqual([]);
        expect(coverage.addressedIssues.map(issue => issue.id)).toEqual(['issue-1']);
    });

    it(`requires at least ${MIN_CLOSURE_REASON_LENGTH} characters of closure rationale`, () => {
        const tooShort = reviewIssue({
            status: 'dismissed',
            dispositions: [dismissal('x'.repeat(MIN_CLOSURE_REASON_LENGTH - 1))],
        });
        expect(deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({ findingIds: ['finding-1'] })],
            reviewIssues: [tooShort],
        })).blockingIssues.map(issue => issue.id)).toEqual(['issue-1']);
    });

    it('does not let a legacy, model-authored, or bare-superseded closure erase a finding', () => {
        const cases: ReviewIssue[] = [
            reviewIssue({ status: 'dismissed', dispositions: [] }),
            reviewIssue({
                status: 'dismissed',
                dispositions: [{
                    action: 'dismiss', actor: 'model', at: 15, contextSignature: 'stale-context',
                    reason: 'The model decided this no longer matters for the first release.',
                } as unknown as ReviewIssue['dispositions'][number]],
            }),
            reviewIssue({ status: 'superseded', dispositions: [] }),
        ];
        for (const issue of cases) {
            expect(deriveChallengeCoverage(input({
                specialistRuns: [specialistRun({ findingIds: ['finding-1'] })],
                reviewIssues: [issue],
            })).blockingIssues.map(item => item.id)).toEqual(['issue-1']);
        }
    });

    it('keeps an acted-on issue unresolved while its linked record is missing or still open', () => {
        const openRecord: PlanningRecord = {
            id: 'record-1', projectId: 'p1', type: 'decision', status: 'open', title: 'Recovery policy',
            statement: 'Decide how failed work is recovered.', evidence: [], sourceFindingIds: [],
            createdBy: 'user', createdAt: 1, updatedAt: 1,
        };
        const acted = reviewIssue({
            status: 'acted',
            dispositions: [{ action: 'link_existing', actor: 'user', at: 15, contextSignature: 'context-1' }],
            relatedPlanningRecordIds: ['record-1'],
        });
        expect(deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({ findingIds: ['finding-1'] })],
            reviewIssues: [acted],
        })).blockingIssues).toHaveLength(1);
        expect(deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({ findingIds: ['finding-1'] })],
            reviewIssues: [acted],
            planningRecords: [openRecord],
        })).blockingIssues).toHaveLength(1);
    });

    it('never counts a deferrable finding against the plan', () => {
        const coverage = deriveChallengeCoverage(input({
            specialistRuns: [specialistRun({ findingIds: ['finding-1'] })],
            reviewIssues: [reviewIssue({ implementationImpact: 'deferrable' })],
        }));
        expect(coverage.blockingIssues).toEqual([]);
    });
});
