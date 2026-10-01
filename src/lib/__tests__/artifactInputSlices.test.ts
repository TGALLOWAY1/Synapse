// @vitest-environment jsdom
// (generateCoreArtifact resolves the per-artifact model from localStorage.)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
    ARTIFACT_INPUT_SLICES,
    buildCorePromptCall,
    comparePrdInputs,
    computeArtifactInputHashes,
    currentPrdInputHashesForSpine,
    dependencyContentHash,
    inputContentHash,
    inputHashSchemeFor,
    rebasedInputHashes,
    selectArtifactPrdInput,
    selectCorePromptInput,
    selectMockupSpecInput,
    versionContentHash,
    type ArtifactPrdSources,
    type ArtifactProjectInputs,
} from '../artifactInputSlices';
import { CORE_ARTIFACT_PIPELINE, isRetiredArtifactSubtype } from '../coreArtifactPipeline';
import { renderPremiumMarkdown } from '../services/prdMarkdownRenderer';
import { generateCoreArtifact } from '../services/coreArtifactService';
import { generateMockup } from '../services/mockupService';
import { callGeminiStream } from '../geminiClient';
import type {
    ArtifactSlotKey,
    CoreArtifactSubtype,
    ScreenInventoryContent,
    SpineSafetyReview,
    StructuredPRD,
} from '../../types';

// Only the transport is stubbed: the prompt is assembled by the real
// coreArtifactService + artifactPromptBuilder, exactly as in production.
vi.mock('../geminiClient', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../geminiClient')>()),
    callGemini: vi.fn(),
    callGeminiStream: vi.fn(),
}));

const streamMock = callGeminiStream as unknown as Mock;

beforeEach(() => {
    streamMock.mockReset();
    streamMock.mockResolvedValue('{}');
    localStorage.clear();
});

// --- fixtures ----------------------------------------------------------------

const basePrd = (): StructuredPRD => ({
    productName: 'MoodTune',
    vision: 'Match music to mood in seconds.',
    coreProblem: 'Picking music for a mood is slow.',
    targetUsers: ['Commuters', 'Students'],
    architecture: 'Local-first SPA with a thin sync API.',
    features: [
        { id: 'f1', name: 'Mood Capture', description: 'Capture a mood fast.', userValue: 'Speed', complexity: 'medium', priority: 'must', tier: 'mvp' },
        { id: 'f2', name: 'Resonance Playlist', description: 'Playlist from mood.', userValue: 'Fit', complexity: 'high', priority: 'should', tier: 'v1' },
    ],
    risks: ['Mood detection quality'],
    constraints: ['Must work offline', 'Encrypt stored listening history'],
    nonFunctionalRequirements: ['Playlist ready in under 2 seconds'],
    domainEntities: [{ name: 'Mood Snapshot', description: 'One captured mood' }],
    uxPages: [{ id: 'p1', name: 'Capture', purpose: 'Capture a mood', components: [], interactions: [] }],
    assumptions: [{ id: 'a1', statement: 'Users accept a one-tap capture.', confidence: 'med' }],
});

const safety: SpineSafetyReview = {
    classification: 'allowed',
    status: 'generated',
    detectedConcerns: [],
    userFacingReason: '',
    safeAlternatives: [],
    reviewedAt: 1,
};

const project: ArtifactProjectInputs = {
    name: 'Mood project',
    platform: 'app',
    designSystemPreset: 'consumer_mobile',
};

const sourcesFor = (
    prd: StructuredPRD = basePrd(),
    overrides: Partial<ArtifactPrdSources> = {},
): ArtifactPrdSources => ({
    structuredPRD: prd,
    // Production invariant: a structured spine's responseText is its render.
    prdMarkdown: renderPremiumMarkdown(prd),
    project,
    safetyReview: safety,
    ...overrides,
});

const DEP_CONTENT: Record<CoreArtifactSubtype, string> = {
    screen_inventory: '# Screen Inventory\n- Capture\n- Playlist',
    user_flows: '### Flow: Capture a mood\n**Goal:** Capture.',
    component_inventory: '# Component Inventory\n## Inputs\n### MoodDial',
    design_system: '# Design System\nbrand.primary #FF3366',
    data_model: '# Data Model\n## MoodSnapshot',
    implementation_plan: '# Implementation Plan\n### Milestone 1: Setup',
    prompt_pack: '### 1. Prompt',
};

