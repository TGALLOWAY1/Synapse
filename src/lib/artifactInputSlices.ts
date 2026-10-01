// Artifact input slices + input fingerprints — what each output's generator
// reads, and stable hashes of exactly that.
//
// The freshness engine (evaluateDependencyGraph) used to treat "the PRD has a
// new version id" as proof that every output is stale. That is wrong in both
// directions it matters for: a restore to the exact content an output came
// from, a no-op save, or an overlay edit that clones an upstream version all
// moved an id without changing a single input. This module records WHAT an
// output was generated from, so the engine can compare inputs instead of ids:
//
//   - ARTIFACT_INPUT_SLICES declares, per slot, which inputs its generator
//     reads (the slot's slice).
//   - `selectArtifactPrdInput` projects the PRD-side sources onto that slice.
//     The job controller builds every core prompt FROM this projection
//     (`buildCorePromptCall`) and the mockup spec from its settings, so the
//     prompt and the fingerprint cannot drift apart — the drift tests in
//     artifactInputSlices.test.ts assert that changing anything outside a
//     slice leaves the prompt (and the fingerprint) unchanged.
//   - `computeArtifactInputHashes` fingerprints the projection plus the exact
//     upstream content consumed; the controller stamps it on the new version as
//     `provenance.inputHashes`. `currentPrdInputHashesForSpine` fingerprints
//     the CURRENT inputs the same way for the freshness seam.
//
// Fingerprints hash RAW inputs (structured PRD, stored PRD markdown, project
// options, upstream content) — never derived representations such as the
// canonical spine — so a deploy that changes how the spine or a prompt is
// rendered never flips a fingerprint for content the user did not touch.
// Hashing is canonical: object keys are sorted, empty values are dropped, and
// text keeps its line structure while cosmetic spacing is normalized (see
// `canonicalText`), so key order and cosmetic whitespace never move a
// fingerprint — but a list, table, or code block reflowed onto one line does.
//
// Pure: no store/React/LLM imports (mirrors artifactDependencyGraph.ts). The
// recorded fingerprint is provenance (persisted on the version); every
// comparison is derived on read (cross-cutting rule 10).

import type {
    ArtifactInputHashes,
    ArtifactSlotKey,
    CanonicalPrdSpine,
    CoreArtifactSubtype,
    MockupSettings,
    ProjectPlatform,
    SpineSafetyReview,
    StructuredPRD,
} from '../types';
import { MOCKUP_DEPENDENCIES, getArtifactMeta } from './coreArtifactPipeline';
import { buildCanonicalPrdSpine } from './canonicalPrdSpine';
import { getDesignSystemPreset } from './designSystemPresets';
import { buildAutoMockupSettings } from './mockupDefaults';

// ---------------------------------------------------------------------------
// Canonical hashing
// ---------------------------------------------------------------------------

/**
 * Canonical text: line structure kept, cosmetic spacing normalized. Line
 * endings become LF; every line keeps its indentation (list nesting and
 * indented code are Markdown structure) but loses its trailing whitespace,
 * and any other run of spaces/tabs inside it collapses to one space; runs of
 * blank lines collapse to a single blank line (a paragraph break stays one
 * paragraph break) and blank lines at either end are dropped. Lines are never
 * joined, so a multiline list, table, or code block and the same tokens on
 * one line fingerprint differently.
 */
function canonicalText(text: string): string {
    return text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => {
            const indent = line.length - line.trimStart().length;
            const body = line.slice(indent).replace(/\s+/g, ' ').trimEnd();
            return body === '' ? '' : line.slice(0, indent) + body;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+|\n+$/g, '');
}

/**
 * Canonical form for fingerprinting: object keys sorted, strings in
 * `canonicalText` form, and empty values (undefined / null / blank strings /
 * [] / {}) dropped — so `{ a: 1, b: [] }` and `{ a: 1 }` fingerprint alike, as
 * do two strings that differ only in cosmetic spacing. Booleans and numbers
 * are kept as-is.
 */
function canonicalize(value: unknown): unknown {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
        const text = canonicalText(value);
        return text === '' ? undefined : text;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        const items = value.map(canonicalize).filter(item => item !== undefined);
        return items.length > 0 ? items : undefined;
    }
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
        const item = canonicalize(record[key]);
        if (item !== undefined) out[key] = item;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 64-bit non-cryptographic string hash (cyrb53's two independent 32-bit lanes,
 * both kept). Synchronous and dependency-free like the other content hashes in
 * the codebase, but wide enough that a false "unchanged" verdict is not a
 * practical concern — a collision here would hide real drift.
 */
