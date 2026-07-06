import { describe, expect, it } from 'vitest';
import {
    buildArtifactPrompt,
    detectStaleFeatureNames,
    SECTION,
    type ArtifactPromptSources,
} from '../artifactPromptBuilder';
import { CANONICAL_SPINE_SCHEMA_VERSION, type CanonicalPrdSpine } from '../../../types';

const makeSpine = (overrides: Partial<CanonicalPrdSpine> = {}): CanonicalPrdSpine => ({
    identity: { productName: 'Acme', description: 'Do the thing' },
    users: [],
    features: [
        { id: 'f1', name: 'Smart Inbox', description: 'A prioritized inbox' },
        { id: 'f2', name: 'Digest Emails', description: 'Daily summary emails' },
    ],
    screenSeeds: [],
    entitySeeds: [],
    constraints: {},
    architecture: {},
    meta: {
        schemaVersion: CANONICAL_SPINE_SCHEMA_VERSION,
        generatedAt: 0,
        validation: { valid: true, warnings: [] },
    },
    ...overrides,
});

const baseSources = (overrides: Partial<ArtifactPromptSources> = {}): ArtifactPromptSources => ({
    userPrefix: 'Create a data model from this PRD:',
    guardrails: 'Ground every entity in the PRD.',
    canonicalSpine: makeSpine(),
    spineSection: 'CANONICAL SPINE JSON HERE (features: Smart Inbox, Digest Emails)',
    dependencyContext: 'screen_inventory: Inbox screen, Digest screen',
    dependencyKeys: ['screen_inventory'],
    presetSection: '',
    prdMarkdown: 'The product includes Smart Inbox and Digest Emails features.',
    mockupSection: '',
    ...overrides,
});

describe('buildArtifactPrompt', () => {
    it('orders sections with the canonical spine authoritative and the PRD markdown as a secondary appendix', () => {
        const built = buildArtifactPrompt(baseSources());
        // Spine appears before the PRD markdown appendix.
        const spineIdx = built.sections.indexOf(SECTION.spine);
        const appendixIdx = built.sections.indexOf(SECTION.appendix);
        const depIdx = built.sections.indexOf(SECTION.dependencies);
        expect(spineIdx).toBeGreaterThanOrEqual(0);
        expect(depIdx).toBeGreaterThan(spineIdx);
        expect(appendixIdx).toBeGreaterThan(depIdx);
        // The hierarchy header comes before the spine.
        expect(built.sections.indexOf(SECTION.hierarchy)).toBeLessThan(spineIdx);
        // The appendix is explicitly marked secondary.
        expect(built.prompt).toContain('SECONDARY REFERENCE ONLY');
        expect(built.prompt).toContain('MUST NOT override the Canonical PRD Spine');
        expect(built.usedSpine).toBe(true);
    });

    it('Case 1: PRD markdown that conflicts with a canonical feature name is flagged as stale', () => {
        // The PRD prose calls the feature "Priority Mailbox" but the spine's
        // canonical name is "Smart Inbox" — a drifted/stale name.
        const built = buildArtifactPrompt(
            baseSources({
                prdMarkdown: 'The product includes Priority Mailbox and Digest Emails features.',
            }),
        );
        // Canonical spine is clearly marked authoritative.
        expect(built.sections).toContain(SECTION.spine);
        expect(built.prompt).toContain('AUTHORITATIVE — CANONICAL PRD SPINE');
        // Full PRD markdown is identified as secondary/fallback.
        expect(built.prompt).toContain(SECTION.appendix);
        // The stale name is flagged.
        expect(built.staleNameConflicts.map(c => c.id)).toEqual(['f1']);
        expect(built.hasConflictBlock).toBe(true);
        expect(built.prompt).toContain(SECTION.conflicts);
        expect(built.prompt).toContain('canonically named "Smart Inbox"');
    });

    it('Case 2: instructs the model to prefer the canonical spine over a conflicting dependency artifact', () => {
        const built = buildArtifactPrompt(baseSources());
        // The dependency section carries the prefer-spine-unless-newer rule.
        expect(built.prompt).toContain(SECTION.dependencies);
        expect(built.prompt).toContain('prefer the spine');
        expect(built.prompt).toContain('unless the dependency is');
        expect(built.prompt).toContain('explicitly newer and valid');
    });

    it('Case 3: surfaces a visible conflict/staleness block when source metadata is partial or stale', () => {
        const built = buildArtifactPrompt(
            baseSources({
                notices: ['Required upstream dependency is missing (data_model); generate against the spine.'],
                // no stale names here — the notice alone must trigger the block
                prdMarkdown: 'The product includes Smart Inbox and Digest Emails features.',
            }),
        );
        expect(built.hasConflictBlock).toBe(true);
        expect(built.sections).toContain(SECTION.conflicts);
        expect(built.prompt).toContain('data_model');
    });

    it('omits the conflict block when there are no notices and no stale names', () => {
        const built = buildArtifactPrompt(baseSources());
        expect(built.hasConflictBlock).toBe(false);
        expect(built.sections).not.toContain(SECTION.conflicts);
    });

    it('falls back to the legacy structured summary when there is no spine', () => {
        const built = buildArtifactPrompt(
            baseSources({ spineSection: null, legacyStructured: 'Canonical Feature Glossary:\n- f1 Smart Inbox' }),
        );
        expect(built.usedSpine).toBe(false);
        expect(built.sections).toContain(SECTION.structuredFallback);
        expect(built.sections).not.toContain(SECTION.spine);
        // No stale-name detection without a spine.
        expect(built.staleNameConflicts).toEqual([]);
    });

    it('includes the selected-options section only when a preset is present', () => {
        const withPreset = buildArtifactPrompt(baseSources({ presetSection: 'SELECTED DESIGN DIRECTION: Modern SaaS' }));
        expect(withPreset.sections).toContain(SECTION.options);
        expect(withPreset.prompt).toContain('Modern SaaS');

        const withoutPreset = buildArtifactPrompt(baseSources({ presetSection: '' }));
        expect(withoutPreset.sections).not.toContain(SECTION.options);
    });
});

describe('detectStaleFeatureNames', () => {
    it('flags features whose canonical name is absent from the PRD prose', () => {
        const spine = makeSpine();
        const conflicts = detectStaleFeatureNames(spine, 'Only Digest Emails is mentioned here.');
        expect(conflicts).toEqual([{ id: 'f1', canonicalName: 'Smart Inbox' }]);
    });

    it('returns no conflicts when every canonical name appears in the prose', () => {
        const spine = makeSpine();
        const conflicts = detectStaleFeatureNames(spine, 'Smart Inbox and Digest Emails are both here.');
        expect(conflicts).toEqual([]);
    });
});
