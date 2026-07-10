// Phase 3C: source signatures + freshness (staleness) for generated mockup
// variants. This is the TRUST layer on top of the Phase 3A/3B variant model.
//
// A generated variant is captured with a MockupVariantSourceSignature — a
// deterministic snapshot of the screen-contract inputs that materially affect
// how the image renders (viewport + state + the same screen-spec fields the
// generation request uses) plus the PRD / design-system / screen version
// context at generation time. Later, we recompute the signature from the
// CURRENT screen/design/PRD context and compare: if the screen-contract hash
// moved, or the design-system / PRD context changed, the variant is stale.
//
// Everything here is PURE and read-time only (no store, no IDB, no React, no
// LLM). Honesty rules mirror the rest of the Screens layer:
//   - Freshness is derived from stored METADATA vs. current metadata, never
//     from inspecting rendered pixels.
//   - Legacy / pre-signature records are `unknown`, NEVER falsely `stale`.
//   - The screen-contract hash covers only fields that change the visual;
//     volatile UI-only overlay fields (notes, review status, variant marks)
//     are excluded so freshness warnings stay quiet unless the spec truly moved.

import type { ScreenItem, ScreenState, LegacyScreenPriority, ScreenPriority } from '../types';

export type MockupVariantTrustViewport = 'desktop' | 'mobile' | 'tablet';

/** A deterministic snapshot of the inputs that materially affect one variant's
 * rendered image, captured at generation time and stored with the record. */
export interface MockupVariantSourceSignature {
    /** Current PRD/spine version id at generation time (context provenance). */
    prdVersionId?: string;
    /** screen_inventory artifact version id at generation time. */
    screenVersionId?: string;
    /** design_system artifact version id at generation time. */
    designSystemVersionId?: string;
    screenId: string;
    screenTitle?: string;
    viewport: MockupVariantTrustViewport;
    stateName: string;
    variantId: string;
    /** Hash of the screen-contract fields this variant's image depends on. */
    screenContractHash: string;
    /** Design-system tokens hash (mirrors the mockup design-drift signal). */
    designSystemHash?: string;
    /** Optional PRD-content hash (proxy: absent today, we compare version ids). */
    prdContextHash?: string;
    /** ISO timestamp captured at generation. */
    createdAt: string;
}

export type MockupVariantFreshnessStatus =
    | 'current'
    | 'possibly_stale'
    | 'stale'
    | 'unknown';

export interface MockupVariantFreshness {
    status: MockupVariantFreshnessStatus;
    /** Calm, human-readable explanations of the status. */
    reasons: string[];
    /** UI weight — nothing here ever blocks rendering or generation. */
    severity: 'info' | 'review' | 'blocking';
    /** Always true — freshness is a metadata estimate, never a visual check. */
    estimated: boolean;
}

// --- Deterministic hashing (self-contained; mirrors designTokens/hash.ts) ----

function canonicalStringify(value: unknown): string {
    if (value === null || value === undefined || typeof value !== 'object') {
        return JSON.stringify(value ?? null);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalStringify).join(',')}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
    return `{${entries.join(',')}}`;
}

function fnv1a(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

function stableHash(value: unknown): string {
    const canonical = canonicalStringify(value);
    return `${fnv1a(canonical)}${fnv1a(canonical + ':v1')}`;
}

// --- Screen-contract hashing -------------------------------------------------

function normalizePriority(priority: ScreenPriority | LegacyScreenPriority): ScreenPriority {
    switch (priority) {
        case 'P0': case 'core': return 'P0';
        case 'P1': case 'secondary': return 'P1';
        case 'P2': case 'supporting': return 'P2';
        case 'P3': return 'P3';
        default: return 'P1';
    }
}

const clean = (values: Array<string | undefined | null>): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of values) {
        const t = v?.trim();
        if (!t) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
    }
    return out;
};

/** slug helper (local — avoids importing the image store into a pure module). */
const slug = (name: string): string =>
    name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The variant-shaped inputs the contract hash keys off. */
export interface VariantContractInput {
    screen: ScreenItem;
    viewport: MockupVariantTrustViewport;
    stateName: string;
    stateType?: string;
    variantId: string;
    /** True for the legacy DEFAULT variant, whose image is produced by the
     * legacy `buildScreenImagePrompt` path — which requests ONLY the mockup
     * screen's UI elements, never the inventory screen's user actions /
     * acceptance criteria / risks. In this mode the contract hash (and any
     * sidecar manifest) is built from those actual legacy inputs so it never
     * over-claims coverage or over-flags freshness on fields the render never
     * used. */
    legacyDefault?: boolean;
    /** The UI regions the legacy default prompt actually requested (the mockup
     * screen's `coreUIElements`). Used only when `legacyDefault` is set. */
    legacyUIRegions?: string[];
}

