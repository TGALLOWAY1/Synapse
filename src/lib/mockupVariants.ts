// Phase 3A: derived mockup-variant model for the Screens experience view.
//
// A "mockup variant" is one (viewport × screen state) cell of the visual
// coverage grid for a screen — e.g. "Desktop · Default", "Mobile · Default",
// "Desktop · Empty History", "Desktop · Loading". Today the mockup pipeline
// still generates a SINGLE image per screen, so at most one variant is ever
// actually generated; every other variant is a *derived recommendation* that
// currently has no persisted data. This module makes that grid visible so a
// reviewer can see, at a glance, what exists vs. what a screen probably wants.
//
// Everything here is PURE and read-time only (no store, no IDB, no React, no
// LLM). It is layered ON TOP of the existing readiness model
// (src/lib/screenReadiness.ts) — it never changes review-status logic. The
// only persisted input is the optional user overlay
// (ScreenMetadataEdit.mockupVariantStatus), keyed by variant id.
//
// Honesty rules (mirroring screenReadiness):
//   - Status is tracked from generated mockup METADATA + real image-store
//     evidence + the user's overlay, never from inspecting rendered pixels.
//   - The primary Default variant only reads as 'generated' when a rendered
//     image actually EXISTS (SYN-003): the caller passes an authoritative
//     `defaultImagePresence` derived from the mockup / screen-inventory image
//     stores. A spec join with no image is honest 'missing' (source
//     'derived_missing'), never a false "Generated" claim. Absent the option
//     (un-wired callers / pure tests) the legacy spec-join behavior is kept.
//   - Recommendations are DERIVED estimates from the screen priority + spec —
//     label them as such, never as authoritative.
//   - Legacy single-image mockups carry no per-variant coverage metadata, so
//     their coverage is 'unknown' — never claim visual alignment.
//
// Overlay-key compatibility: the primary-viewport Default row reuses the
// existing overlay key `default` and primary-viewport state rows reuse
// `state:<slug>` (the same keys buildMockupVariantRows already persists), so a
// user's earlier accepted/not-needed marks survive. Only the *secondary*
// viewport default (e.g. Mobile when the mockup is Desktop) introduces a new
// `${viewport}:default` key.

import type {
    LegacyScreenPriority, MockupPlatform, ScreenItem, ScreenPriority, ScreenStateType,
} from '../types';
import { slugifyScreenName } from './screenInventoryImageStore';
import type { ScreenExperienceIndex, ScreenExperienceItem } from './screenExperience';
import { buildMockupSpecCoverage, type MockupVariantRowStatus } from './screenReadiness';
import {
    buildVariantSourceSignature, compareVariantFreshness, summarizeVariantFreshness,
    type MockupVariantFreshness, type MockupVariantSourceSignature,
    type VariantFreshnessRollup, type VariantTrustContext,
} from './mockupVariantTrust';

export type MockupViewport = 'desktop' | 'mobile' | 'tablet';

/** Real image-store presence for the primary Default variant (SYN-003):
 *   'present'  — a rendered image (AI or uploaded) exists on this device;
 *   'absent'   — both image stores settled and neither holds an image;
 *   'checking' — a store is still hydrating, so presence is not yet known
 *                (the variant stays 'generated' to avoid a mid-load flap);
 *   'unknown'  — the caller supplied no evidence → keep legacy spec-join
 *                behavior (un-wired callers, existing pure tests). */
export type MockupImagePresence = 'present' | 'absent' | 'checking' | 'unknown';

/** Variant fulfilment status. Aligns with MockupVariantRowStatus in
 * screenReadiness so overlay values stay interchangeable. */
export type MockupVariantStatus = MockupVariantRowStatus; // generated | missing | accepted | not_needed

/** Spec-coverage confidence for a variant. 'unknown' is the honest default
 * for legacy single-image mockups (no coverage metadata was captured). */
export type MockupVariantCoverage = 'aligned' | 'partial' | 'missing_items' | 'unknown';

/** Where the variant record came from:
 *   'legacy'          — an existing single-image mockup with no per-variant metadata;
 *   'variant'         — a mockup carrying explicit variant metadata (future);
 *   'derived_missing' — a recommended variant with no mockup yet. */
export type MockupVariantSource = 'legacy' | 'variant' | 'derived_missing';