const ACTIVE_CORE: CoreArtifactSubtype[] = CORE_ARTIFACT_PIPELINE
    .map(meta => meta.subtype)
    .filter(subtype => !isRetiredArtifactSubtype(subtype));

const ALL_SLOTS: ArtifactSlotKey[] = [...ACTIVE_CORE, 'mockup'];

/** Every core output's content, as the controller's shared map would hold it. */
const allDeps = (overrides: Partial<Record<CoreArtifactSubtype, string>> = {}) => ({ ...DEP_CONTENT, ...overrides });

/**
 * Build a core prompt EXACTLY the way the job controller does
 * (artifactJobController.runCoreArtifactSlot): project the sources onto the
 * slot's slice, derive the generateCoreArtifact call from it, and fingerprint
 * the same projection plus the dependency map.
 */
async function generateFrom(
    subtype: CoreArtifactSubtype,
    sources: ArtifactPrdSources,
    deps: Partial<Record<CoreArtifactSubtype, string>>,
    meta: { sourceSpineVersionId?: string; sourcePrdVersion?: number } = {},
) {
    streamMock.mockClear();
    const input = selectCorePromptInput(sources);
    const call = buildCorePromptCall(input, meta);
    const hashes = computeArtifactInputHashes(subtype, input, deps);
    await generateCoreArtifact(subtype, call.prdContent, call.structuredPRD, {
        generatedArtifacts: { ...deps },
        designSystemPreset: call.designSystemPreset,
        canonicalSpine: call.canonicalSpine,
    }).catch(() => undefined); // only the assembled prompt matters here
    expect(streamMock).toHaveBeenCalledTimes(1);
    return { prompt: streamMock.mock.calls[0][1] as string, hashes };
}

// --- canonical hashing --------------------------------------------------------

