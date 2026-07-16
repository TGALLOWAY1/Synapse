import { describe, expect, it } from 'vitest';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import { canPerformProjectAction, getProjectCapabilities, PERSISTENT_STORE_ACTIONS } from '../projectCapabilities';

describe('project capabilities', () => {
    it('keeps the public demo explorable but denies every persistent capability', () => {
        expect(getProjectCapabilities(DEMO_PROJECT_ID)).toEqual({
            explore: true, persist: false, generate: false, image: false, external: false,
        });
    });

    it('keeps ordinary projects fully functional', () => {
        expect(canPerformProjectAction('ordinary-project', 'persist')).toBe(true);
        expect(canPerformProjectAction('ordinary-project', 'generate')).toBe(true);
        expect(canPerformProjectAction('ordinary-project', 'image')).toBe(true);
        expect(canPerformProjectAction('ordinary-project', 'external')).toBe(true);
    });

    it('guards every downstream proposal authority and history write at the shared persistence boundary', () => {
        for (const action of [
            'recordDownstreamArtifactUpdateProposal', 'appendDownstreamArtifactUpdateReviewEvent',
            'recordDownstreamArtifactUpdateApplication', 'recordDownstreamArtifactUpdateVerification',
            'appendDownstreamArtifactUpdateVerificationEvent',
        ]) expect(PERSISTENT_STORE_ACTIONS.has(action)).toBe(true);
    });
});
