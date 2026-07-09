// Phase 3B: pure builders for single-variant mockup generation.
//
// Given one screen + one derived variant (viewport × state), assemble:
//   - a MockupVariantGenerationRequest (the structured generation input),
//   - a variant-specific image prompt (buildVariantImagePrompt), and
//   - a generation-time coverage manifest (buildVariantCoverageManifest).
//
// Everything here is PURE (no React / store / IDB / network). The manifest is
// a GENERATION-TIME self-report of what the request asked the image to render,
// derived deterministically from the request spec — never a visual inspection
// of the rendered pixels (estimated: true, and the UI labels it as such).

import type {
    DesignTokens, MockupCoverageItem, MockupCoverageManifest,
    MockupCoverageOverallStatus, MockupScreen, ScreenItem, ScreenPriority,
    ScreenStateType,
} from '../types';
import { buildDesignSystemBrief } from './designTokens';
import { IMAGE_CLOSING_RULES, fidelityStyleHint } from './prompts/imagePromptFragments';
import { slugifyScreenName } from './screenInventoryImageStore';
import { normalizeScreenPriority, type DerivedMockupVariant, type MockupViewport } from './mockupVariants';

/** Structured input for generating one mockup variant (viewport × state). */
export interface MockupVariantGenerationRequest {
    projectName: string;
    productSummary: string;
    screenId: string;
    screenName: string;
    screenPurpose: string;
    userIntent?: string;
    priority: ScreenPriority;
    /** Overlay-compatible variant id (`mobile:default`, `state:<slug>`, …). */
    variantId: string;
    viewport: MockupViewport;
    stateName: string;
    /** Semantic state category, when known (drives the state visual guidance). */
    stateType?: ScreenStateType;
    stateTrigger?: string;
    stateBehavior?: string;
    coreUIRegions: string[];
    userActions: string[];
    acceptanceCriteria: string[];
    /** Known risks / edge cases affecting this visual state. */
    risks: string[];
    /** Context about the screen's existing default mockup, when available. */
    siblingContext?: string;
    /** Mockup fidelity ('low' | 'mid' | 'high'), from mockup settings. */
    fidelity: string;
}

/** Fields the caller supplies from the project / mockup settings. */
export interface VariantRequestContext {
    projectName: string;
    productSummary: string;
    fidelity: string;
    /** The screen's existing default mockup screen spec (for sibling context). */
    siblingMockup?: MockupScreen;
}

