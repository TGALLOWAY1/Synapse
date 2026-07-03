import { describe, it, expect } from 'vitest';
import {
    buildCanonicalPrdSpine,
    validateCanonicalPrdSpine,
    canonicalSpineToPromptJson,
    buildCanonicalSpinePromptSection,
} from '../canonicalPrdSpine';
import type { StructuredPRD, SpineSafetyReview } from '../../types';
import { CANONICAL_SPINE_SCHEMA_VERSION } from '../../types';

const FIXED_NOW = () => 1_700_000_000_000;

const BASE_PRD: StructuredPRD = {
    productName: 'MoodTune',
    executiveSummary: 'MoodTune turns a quick emotional check-in into a personalized playlist. It adapts over time.',
    vision: 'Help people find music that matches how they feel in seconds.',
    coreProblem: 'Choosing music for a mood is slow and manual.',
    targetUsers: ['Casual listeners', 'Commuters'],
    architecture: 'Local-first React SPA with a lightweight recommendation service. Storage in IndexedDB.',
    features: [
        {
            id: 'f1',
            name: 'Mood Capture',
            description: 'Capture a mood in under five seconds.',
            userValue: 'Fast emotional input',
            complexity: 'medium',
            priority: 'must',
            tier: 'mvp',
            acceptanceCriteria: ['Mood recorded in <5s'],
            successCriteria: ['Playlist seeded from mood'],
        },
        {
            id: 'f2',
            name: 'Resonance Playlist',
            description: 'Generate a playlist from the captured mood.',
            userValue: 'Instant fitting music',
            complexity: 'high',
            priority: 'should',
        },
    ],
    risks: ['Recommendation quality'],
    constraints: ['Must work offline', 'All PII must be encrypted at rest'],
    nonFunctionalRequirements: ['P95 latency under 200ms', 'GDPR compliant data handling'],
    domainEntities: [
        { name: 'MoodSnapshot', description: 'A captured emotional state.' },
        { name: 'ResonancePlaylist', description: 'A generated playlist.' },
    ],
    jtbd: [
        {
            segment: 'Commuter',
            motivation: 'Wants a soundtrack for the drive',
            painPoints: ['Too many taps to build a playlist'],
            job: 'Get fitting music instantly',
            successMoment: 'Playlist starts before the light turns green',
        },
    ],
    uxPages: [
        { id: 'p1', name: 'Mood Capture', purpose: 'Capture the mood', components: [], interactions: [], primaryUser: 'Commuter', emptyState: 'No mood yet' },
        { id: 'p2', name: 'Player', purpose: 'Play the resonance playlist', components: [], interactions: [] },
    ],
    productThesis: {
        whyExist: 'Music selection should match emotion, not genre.',
        differentiation: 'Emotion-first.',
        nonGoals: ['Not a social network'],
    },
};