export interface DerivedMockupVariant {
    /** Deterministic id — also the ScreenMetadataEdit.mockupVariantStatus key. */
    id: string;
    screenId: string;
    viewport: MockupViewport;
    stateName: string;
    stateType?: ScreenStateType;
    status: MockupVariantStatus;
    /** Recommended for this screen (counts toward recommended-coverage totals).
     * A missing required variant is what the "N missing" summary reports. */
    required: boolean;
    /** True when status came from the user's overlay (accepted / not_needed). */
    userSet: boolean;
    source: MockupVariantSource;
    coverageStatus: MockupVariantCoverage;
    /** True when the coverage figure is an estimate (spec-to-spec token overlap
     * or "not captured"), never a visual inspection. Always true today. */
    coverageEstimated: boolean;
    /** Real image-store presence (SYN-003). Default slot: from
     * `BuildVariantOptions.defaultImagePresence` (defaulting 'unknown' — legacy
     * behavior). Non-default variants: 'present'/'absent' from their own image
     * record (they already key off real per-variant records). Lets the UI show
     * a neutral "Checking…" state instead of flapping to "missing" mid-load. */
    imagePresence: MockupImagePresence;
    /** Short human notes explaining status / recommendation / coverage. */
    notes: string[];
    /** Phase 3C: staleness of a generated variant vs. the current screen /
     * design-system / PRD context. Absent for missing / not-generated variants.
     * Legacy generated variants with no stored signature resolve to `unknown`. */
    freshness?: MockupVariantFreshness;
}

export const VIEWPORT_LABELS: Record<MockupViewport, string> = {
    desktop: 'Desktop',
    mobile: 'Mobile',
    tablet: 'Tablet',
};

/** `Desktop · Default`, `Mobile · Empty History`, … */
export function formatVariantLabel(variant: Pick<DerivedMockupVariant, 'viewport' | 'stateName'>): string {
    return `${VIEWPORT_LABELS[variant.viewport]} · ${variant.stateName}`;
}

/** The viewport a mockup image occupies, from its generation platform. A
 * 'responsive' mockup is treated as Desktop-primary (its default breakpoint);
 * missing platform falls back to Desktop — the conservative common case and
 * the legacy normalization the Phase 3A spec calls for. */
export function viewportFromPlatform(platform?: MockupPlatform): MockupViewport {
    if (platform === 'mobile') return 'mobile';
    return 'desktop';
}

/** Coerce a possibly-legacy priority to a P-scale value for the recommendation
 * rules. Unlike stylablePriority (which flattens everything unknown to P1),
 * this preserves the P0 distinction legacy 'core' screens carry. */
export function normalizeScreenPriority(priority: ScreenPriority | LegacyScreenPriority): ScreenPriority {
    switch (priority) {
        case 'P0':
        case 'core':
            return 'P0';
        case 'P1':
        case 'secondary':
            return 'P1';
        case 'P2':
        case 'supporting':
            return 'P2';
        case 'P3':
            return 'P3';
        default:
            return 'P1';
    }
}

const DEFAULT_VARIANT_ID = 'default';

/** State types that warrant their own mockup variant when documented. */
const IMPORTANT_STATE_TYPES: ReadonlySet<ScreenStateType> = new Set<ScreenStateType>([
    'empty', 'loading', 'error', 'success', 'permission', 'disabled',
]);

/** Name keywords that mark a state as visually important even when its `type`
 * is missing/other (legacy specs rarely set `type`). */
const IMPORTANT_STATE_KEYWORDS = [
    'empty', 'loading', 'error', 'success', 'permission', 'disabled', 'selected',
];

function isImportantState(name: string, type?: ScreenStateType): boolean {
    if (type && IMPORTANT_STATE_TYPES.has(type)) return true;
    const lower = name.toLowerCase();
    return IMPORTANT_STATE_KEYWORDS.some(k => lower.includes(k));
}

/** Phase 3B: real generation state for one variant, keyed by variant id.
 * Threaded in from the per-variant image store so a derived-missing variant
 * flips to 'generated' once its image + coverage manifest exist. */
export interface GeneratedVariantInfo {
    /** Coverage from the stored manifest's overallStatus. */
    coverage: MockupVariantCoverage;
    /** Phase 3C: the source signature stored with this generated variant, used
     * to derive freshness against the current context. Absent for pre-3C
     * records → freshness resolves to `unknown`. */
    sourceSignature?: MockupVariantSourceSignature;
}