/** Find the documented screen state a non-default variant renders (by slug). */
function matchState(screen: ScreenItem, input: VariantContractInput): ScreenState | undefined {
    if (!input.stateType || input.stateType === 'default') return undefined;
    const target = slug(input.stateName);
    return (screen.states ?? []).find(s => slug(s.name ?? '') === target);
}

/**
 * Compute a deterministic hash of the screen-contract fields that materially
 * affect THIS variant's rendered image. Mirrors the field selection in
 * buildVariantGenerationRequest so the hash moves exactly when the generation
 * inputs would. Excludes overlay-only UI metadata (notes / review status /
 * variant marks) so cosmetic edits never trip a false stale warning.
 */
export function computeScreenContractHash(input: VariantContractInput): string {
    const { screen } = input;

    // Legacy default: hash only what the legacy prompt actually requested — the
    // mockup screen's UI regions plus screen identity fields. Omits user actions
    // / acceptance criteria / risks / per-state detail the legacy render never
    // consumed, so it can't over-flag freshness on unused fields.
    if (input.legacyDefault) {
        const contract = {
            legacyDefault: true,
            name: screen.name ?? '',
            purpose: screen.purpose ?? '',
            userIntent: screen.userIntent ?? '',
            priority: normalizePriority(screen.priority),
            viewport: input.viewport,
            stateName: input.stateName,
            coreUIRegions: clean(input.legacyUIRegions ?? []),
        };
        return stableHash(contract);
    }

    const state = matchState(screen, input);
    const coreUIRegions = clean([
        ...(screen.coreUIElements ?? []),
        ...(screen.coreUIElements?.length ? [] : (screen.components ?? [])),
    ]);
    const userActions = clean([
        ...((screen.handoff?.events ?? []).map(e => e.name)),
        ...((screen.exitPaths ?? []).map(p => p.label)),
    ]);
    const acceptanceCriteria = clean([
        ...(state?.acceptanceCriteria ?? []),
        ...(state ? [] : (screen.acceptanceCriteria ?? [])),
    ]);
    const risks = clean([
        ...((screen.riskDetails ?? []).map(r => r.description)),
        ...(screen.riskDetails?.length ? [] : (screen.risks ?? [])),
    ]);

    const contract = {
        name: screen.name ?? '',
        purpose: screen.purpose ?? '',
        userIntent: screen.userIntent ?? '',
        priority: normalizePriority(screen.priority),
        viewport: input.viewport,
        stateName: input.stateName,
        stateType: input.stateType ?? 'default',
        state: state
            ? {
                type: state.type ?? null,
                systemBehavior: state.systemBehavior ?? state.description ?? '',
                trigger: state.trigger ?? '',
                required: state.required ?? null,
                needsMockup: state.needsMockup ?? null,
                acceptanceCriteria: clean(state.acceptanceCriteria ?? []),
            }
            : null,
        coreUIRegions,
        userActions,
        acceptanceCriteria,
        risks,
    };
    return stableHash(contract);
}

// --- Source signature builder ------------------------------------------------

/** Current PRD / design-system / screen version context for signature capture
 * and comparison. All optional — sparse projects still get a valid signature. */
export interface VariantTrustContext {
    prdVersionId?: string;
    screenVersionId?: string;
    designSystemVersionId?: string;
    designSystemHash?: string;
    prdContextHash?: string;
}

/**
 * Build the source signature to STORE with a freshly generated variant. Uses
 * the same computeScreenContractHash as the comparison path, so storage and
 * comparison can never drift apart.
 */
export function buildVariantSourceSignature(
    input: VariantContractInput,
    context: VariantTrustContext,
    createdAt: string,
): MockupVariantSourceSignature {
    return {
        prdVersionId: context.prdVersionId,
        screenVersionId: context.screenVersionId,
        designSystemVersionId: context.designSystemVersionId,
        screenId: input.screen.id ?? slug(input.screen.name ?? ''),
        screenTitle: input.screen.name,
        viewport: input.viewport,
        stateName: input.stateName,
        variantId: input.variantId,
        screenContractHash: computeScreenContractHash(input),
        designSystemHash: context.designSystemHash,
        prdContextHash: context.prdContextHash,
        createdAt,
    };
}

// --- Freshness comparison ----------------------------------------------------