const uniqueNonEmpty = (values: Array<string | undefined | null>): string[] => {
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

/** Find the documented screen state that a variant renders (by name slug). */
const matchState = (screen: ScreenItem, variant: DerivedMockupVariant) => {
    const targetSlug = slugifyScreenName(variant.stateName);
    return (screen.states ?? []).find(s => slugifyScreenName(s.name ?? '') === targetSlug);
};

/**
 * Assemble the structured generation request for one variant. Every field is
 * derived from existing screen-contract data (states / handoff / exitPaths /
 * risks) — nothing is invented. Sparse screens still produce a valid request
 * (empty arrays, no state detail).
 */
export function buildVariantGenerationRequest(
    screen: ScreenItem,
    screenId: string,
    variant: DerivedMockupVariant,
    ctx: VariantRequestContext,
): MockupVariantGenerationRequest {
    const state = variant.stateType && variant.stateType !== 'default'
        ? matchState(screen, variant)
        : undefined;

    const coreUIRegions = uniqueNonEmpty([
        ...(screen.coreUIElements ?? []),
        ...(screen.coreUIElements?.length ? [] : (screen.components ?? [])),
    ]);
    const userActions = uniqueNonEmpty([
        ...((screen.handoff?.events ?? []).map(e => e.name)),
        ...((screen.exitPaths ?? []).map(p => p.label)),
    ]);
    const acceptanceCriteria = uniqueNonEmpty([
        ...(state?.acceptanceCriteria ?? []),
        ...(state ? [] : (screen.acceptanceCriteria ?? [])),
    ]);
    const risks = uniqueNonEmpty([
        ...((screen.riskDetails ?? []).map(r => r.description)),
        ...(screen.riskDetails?.length ? [] : (screen.risks ?? [])),
    ]);

    const siblingContext = ctx.siblingMockup?.coreUIElements?.length
        ? `The screen's existing default mockup includes: ${ctx.siblingMockup.coreUIElements.join('; ')}. Keep this variant visually consistent with it.`
        : undefined;

    return {
        projectName: ctx.projectName,
        productSummary: ctx.productSummary,
        screenId,
        screenName: screen.name,
        screenPurpose: screen.purpose ?? '',
        userIntent: screen.userIntent,
        priority: normalizeScreenPriority(screen.priority),
        variantId: variant.id,
        viewport: variant.viewport,
        stateName: variant.stateName,
        stateType: variant.stateType,
        stateTrigger: state?.trigger,
        stateBehavior: state?.systemBehavior ?? state?.description,
        coreUIRegions,
        userActions,
        acceptanceCriteria,
        risks,
        siblingContext,
        fidelity: ctx.fidelity,
    };
}

const VIEWPORT_PROMPT_HINTS: Record<MockupViewport, string> = {
    desktop: 'desktop web app screen, landscape orientation',
    mobile: 'realistic mobile app screen, portrait orientation with a touch-friendly hierarchy — do not simply shrink a desktop layout',
    tablet: 'tablet app screen, landscape orientation',
};

// Explicit visual guidance per state category so the requested state is
// unmistakably represented in the render (not a generic default screen).
const STATE_VISUAL_GUIDANCE: Partial<Record<ScreenStateType, string>> = {
    empty: 'This is an EMPTY state — the UI must visibly show no items/content, with an appropriate empty-state message or primary call to action.',
    loading: 'This is a LOADING state — show skeleton placeholders, spinners, or progress indicators instead of loaded content.',
    error: 'This is an ERROR state — show a clear, recoverable error message with a way to retry or recover.',
    permission: 'This is a PERMISSION state — show access guidance or a request-access affordance rather than the full content.',
    success: 'This is a SUCCESS state — show a completion/confirmation message.',
    disabled: 'This is a DISABLED state — render controls in a visibly disabled/inactive treatment.',
};

/** Build the state-specific instruction block (empty for default states). */
function buildStateInstruction(request: MockupVariantGenerationRequest): string {
    const isDefault = !request.stateType || request.stateType === 'default'
        || request.stateName.trim().toLowerCase() === 'default';
    if (isDefault) return '';
    const parts: string[] = [
        `The visible UI must clearly represent the "${request.stateName}" state.`,
    ];
    const guidance = request.stateType ? STATE_VISUAL_GUIDANCE[request.stateType] : undefined;
    if (guidance) parts.push(guidance);
    if (request.stateTrigger) parts.push(`Triggered when: ${request.stateTrigger}.`);
    if (request.stateBehavior) parts.push(`Expected behavior: ${request.stateBehavior}.`);
    return parts.join(' ');
}

/**
 * Build the natural-language prompt for a single variant. Scoped to one
 * viewport + state; instructs the model NOT to render other states or a
 * generic default, and appends the Design System Brief when tokens exist so
 * the variant follows the same visual language as the default mockup.
 */
export function buildVariantImagePrompt(
    request: MockupVariantGenerationRequest,
    designTokens?: DesignTokens,
): string {
    const hasDs = Boolean(designTokens);
    const styleHint = fidelityStyleHint(request.fidelity, hasDs);
    const tokenBrief = designTokens ? ` ${buildDesignSystemBrief(designTokens)}` : '';
    const priorityLine = request.priority === 'P0'
        ? 'This is a P0 screen (essential to the main product loop) — give it a polished, central treatment.'
        : '';

    return [
        'Generate a mockup for this exact screen variant only:',
        `Viewport: ${request.viewport}. State: ${request.stateName}.`,
        `Screen: "${request.screenName}" for the product "${request.projectName}".`,
        request.screenPurpose ? `Screen purpose: ${request.screenPurpose}` : '',
        request.userIntent ? `User intent: ${request.userIntent}.` : '',
        request.coreUIRegions.length ? `Core UI regions to include: ${request.coreUIRegions.join('; ')}.` : '',
        request.userActions.length ? `Primary user actions: ${request.userActions.join('; ')}.` : '',
        buildStateInstruction(request),
        request.risks.length ? `Design carefully around these known edge cases: ${request.risks.join('; ')}.` : '',
        priorityLine,
        request.siblingContext ?? '',
        request.productSummary ? `Product context: ${request.productSummary}` : '',
        `Render as a ${VIEWPORT_PROMPT_HINTS[request.viewport]}.`,
        'Do not show other states unless they are necessary as background context. Do not create a generic default screen when a specific state was requested. Preserve the project’s design system and visual language, and keep the layout coherent with sibling variants.',
        `Style: ${styleHint}.${tokenBrief}`,
        ...IMAGE_CLOSING_RULES,
    ].filter(Boolean).join(' ');
}

/**
 * Build the generation-time coverage manifest for a variant. This is a
 * deterministic, structured restatement of what the request ASKED the image to
 * render — not a visual check. Every requested spec item is marked `covered`
 * (evidence: it was in the request); the rendered state is `covered` and other
 * states are `not_applicable` to this variant. `estimated` is always true.
 */
export function buildVariantCoverageManifest(
    request: MockupVariantGenerationRequest,
): MockupCoverageManifest {
    const covered = (label: string): MockupCoverageItem => ({
        label,
        status: 'covered',
        evidence: 'Requested in the generation spec for this variant.',
    });

    const uiRegions = request.coreUIRegions.map(covered);
    const userActions = request.userActions.map(covered);
    const acceptanceCriteria = request.acceptanceCriteria.map(covered);
    const states: MockupCoverageItem[] = [{
        label: request.stateName,
        status: 'covered',
        evidence: 'This variant renders this state.',
    }];

    const warnings: string[] = [];
    if (uiRegions.length === 0) {
        warnings.push('No core UI regions were documented for this screen — coverage is inferred from the screen purpose only.');
    }
    if (acceptanceCriteria.length === 0) {
        warnings.push('No acceptance criteria were documented for this variant — visual completeness is a best-effort estimate.');
    }

    // "aligned" once there is any concrete spec content the render was asked to
    // include; "unknown" for a sparse screen with nothing to align against.
    const hasContent = uiRegions.length + userActions.length + acceptanceCriteria.length > 0;
    const overallStatus: MockupCoverageOverallStatus = hasContent ? 'aligned' : 'unknown';

    return {
        variant: { viewport: request.viewport, stateName: request.stateName },
        overallStatus,
        estimated: true,
        uiRegions,
        states,
        userActions,
        acceptanceCriteria,
        warnings,
    };
}