/** Per-screen map of variantId -> generation info (from the variant image store). */
export type GeneratedVariantMap = Record<string, GeneratedVariantInfo>;

export interface BuildVariantOptions {
    /** Generation platform of the current mockup set (mockup settings). */
    platform?: MockupPlatform;
    /** True when the project is mobile-relevant (mobile-first / responsive) —
     * the sole gate for recommending a Mobile default variant (on every screen,
     * P0 included). A web/desktop project (false) never recommends Mobile
     * coverage, so mobile gaps don't surface for platforms with no mobile UI. */
    mobileRelevant?: boolean;
    /** Phase 3B: manifest-backed generated variants for THIS screen, keyed by
     * variant id. A non-default variant present here renders as 'generated'
     * with its manifest coverage. Absent → the Phase 3A derived-missing model.
     * The default variant's generation state comes from the mockup spec join
     * (item.mockupScreen) GATED by `defaultImagePresence` (SYN-003), never this
     * map. A `default` entry here is the Phase 3C coverage sidecar — it supplies
     * the default variant's coverage + source signature WITHOUT changing its
     * generation state. */
    generatedVariants?: GeneratedVariantMap;
    /** SYN-003: authoritative image-store evidence for the primary Default slot
     * (from src/lib/mockupImagePresence.ts). Unset or 'unknown' → EXACT legacy
     * behavior: the Default variant is 'generated' whenever the spec join
     * exists. 'present'/'checking' → 'generated'; 'absent' → 'missing' (source
     * 'derived_missing'), so a spec with no rendered image never claims
     * "Generated". Only meaningful for the primary Default row. */
    defaultImagePresence?: MockupImagePresence;
    /** Phase 3C: the CURRENT screen/design/PRD context, used to compute each
     * generated variant's freshness. Absent → generated variants carry no
     * freshness (the caller isn't wired for staleness yet). */
    trustContext?: VariantTrustContext;
}

interface VariantSeed {
    viewport: MockupViewport;
    stateName: string;
    stateType?: ScreenStateType;
    overlayKey: string;
    required: boolean;
    /** This seed holds the single generated image (the primary default row). */
    generatedSlot: boolean;
    /** Explicit generation-contract signal (state.needsMockup / typed state). */
    fromContract: boolean;
}

/**
 * Derive the full variant grid for one screen: the generated primary Default
 * row, any recommended secondary-viewport default, and one row per documented
 * important state. Existing single-image mockups normalize to the primary
 * Default row with `source: 'legacy'` and `coverageStatus: 'unknown'`.
 */
export function buildScreenMockupVariants(
    item: Pick<ScreenExperienceItem, 'screen' | 'baseScreen' | 'mockupScreen' | 'edit' | 'id'>,
    options: BuildVariantOptions = {},
): DerivedMockupVariant[] {
    const { screen } = item;
    const overlay = item.edit?.mockupVariantStatus ?? {};
    const priority = normalizeScreenPriority(screen.priority);
    const primary = viewportFromPlatform(options.platform);
    const mobileRelevant = options.mobileRelevant ?? (primary !== 'desktop');

    const seeds: VariantSeed[] = [];

    // 1. Primary-viewport Default — the slot the single generated image fills.
    seeds.push({
        viewport: primary,
        stateName: 'Default',
        stateType: 'default',
        overlayKey: DEFAULT_VARIANT_ID,
        required: true,
        generatedSlot: true,
        fromContract: false,
    });

    // 2. Secondary-viewport Default recommendation.
    //    - Desktop is the baseline default for P0/P1 screens.
    //    - Mobile default is recommended ONLY when the project is
    //      mobile-relevant (mobile-first / responsive). A web/desktop project
    //      never wants a Mobile variant — not even for its P0 screens — so it
    //      must not surface "mobile coverage" gaps for platforms that ship no
    //      mobile UI.
    const wantDesktopDefault = priority === 'P0' || priority === 'P1';
    const wantMobileDefault = mobileRelevant;
    if (primary !== 'desktop' && wantDesktopDefault) {
        seeds.push({
            viewport: 'desktop',
            stateName: 'Default',
            stateType: 'default',
            overlayKey: 'desktop:default',
            required: true,
            generatedSlot: false,
            fromContract: false,
        });
    }
    if (primary === 'desktop' && wantMobileDefault) {
        seeds.push({
            viewport: 'mobile',
            stateName: 'Default',
            stateType: 'default',
            overlayKey: 'mobile:default',
            required: true,
            generatedSlot: false,
            fromContract: false,
        });
    }

    // 3. Important state variants on the primary viewport. State overlay keys
    //    match the existing readiness rows (`state:<slug>`, deduped) so marks
    //    stay shared.
    const usedStateSlugs = new Set<string>();
    for (const state of screen.states ?? []) {
        if (!state.name?.trim()) continue;
        if (state.type === 'default') continue; // folds into the Default row
        const recommended = state.needsMockup === true || isImportantState(state.name, state.type);
        if (!recommended) continue;
        const base = slugifyScreenName(state.name);
        let slug = base;
        let n = 2;
        while (usedStateSlugs.has(slug)) {
            slug = `${base}-${n}`;
            n += 1;
        }
        usedStateSlugs.add(slug);
        seeds.push({
            viewport: primary,
            stateName: state.name,
            stateType: state.type,
            overlayKey: `state:${slug}`,
            required: true,
            generatedSlot: false,
            fromContract: state.needsMockup !== undefined || state.type !== undefined,
        });
    }

    const generatedVariants = options.generatedVariants ?? {};
    return seeds.map(seed => buildVariant(
        item, seed, overlay, generatedVariants, options.defaultImagePresence, options.trustContext,
    ));
}

