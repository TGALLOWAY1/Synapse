// Save-time integrity check for snapshot mockup images.
//
// A snapshot bundles a project's mockup SPECS (the `mockup` artifact version's
// JSON) separately from its rendered mockup IMAGES (IndexedDB blobs shipped one
// per request). Nothing forces the two to agree, so it is possible to save — and
// then pin as the public demo — a snapshot whose mockup spec lists screens while
// carrying zero images (e.g. the images were generated in a different browser, or
// IndexedDB was cleared, or only the spec was regenerated). The demo then renders
// mockup specs with no previews and the mockups "disappear".
//
// This module is a pure, deterministic audit that detects exactly that mismatch
// so the save UI can warn the owner BEFORE they pin an image-less demo. It never
// blocks the save — the specs are still worth keeping — it only surfaces the gap.

import type {
    Artifact, ArtifactVersion, MockupImageRecord, ScreenInventoryImageRecord,
} from '../types';
import { tryParsePayload, readExtraMockupScreens } from './mockupParsing';
import type { MockupVariantImageSnapshot } from './mockupVariantSnapshot';

export interface MockupImageAuditInput {
    artifacts: Artifact[];
    artifactVersions: ArtifactVersion[];
    /** Mockup images collected for the snapshot (mockupImageStore / IDB). */
    images: Array<Pick<MockupImageRecord, 'versionId'>>;
    /** User-uploaded screen-inventory images (also hold user_uploaded mockups,
     *  keyed by the mockup artifact version id). */
    screenImages: Array<Pick<ScreenInventoryImageRecord, 'artifactVersionId'>>;
    /** Per-variant mockup images (Phase 3B/3C) in their portable snapshot form. */
    variantImages?: MockupVariantImageSnapshot;
}

// Resolve the mockup artifact's preferred version: its recorded
// `currentVersionId`, falling back to the highest-numbered version for that
// artifact so a bundle with a stale/absent pointer still audits sensibly.
const resolveMockupVersion = (
    artifact: Artifact,
    versions: ArtifactVersion[],
): ArtifactVersion | undefined => {
    const own = versions.filter((v) => v.artifactId === artifact.id);
    if (artifact.currentVersionId) {
        const preferred = own.find((v) => v.id === artifact.currentVersionId);
        if (preferred) return preferred;
    }
    if (own.length === 0) return undefined;
    return own.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
};

/**
 * Returns human-readable warnings for mockup-image gaps in a snapshot bundle.
 * Empty when the project has no mockup artifact, the mockup spec has no screens,
 * or at least one mockup image (AI-generated, uploaded, or a variant) was
 * collected for the mockup version. Pure — safe to unit-test in isolation.
 */
export function auditMockupImageCoverage(input: MockupImageAuditInput): string[] {
    const warnings: string[] = [];

    const mockupArtifact = input.artifacts.find((a) => a.type === 'mockup');
    if (!mockupArtifact) return warnings;

    const version = resolveMockupVersion(mockupArtifact, input.artifactVersions);
    if (!version) return warnings;

    const payload = tryParsePayload(version);
    if (!payload) return warnings;
    const extraScreens = readExtraMockupScreens(
        version.metadata as Record<string, unknown> | undefined,
    );
    const screenCount = payload.screens.length + extraScreens.length;
    if (screenCount === 0) return warnings;

    const versionId = version.id;
    const aiImages = input.images.filter((r) => r.versionId === versionId).length;
    const uploadedImages = input.screenImages.filter(
        (r) => r.artifactVersionId === versionId,
    ).length;
    const variantRecords = (input.variantImages?.records ?? []).filter(
        (r) => r.versionId === versionId,
    ).length;

    if (aiImages + uploadedImages + variantRecords === 0) {
        warnings.push(
            `The Mockups artifact describes ${screenCount} screen${screenCount === 1 ? '' : 's'}, `
            + 'but no rendered mockup images were found on this device. The snapshot will save the '
            + 'mockup specs without any preview images — generate the mockup images (or open the '
            + 'project on the device where they were generated) before pinning this snapshot as the '
            + 'public demo, or the demo will show mockups with no previews.',
        );
    }

    return warnings;
}
