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
//   - Status is tracked from generated mockup METADATA + the user's overlay,
//     never from inspecting rendered pixels.
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

export type MockupViewport = 'desktop' | 'mobile' | 'tablet';

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
    /** Short human notes explaining status / recommendation / coverage. */
    notes: string[];
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
}

/** Per-screen map of variantId -> generation info (from the variant image store). */
export type GeneratedVariantMap = Record<string, GeneratedVariantInfo>;

export interface BuildVariantOptions {
    /** Generation platform of the current mockup set (mockup settings). */
    platform?: MockupPlatform;
    /** True when the project is mobile-relevant (mobile-first / responsive) —
     * enables a recommended Mobile default on P1 / supporting screens. P0
     * always recommends mobile regardless. */
    mobileRelevant?: boolean;
    /** Phase 3B: manifest-backed generated variants for THIS screen, keyed by
     * variant id. A non-default variant present here renders as 'generated'
     * with its manifest coverage. Absent → the Phase 3A derived-missing model.
     * The default variant's generation state still comes from the legacy
     * mockup join (item.mockupScreen), never this map. */
    generatedVariants?: GeneratedVariantMap;
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
    //    - Mobile default is recommended for P0 always, P1/supporting when the
    //      project is mobile-relevant.
    const wantDesktopDefault = priority === 'P0' || priority === 'P1';
    const wantMobileDefault = priority === 'P0' || mobileRelevant;
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
    return seeds.map(seed => buildVariant(item, seed, overlay, generatedVariants));
}

function buildVariant(
    item: Pick<ScreenExperienceItem, 'screen' | 'baseScreen' | 'mockupScreen' | 'id'>,
    seed: VariantSeed,
    overlay: Record<string, 'accepted' | 'not_needed'>,
    generatedVariants: GeneratedVariantMap,
): DerivedMockupVariant {
    const override: 'accepted' | 'not_needed' | undefined = overlay[seed.overlayKey];
    // The legacy default variant is generated iff the screen joins a mockup.
    const legacyGenerated = seed.generatedSlot && Boolean(item.mockupScreen);
    // A non-default variant is generated iff the per-variant image store has a
    // record for it (Phase 3B). The default slot never reads this map — its
    // image lives in the legacy store.
    const variantImage = !seed.generatedSlot ? generatedVariants[seed.overlayKey] : undefined;
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
    } else if (seed.required) {
        // Not generated, not user-marked → a recommended-but-missing variant.
        notes.push(recommendationReason(item.screen, seed));
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
        notes,
    };
}

function recommendationReason(screen: ScreenItem, seed: VariantSeed): string {
    const priority = normalizeScreenPriority(screen.priority);
    if (seed.stateType === 'default') {
        if (seed.viewport === 'mobile') {
            return priority === 'P0'
                ? 'Recommended for P0 screen mobile coverage.'
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
    /** P0 screens whose Mobile default is generated/accepted. */
    p0WithMobile: number;
    /** Total P0 screens. */
    p0Total: number;
    /** Generated mockups with no captured coverage metadata (legacy). */
    legacyUnknownMockups: number;
    /** Phase 3B: generated variants backed by a captured coverage manifest —
     * counted separately from legacy "unknown" coverage. */
    manifestBackedGenerated: number;
}

/** Options for the artifact-level rollup. Extends BuildVariantOptions with a
 * per-screen generated-variant lookup so manifest-backed coverage is counted. */
export interface CoverageSummaryOptions extends Omit<BuildVariantOptions, 'generatedVariants'> {
    /** Resolve THIS screen's manifest-backed generated variants (variant image
     * store), keyed by variant id. Absent → the derived-only rollup. */
    generatedVariantsByScreen?: (screenId: string) => GeneratedVariantMap | undefined;
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
    let p0WithMobile = 0;
    let p0Total = 0;
    let legacyUnknownMockups = 0;
    let manifestBackedGenerated = 0;

    const { generatedVariantsByScreen, ...variantOptions } = options;

    for (const item of index.items) {
        const generatedVariants = generatedVariantsByScreen?.(item.id);
        const variants = buildScreenMockupVariants(item, { ...variantOptions, generatedVariants });
        const isP0 = normalizeScreenPriority(item.screen.priority) === 'P0';
        if (isP0) p0Total += 1;
        for (const v of variants) {
            // A not_needed variant is deliberately skipped — drop it from the
            // denominator so a resolved gap never keeps the panel warning.
            if (v.required && v.status !== 'not_needed') {
                recommendedTotal += 1;
                if (isGeneratedOrAccepted(v.status)) recommendedGenerated += 1;
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
        }
    }

    return {
        recommendedGenerated,
        recommendedTotal,
        p0WithMobile,
        p0Total,
        legacyUnknownMockups,
        manifestBackedGenerated,
    };
}

// --- Variant status presentation ------------------------------------------------

export const VARIANT_STATUS_LABELS: Record<MockupVariantStatus, string> = {
    generated: 'Generated',
    missing: 'Missing',
    accepted: 'Accepted',
    not_needed: 'Not needed',
};

export const COVERAGE_STATUS_LABELS: Record<MockupVariantCoverage, string> = {
    aligned: 'Aligned with spec',
    partial: 'Partial',
    missing_items: 'Spec items missing',
    unknown: 'Unknown',
};