describe('buildCanonicalPrdSpine', () => {
    it('builds a spine from a normal structured PRD', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        expect(spine.identity.productName).toBe('MoodTune');
        expect(spine.identity.description).toBe('MoodTune turns a quick emotional check-in into a personalized playlist.');
        expect(spine.identity.primaryGoal).toBe(BASE_PRD.vision);
        expect(spine.features).toHaveLength(2);
        expect(spine.users[0].segment).toBe('Commuter');
        expect(spine.meta.schemaVersion).toBe(CANONICAL_SPINE_SCHEMA_VERSION);
        expect(spine.meta.generatedAt).toBe(FIXED_NOW());
    });

    it('preserves PRD feature ids exactly and keeps them unique', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        expect(spine.features.map(f => f.id)).toEqual(['f1', 'f2']);
        const ids = spine.features.map(f => f.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('merges successCriteria into acceptance criteria', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        expect(spine.features[0].acceptanceCriteria).toEqual(['Mood recorded in <5s', 'Playlist seeded from mood']);
    });

    it('uses the user-chosen project name when the PRD has none (product identity preserved)', () => {
        const prd: StructuredPRD = { ...BASE_PRD, productName: undefined };
        const spine = buildCanonicalPrdSpine(prd, { projectName: 'My Chosen Name', now: FIXED_NOW });
        expect(spine.identity.productName).toBe('My Chosen Name');
    });

    it('maps platform to a human label', () => {
        expect(buildCanonicalPrdSpine(BASE_PRD, { platform: 'app', now: FIXED_NOW }).identity.platform).toBe('Mobile app');
        expect(buildCanonicalPrdSpine(BASE_PRD, { platform: 'web', now: FIXED_NOW }).identity.platform).toBe('Web app');
    });

    it('derives screen seeds from uxPages with deterministic scr- ids', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        expect(spine.screenSeeds.map(s => s.id)).toEqual(['scr-mood-capture', 'scr-player']);
        const again = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        expect(again.screenSeeds.map(s => s.id)).toEqual(spine.screenSeeds.map(s => s.id));
        // The Mood Capture screen matches feature f1 by name.
        expect(spine.screenSeeds[0].relatedFeatureIds).toContain('f1');
        expect(spine.screenSeeds[0].userIntent).toBe('Commuter');
    });

    it('suffixes duplicate screen names deterministically', () => {
        const prd: StructuredPRD = {
            ...BASE_PRD,
            uxPages: [
                { id: 'a', name: 'Settings', purpose: 'x', components: [], interactions: [] },
                { id: 'b', name: 'Settings', purpose: 'y', components: [], interactions: [] },
            ],
        };
        const spine = buildCanonicalPrdSpine(prd, { now: FIXED_NOW });
        expect(spine.screenSeeds.map(s => s.id)).toEqual(['scr-settings', 'scr-settings-2']);
    });

    it('derives entity seeds from domainEntities with deterministic ent- ids', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        expect(spine.entitySeeds.map(e => e.id)).toEqual(['ent-moodsnapshot', 'ent-resonanceplaylist']);
        const again = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        expect(again.entitySeeds.map(e => e.id)).toEqual(spine.entitySeeds.map(e => e.id));
    });

    it('extracts privacy/security constraints out of the general lists', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        expect(spine.constraints.privacySecurityCompliance).toEqual(
            expect.arrayContaining(['All PII must be encrypted at rest', 'GDPR compliant data handling']),
        );
        expect(spine.constraints.product).toEqual(['Must work offline']);
        expect(spine.constraints.nonFunctional).toEqual(['P95 latency under 200ms']);
        expect(spine.constraints.outOfScope).toEqual(['Not a social network']);
    });

    it('preserves architecture direction when present in the PRD', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        expect(spine.architecture.summary).toBe(BASE_PRD.architecture);
    });

    it('includes design direction when a concrete preset is selected', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { designSystemPreset: 'saas_minimal', now: FIXED_NOW });
        expect(spine.design?.presetId).toBe('saas_minimal');
        expect(spine.design?.presetLabel).toBeTruthy();
    });

    it('omits design direction for a custom/unknown preset', () => {
        expect(buildCanonicalPrdSpine(BASE_PRD, { designSystemPreset: 'custom', now: FIXED_NOW }).design).toBeUndefined();
        expect(buildCanonicalPrdSpine(BASE_PRD, { designSystemPreset: 'nope', now: FIXED_NOW }).design).toBeUndefined();
        expect(buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW }).design).toBeUndefined();
    });

    it('propagates safety restrictions for an allowed_with_restrictions run', () => {
        const review: SpineSafetyReview = {
            classification: 'allowed_with_restrictions',
            status: 'restricted',
            detectedConcerns: ['covert collection', 'surveillance'],
            userFacingReason: 'Touches monitoring.',
            safeAlternatives: ['Add consent'],
            reviewedAt: 1,
        };
        const spine = buildCanonicalPrdSpine(BASE_PRD, { safetyReview: review, now: FIXED_NOW });
        expect(spine.safety?.classification).toBe('allowed_with_restrictions');
        expect(spine.safety?.status).toBe('restricted');
        expect(spine.safety?.boundaries).toEqual(['covert collection', 'surveillance']);
        expect(spine.safety?.restrictionDirectives?.length ?? 0).toBeGreaterThan(0);
    });

    it('falls back to targetUsers and richDataModel when premium fields are absent', () => {
        const prd: StructuredPRD = {
            ...BASE_PRD,
            jtbd: undefined,
            uxPages: undefined,
            domainEntities: undefined,
            userLoops: [
                { name: 'Capture loop', trigger: 't', action: 'Capture mood', systemResponse: 'r', reward: 'w', retentionMechanic: 'm' },
            ],
            richDataModel: { entities: [{ name: 'Track', description: 'A song', fields: [] }] },
        };
        const spine = buildCanonicalPrdSpine(prd, { now: FIXED_NOW });
        expect(spine.users.map(u => u.segment)).toEqual(['Casual listeners', 'Commuters']);
        expect(spine.screenSeeds.map(s => s.id)).toEqual(['scr-capture-loop']);
        expect(spine.entitySeeds.map(e => e.id)).toEqual(['ent-track']);
    });
});

