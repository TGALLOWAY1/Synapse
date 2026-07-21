import { describe, expect, it } from 'vitest';
import { hashEvidenceExcerpt } from '../hash';
import { buildReviewContextManifest, isManifestCurrent, toPersistedReviewContextManifest, verifyEvidenceRef } from '../manifest';
import { buildSpecialistPrompt } from '../prompt';
import { buildCanonicalPrdSpine } from '../../canonicalPrdSpine';
import { makeManifest, structuredPRD } from './reviewTestUtils';

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

    it('requires meaningful evidence from the specifically cited locator', () => {
        const manifest = makeManifest();
        const risk = manifest.locators.find(item => item.path === 'prd.risks')!;
        const vision = manifest.locators.find(item => item.path === 'prd.vision')!;

        expect(verifyEvidenceRef(manifest, {
            sourceKey: risk.sourceKey,
            locatorId: risk.id,
            path: risk.path,
            excerpt: 'a',
        }).failureReason).toBe('excerpt_too_short');

        expect(verifyEvidenceRef(manifest, {
            sourceKey: risk.sourceKey,
            locatorId: risk.id,
            path: risk.path,
            excerpt: vision.excerpt,
        }).failureReason).toBe('excerpt_mismatch');

        expect(verifyEvidenceRef(manifest, {
            sourceKey: risk.sourceKey,
            locatorId: risk.id,
            path: vision.path,
            excerpt: risk.excerpt,
        }).failureReason).toBe('locator_mismatch');
    });

    it('signs model-visible structured context, not only raw source text', () => {
        const baseline = makeManifest();
        const changedPlatform = makeManifest({ platform: 'app' });
        const changedStructuredPrd = makeManifest({
            structuredPRD: {
                ...structuredPRD,
                assumptions: [{ id: 'assumption-1', statement: 'Clinicians have reliable connectivity.', confidence: 'med' }],
            },
        });
        expect(changedPlatform.sources.map(source => source.contentHash)).toEqual(baseline.sources.map(source => source.contentHash));
        expect(changedPlatform.contextSignature).not.toBe(baseline.contextSignature);
        expect(changedStructuredPrd.contextSignature).not.toBe(baseline.contextSignature);
    });

    it('keeps the signature independent of the rebuildable canonicalSpine cache', () => {
        // canonicalSpine is stripped from localStorage (projectStore partialize)
        // to bound storage growth, so it is present in-session but absent after a
        // reload. The signature must NOT depend on its presence, or every review
        // run's context would spuriously read "changed" across a refresh. It is a
        // deterministic projection of structuredPRD, so structuredPrdHash already
        // captures any real change.
        const base = {
            projectId: 'project-1',
            projectName: 'Careful AI',
            platform: 'web' as const,
            productCategory: 'health workflow',
            capturedAt: 100,
            artifacts: [],
            safetyBoundaries: [],
        };
        const spineBase = {
            versionId: 'spine-v2',
            schemaVersion: 2,
            content: '# PRD',
            structuredPRD,
        };
        const withCache = buildReviewContextManifest({
            ...base,
            spine: { ...spineBase, canonicalSpine: buildCanonicalPrdSpine(structuredPRD, {}) },
        });
        const withoutCache = buildReviewContextManifest({ ...base, spine: spineBase });
        expect(withCache.contextSignature).toBe(withoutCache.contextSignature);
    });

    it('chunks long sections instead of truncating their later content', () => {
        const longBody = `${'Early planning detail. '.repeat(150)} FINAL_REQUIREMENT_MARKER`;
        const manifest = makeManifest({
            artifacts: [{
                artifactId: 'implementation',
                versionId: 'implementation-v1',
                subtype: 'implementation_plan',
                title: 'Implementation Plan',
                content: `# Delivery\n${longBody}`,
            }],
        });
        const delivery = manifest.locators.filter(locator => locator.sourceKey === 'artifact:implementation-v1');
        expect(delivery.length).toBeGreaterThan(1);
        expect(delivery.at(-1)?.excerpt).toContain('FINAL_REQUIREMENT_MARKER');
    });

    it('samples large sources across their full range instead of taking only the first 30 locators', () => {
        const content = Array.from({ length: 55 }, (_, index) =>
            `## Delivery section ${index + 1}\nRequirement content for delivery section ${index + 1}.`,
        ).join('\n\n');
        const manifest = makeManifest({
            artifacts: [{
                artifactId: 'implementation',
                versionId: 'implementation-v2',
                subtype: 'implementation_plan',
                title: 'Implementation Plan',
                content,
            }],
        });
        const prompt = buildSpecialistPrompt(manifest, 'delivery_operations');
        expect(prompt).toContain('Delivery section 1');
        expect(prompt).toContain('Delivery section 55');
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