function buildVariant(
    item: Pick<ScreenExperienceItem, 'screen' | 'baseScreen' | 'mockupScreen' | 'id'>,
    seed: VariantSeed,
    overlay: Record<string, 'accepted' | 'not_needed'>,
    generatedVariants: GeneratedVariantMap,
    defaultImagePresence: MockupImagePresence | undefined,
    trustContext?: VariantTrustContext,
): DerivedMockupVariant {
    const override: 'accepted' | 'not_needed' | undefined = overlay[seed.overlayKey];
    // A non-default variant is generated iff the per-variant image store has a
    // record for it (Phase 3B). The default slot never reads this map for its
    // generation state — its image lives in the legacy store.
    const variantImage = !seed.generatedSlot ? generatedVariants[seed.overlayKey] : undefined;

    // SYN-003: image presence for THIS variant.
    //   - default slot: from the caller-supplied option ('unknown' = legacy).
    //   - non-default:  it already keys off a real per-variant record.
    const presence: MockupImagePresence = seed.generatedSlot
        ? (defaultImagePresence ?? 'unknown')
        : (variantImage ? 'present' : 'absent');

    // The default variant is generated iff it joins a mockup SPEC *and* a
    // rendered image is not provably absent (present / checking / unknown). A
    // spec join with an absent image is honest 'missing', never "Generated".
    const specJoined = seed.generatedSlot && Boolean(item.mockupScreen);
    const legacyGenerated = specJoined && presence !== 'absent';
    // A spec exists for this screen but its rendered image is gone (SYN-003).
    const specJoinedImageAbsent = specJoined && presence === 'absent';
    // Phase 3C: a coverage sidecar for the default variant (metadata only) —
    // supplies the default's coverage + source signature without altering that
    // it renders via the legacy path.
    const defaultSidecar = legacyGenerated ? generatedVariants[seed.overlayKey] : undefined;
    const generated = legacyGenerated || Boolean(variantImage);
    const status: MockupVariantStatus = override ?? (generated ? 'generated' : 'missing');
    const source: MockupVariantSource = variantImage
        ? 'variant'
        : legacyGenerated ? 'legacy' : 'derived_missing';

    let coverageStatus: MockupVariantCoverage = 'unknown';
    const notes: string[] = [];
    if (variantImage) {
        // Manifest-backed coverage captured during this variant's generation.
        coverageStatus = variantImage.coverage;
        notes.push('Coverage manifest captured during generation — a self-report of the generation spec, not a visual inspection of the image.');
    } else if (legacyGenerated && defaultSidecar) {
        // The legacy default carries a Phase 3C sidecar manifest.
        coverageStatus = defaultSidecar.coverage;
        notes.push('Coverage manifest captured during generation — a self-report of the generation spec, not a visual inspection of the image.');
    } else if (legacyGenerated) {
        const rows = buildMockupSpecCoverage(item.baseScreen, item.mockupScreen?.coreUIElements);
        if (rows.length === 0) {
            coverageStatus = 'unknown';
            notes.push('Coverage metadata was not captured for this mockup — Synapse cannot confirm which spec items it represents.');
        } else {
            const inSpec = rows.filter(r => r.status === 'in_spec').length;
            coverageStatus = inSpec === rows.length ? 'aligned' : inSpec === 0 ? 'missing_items' : 'partial';
            notes.push(`${inSpec} of ${rows.length} spec UI items appear in the mockup spec (spec-to-spec, not a visual check).`);
        }
    } else if (override === 'not_needed') {
        notes.push('Marked not needed — excluded from recommended coverage.');
    } else if (override === 'accepted') {
        notes.push('Marked accepted by you — e.g. verified or uploaded outside the generated set.');
    } else if (specJoinedImageAbsent) {
        // SYN-003: never claim spec "aligned" coverage for a render that doesn't
        // exist — coverage stays 'unknown' and the note is honest and actionable.
        coverageStatus = 'unknown';
        notes.push('A mockup spec exists for this screen, but no rendered image was found — generate or upload the image to complete it.');
    } else if (seed.required) {
        // Not generated, not user-marked → a recommended-but-missing variant.
        notes.push(recommendationReason(item.screen, seed));
    }

    // Phase 3C: freshness — only for variants that hold a real generated image
    // (legacy default, sidecar default, or a per-variant image). A stored source
    // signature (from the variant image / sidecar) is compared against a freshly
    // computed one; no signature → `unknown` (never falsely stale).
    let freshness: MockupVariantFreshness | undefined;
    const hasImage = legacyGenerated || Boolean(variantImage);
    if (hasImage && trustContext) {
        const storedSig = (variantImage ?? defaultSidecar)?.sourceSignature;
        // The legacy default's image comes from buildScreenImagePrompt, which
        // requests only the mockup screen's UI elements — so its contract hash
        // must be built from those legacy inputs, not the full variant request
        // (which would invent user-action / acceptance-criteria coverage).
        const isLegacyDefault = seed.generatedSlot;
        const current = buildVariantSourceSignature(
            {
                screen: item.screen,
                viewport: seed.viewport,
                stateName: seed.stateName,
                stateType: seed.stateType,
                variantId: seed.overlayKey,
                legacyDefault: isLegacyDefault,
                legacyUIRegions: isLegacyDefault ? item.mockupScreen?.coreUIElements : undefined,
            },
            trustContext,
            storedSig?.createdAt ?? '',
        );
        freshness = compareVariantFreshness(storedSig, current);
    }

    return {
        id: seed.overlayKey,
        screenId: item.id,
        viewport: seed.viewport,
        stateName: seed.stateName,
        stateType: seed.stateType,
        status,
        required: seed.required,
        userSet: Boolean(override),
        source,
        coverageStatus,
        coverageEstimated: true,
        imagePresence: presence,
        notes,
        freshness,
    };
}

