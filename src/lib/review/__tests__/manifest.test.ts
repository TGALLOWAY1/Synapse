import { describe, expect, it } from 'vitest';
import { hashEvidenceExcerpt } from '../hash';
import { isManifestCurrent, toPersistedReviewContextManifest, verifyEvidenceRef } from '../manifest';
import { makeManifest } from './reviewTestUtils';

describe('review context manifest', () => {
    it('freezes exact source versions and creates a stable signature', () => {
        const first = makeManifest();
        const second = makeManifest();
        expect(first.contextSignature).toBe(second.contextSignature);
        expect(first.sources.map(source => source.sourceKey)).toEqual([
            'spine:spine-v2', 'artifact:data-v3', 'artifact:screens-v1',
        ]);
        expect(first.availableArtifacts).toEqual(['data_model', 'screen_inventory']);
        expect(first.missingArtifacts).toContain('user_flows');
    });

    it('verifies exact evidence and quarantines altered excerpts', () => {
        const manifest = makeManifest();
        const locator = manifest.locators.find(item => item.path === 'prd.risks')!;
        expect(verifyEvidenceRef(manifest, {
            sourceKey: locator.sourceKey,
            locatorId: locator.id,
            path: locator.path,
            excerpt: locator.excerpt,
            excerptHash: locator.excerptHash,
        }).verified).toBe(true);

        const altered = verifyEvidenceRef(manifest, {
            sourceKey: locator.sourceKey,
            locatorId: locator.id,
            path: locator.path,
            excerpt: 'The plan guarantees perfect summaries.',
            excerptHash: hashEvidenceExcerpt('The plan guarantees perfect summaries.'),
        });
        expect(altered.verified).toBe(false);
        expect(altered.failureReason).toBe('excerpt_mismatch');
    });

    it('detects source version or content drift without mutating history', () => {
        const manifest = makeManifest();
        expect(isManifestCurrent(manifest, manifest)).toBe(true);
        const changed = {
            spineVersionId: manifest.spineVersionId,
            sources: manifest.sources.map((source, index) => index === 0 ? { ...source, contentHash: 'changed' } : source),
        };
        expect(isManifestCurrent(manifest, changed)).toBe(false);
    });

    it('projects to a bounded persistence manifest without raw source text', () => {
        const persisted = toPersistedReviewContextManifest(makeManifest());
        expect(persisted.spineVersionId).toBe('spine-v2');
        expect(persisted.artifactRefs.map(ref => ref.artifactVersionId)).toEqual(['data-v3', 'screens-v1']);
        expect(JSON.stringify(persisted)).not.toContain('patient note beside');
    });
});