describe('validateCanonicalPrdSpine', () => {
    it('passes for a normal spine', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        expect(spine.meta.validation.valid).toBe(true);
        expect(spine.meta.validation.warnings).toEqual([]);
    });

    it('warns when the feature glossary is empty', () => {
        const prd: StructuredPRD = { ...BASE_PRD, features: [] };
        const spine = buildCanonicalPrdSpine(prd, { now: FIXED_NOW });
        expect(spine.meta.validation.valid).toBe(false);
        expect(spine.meta.validation.warnings.some(w => /Feature glossary is empty/.test(w))).toBe(true);
    });

    it('warns when feature ids are not unique', () => {
        const prd: StructuredPRD = {
            ...BASE_PRD,
            features: [BASE_PRD.features[0], { ...BASE_PRD.features[1], id: 'f1' }],
        };
        const spine = buildCanonicalPrdSpine(prd, { now: FIXED_NOW });
        expect(spine.meta.validation.warnings.some(w => /not unique/.test(w))).toBe(true);
    });

    it('warns when safety restrictions were present but dropped', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        // Simulate a spine that lost its safety block.
        const stripped = { ...spine, safety: undefined };
        const review: SpineSafetyReview = {
            classification: 'allowed_with_restrictions',
            status: 'restricted',
            detectedConcerns: [],
            userFacingReason: '',
            safeAlternatives: [],
            reviewedAt: 1,
        };
        const result = validateCanonicalPrdSpine(stripped, { prd: BASE_PRD, options: { safetyReview: review } });
        expect(result.warnings.some(w => /Safety restrictions/.test(w))).toBe(true);
    });
});

describe('canonicalSpineToPromptJson / buildCanonicalSpinePromptSection', () => {
    it('omits the meta block and empty containers from the prompt JSON', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        const json = canonicalSpineToPromptJson(spine);
        const parsed = JSON.parse(json);
        expect(parsed.meta).toBeUndefined();
        expect(parsed.identity.productName).toBe('MoodTune');
        // safety/design were not provided → pruned out entirely.
        expect(parsed.safety).toBeUndefined();
        expect(parsed.design).toBeUndefined();
    });

    it('produces an authoritative prompt section for a spine with features', () => {
        const spine = buildCanonicalPrdSpine(BASE_PRD, { now: FIXED_NOW });
        const section = buildCanonicalSpinePromptSection(spine);
        expect(section).not.toBeNull();
        expect(section).toMatch(/AUTHORITATIVE/);
        expect(section).toMatch(/Reuse feature ids exactly/);
        expect(section).toMatch(/"id": "f1"/);
    });

    it('returns null (fallback signal) for a spine with no features', () => {
        const spine = buildCanonicalPrdSpine({ ...BASE_PRD, features: [] }, { now: FIXED_NOW });
        expect(buildCanonicalSpinePromptSection(spine)).toBeNull();
    });
});