function recommendationReason(screen: ScreenItem, seed: VariantSeed): string {
    const priority = normalizeScreenPriority(screen.priority);
    if (seed.stateType === 'default') {
        if (seed.viewport === 'mobile') {
            // Mobile is only ever recommended for mobile-relevant projects, so
            // the reason is the project's mobile relevance regardless of the
            // screen's priority (a P0 screen just makes it more prominent).
            return priority === 'P0'
                ? 'Recommended because this P0 screen ships on a mobile-relevant project.'
                : 'Recommended because the project appears mobile-relevant.';
        }
        return 'Recommended baseline coverage for a primary screen.';
    }
    return `Recommended because this screen documents a "${seed.stateName}" state that usually warrants its own mockup.`;
}

// --- Per-screen summary (screen cards) -------------------------------------------

export interface ScreenMockupVariantSummary {
    /** Recommended variants for this screen (required rows). */
    recommended: number;
    /** Recommended variants that are generated or user-accepted. */
    generated: number;
    /** Recommended variants still missing (not generated / accepted / skipped). */
    missing: number;
    /** True when a required Mobile default is missing. */
    mobileMissing: boolean;
    /** True when the screen joins a generated mockup. */
    hasMockup: boolean;
    /** True when the generated mockup carries no coverage metadata (legacy). */
    coverageUnknown: boolean;
    /** Compact primary line for the card, e.g. "1 / 4 recommended" or
     * "No mockup yet". */
    label: string;
    /** Optional secondary line, e.g. "Mobile + 1 state variant recommended". */
    detail?: string;
}

