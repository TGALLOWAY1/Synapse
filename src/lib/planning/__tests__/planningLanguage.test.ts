import { describe, expect, it } from 'vitest';
import {
    assumptionEvidenceCopy,
    downstreamImpactCopy,
    downstreamVerificationCopy,
    outputAlignmentCopy,
    planningRecordCopy,
    planningRecordDominantCondition,
    projectCommitmentCopy,
    proposalLifecycleCopy,
} from '../planningLanguage';

describe('planning language', () => {
    it('uses one plain-language vocabulary without weakening important distinctions', () => {
        expect(projectCommitmentCopy('proceeding_with_accepted_risk').label)
            .toBe('Proceeding with accepted risk');
        expect(outputAlignmentCopy('aligned').label).toBe('Up to date');
        expect(outputAlignmentCopy('possibly_affected').label).toBe('Review recommended');
        expect(outputAlignmentCopy('stale').label).toBe('Update required');
        expect(downstreamImpactCopy('possible').label).toBe('Review recommended');
        expect(downstreamImpactCopy('definite').label).toBe('Update required');
        expect(proposalLifecycleCopy('change_applied').label).toBe('Change applied');
        expect(downstreamVerificationCopy('aligned').label).toBe('Alignment verified');
        expect(assumptionEvidenceCopy('supported').label).toBe('Supported by current evidence');
    });

    it('derives one dominant condition without turning acceptance into evidence support', () => {
        expect(planningRecordDominantCondition({
            type: 'assumption',
            status: 'confirmed',
            requiresValidation: true,
            hasCurrentEvidenceConclusion: false,
        })).toBe('worth_validating');
        expect(planningRecordCopy('worth_validating').label).toBe('Worth validating');

        expect(planningRecordDominantCondition({
            type: 'assumption',
            status: 'confirmed',
            requiresValidation: false,
            hasCurrentEvidenceConclusion: false,
        })).toBe('accepted_without_validation');
        expect(planningRecordCopy('accepted_without_validation').label)
            .toBe('Accepted without validation');
    });
});
