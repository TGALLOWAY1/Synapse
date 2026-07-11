import { describe, expect, it } from 'vitest';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import {
    ProjectCapabilityError,
    assertProjectCapability,
    getProjectCapabilities,
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
        });
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
});