const isGeneratedOrAccepted = (s: MockupVariantStatus): boolean =>
    s === 'generated' || s === 'accepted';

/** True when the variant holds (or is derived from) a real generated mockup
 * image — independent of the mutable status. A user marking the generated
 * default "accepted" flips status off 'generated' but the image still exists,
 * so presence must key off the mockup join (source), not the status. */
const hasGeneratedImage = (v: DerivedMockupVariant): boolean =>
    v.source === 'legacy' || v.source === 'variant';

export function summarizeScreenVariants(variants: readonly DerivedMockupVariant[]): ScreenMockupVariantSummary {
    // A "not_needed" recommended variant is deliberately skipped — it is not a
    // gap, so it must drop out of BOTH the denominator and the missing count
    // (consistent with the readiness layer, where not_needed resolves the gap);
    // otherwise the coverage line would warn "1 / 2 recommended" forever.
    const recommendedRows = variants.filter(v => v.required && v.status !== 'not_needed');
    const recommended = recommendedRows.length;
    const generated = recommendedRows.filter(v => isGeneratedOrAccepted(v.status)).length;
    const missing = recommendedRows.filter(v => v.status === 'missing').length;
    const mobileMissing = recommendedRows.some(
        v => v.viewport === 'mobile' && v.stateType === 'default' && v.status === 'missing',
    );
    const hasMockup = variants.some(hasGeneratedImage);
    const coverageUnknown = variants.some(v => hasGeneratedImage(v) && v.coverageStatus === 'unknown');

    const missingRows = recommendedRows.filter(v => v.status === 'missing');
    const missingDefaults = missingRows.filter(v => v.stateType === 'default');
    const missingStates = missingRows.filter(v => v.stateType !== 'default');
    const detailParts: string[] = [];
    for (const d of missingDefaults) detailParts.push(`${VIEWPORT_LABELS[d.viewport]} default`);
    if (missingStates.length === 1) detailParts.push('1 state variant');
    else if (missingStates.length > 1) detailParts.push(`${missingStates.length} state variants`);

    let label: string;
    if (!hasMockup && generated === 0) {
        label = 'No mockup yet';
    } else if (missing === 0) {
        label = recommended === 1 ? 'Default covered' : `${generated} / ${recommended} recommended`;
    } else {
        label = `${generated} / ${recommended} recommended`;
    }

    return {
        recommended,
        generated,
        missing,
        mobileMissing,
        hasMockup,
        coverageUnknown,
        label,
        detail: detailParts.length > 0 ? `${detailParts.join(' + ')} recommended` : undefined,
    };
}

// --- Artifact-level rollup (coverage panel) -------------------------------------

export interface MockupVariantCoverageSummary {
    /** Recommended variants generated/accepted across all screens. */
    recommendedGenerated: number;
    /** Recommended variants across all screens. */
    recommendedTotal: number;
    /** ADDITIONAL (non-primary) variants generated/accepted — i.e. excluding
     * each screen's primary Default mockup (which is the required implementation
     * asset, counted under primary mockup coverage). These are the optional
     * "expanded design coverage" enhancements (mobile / responsive / per-state
     * layouts). */
    additionalGenerated: number;
    /** ADDITIONAL (non-primary) recommended variants across all screens. The
     * pool a user can expand into on demand; `additionalTotal - additionalGenerated`
     * are available to generate. */
    additionalTotal: number;
    /** P0 screens whose Mobile default is generated/accepted. */
    p0WithMobile: number;
    /** Total P0 screens. */
    p0Total: number;
    /** Generated mockups with no captured coverage metadata (legacy). */
    legacyUnknownMockups: number;
    /** Phase 3B: generated variants backed by a captured coverage manifest —
     * counted separately from legacy "unknown" coverage. */
    manifestBackedGenerated: number;
    /** Phase 3C: freshness rollup across all generated variants (current /
     * review / unknown). Only populated when trustContext is supplied. */
    freshness: VariantFreshnessRollup;
}

/** Options for the artifact-level rollup. Extends BuildVariantOptions with a
 * per-screen generated-variant lookup so manifest-backed coverage is counted. */
