import { describe, expect, it } from 'vitest';
import { DEMO_PROJECT_ID, GALLERY_PROJECT_IDS, GALLERY_MAX_SIZE } from '../../data/demoProject';
import {
    ProjectCapabilityError,
    assertProjectCapability,
    canPerformProjectAction,
    getProjectCapabilities,
    PERSISTENT_STORE_ACTIONS,
} from '../projectCapabilities';

describe('project capabilities', () => {
    it('denies every durable capability for the public demo while allowing exploration', () => {
        const capabilities = getProjectCapabilities({ id: DEMO_PROJECT_ID });

        expect(capabilities).toEqual({
            isReadOnly: true,
            canExplore: true,
            canEditProjectContent: false,
            canChangeFinality: false,
            canEditArtifacts: false,
            canReviewArtifacts: false,
            canGenerateArtifacts: false,
            canManageDesignSystem: false,
            canPersistWorkflowState: false,
            canExportExternally: false,
            showsProviderSetupWarnings: false,
        });
    });

    it('applies the same read-only policy to every gallery slot project', () => {
        expect(GALLERY_PROJECT_IDS).toHaveLength(GALLERY_MAX_SIZE);
        for (const galleryId of GALLERY_PROJECT_IDS) {
            const capabilities = getProjectCapabilities({ id: galleryId });
            expect(capabilities.isReadOnly).toBe(true);
            expect(capabilities.canExplore).toBe(true);
            expect(capabilities.canPersistWorkflowState).toBe(false);
            expect(capabilities.canGenerateArtifacts).toBe(false);
            expect(canPerformProjectAction(galleryId, 'persist')).toBe(false);
            expect(canPerformProjectAction(galleryId, 'explore')).toBe(true);
            expect(() => assertProjectCapability({ id: galleryId }, 'canEditProjectContent'))
                .toThrow('This example project is read-only.');
        }
    });

    it('keeps ordinary projects editable', () => {
        const capabilities = getProjectCapabilities({ id: 'ordinary-project' });

        expect(capabilities.isReadOnly).toBe(false);
        expect(capabilities.canExplore).toBe(true);
        expect(Object.entries(capabilities)
            .filter(([key]) => key.startsWith('can'))
            .every(([, value]) => value)).toBe(true);
    });

    it('fails conservatively for an unknown or missing project', () => {
        expect(getProjectCapabilities(undefined).canExplore).toBe(false);
        expect(getProjectCapabilities(null).canEditArtifacts).toBe(false);
        expect(() => assertProjectCapability(undefined, 'canEditProjectContent'))
            .toThrow(ProjectCapabilityError);
    });

    it('rejects a protected demo mutation with a stable user-facing error', () => {
        expect(() => assertProjectCapability({ id: DEMO_PROJECT_ID }, 'canGenerateArtifacts'))
            .toThrow('This example project is read-only.');
    });

    it('maps the coarse action vocabulary onto the same policy', () => {
        expect(canPerformProjectAction(DEMO_PROJECT_ID, 'explore')).toBe(true);
        for (const action of ['persist', 'generate', 'image', 'external'] as const) {
            expect(canPerformProjectAction(DEMO_PROJECT_ID, action)).toBe(false);
            expect(canPerformProjectAction('ordinary-project', action)).toBe(true);
        }
    });

    it('guards every downstream proposal authority and history write at the shared persistence boundary', () => {
        for (const action of [
            'recordDownstreamArtifactUpdateProposal', 'appendDownstreamArtifactUpdateReviewEvent',
            'recordDownstreamArtifactUpdateApplication', 'recordDownstreamArtifactUpdateVerification',
            'appendDownstreamArtifactUpdateVerificationEvent',
        ]) expect(PERSISTENT_STORE_ACTIONS.has(action)).toBe(true);
    });
});
