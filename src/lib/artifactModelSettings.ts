import type { CoreArtifactSubtype, MockupImageProvider } from '../types';
import { getFastModel, getStrongModel } from './geminiClient';
import { hasGeminiKey } from './geminiKeyVault';
import { hasOpenAIKey } from './openaiClient';
import {
    DEFAULT_MOCKUP_IMAGE_MODEL_PREFS,
    MOCKUP_IMAGE_PROVIDERS,
    isMockupImageProvider,
    otherMockupImageProvider,
    resolveImageProviderChain,
    type MockupImageModelPrefs,
} from './mockupImageModels';

/**
 * Per-artifact model routing + persistence.
 *
 * Mirrors the PRD pipeline's Fast/Expert tiering but adds an explicit
 * **per-artifact override** layer so users can pin a specific model for each
 * artifact in Settings → "Artifact Generation Models".
 *
 * Resolution order for a given artifact subtype:
 *   1. explicit user override (Settings)               — `getArtifactModelOverrides()`
 *   2. complexity recommendation (Flash vs Argon)      — `CORE_ARTIFACT_COMPLEXITY`
 *   3. tier-model fallback via `getFastModel`/`getStrongModel` — an explicit
 *      tier model, else the single Default model, else the tier's own default
 *      (`DEFAULT_FAST_MODEL` = Flash / `DEFAULT_STRONG_MODEL` = Argon). The
 *      strong tier defaults to Argon, matching Settings — it must NOT collapse
 *      to the Flash global default, or "Argon for complex artifacts" silently
 *      runs Flash.
 *
 * Existing projects have no override key, so behaviour is unchanged until the
 * user picks a model. The one exception is `migrateGeminiProModel`
 * (`modelMigration.ts`), which moves saved Gemini 3.1 Pro overrides to Argon.
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
// Mockup image source mode + image model routing
// ---------------------------------------------------------------------------
//
// Mockups are not a text artifact — their "model" is an image source. The user
// chooses between AI-generated screen images or supplying their own uploads
// against generated per-screen prompts. AI generation then routes through a
// PRIMARY image model with an optional FALLBACK (GPT Image 2 / Nano Banana
// 2.1 — see `mockupImageModels.ts` for the routing rules).

export type MockupImageMode = 'ai_generated' | 'user_uploaded';
export const DEFAULT_MOCKUP_IMAGE_MODE: MockupImageMode = 'ai_generated';
const MOCKUP_IMAGE_MODE_KEY = 'SYNAPSE_MOCKUP_IMAGE_MODE';
// The stored AI value was 'gpt_image' while GPT Image 2 was the only model; it
// (like any unrecognized value) reads as the default, AI generation.

export const getMockupImageMode = (): MockupImageMode => {
    try {
        const v = localStorage.getItem(MOCKUP_IMAGE_MODE_KEY);
        return v === 'user_uploaded' || v === 'ai_generated' ? v : DEFAULT_MOCKUP_IMAGE_MODE;
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

const MOCKUP_IMAGE_PRIMARY_KEY = 'SYNAPSE_MOCKUP_IMAGE_PRIMARY';
const MOCKUP_IMAGE_FALLBACK_KEY = 'SYNAPSE_MOCKUP_IMAGE_FALLBACK';
const NO_FALLBACK = 'none';

/**
 * Persisted primary/fallback image models. An unset fallback defaults to the
 * other model; a fallback equal to the primary (or 'none') means no fallback.
 */
export const getMockupImageModelPrefs = (): MockupImageModelPrefs => {
    try {
        const storedPrimary = localStorage.getItem(MOCKUP_IMAGE_PRIMARY_KEY);
        const primary = isMockupImageProvider(storedPrimary)
            ? storedPrimary
            : DEFAULT_MOCKUP_IMAGE_MODEL_PREFS.primary;
        const storedFallback = localStorage.getItem(MOCKUP_IMAGE_FALLBACK_KEY);
        const fallback = storedFallback === NO_FALLBACK
            ? null
            : isMockupImageProvider(storedFallback)
                ? storedFallback
                : otherMockupImageProvider(primary);
        return { primary, fallback: fallback === primary ? null : fallback };
    } catch {
        return DEFAULT_MOCKUP_IMAGE_MODEL_PREFS;
    }
};

export const setMockupImageModelPrefs = (prefs: MockupImageModelPrefs): void => {
    try {
        localStorage.setItem(MOCKUP_IMAGE_PRIMARY_KEY, prefs.primary);
        const fallback = prefs.fallback && prefs.fallback !== prefs.primary ? prefs.fallback : NO_FALLBACK;
        localStorage.setItem(MOCKUP_IMAGE_FALLBACK_KEY, fallback);
    } catch {
        /* ignore */
    }
};

/**
 * Whether a provider has a usable key right now: the primed vault flag for
 * OpenAI (its key never reaches the browser), the in-memory vault key OR the
 * local fallback for Gemini (`hasGeminiKey`, the same resolution the
 * transport uses).
 */
export const isMockupImageProviderAvailable = (provider: MockupImageProvider): boolean =>
    provider === 'openai' ? hasOpenAIKey() : hasGeminiKey();

/** The providers a default generation tries right now, in order (see
 * `resolveImageProviderChain`). Empty when no selected model has a key. */
export const getMockupImageProviderChain = (): MockupImageProvider[] =>
    resolveImageProviderChain(getMockupImageModelPrefs(), isMockupImageProviderAvailable);

/** Whether a default generation can run at all (the "has an image key?" gate
 * for the approval gate and batch flows). */
export const hasMockupImageModel = (): boolean => getMockupImageProviderChain().length > 0;

/** Whether ANY image model has a key — enough for the AI generator view and
 * its explicit per-model actions, even when the Settings chain can't run (a
 * keyless primary with the fallback turned off). */
export const hasAnyMockupImageKey = (): boolean => MOCKUP_IMAGE_PROVIDERS.some(isMockupImageProviderAvailable);

export interface MockupRenderDecision {
    /** Render the manual prompt + upload sheet instead of the AI generator. */
    manual: boolean;
    /** True when AI generation was chosen but no image model has a key (forced fallback). */
    forcedFallback: boolean;
}

/**
 * Decide how a mockup screen should render given the selected mode and whether
 * any image model has a key (`hasAnyMockupImageKey`). 'user_uploaded' always
 * shows the manual sheet; 'ai_generated' shows the generator only when a model
 * is usable, otherwise it falls back to the manual sheet (never a silent
 * failure).
 */
export const resolveMockupRender = (
    mode: MockupImageMode,
    hasImageModel: boolean,
): MockupRenderDecision => ({
    manual: mode === 'user_uploaded' || !hasImageModel,
    forcedFallback: mode === 'ai_generated' && !hasImageModel,
});