export interface CoverageSummaryOptions extends Omit<BuildVariantOptions, 'generatedVariants' | 'defaultImagePresence'> {
    /** Resolve THIS screen's manifest-backed generated variants (variant image
     * store), keyed by variant id. Absent → the derived-only rollup. */
    generatedVariantsByScreen?: (screenId: string) => GeneratedVariantMap | undefined;
    /** SYN-003: resolve THIS screen's authoritative default-image presence
     * (src/lib/mockupImagePresence.ts). Absent → legacy spec-join behavior, so
     * an image-absent default over-counts as generated (the pre-fix behavior);
     * wire it so the rollup reflects real image presence. */
    defaultImagePresenceByScreen?: (screenId: string) => MockupImagePresence | undefined;
}

/** Roll up variant coverage across the whole screen index for the Screen
 * Coverage & Readiness panel. Returns null when there are no screens. */
export function buildMockupVariantCoverageSummary(
    index: ScreenExperienceIndex,
    options: CoverageSummaryOptions = {},
): MockupVariantCoverageSummary | null {
    if (index.items.length === 0) return null;
    let recommendedGenerated = 0;
    let recommendedTotal = 0;
    let additionalGenerated = 0;
    let additionalTotal = 0;
    let p0WithMobile = 0;
    let p0Total = 0;
    let legacyUnknownMockups = 0;
    let manifestBackedGenerated = 0;
    const freshnessVerdicts: MockupVariantFreshness[] = [];

    const { generatedVariantsByScreen, defaultImagePresenceByScreen, ...variantOptions } = options;

    for (const item of index.items) {
        const generatedVariants = generatedVariantsByScreen?.(item.id);
        const variants = buildScreenMockupVariants(item, {
            ...variantOptions,
            generatedVariants,
            defaultImagePresence: defaultImagePresenceByScreen?.(item.id),
        });
        const isP0 = normalizeScreenPriority(item.screen.priority) === 'P0';
        // Only P0 screens that actually recommend a Mobile default count toward
        // the "Mobile coverage (P0)" rollup — a web/desktop project recommends
        // no Mobile variant, so p0Total stays 0 and the panel hides that row
        // instead of warning about mobile coverage the project will never ship.
        const recommendsMobileDefault = variants.some(
            v => v.viewport === 'mobile' && v.stateType === 'default',
        );
        if (isP0 && recommendsMobileDefault) p0Total += 1;
        for (const v of variants) {
            // A not_needed variant is deliberately skipped — drop it from the
            // denominator so a resolved gap never keeps the panel warning.
            if (v.required && v.status !== 'not_needed') {
                const generated = isGeneratedOrAccepted(v.status);
                recommendedTotal += 1;
                if (generated) recommendedGenerated += 1;
                // Everything except the primary Default row is optional expanded
                // coverage (the Default row is the required implementation asset).
                if (v.id !== DEFAULT_VARIANT_ID) {
                    additionalTotal += 1;
                    if (generated) additionalGenerated += 1;
                }
            }
            // "Handled" = generated, accepted, or explicitly not needed, so a
            // deliberately-skipped mobile default doesn't read as a gap.
            if (isP0 && v.viewport === 'mobile' && v.stateType === 'default'
                && (isGeneratedOrAccepted(v.status) || v.status === 'not_needed')) {
                p0WithMobile += 1;
            }
            if (hasGeneratedImage(v) && v.coverageStatus === 'unknown') {
                legacyUnknownMockups += 1;
            }
            if (v.source === 'variant' && isGeneratedOrAccepted(v.status)) {
                manifestBackedGenerated += 1;
            }
            if (v.freshness) freshnessVerdicts.push(v.freshness);
        }
    }

    return {
        recommendedGenerated,
        recommendedTotal,
        additionalGenerated,
        additionalTotal,
        p0WithMobile,
        p0Total,
        legacyUnknownMockups,
        manifestBackedGenerated,
        freshness: summarizeVariantFreshness(freshnessVerdicts),
    };
}

// --- Variant status presentation ------------------------------------------------

// 'missing' reads as "Not generated" — an on-demand option, never a failure
// state (optional variants must not look like incomplete work; audit H1).
export const VARIANT_STATUS_LABELS: Record<MockupVariantStatus, string> = {
    generated: 'Generated',
    missing: 'Not generated',
    accepted: 'Accepted',
    not_needed: 'Not needed',
};

export const COVERAGE_STATUS_LABELS: Record<MockupVariantCoverage, string> = {
    aligned: 'Aligned with spec',
    partial: 'Partial',
    missing_items: 'Spec items missing',
    unknown: 'Unknown',
};
