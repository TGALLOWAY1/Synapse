import { describe, it, expect } from 'vitest';
import { auditMockupImageCoverage, countMockupSpecScreens } from '../snapshotImageAudit';
import type { Artifact, ArtifactVersion } from '../../types';
import { MOCKUP_SPEC_V1 } from '../../types';

const MOCKUP_ARTIFACT_ID = 'art-mockup';
const MOCKUP_VERSION_ID = 'ver-mockup-1';

const mockupArtifact = (currentVersionId: string | null = MOCKUP_VERSION_ID): Artifact => ({
    id: MOCKUP_ARTIFACT_ID,
    projectId: 'proj',
    type: 'mockup',
    title: 'Mockups',
    status: 'active',
    currentVersionId,
    createdAt: 0,
    updatedAt: 0,
});

const mockupVersion = (screenNames: string[]): ArtifactVersion => ({
    id: MOCKUP_VERSION_ID,
    artifactId: MOCKUP_ARTIFACT_ID,
    versionNumber: 1,
    parentVersionId: null,
    content: JSON.stringify({
        version: MOCKUP_SPEC_V1,
        title: 'Mockups',
        summary: '',
        screens: screenNames.map((name, i) => ({ id: `scr-${i}`, name })),
    }),
    metadata: { format: MOCKUP_SPEC_V1 },
    sourceRefs: [],
    generationPrompt: '',
    isPreferred: true,
    createdAt: 0,
});

const baseInput = () => ({
    artifacts: [mockupArtifact()],
    artifactVersions: [mockupVersion(['Home', 'Settings'])],
    images: [] as Array<{ versionId: string }>,
    screenImages: [] as Array<{ artifactVersionId: string }>,
});

describe('auditMockupImageCoverage', () => {
    it('warns when a mockup spec has screens but no images were collected', () => {
        const warnings = auditMockupImageCoverage(baseInput());
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/2 screens/);
        expect(warnings[0]).toMatch(/no rendered mockup images/i);
    });

    it('is silent when at least one AI mockup image exists for the version', () => {
        const warnings = auditMockupImageCoverage({
            ...baseInput(),
            images: [{ versionId: MOCKUP_VERSION_ID }],
        });
        expect(warnings).toEqual([]);
    });

    it('is silent when a user-uploaded mockup image exists for the version', () => {
        const warnings = auditMockupImageCoverage({
            ...baseInput(),
            screenImages: [{ artifactVersionId: MOCKUP_VERSION_ID }],
        });
        expect(warnings).toEqual([]);
    });

    it('is silent when a per-variant mockup image exists for the version', () => {
        const warnings = auditMockupImageCoverage({
            ...baseInput(),
            variantImages: {
                schemaVersion: 1,
                projectId: 'proj',
                exportedAt: '2026-07-11T00:00:00.000Z',
                records: [{ versionId: MOCKUP_VERSION_ID } as never],
                summary: { recordCount: 1, historyEntryCount: 0, totalApproxBytes: 0, warnings: [] },
            },
        });
        expect(warnings).toEqual([]);
    });

    it('ignores images collected for an unrelated version id', () => {
        const warnings = auditMockupImageCoverage({
            ...baseInput(),
            images: [{ versionId: 'some-other-version' }],
        });
        expect(warnings).toHaveLength(1);
    });

    it('is silent when there is no mockup artifact at all', () => {
        expect(auditMockupImageCoverage({ ...baseInput(), artifacts: [] })).toEqual([]);
    });

    it('is silent when the mockup spec is unparseable', () => {
        const version = { ...mockupVersion([]), content: 'not json', metadata: {} };
        const warnings = auditMockupImageCoverage({
            ...baseInput(),
            artifactVersions: [version],
        });
        expect(warnings).toEqual([]);
    });

    it('falls back to the highest-numbered version when currentVersionId is null', () => {
        const warnings = auditMockupImageCoverage({
            ...baseInput(),
            artifacts: [mockupArtifact(null)],
        });
        expect(warnings).toHaveLength(1);
    });
});

describe('countMockupSpecScreens (SYN-003)', () => {
    it('counts the preferred mockup version screens', () => {
        expect(countMockupSpecScreens(
            [mockupArtifact()], [mockupVersion(['Home', 'Settings'])],
        )).toEqual({ versionId: MOCKUP_VERSION_ID, screenCount: 2 });
    });

    it('returns null when there is no mockup artifact', () => {
        expect(countMockupSpecScreens([], [mockupVersion(['Home'])])).toBeNull();
    });

    it('returns null when the preferred version is unparseable', () => {
        const version = { ...mockupVersion([]), content: 'not json', metadata: {} };
        expect(countMockupSpecScreens([mockupArtifact()], [version])).toBeNull();
    });

    it('returns null for a mockup spec with no screens (payload requires >=1)', () => {
        // tryParsePayload rejects a zero-screen payload, so there is nothing to
        // count — the pin gate treats "no parseable mockup screens" as pass.
        expect(countMockupSpecScreens([mockupArtifact()], [mockupVersion([])])).toBeNull();
    });

    it('includes user-added extraScreens overlay in the count', () => {
        const version: ArtifactVersion = {
            ...mockupVersion(['Home']),
            metadata: {
                format: MOCKUP_SPEC_V1,
                extraScreens: [{ id: 'extra-1', name: 'Added Screen', purpose: 'p' }],
            },
        };
        expect(countMockupSpecScreens([mockupArtifact()], [version]))
            .toEqual({ versionId: MOCKUP_VERSION_ID, screenCount: 2 });
    });
});
