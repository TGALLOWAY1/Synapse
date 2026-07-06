import type { CoreArtifactSubtype } from '../types';
import { getFastModel, getStrongModel } from './geminiClient';

/**
 * Per-artifact model routing + persistence.
 *
 * Mirrors the PRD pipeline's Fast/Expert tiering but adds an explicit
 * **per-artifact override** layer so users can pin a specific model for each
 * artifact in Settings → "Artifact Generation Models".
 *
 * Resolution order for a given artifact subtype:
 *   1. explicit user override (Settings)               — `getArtifactModelOverrides()`
 *   2. complexity recommendation (Flash vs Pro)        — `CORE_ARTIFACT_COMPLEXITY`
 *   3. tier-model fallback via `getFastModel`/`getStrongModel` — an explicit
 *      tier model, else the single Default model, else the tier's own default
 *      (`DEFAULT_FAST_MODEL` = Flash / `DEFAULT_STRONG_MODEL` = Pro). The strong
 *      tier defaults to Pro, matching Settings — it must NOT collapse to the
 *      Flash global default, or "Pro for complex artifacts" silently runs Flash.
 *
 * Existing projects have no override key, so behaviour is unchanged until the
 * user picks a model — no migration is required.
 *
 * Keep `CORE_ARTIFACT_COMPLEXITY` in sync when adding a `CoreArtifactSubtype`.
 */
export type ArtifactComplexity = 'low' | 'high';

export const CORE_ARTIFACT_COMPLEXITY: Record<CoreArtifactSubtype, ArtifactComplexity> = {
    // High — deep reasoning / structural design over the full PRD.
    screen_inventory: 'high',
    user_flows: 'high',
    data_model: 'high',
    implementation_plan: 'high',
    // Low — derivative of upstream artifacts or template-shaped.
    component_inventory: 'low',
    design_system: 'low',
    prompt_pack: 'low',
};

const ARTIFACT_MODELS_KEY = 'GEMINI_ARTIFACT_MODELS';

/** Read the persisted per-artifact model override map (defensive). */
export const getArtifactModelOverrides = (): Partial<Record<CoreArtifactSubtype, string>> => {
    try {
        const raw = localStorage.getItem(ARTIFACT_MODELS_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        const out: Partial<Record<CoreArtifactSubtype, string>> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'string' && v && k in CORE_ARTIFACT_COMPLEXITY) {
                out[k as CoreArtifactSubtype] = v;
            }
        }
        return out;
    } catch {
        return {};
    }
};

/**
 * Persist per-artifact overrides. Empty values are dropped so a cleared
 * selection cleanly falls back to the complexity recommendation; an empty map
 * removes the key entirely.
 */
export const setArtifactModelOverrides = (
    overrides: Partial<Record<CoreArtifactSubtype, string>>,
): void => {
    try {
        const cleaned: Record<string, string> = {};
        for (const [k, v] of Object.entries(overrides)) {
            if (typeof v === 'string' && v && k in CORE_ARTIFACT_COMPLEXITY) {
                cleaned[k] = v;
            }
        }
        if (Object.keys(cleaned).length === 0) {
            localStorage.removeItem(ARTIFACT_MODELS_KEY);
        } else {
            localStorage.setItem(ARTIFACT_MODELS_KEY, JSON.stringify(cleaned));
        }
    } catch {
        /* ignore quota / serialization errors — selection is best-effort */
    }
};

/** The recommended model for an artifact, derived purely from its complexity tier. */
export const getRecommendedArtifactModel = (subtype: CoreArtifactSubtype): string =>
    CORE_ARTIFACT_COMPLEXITY[subtype] === 'high' ? getStrongModel() : getFastModel();

/**
 * The effective model an artifact should generate with: an explicit user
 * override when present, otherwise the complexity recommendation. This is the
 * single resolution point consumed by generation, refinement, and metrics.
 */
export const getArtifactModel = (subtype: CoreArtifactSubtype): string => {
    const override = getArtifactModelOverrides()[subtype];
    return override || getRecommendedArtifactModel(subtype);
};

// ---------------------------------------------------------------------------
// Mockup image source mode
// ---------------------------------------------------------------------------
//
// Mockups are not a text artifact — their "model" is an image source. The user
// chooses between auto-generating screen images via OpenAI GPT Image, or
// supplying their own uploads against generated per-screen prompts.

export type MockupImageMode = 'gpt_image' | 'user_uploaded';
export const DEFAULT_MOCKUP_IMAGE_MODE: MockupImageMode = 'gpt_image';
const MOCKUP_IMAGE_MODE_KEY = 'SYNAPSE_MOCKUP_IMAGE_MODE';

export const getMockupImageMode = (): MockupImageMode => {
    try {
        const v = localStorage.getItem(MOCKUP_IMAGE_MODE_KEY);
        return v === 'user_uploaded' || v === 'gpt_image' ? v : DEFAULT_MOCKUP_IMAGE_MODE;
    } catch {
        return DEFAULT_MOCKUP_IMAGE_MODE;
    }
};

export const setMockupImageMode = (mode: MockupImageMode): void => {
    try {
        localStorage.setItem(MOCKUP_IMAGE_MODE_KEY, mode);
    } catch {
        /* ignore */
    }
};

export interface MockupRenderDecision {
    /** Render the manual prompt + upload sheet instead of the OpenAI generator. */
    manual: boolean;
    /** True when GPT Image 2 was chosen but no key is configured (forced fallback). */
    forcedFallback: boolean;
}

/**
 * Decide how a mockup screen should render given the selected mode and whether
 * an OpenAI image key is available. 'user_uploaded' always shows the manual
 * sheet; 'gpt_image' shows the generator only when a key exists, otherwise it
 * falls back to the manual sheet (never a silent failure).
 */
export const resolveMockupRender = (
    mode: MockupImageMode,
    hasOpenAiKey: boolean,
): MockupRenderDecision => ({
    manual: mode === 'user_uploaded' || !hasOpenAiKey,
    forcedFallback: mode === 'gpt_image' && !hasOpenAiKey,
});
