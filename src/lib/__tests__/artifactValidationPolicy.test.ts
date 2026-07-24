import { describe, expect, it } from 'vitest';
import type { ArtifactValidationBlocker, ArtifactVersion } from '../../types';
import {
    artifactValidationBlockerSetFingerprint,
    artifactValidationOverridePolicyFor,
    isArtifactVersionEligibleAsGenerationContext,
    readArtifactValidationDisposition,
    withoutArtifactValidationAcceptance,
} from '../artifactValidationPolicy';

const semantic: ArtifactValidationBlocker = {
    code: 'prd_traceability_unverified',
    message: 'Traceability was not verified.',
};
const structural: ArtifactValidationBlocker = {
    code: 'output_structure_incomplete',
    message: 'No screens were produced.',
};
const version = (metadata: Record<string, unknown>): ArtifactVersion => ({
    id: 'v1',
    artifactId: 'a1',
    versionNumber: 1,
    parentVersionId: null,
    content: 'content',
    metadata,
    sourceRefs: [],
    generationPrompt: 'prompt',
    isPreferred: true,
    createdAt: 1,
});

describe('artifact validation policy', () => {
    it('classifies by code, not display text', () => {
        expect(artifactValidationOverridePolicyFor('prd_traceability_unverified')).toBe('rationale_required');
        expect(artifactValidationOverridePolicyFor('data_model_api_surface_missing')).toBe('rationale_required');
        expect(artifactValidationOverridePolicyFor('user_flows_error_paths_missing')).toBe('rationale_required');
        expect(artifactValidationOverridePolicyFor('output_truncated')).toBe('non_overridable');
        expect(artifactValidationOverridePolicyFor('output_unparseable')).toBe('non_overridable');
        expect(artifactValidationOverridePolicyFor('output_structure_incomplete')).toBe('non_overridable');
        expect(artifactValidationOverridePolicyFor('legacy_unclassified')).toBe('non_overridable');
    });

    it('accepts only the exact order-independent blocker fingerprint', () => {
        const fingerprint = artifactValidationBlockerSetFingerprint([semantic]);
        const metadata = {
            validationBlockers: [semantic],
            validationAcceptance: {
                schemaVersion: 1,
                actor: 'user',
                acceptedAt: 10,
                rationale: 'The canonical appendix supplies this mapping.',
                blockerFingerprint: fingerprint,
            },
        };
        expect(readArtifactValidationDisposition(metadata)).toMatchObject({
            blockers: [semantic],
            effectiveStatus: 'accepted_issue',
            overridePolicy: 'rationale_required',
            accepted: {
                actor: 'user',
                rationale: 'The canonical appendix supplies this mapping.',
            },
        });
        expect(isArtifactVersionEligibleAsGenerationContext(version(metadata))).toBe(true);
        expect(artifactValidationBlockerSetFingerprint([semantic, structural]))
            .toBe(artifactValidationBlockerSetFingerprint([structural, semantic]));
    });

    it('rejects stale, structural, mixed, and legacy acceptance', () => {
        expect(readArtifactValidationDisposition({
            validationBlockers: [semantic],
            validationAcceptance: {
                schemaVersion: 1,
                actor: 'user',
                acceptedAt: 10,
                rationale: 'Stale',
                blockerFingerprint: 'wrong',
            },
        }).effectiveStatus).toBe('needs_review');
        expect(readArtifactValidationDisposition({
            validationBlockers: [semantic, structural],
        }).overridePolicy).toBe('non_overridable');
        expect(readArtifactValidationDisposition({
            validationBlockers: ['old blocker text'],
        })).toMatchObject({
            blockers: [{ code: 'legacy_unclassified', message: 'old blocker text' }],
            effectiveStatus: 'needs_review',
            overridePolicy: 'non_overridable',
        });
    });

    it('fails closed for unknown and malformed blocker entries, including mixed sets', () => {
        expect(readArtifactValidationDisposition({
            validationBlockers: [
                semantic,
                { code: 'future_semantic_code', message: 'A newer validator found an issue.' },
                { code: 'prd_traceability_unverified' },
                { unexpected: true },
                42,
            ],
        })).toMatchObject({
            blockers: [
                semantic,
                {
                    code: 'legacy_unclassified',
                    message: 'A newer validator found an issue.',
                },
                {
                    code: 'legacy_unclassified',
                    message: 'Unrecognized validation blocker metadata.',
                },
                {
                    code: 'legacy_unclassified',
                    message: 'Unrecognized validation blocker metadata.',
                },
                {
                    code: 'legacy_unclassified',
                    message: 'Unrecognized validation blocker metadata.',
                },
            ],
            effectiveStatus: 'needs_review',
            overridePolicy: 'non_overridable',
        });
    });

    it('does not let a lone malformed blocker make an artifact appear clear', () => {
        expect(readArtifactValidationDisposition({
            validationBlockers: [{ code: 'prd_traceability_unverified' }],
        })).toMatchObject({
            blockers: [{
                code: 'legacy_unclassified',
                message: 'Unrecognized validation blocker metadata.',
            }],
            effectiveStatus: 'needs_review',
            overridePolicy: 'non_overridable',
        });
        expect(readArtifactValidationDisposition({
            validationBlockers: { code: 'prd_traceability_unverified' },
        })).toMatchObject({
            blockers: [{
                code: 'legacy_unclassified',
                message: 'Unrecognized validation blocker metadata.',
            }],
            effectiveStatus: 'needs_review',
            overridePolicy: 'non_overridable',
        });
    });

    it('strips acceptance but preserves failures and unrelated metadata', () => {
        expect(withoutArtifactValidationAcceptance({
            validationBlockers: [semantic],
            validationAcceptance: { actor: 'user' },
            repairAttempted: true,
        })).toEqual({
            validationBlockers: [semantic],
            repairAttempted: true,
        });
    });

    it('projects the exact accepted metadata used by checkpoint and export summaries', () => {
        const blockers = [semantic];
        const blockerFingerprint = artifactValidationBlockerSetFingerprint(blockers);
        const metadata = {
            validationBlockers: blockers,
            validationAcceptance: {
                schemaVersion: 1,
                actor: 'user',
                acceptedAt: 123,
                rationale: 'The canonical mapping was reviewed manually.',
                blockerFingerprint,
            },
        };
        expect(readArtifactValidationDisposition(metadata)).toEqual({
            blockers,
            accepted: {
                schemaVersion: 1,
                actor: 'user',
                acceptedAt: 123,
                rationale: 'The canonical mapping was reviewed manually.',
                blockerFingerprint,
            },
            effectiveStatus: 'accepted_issue',
            overridePolicy: 'rationale_required',
        });
    });
});
