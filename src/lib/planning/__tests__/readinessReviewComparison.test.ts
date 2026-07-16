import { describe, expect, it } from 'vitest';
import type { ReadinessReview } from '../../../types';
import { compareReadinessReviewProjections } from '../readinessReviewComparison';

const baseReview = (overrides: Partial<ReadinessReview> = {}): ReadinessReview => ({
    id: 'review-old',
    projectId: 'project-1',
    schemaVersion: 1,
    criteriaVersion: 2,
    conclusion: 'ready_to_build',
    spineVersionId: 'spine-1',
    snapshotHashes: {
        spineIdentity: 'identity-1',
        spineContent: 'content-1',
        planningState: 'planning-1',
        challenge: 'challenge-1',
        alignment: 'alignment-1',
        downstream: 'downstream-1',
        aggregate: 'aggregate-1',
    },
    criteria: [{
        id: 'scope',
        label: 'First-release scope is intentional',
        status: 'met',
        blocking: false,
        explanation: 'Scope is confirmed.',
        evidence: [{
            id: 'evidence-scope',
            quality: 'direct',
            summary: 'Mobile export is confirmed for the first release.',
            sourceType: 'prd',
            sourceId: 'feature-mobile-export',
            sourceVersionId: 'spine-1',
            contentHash: 'content-1',
        }],
    }],
    concerns: [],
    caveats: [],
    createdAt: 100,
    integrityHash: 'integrity-1',
    ...overrides,
});

describe('readiness review projection comparison', () => {
    it('explains plan, conclusion, criterion, and concern changes with product-facing titles', () => {
        const reviewed = baseReview();
        const current = baseReview({
            id: 'review-current',
            conclusion: 'not_ready',
            spineVersionId: 'spine-2',
            criteria: [{
                ...reviewed.criteria[0],
                status: 'attention',
                blocking: true,
                explanation: 'Mobile export is no longer confirmed.',
                evidence: [{
                    ...reviewed.criteria[0].evidence[0],
                    quality: 'incomplete',
                    summary: 'Mobile export was reopened after feasibility review.',
                    sourceVersionId: 'spine-2',
                    contentHash: 'content-2',
                }],
            }],
            concerns: [{
                id: 'concern-mobile-export',
                criterionId: 'scope',
                kind: 'scope',
                title: 'Decide whether mobile export belongs in the first release',
                consequence: 'The implementation boundary and delivery estimate depend on this choice.',
                blocking: true,
                evidenceQuality: 'incomplete',
                source: { type: 'prd', sourceId: 'feature-mobile-export', sourceVersionId: 'spine-2' },
                actionTarget: { kind: 'feature', featureId: 'feature-mobile-export' },
            }],
        });

        const changes = compareReadinessReviewProjections(reviewed, current, {
            reviewedVersionLabel: 'Version 1',
            currentVersionLabel: 'Version 2',
        });

        expect(changes).toContain('The active plan changed from Version 1 to Version 2.');
        expect(changes).toContain('The readiness conclusion changed from ready to build to not ready to build.');
        expect(changes).toContain('First-release scope is intentional changed from supported to blocking.');
        expect(changes).toContain('First-release scope is intentional evidence “Mobile export was reopened after feasibility review.” changed from direct to incomplete.');
        expect(changes).toContain('New blocker: Decide whether mobile export belongs in the first release.');
    });

    it('distinguishes resolved concerns from changed severity and changed source versions', () => {
        const reviewed = baseReview({
            concerns: [
                {
                    id: 'old-risk', criterionId: 'scope', kind: 'risk', title: 'Offline recovery is unclear',
                    consequence: 'Users may lose edits.', blocking: true, evidenceQuality: 'incomplete',
                    source: { type: 'planning_record', sourceId: 'risk-offline' },
                    actionTarget: { kind: 'planning_record', planningRecordId: 'risk-offline' },
                },
                {
                    id: 'old-output', criterionId: 'scope', kind: 'downstream', title: 'Implementation plan may be affected',
                    consequence: 'Review it before coding.', blocking: true, evidenceQuality: 'incomplete',
                    source: { type: 'downstream', sourceId: 'artifact-plan' },
                    actionTarget: { kind: 'output', artifactId: 'artifact-plan', nodeId: 'implementation_plan' },
                },
            ],
        });
        const current = baseReview({
            snapshotHashes: { ...reviewed.snapshotHashes, aggregate: 'aggregate-2' },
            criteria: [{
                ...reviewed.criteria[0],
                evidence: [{ ...reviewed.criteria[0].evidence[0], sourceVersionId: 'spine-2', contentHash: 'content-2' }],
            }],
            concerns: [{
                ...reviewed.concerns[1],
                id: 'current-output',
                blocking: false,
                evidenceQuality: 'inferred',
            }],
        });

        const changes = compareReadinessReviewProjections(reviewed, current);

        expect(changes).toContain('First-release scope is intentional still has the same finding, but its supporting source version changed: “Mobile export is confirmed for the first release.”.');
        expect(changes).toContain('No longer present: Offline recovery is unclear.');
        expect(changes).toContain('Implementation plan may be affected no longer blocks implementation.');
        expect(changes).toContain('Support for Implementation plan may be affected changed from incomplete to inferred.');
    });

    it('does not invent a visible finding when only the underlying snapshot changed', () => {
        const reviewed = baseReview();
        const current = baseReview({
            snapshotHashes: { ...reviewed.snapshotHashes, aggregate: 'aggregate-2', planningState: 'planning-2' },
        });

        expect(compareReadinessReviewProjections(reviewed, current)).toEqual([
            'The underlying source snapshot changed, while the projected findings stayed the same. Create a current checkpoint before relying on the earlier review.',
        ]);
    });

    it('caps large comparisons after prioritizing conclusion and concerns over evidence detail', () => {
        const reviewed = baseReview();
        const current = baseReview({
            conclusion: 'not_ready',
            spineVersionId: 'spine-2',
            criteria: [{
                ...reviewed.criteria[0],
                status: 'attention',
                blocking: true,
                evidence: Array.from({ length: 8 }, (_, index) => ({
                    id: `evidence-${index}`,
                    quality: 'incomplete' as const,
                    summary: `Missing confirmation for scope item ${index + 1}`,
                    sourceType: 'prd' as const,
                    sourceId: `feature-${index}`,
                })),
            }],
            concerns: [{
                id: 'new-blocker', criterionId: 'scope', kind: 'scope', title: 'Confirm the release boundary',
                consequence: 'The delivery plan depends on it.', blocking: true, evidenceQuality: 'incomplete',
                source: { type: 'prd', sourceId: 'features' }, actionTarget: { kind: 'feature' },
            }],
        });

        const changes = compareReadinessReviewProjections(reviewed, current, { maxChanges: 4 });

        expect(changes).toHaveLength(5);
        expect(changes.slice(0, 4)).toEqual([
            'The active plan changed from spine-1 to spine-2.',
            'The readiness conclusion changed from ready to build to not ready to build.',
            'New blocker: Confirm the release boundary.',
            'First-release scope is intentional changed from supported to blocking.',
        ]);
        expect(changes[4]).toMatch(/^\d+ additional changes are available/);
    });
});