function hash64(text: string): string {
    let h1 = 0xdeadbeef ^ text.length;
    let h2 = 0x41c6ce57 ^ text.length;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

/** Deterministic fingerprint of any JSON-like value (insensitive to key order and cosmetic whitespace). */
export function inputContentHash(value: unknown): string {
    return hash64(JSON.stringify(canonicalize(value) ?? null));
}

/** Fingerprint of an upstream artifact's content as fed to a dependent's generator. */
export function dependencyContentHash(content: string): string {
    return inputContentHash(content);
}

// A version's content never changes under its id (user work lives in metadata
// overlays), so its fingerprint is memoized per stored version object.
const versionContentHashCache = new WeakMap<object, string>();

/** `dependencyContentHash` of a stored version's content, memoized per version object. */
export function versionContentHash(version: { content: string }): string {
    let hash = versionContentHashCache.get(version);
    if (hash === undefined) {
        hash = dependencyContentHash(version.content);
        versionContentHashCache.set(version, hash);
    }
    return hash;
}

const BLANK_CONTENT_HASH = dependencyContentHash('');

/**
 * Would generation consume content with this fingerprint? Not blank content:
 * generation treats it as unavailable (artifactDependencyGate) and records
 * nothing for it (computeArtifactInputHashes) — so a dependency whose content
 * is blank never counts as "now available" to an output built without it.
 */
export function isConsumableContentHash(hash: string): boolean {
    return hash !== BLANK_CONTENT_HASH;
}

// ---------------------------------------------------------------------------
// The slice map
// ---------------------------------------------------------------------------

/**
 * Bumped when the canonical hashing itself changes — or when a persisted-data
 * migration rewrites stored inputs (structured PRDs, PRD markdown, artifact
 * content) without the user changing them, since fingerprints hash those raw
 * values. Together with each slot's slice `version` it forms the recorded
 * `scheme`; a record from another scheme is never compared (the engine falls
 * back to version ids), so such a change can never mass-flag existing outputs.
 *
 * 2: text keeps its line structure (`canonicalText`); scheme 1 collapsed every
 *    whitespace run, line breaks included.
 */
const INPUT_HASH_SCHEME_VERSION = 2;

/**
 * What a slot's generator reads from the PRD side:
 *   - `core_prompt`: the core-artifact prompt (coreArtifactService +
 *     artifactPromptBuilder) — the canonical PRD spine built from the WHOLE
 *     structured PRD (identity, users, features, screen/entity seeds,
 *     constraints, safety, architecture, design direction), the guardrails'
 *     feature-id list, the legacy structured summary when the PRD has no
 *     features, and the FULL PRD markdown appendix (`SpineVersion.responseText`,
 *     which renders essentially every structured field, decisions included).
 *     Every core prompt reads all of it today, so any PRD content edit moves
 *     a core fingerprint. Narrowing a subtype means narrowing what its prompt
 *     reads — add a new kind here and build that prompt from it, so prompt
 *     and fingerprint keep moving together.
 *   - `mockup_spec`: the deterministic mockup spec builder (generateMockup +
 *     buildAutoMockupSettings) — only the product name, the vision, and the
 *     auto settings (platform + a fidelity derived from feature count,
 *     high-complexity count, and PRD length).
 */
export type ArtifactPrdSliceKind = 'core_prompt' | 'mockup_spec';

/**
 * How the selected design-system preset (the design direction) relates to a
 * slot:
 *   - `compared`: a changed direction marks the output stale. Only the design
 *     system, whose prompt carries the preset directive as a hard task
 *     constraint.
 *   - `recorded`: the prompt carries the direction (the canonical spine's
 *     `design` block is in every core prompt) and the fingerprint records it,
 *     but a change does not mark the output stale: a visual-direction change
 *     invalidates the design system and — through its tokens — the mockups,
 *     the rule the engine applied before fingerprints existed.
 *   - `not_read`: the generator never sees it (the mockup spec; mockups track
 *     the design system through its tokensHash instead).
 */
export type DesignDirectionPolicy = 'compared' | 'recorded' | 'not_read';

export interface ArtifactInputSliceSpec {
    /** Bump when this slot's slice — or what its generator reads — changes. */
    version: number;
    prd: ArtifactPrdSliceKind;
    designDirection: DesignDirectionPolicy;
    /**
     * Upstream artifacts whose content the generator consumes, fingerprinted
     * per dependency. The mockup's design_system input is NOT here: it is
     * fingerprinted by the tokensHash on its design-system source ref
     * (`SourceRef.anchorInfo`), which the engine already compares.
     */
    dependencies: readonly CoreArtifactSubtype[];
}

const coreSlice = (
    subtype: CoreArtifactSubtype,
    designDirection: DesignDirectionPolicy = 'recorded',
): ArtifactInputSliceSpec => ({
    version: 1,
    prd: 'core_prompt',
    designDirection,
    dependencies: getArtifactMeta(subtype).dependsOn,
});

/** The per-slot slice — the single declaration of what each generator reads. */
export const ARTIFACT_INPUT_SLICES: Readonly<Record<ArtifactSlotKey, ArtifactInputSliceSpec>> = {
    design_system: coreSlice('design_system', 'compared'),
    screen_inventory: coreSlice('screen_inventory'),
    user_flows: coreSlice('user_flows'),
    component_inventory: coreSlice('component_inventory'),
    data_model: coreSlice('data_model'),
    implementation_plan: coreSlice('implementation_plan'),
    // Retired from new generation; kept so the map stays total.
    prompt_pack: coreSlice('prompt_pack'),
    mockup: {
        version: 1,
        prd: 'mockup_spec',
        designDirection: 'not_read',
        dependencies: MOCKUP_DEPENDENCIES.filter(dep => dep !== 'design_system'),
    },
};

/** The scheme string recorded with (and required to compare) a slot's fingerprints. */
export function inputHashSchemeFor(slot: ArtifactSlotKey): string {
    return `ih${INPUT_HASH_SCHEME_VERSION}.${ARTIFACT_INPUT_SLICES[slot].prd}.${ARTIFACT_INPUT_SLICES[slot].version}`;
}

// ---------------------------------------------------------------------------
// The projection the prompt builder and the hasher share
// ---------------------------------------------------------------------------

/** The project-level options generation reads (structurally satisfied by `Project`). */
export interface ArtifactProjectInputs {
    name?: string;
    productName?: string;
    platform?: ProjectPlatform;
    designSystemPreset?: string;
}

/** The PRD-side sources of one generation: a spine version plus its project. */
export interface ArtifactPrdSources {
    structuredPRD: StructuredPRD;
    /** `SpineVersion.responseText` — the PRD markdown every core prompt appends. */
    prdMarkdown: string;
    project?: ArtifactProjectInputs;
    safetyReview?: SpineSafetyReview;
}

/** Everything PRD-side a core-artifact prompt is built from. */
export interface CorePromptPrdInput {
    kind: 'core_prompt';
    structuredPRD: StructuredPRD;
    prdMarkdown: string;
    /** The canonical spine's product-name fallback (used only when the PRD has none). */
    projectName?: string;
    platform?: ProjectPlatform;
    designSystemPreset?: string;
    safetyReview?: SpineSafetyReview;
}

/** Everything PRD-side the mockup spec builder reads. */
export interface MockupSpecPrdInput {
    kind: 'mockup_spec';
    productName?: string;
    vision?: string;
    settings: MockupSettings;
}

export type ArtifactPrdInput = CorePromptPrdInput | MockupSpecPrdInput;

export function selectCorePromptInput(sources: ArtifactPrdSources): CorePromptPrdInput {
    return {
        kind: 'core_prompt',
        structuredPRD: sources.structuredPRD,
        prdMarkdown: sources.prdMarkdown,
        // Mirrors what the job controller always passed the spine builder.
        projectName: sources.project?.productName || sources.project?.name,
        platform: sources.project?.platform,
        designSystemPreset: sources.project?.designSystemPreset,
        safetyReview: sources.safetyReview,
    };
}

export function selectMockupSpecInput(sources: ArtifactPrdSources): MockupSpecPrdInput {
    return {
        kind: 'mockup_spec',
        productName: sources.structuredPRD.productName,
        vision: sources.structuredPRD.vision,
        settings: buildAutoMockupSettings(sources.prdMarkdown, sources.structuredPRD, sources.project?.platform),
    };
}

/** Project the PRD-side sources onto a slot's slice. */
export function selectArtifactPrdInput(slot: ArtifactSlotKey, sources: ArtifactPrdSources): ArtifactPrdInput {
    return ARTIFACT_INPUT_SLICES[slot].prd === 'mockup_spec'
        ? selectMockupSpecInput(sources)
        : selectCorePromptInput(sources);
}

/**
 * The `generateCoreArtifact` arguments derived from a core input — the only
 * way the job controller calls it, so a core prompt reads nothing PRD-side
 * that its fingerprint does not cover. `meta` reaches only the spine's `meta`
 * block, which the prompt strips.
 */
export function buildCorePromptCall(
    input: CorePromptPrdInput,
    meta: { sourceSpineVersionId?: string; sourcePrdVersion?: number } = {},
): {
    prdContent: string;
    structuredPRD: StructuredPRD;
    designSystemPreset?: string;
    canonicalSpine: CanonicalPrdSpine;
} {
    return {
        prdContent: input.prdMarkdown,
        structuredPRD: input.structuredPRD,
        designSystemPreset: input.designSystemPreset,
        canonicalSpine: buildCanonicalPrdSpine(input.structuredPRD, {
            projectName: input.projectName,
            platform: input.platform,
            designSystemPreset: input.designSystemPreset,
            safetyReview: input.safetyReview,
            ...meta,
        }),
    };
}

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

/** The PRD-side half of a fingerprint — what the freshness seam computes for the current inputs. */
export type CurrentPrdInputHashes = Pick<ArtifactInputHashes, 'scheme' | 'spine' | 'designBrief'>;

/** A concrete preset carries a design direction; custom/unknown/missing carries none. */
const effectiveDesignPresetId = (presetId: string | undefined): string | null => {
    const preset = getDesignSystemPreset(presetId);
    return preset?.directive ? preset.id : null;
};

const corePromptPrdPayload = (input: CorePromptPrdInput) => ({
    prd: input.structuredPRD,
    prdMarkdown: input.prdMarkdown,
    // The canonical spine names the product from the PRD and falls back to the
    // project name only when the PRD has none (buildIdentity).
    productNameFallback: input.structuredPRD.productName ? undefined : input.projectName,
    platform: input.platform,
    // The fields the canonical spine's safety block is rebuilt from (never
    // `reviewedAt`).
    safety: input.safetyReview
        ? {
            classification: input.safetyReview.classification,
            status: input.safetyReview.status,
            detectedConcerns: input.safetyReview.detectedConcerns,
            userFacingReason: input.safetyReview.userFacingReason,
            safeAlternatives: input.safetyReview.safeAlternatives,
        }
        : undefined,
});

const mockupSpecPrdPayload = (input: MockupSpecPrdInput) => ({
    productName: input.productName,
    vision: input.vision,
    settings: input.settings,
});

/** Fingerprint a slot's PRD-side input (scheme + spine + design brief). */
function hashPrdInput(slot: ArtifactSlotKey, input: ArtifactPrdInput): CurrentPrdInputHashes {
    const scheme = inputHashSchemeFor(slot);
    if (input.kind === 'mockup_spec') {
        return { scheme, spine: inputContentHash(mockupSpecPrdPayload(input)) };
    }
    return {
        scheme,
        spine: inputContentHash(corePromptPrdPayload(input)),
        designBrief: inputContentHash({ designPreset: effectiveDesignPresetId(input.designSystemPreset) ?? 'none' }),
    };
}

/**
 * The full fingerprint recorded on a generated version: the PRD-side input
 * plus the exact content of every declared dependency that was consumed.
 * `consumed` is the generation's dependency map at call time; dependencies the
 * slot does not declare are ignored (their content never reaches the prompt),
 * and a missing or blank dependency records nothing — that absence IS the
 * record that the input was unavailable (a plan saved without its optional
 * user flows), which the engine flags once the input becomes usable.
 */
export function computeArtifactInputHashes(
    slot: ArtifactSlotKey,
    input: ArtifactPrdInput,
    consumed: Partial<Record<CoreArtifactSubtype, string>>,
): ArtifactInputHashes {
    const dependencies: Partial<Record<CoreArtifactSubtype, string>> = {};
    for (const dep of ARTIFACT_INPUT_SLICES[slot].dependencies) {
        const content = consumed[dep];
        if (content && content.trim()) dependencies[dep] = dependencyContentHash(content);
    }
    return {
        ...hashPrdInput(slot, input),
        ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    };
}

/** The slice of a spine version the PRD-side fingerprint reads. */
export interface SpineInputSource {
    structuredPRD?: StructuredPRD;
    responseText: string;
    safetyReview?: SpineSafetyReview;
}

// Spine versions are immutable store objects (every change makes a new one),
// so the PRD-side fingerprint is memoized per spine object. The payload hash
// depends only on the slice KIND and the project options — never on the slot
// — so every core slot shares one hash of the (large) structured PRD +
// markdown; only the scheme string is per slot.
const prdHashCache = new WeakMap<object, Map<string, Omit<CurrentPrdInputHashes, 'scheme'>>>();

/**
 * The CURRENT PRD-side fingerprint of a slot for a spine version, computed
 * exactly as generation records it. Undefined when it cannot be computed
 * faithfully — a spine without a structured PRD, or an unknown project (the
 * recorded fingerprint includes project options) — so callers fall back to
 * version-id comparison instead of comparing against a wrong value.
 */
export function currentPrdInputHashesForSpine(
    slot: ArtifactSlotKey,
    spine: SpineInputSource | undefined,
    project: ArtifactProjectInputs | undefined,
): CurrentPrdInputHashes | undefined {
    if (!spine?.structuredPRD || !project) return undefined;
    const key = JSON.stringify([
        ARTIFACT_INPUT_SLICES[slot].prd,
        project.name ?? null,
        project.productName ?? null,
        project.platform ?? null,
        project.designSystemPreset ?? null,
    ]);
    let bySpine = prdHashCache.get(spine);
    if (!bySpine) {
        bySpine = new Map();
        prdHashCache.set(spine, bySpine);
    }
    let payload = bySpine.get(key);
    if (!payload) {
        const { scheme: ignoredScheme, ...hashes } = hashPrdInput(slot, selectArtifactPrdInput(slot, {
            structuredPRD: spine.structuredPRD,
            prdMarkdown: spine.responseText,
            project,
            safetyReview: spine.safetyReview,
        }));
        void ignoredScheme;
        payload = hashes;
        bySpine.set(key, payload);
    }
    return { scheme: inputHashSchemeFor(slot), ...payload };
}

// ---------------------------------------------------------------------------
// Comparison (shared by the freshness engine and the job controller)
// ---------------------------------------------------------------------------

export type PrdInputComparison =
    | { comparable: false }
    | { comparable: true; prdChanged: boolean; designDirectionChanged: boolean };

/**
 * Compare a recorded fingerprint with the current one. Not comparable — the
 * caller then falls back to version ids — when either side is missing or the
 * schemes differ. The design brief only counts where the slot's policy is
 * `compared`.
 */
export function comparePrdInputs(
    slot: ArtifactSlotKey,
    recorded: ArtifactInputHashes | undefined,
    current: CurrentPrdInputHashes | undefined,
): PrdInputComparison {
    if (!recorded || !current || recorded.scheme !== current.scheme) return { comparable: false };
    return {
        comparable: true,
        prdChanged: recorded.spine !== current.spine,
        designDirectionChanged: ARTIFACT_INPUT_SLICES[slot].designDirection === 'compared'
            && recorded.designBrief !== current.designBrief,
    };
}

/**
 * The fingerprint a "Mark as up to date" clone records. Marking current is the
 * user asserting the content holds for the confirmed spine and TODAY's
 * upstream content, so the clone records exactly those inputs — the PRD-side
 * fingerprint of the confirmed spine and the content fingerprint of every
 * declared dependency that exists now (`currentDependency` returns its
 * preferred version). Recording every present dependency, not only the ones
 * the source consumed, is what lets it clear a "was not available when this
 * was generated" flag. Undefined when the PRD side cannot be fingerprinted
 * faithfully: the clone then relies on its rebased refs (id comparison).
 */
export function rebasedInputHashes(
    slot: ArtifactSlotKey,
    prd: CurrentPrdInputHashes | undefined,
    currentDependency: (dep: CoreArtifactSubtype) => { content: string } | undefined,
): ArtifactInputHashes | undefined {
    if (!prd) return undefined;
    const dependencies: Partial<Record<CoreArtifactSubtype, string>> = {};
    for (const dep of ARTIFACT_INPUT_SLICES[slot].dependencies) {
        const version = currentDependency(dep);
        // Recorded as generation would have: blank content is no input.
        if (version && version.content.trim()) dependencies[dep] = versionContentHash(version);
    }
    return { ...prd, ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}) };
}