const REASON = {
    screenSpec: 'Screen spec changed after this mockup was generated.',
    designSystem: 'Design system version changed after this mockup was generated.',
    designSystemMaybe: 'Design system may have changed — this mockup predates the current version.',
    prd: 'PRD changed after this mockup was generated.',
    prdMaybe: 'PRD context changed — this mockup predates the current PRD version.',
    noMetadata: 'This mockup was generated before Synapse tracked PRD versions, so its sync state cannot be confirmed automatically.',
    partial: 'Some source metadata is unavailable, so freshness cannot be fully confirmed.',
    current: 'Matches the current screen spec, design system, and PRD context.',
} as const;

const unknownFreshness = (reason: string = REASON.noMetadata): MockupVariantFreshness => ({
    status: 'unknown',
    reasons: [reason],
    severity: 'info',
    estimated: true,
});

/**
 * Compare a stored source signature against the current screen / design / PRD
 * context. Returns a freshness verdict with calm, specific reasons.
 *
 * - `unknown`        — no stored signature (legacy / pre-Phase-3C record).
 * - `stale`          — a hash we can compare moved (screen contract, design
 *                      system, or PRD).
 * - `possibly_stale` — version metadata changed but a hash to confirm with is
 *                      missing (can't be sure it's material).
 * - `current`        — everything we can compare matches.
 */
export function compareVariantFreshness(
    stored: MockupVariantSourceSignature | undefined,
    current: MockupVariantSourceSignature | undefined,
): MockupVariantFreshness {
    if (!stored) return unknownFreshness();
    if (!current) return unknownFreshness(REASON.partial);

    const reasons: string[] = [];
    let stale = false;
    let possibly = false;

    // 1. Screen contract — the strongest signal.
    if (stored.screenContractHash && current.screenContractHash) {
        if (stored.screenContractHash !== current.screenContractHash) {
            stale = true;
            reasons.push(REASON.screenSpec);
        }
    } else {
        // No contract hash to compare — fall through to version signals.
        possibly = true;
        reasons.push(REASON.partial);
    }

    // 2. Design system — hash first, else version id.
    if (stored.designSystemHash && current.designSystemHash) {
        if (stored.designSystemHash !== current.designSystemHash) {
            stale = true;
            reasons.push(REASON.designSystem);
        }
    } else if (
        stored.designSystemVersionId && current.designSystemVersionId
        && stored.designSystemVersionId !== current.designSystemVersionId
    ) {
        possibly = true;
        reasons.push(REASON.designSystemMaybe);
    }

    // 3. PRD context — hash first, else version id.
    if (stored.prdContextHash && current.prdContextHash) {
        if (stored.prdContextHash !== current.prdContextHash) {
            stale = true;
            reasons.push(REASON.prd);
        }
    } else if (
        stored.prdVersionId && current.prdVersionId
        && stored.prdVersionId !== current.prdVersionId
    ) {
        possibly = true;
        reasons.push(REASON.prdMaybe);
    }

    if (stale) {
        // Keep only the concrete "changed" reasons (drop the soft "partial").
        const concrete = reasons.filter(r => r !== REASON.partial);
        return {
            status: 'stale',
            reasons: concrete.length ? concrete : [REASON.screenSpec],
            severity: 'review',
            estimated: true,
        };
    }
    if (possibly) {
        return {
            status: 'possibly_stale',
            reasons: reasons.length ? reasons : [REASON.partial],
            severity: 'review',
            estimated: true,
        };
    }
    return {
        status: 'current',
        reasons: [REASON.current],
        severity: 'info',
        estimated: true,
    };
}

// --- Rollup ------------------------------------------------------------------

export interface VariantFreshnessRollup {
    current: number;
    /** possibly_stale + stale — variants worth a freshness review. */
    review: number;
    /** Generated variants with no comparable source metadata. */
    unknown: number;
    /** Total generated variants considered. */
    total: number;
}

/** Roll up a set of freshness verdicts into current / review / unknown counts.
 * Unknown is NEVER counted as review (stale) — it's just missing metadata. */
export function summarizeVariantFreshness(
    verdicts: readonly MockupVariantFreshness[],
): VariantFreshnessRollup {
    let current = 0;
    let review = 0;
    let unknown = 0;
    for (const v of verdicts) {
        if (v.status === 'current') current += 1;
        else if (v.status === 'stale' || v.status === 'possibly_stale') review += 1;
        else unknown += 1;
    }
    return { current, review, unknown, total: verdicts.length };
}

export const FRESHNESS_LABELS: Record<MockupVariantFreshnessStatus, string> = {
    current: 'Current',
    possibly_stale: 'Review freshness',
    stale: 'Stale',
    unknown: 'Freshness unknown',
};