describe('input fingerprints — canonical hashing', () => {
    it('is deterministic across object key order', () => {
        expect(inputContentHash({ a: 1, b: { c: 2, d: [1, 2] } }))
            .toBe(inputContentHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
    });

    it('ignores cosmetic whitespace: intra-line runs, trailing spaces, line endings, extra blank lines', () => {
        // Runs of spaces/tabs inside a line, and trailing whitespace.
        expect(inputContentHash({ vision: 'Match  music\tto mood. ' }))
            .toBe(inputContentHash({ vision: 'Match music to mood.' }));
        const doc = '# Title\n\nIntro paragraph.\n\n- one\n  - nested\n- two\n';
        expect(dependencyContentHash('# Title  \n\nIntro   paragraph.\t\n\n- one\n  - nested  \n- two')).toBe(dependencyContentHash(doc));
        // CRLF / CR line endings.
        expect(dependencyContentHash(doc.replace(/\n/g, '\r\n'))).toBe(dependencyContentHash(doc));
        expect(dependencyContentHash(doc.replace(/\n/g, '\r'))).toBe(dependencyContentHash(doc));
        // Extra blank lines (whitespace-only lines included) collapse to one;
        // blank lines at either end are dropped.
        expect(dependencyContentHash('\n\n# Title\n\n\n  \t\n\nIntro paragraph.\n\n- one\n  - nested\n- two\n\n\n'))
            .toBe(dependencyContentHash(doc));
    });

    it('keeps line structure: a list, table, or code block never matches the same tokens reflowed', () => {
        // Lines are never joined.
        expect(dependencyContentHash('- a\n- b\n- c')).not.toBe(dependencyContentHash('- a - b - c'));
        expect(dependencyContentHash('| a | b |\n|---|---|\n| 1 | 2 |'))
            .not.toBe(dependencyContentHash('| a | b | |---|---| | 1 | 2 |'));
        expect(dependencyContentHash('```\nconst a = 1;\nconst b = 2;\n```'))
            .not.toBe(dependencyContentHash('``` const a = 1; const b = 2; ```'));
        expect(inputContentHash({ vision: 'Match music\nto mood.' }))
            .not.toBe(inputContentHash({ vision: 'Match music to mood.' }));
        // A paragraph break is not a line break.
        expect(dependencyContentHash('Intro.\n\nMore.')).not.toBe(dependencyContentHash('Intro.\nMore.'));
        // Indentation is structure (list nesting, indented code).
        expect(dependencyContentHash('- one\n  - nested')).not.toBe(dependencyContentHash('- one\n- nested'));
        expect(dependencyContentHash('- one\n  - nested')).not.toBe(dependencyContentHash('- one\n    - nested'));
        expect(dependencyContentHash('Text:\n\n    code')).not.toBe(dependencyContentHash('Text:\n\ncode'));
    });

    it('treats whitespace-only strings as empty', () => {
        expect(inputContentHash({ a: 1, b: ' \n\t\r\n ' })).toBe(inputContentHash({ a: 1 }));
    });

    it('treats empty values as absent (optional fields stay optional)', () => {
        expect(inputContentHash({ a: 1, b: [], c: '', d: undefined, e: null, f: {} }))
            .toBe(inputContentHash({ a: 1 }));
    });

    it('keeps array order and real content significant', () => {
        expect(inputContentHash({ list: ['a', 'b'] })).not.toBe(inputContentHash({ list: ['b', 'a'] }));
        expect(inputContentHash({ vision: 'Match music to mood.' }))
            .not.toBe(inputContentHash({ vision: 'Match music to mood in seconds.' }));
        expect(inputContentHash({ confirmed: false })).not.toBe(inputContentHash({}));
    });

    it('produces a 64-bit hex digest', () => {
        expect(inputContentHash({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
    });

    it('memoizes a stored version\'s content fingerprint without changing it', () => {
        const version = { content: DEP_CONTENT.data_model };
        expect(versionContentHash(version)).toBe(dependencyContentHash(DEP_CONTENT.data_model));
        expect(versionContentHash(version)).toBe(versionContentHash(version));
    });
});

// --- the slice map -------------------------------------------------------------

describe('input fingerprints — the per-slot slice map', () => {
    it('declares every slot; core slots fingerprint exactly their pipeline dependencies', () => {
        for (const meta of CORE_ARTIFACT_PIPELINE) {
            expect(ARTIFACT_INPUT_SLICES[meta.subtype].prd).toBe('core_prompt');
            expect([...ARTIFACT_INPUT_SLICES[meta.subtype].dependencies]).toEqual(meta.dependsOn);
        }
        expect(ARTIFACT_INPUT_SLICES.mockup.prd).toBe('mockup_spec');
        // The mockup's design-system input is tracked by tokensHash on its source ref.
        expect([...ARTIFACT_INPUT_SLICES.mockup.dependencies]).toEqual(['screen_inventory', 'component_inventory']);
    });

    it('compares the design direction only for the design system', () => {
        const compared = ALL_SLOTS.filter(slot => ARTIFACT_INPUT_SLICES[slot].designDirection === 'compared');
        expect(compared).toEqual(['design_system']);
        expect(ARTIFACT_INPUT_SLICES.mockup.designDirection).toBe('not_read');
    });

    it('versions the scheme per slice kind', () => {
        expect(inputHashSchemeFor('data_model')).toBe(inputHashSchemeFor('design_system'));
        expect(inputHashSchemeFor('mockup')).not.toBe(inputHashSchemeFor('data_model'));
        // Hashing scheme 2: line-structure-preserving text. Scheme-1 records
        // (whitespace fully collapsed) are never compared — id fallback.
        expect(inputHashSchemeFor('data_model')).toMatch(/^ih2\.core_prompt\./);
        expect(inputHashSchemeFor('mockup')).toMatch(/^ih2\.mockup_spec\./);
    });
});

// --- generation and freshness agree ----------------------------------------------

describe('input fingerprints — generation and the freshness seam agree', () => {
    it('the current fingerprint of a spine equals what generation records for it, for every slot', () => {
        const sources = sourcesFor();
        const spine = { structuredPRD: sources.structuredPRD, responseText: sources.prdMarkdown, safetyReview: safety };
        for (const slot of ALL_SLOTS) {
            const recorded = computeArtifactInputHashes(slot, selectArtifactPrdInput(slot, sources), {});
            const current = currentPrdInputHashesForSpine(slot, spine, project);
            expect(current, slot).toEqual({
                scheme: recorded.scheme,
                spine: recorded.spine,
                ...(recorded.designBrief ? { designBrief: recorded.designBrief } : {}),
            });
        }
    });

    it('cannot compute a faithful current fingerprint without the project or a structured PRD', () => {
        const sources = sourcesFor();
        const spine = { structuredPRD: sources.structuredPRD, responseText: sources.prdMarkdown };
        expect(currentPrdInputHashesForSpine('data_model', spine, undefined)).toBeUndefined();
        expect(currentPrdInputHashesForSpine('data_model', { responseText: 'md' }, project)).toBeUndefined();
    });

    it('records the content of each declared dependency consumed — and nothing else', () => {
        const hashes = computeArtifactInputHashes(
            'implementation_plan',
            selectCorePromptInput(sourcesFor()),
            allDeps({ user_flows: '   ' }), // blank → treated as missing, like the prompt does
        );
        expect(hashes.dependencies).toEqual({
            screen_inventory: dependencyContentHash(DEP_CONTENT.screen_inventory),
            data_model: dependencyContentHash(DEP_CONTENT.data_model),
        });
        expect(computeArtifactInputHashes('design_system', selectCorePromptInput(sourcesFor()), allDeps()).dependencies)
            .toBeUndefined();
    });
});

// --- drift: a core prompt reads nothing outside its slice -----------------------

describe('input fingerprints — every core prompt depends only on its slice', () => {
    // Inputs a generation call can see that are NOT in a core slice. Each must
    // leave both the assembled prompt and the fingerprint untouched.
    const outsideVariants: Array<{
        label: string;
        sources?: ArtifactPrdSources;
        deps?: (subtype: CoreArtifactSubtype) => Partial<Record<CoreArtifactSubtype, string>>;
        meta?: { sourceSpineVersionId?: string; sourcePrdVersion?: number };
    }> = [
        {
            label: 'project name while the PRD names the product',
            sources: sourcesFor(basePrd(), { project: { ...project, name: 'Renamed project' } }),
        },
        {
            label: 'safety review timestamp',
            sources: sourcesFor(basePrd(), { safetyReview: { ...safety, reviewedAt: 999 } }),
        },
        {
            label: 'spine identity metadata',
            meta: { sourceSpineVersionId: 'another-spine', sourcePrdVersion: 7 },
        },
        {
            label: 'content of an output the slot does not depend on',
            deps: (subtype) => {
                const undeclared = ACTIVE_CORE.find(other =>
                    other !== subtype && !ARTIFACT_INPUT_SLICES[subtype].dependencies.includes(other));
                return undeclared ? allDeps({ [undeclared]: `${DEP_CONTENT[undeclared]}\nchanged elsewhere` }) : allDeps();
            },
        },
    ];

    for (const subtype of ACTIVE_CORE) {
        it(`${subtype}: inputs outside the slice change neither the prompt nor the fingerprint`, async () => {
            const base = await generateFrom(subtype, sourcesFor(), allDeps());
            for (const variant of outsideVariants) {
                const next = await generateFrom(
                    subtype,
                    variant.sources ?? sourcesFor(),
                    variant.deps ? variant.deps(subtype) : allDeps(),
                    variant.meta,
                );
                expect(next.prompt, `${subtype} · ${variant.label}`).toBe(base.prompt);
                expect(next.hashes, `${subtype} · ${variant.label}`).toEqual(base.hashes);
            }
        });

        it(`${subtype}: every input change the prompt sees moves the fingerprint`, async () => {
            const base = await generateFrom(subtype, sourcesFor(), allDeps());
            const insideVariants: Array<{ label: string; sources?: ArtifactPrdSources; deps?: Partial<Record<CoreArtifactSubtype, string>> }> = [
                { label: 'vision', sources: sourcesFor({ ...basePrd(), vision: 'Match music to mood in one tap.' }) },
                { label: 'risks (PRD appendix only)', sources: sourcesFor({ ...basePrd(), risks: ['Licensing costs'] }) },
                {
                    label: 'a decision recorded on an assumption',
                    sources: sourcesFor({ ...basePrd(), assumptions: [{ ...basePrd().assumptions![0], decision: 'confirmed' }] }),
                },
                { label: 'design preset', sources: sourcesFor(basePrd(), { project: { ...project, designSystemPreset: 'enterprise_professional' } }) },
                { label: 'platform', sources: sourcesFor(basePrd(), { project: { ...project, platform: 'web' } }) },
                ...ARTIFACT_INPUT_SLICES[subtype].dependencies.map(dep => ({
                    label: `dependency ${dep}`,
                    deps: allDeps({ [dep]: `${DEP_CONTENT[dep]}\nregenerated` }),
                })),
            ];
            for (const variant of insideVariants) {
                const next = await generateFrom(subtype, variant.sources ?? sourcesFor(), variant.deps ?? allDeps());
                // The direction that matters: the model saw something new, so
                // the fingerprint must not claim the inputs are unchanged.
                expect(next.prompt, `${subtype} · ${variant.label}`).not.toBe(base.prompt);
                expect(next.hashes, `${subtype} · ${variant.label}`).not.toEqual(base.hashes);
            }
        });
    }

    it('attributes a preset change to the design brief, not the PRD-side fingerprint', async () => {
        const base = await generateFrom('screen_inventory', sourcesFor(), allDeps());
        const next = await generateFrom(
            'screen_inventory',
            sourcesFor(basePrd(), { project: { ...project, designSystemPreset: 'enterprise_professional' } }),
            allDeps(),
        );
        expect(next.hashes.spine).toBe(base.hashes.spine);
        expect(next.hashes.designBrief).not.toBe(base.hashes.designBrief);
    });

    it('custom / unknown / missing presets carry no direction and fingerprint alike', () => {
        const brief = (designSystemPreset?: string) => computeArtifactInputHashes(
            'design_system',
            selectCorePromptInput(sourcesFor(basePrd(), { project: { ...project, designSystemPreset } })),
            {},
        ).designBrief;
        expect(brief('custom')).toBe(brief(undefined));
        expect(brief('no-such-preset')).toBe(brief(undefined));
        expect(brief('saas_minimal')).not.toBe(brief(undefined));
    });
});

// --- drift: the mockup spec reads only its narrow slice ---------------------------

describe('input fingerprints — the mockup spec depends only on its slice', () => {
    const screenInventory: ScreenInventoryContent = {
        sections: [{
            title: 'Core',
            screens: [
                { id: 'scr-capture', name: 'Capture', priority: 'P0', purpose: 'Capture a mood' },
                { id: 'scr-playlist', name: 'Playlist', priority: 'P1', purpose: 'Listen' },
            ],
        }],
    };

    // What runMockupSlot stores: the spec payload as content, and the auto
    // settings as `metadata.settings` (they steer the image prompts).
    const specFor = (sources: ArtifactPrdSources) => {
        const input = selectMockupSpecInput(sources);
        const { payload } = generateMockup(input.settings, sources.structuredPRD, screenInventory, null);
        return {
            spec: {
                // Screen ids are fresh uuids per run; everything else is the spec.
                payload: { ...payload, screens: payload.screens.map(screen => ({ ...screen, id: '' })) },
                settings: input.settings,
            },
            hashes: computeArtifactInputHashes('mockup', input, {}),
        };
    };

    it('PRD edits outside the slice leave the spec and the fingerprint unchanged', () => {
        const base = specFor(sourcesFor());
        const prd = basePrd();
        const outside: Array<[string, StructuredPRD]> = [
            ['risks', { ...prd, risks: ['A different risk'] }],
            ['architecture', { ...prd, architecture: 'Serverless functions.' }],
            ['constraints', { ...prd, constraints: ['Runs on low-end phones'] }],
            ['core problem', { ...prd, coreProblem: 'Music apps ignore mood.' }],
            ['target users', { ...prd, targetUsers: ['Runners'] }],
            ['a feature description', { ...prd, features: prd.features.map(f => ({ ...f, description: `${f.description} Now richer.` })) }],
            ['assumption decisions', { ...prd, assumptions: [{ ...prd.assumptions![0], decision: 'rejected', decisionNote: 'No.' }] }],
        ];
        for (const [label, edited] of outside) {
            const next = specFor(sourcesFor(edited));
            expect(next.spec, label).toEqual(base.spec);
            expect(next.hashes, label).toEqual(base.hashes);
        }
    });

    it('edits the spec reads move both the spec and the fingerprint', () => {
        const base = specFor(sourcesFor());
        const prd = basePrd();
        const manyFeatures = Array.from({ length: 6 }, (_, i) => ({
            id: `f${i + 1}`, name: `Feature ${i + 1}`, description: 'd', userValue: 'v', complexity: 'low' as const,
        }));
        const inside: Array<[string, ArtifactPrdSources]> = [
            ['vision', sourcesFor({ ...prd, vision: 'Mood music for runners.' })],
            ['product name', sourcesFor({ ...prd, productName: 'TuneMood' })],
            ['fidelity (feature count crosses 6)', sourcesFor({ ...prd, features: manyFeatures })],
            ['platform', sourcesFor(prd, { project: { ...project, platform: 'web' } })],
        ];
        for (const [label, sources] of inside) {
            const next = specFor(sources);
            expect(next.spec, label).not.toEqual(base.spec);
            expect(next.hashes, label).not.toEqual(base.hashes);
        }
    });
});

// --- comparison + rebase -----------------------------------------------------------

describe('input fingerprints — comparison and rebase', () => {
    const recordedFor = (slot: ArtifactSlotKey, sources = sourcesFor()) =>
        computeArtifactInputHashes(slot, selectArtifactPrdInput(slot, sources), {});

    it('is not comparable across schemes or without a current fingerprint (id fallback)', () => {
        const recorded = recordedFor('data_model');
        expect(comparePrdInputs('data_model', recorded, undefined)).toEqual({ comparable: false });
        expect(comparePrdInputs('data_model', undefined, recorded)).toEqual({ comparable: false });
        expect(comparePrdInputs('data_model', { ...recorded, scheme: 'ih0.core_prompt.1' }, recorded))
            .toEqual({ comparable: false });
        // A record from hashing scheme 1 (written before line structure was
        // kept), same slice version, is never compared against scheme 2.
        const schemeOne = recorded.scheme.replace(/^ih2\./, 'ih1.');
        expect(schemeOne).not.toBe(recorded.scheme);
        expect(comparePrdInputs('data_model', { ...recorded, scheme: schemeOne }, recorded))
            .toEqual({ comparable: false });
    });

    it('reports PRD-side and design-direction changes per the slot policy', () => {
        const before = recordedFor('design_system');
        const after = recordedFor('design_system', sourcesFor(basePrd(), {
            project: { ...project, designSystemPreset: 'enterprise_professional' },
        }));
        expect(comparePrdInputs('design_system', before, after))
            .toEqual({ comparable: true, prdChanged: false, designDirectionChanged: true });
        // Recorded for every core slot, compared only for the design system.
        expect(comparePrdInputs('data_model', recordedFor('data_model'), recordedFor('data_model', sourcesFor(basePrd(), {
            project: { ...project, designSystemPreset: 'enterprise_professional' },
        })))).toEqual({ comparable: true, prdChanged: false, designDirectionChanged: false });
    });

    it('a mark-current rebase records the confirmed inputs and every declared dependency present now', () => {
        const prd = currentPrdInputHashesForSpine(
            'user_flows',
            { structuredPRD: basePrd(), responseText: renderPremiumMarkdown(basePrd()) },
            project,
        );
        const present: Partial<Record<CoreArtifactSubtype, { content: string }>> = {
            screen_inventory: { content: DEP_CONTENT.screen_inventory },
            data_model: { content: DEP_CONTENT.data_model }, // not a user_flows input — ignored
        };
        const rebased = rebasedInputHashes('user_flows', prd, dep => present[dep]);
        expect(rebased).toEqual({
            ...prd,
            dependencies: { screen_inventory: dependencyContentHash(DEP_CONTENT.screen_inventory) },
        });
        expect(rebasedInputHashes('user_flows', undefined, () => undefined)).toBeUndefined();
        // Blank content is recorded as generation would: not an input.
        expect(rebasedInputHashes('user_flows', prd, () => ({ content: ' \n ' }))).toEqual(prd);
    });
});
