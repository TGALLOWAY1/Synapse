// Registry + routing rules for the two mockup image providers. Pure: no
// stores, no network, no key reads — availability is passed in.
//
// Synapse renders mockup screens with OpenAI GPT Image 2 (proxied server-side
// through api/image/generate.js) or Google Nano Banana 2.1 (browser-direct via
// geminiClient.callGeminiImage, on the user's Gemini key). Settings picks a
// PRIMARY model and an optional FALLBACK:
//   - a generation started WITHOUT an explicit model (the main "Generate"
//     action, approval-gate and batch flows, "Retry failed images") runs on
//     the first AVAILABLE provider of [primary, fallback] and, when that
//     attempt fails, retries once on the next;
//   - a generation started FROM an explicit model choice (the per-model
//     buttons on the mockup pages) runs on that model only — no silent swap.
//
// Upgrading a slot to a newer model is a one-line `modelId` change here; old
// renders keep the exact model id they were made with (`record.model`).

import type { MockupImageProvider, MockupImageQuality } from '../types';

export interface MockupImageModelInfo {
    provider: MockupImageProvider;
    /** Exact model id the provider is called with. */
    modelId: string;
    /** Short UI label. */
    label: string;
    /** Who bills the call, for cost copy ("Paid {vendor} operation"). */
    vendor: string;
    /** The API key that enables it, for "add a key" copy. */
    keyName: string;
    /** Typical latency of a draft render, for the in-flight hint. */
    draftLatency: string;
}

export const MOCKUP_IMAGE_MODELS: Readonly<Record<MockupImageProvider, MockupImageModelInfo>> = {
    openai: {
        provider: 'openai',
        modelId: 'gpt-image-2',
        label: 'GPT Image 2',
        vendor: 'OpenAI',
        keyName: 'OpenAI',
        draftLatency: 'usually 5–15s',
    },
    gemini: {
        provider: 'gemini',
        // Nano Banana 2.1 — Google's newest image model (GA October 2026),
        // the successor to Nano Banana 2 (gemini-3.1-flash-image).
        modelId: 'gemini-nano-banana-2.1',
        label: 'Nano Banana 2.1',
        vendor: 'Google',
        keyName: 'Gemini',
        // Measured live: 21–31s per render (thinking is on by default).
        draftLatency: 'usually 20–40s',
    },
};

/** Display order for pickers and per-model buttons. */
export const MOCKUP_IMAGE_PROVIDERS: readonly MockupImageProvider[] = ['openai', 'gemini'];

export const isMockupImageProvider = (value: unknown): value is MockupImageProvider =>
    value === 'openai' || value === 'gemini';

export interface MockupImageModelPrefs {
    primary: MockupImageProvider;
    /** null = no automatic fallback. Never equal to `primary`. */
    fallback: MockupImageProvider | null;
}

/** GPT Image 2 stays the primary source (the pre-Nano-Banana behavior), with
 * Nano Banana 2.1 as the automatic fallback. */
export const DEFAULT_MOCKUP_IMAGE_MODEL_PREFS: MockupImageModelPrefs = {
    primary: 'openai',
    fallback: 'gemini',
};

/** The provider that is not `provider` (there are exactly two). */
export const otherMockupImageProvider = (provider: MockupImageProvider): MockupImageProvider =>
    provider === 'openai' ? 'gemini' : 'openai';

/**
 * The providers a default (non-explicit) generation tries, in order: the
 * primary, then the fallback — skipping any without a usable key. Empty when
 * neither is available (callers show the upload sheet / "add a key" copy).
 */
export const resolveImageProviderChain = (
    prefs: MockupImageModelPrefs,
    isAvailable: (provider: MockupImageProvider) => boolean,
): MockupImageProvider[] => {
    const ordered: MockupImageProvider[] = [prefs.primary];
    if (prefs.fallback && prefs.fallback !== prefs.primary) ordered.push(prefs.fallback);
    return ordered.filter(isAvailable);
};

const LABEL_BY_MODEL_ID: ReadonlyMap<string, string> = new Map(
    Object.values(MOCKUP_IMAGE_MODELS).map((m) => [m.modelId, m.label]),
);

/** The provider behind a stored model id. An absent id is a pre-provider
 * render (gpt-image-2); an unknown id is matched by its `gemini` family prefix. */
export const imageProviderForModel = (modelId: string | undefined): MockupImageProvider => {
    if (!modelId) return 'openai';
    const known = Object.values(MOCKUP_IMAGE_MODELS).find((m) => m.modelId === modelId);
    if (known) return known.provider;
    return modelId.startsWith('gemini') ? 'gemini' : 'openai';
};

/** "GPT Image 2" or "GPT Image 2, falling back to Nano Banana 2.1" — the
 * routing a default generation will use, for confirm / cost copy. */
export const describeImageProviderChain = (chain: MockupImageProvider[]): string => {
    if (chain.length === 0) return '';
    const [first, next] = chain;
    return next
        ? `${MOCKUP_IMAGE_MODELS[first].label}, falling back to ${MOCKUP_IMAGE_MODELS[next].label}`
        : MOCKUP_IMAGE_MODELS[first].label;
};

/** In-flight hint: who is rendering and roughly how long it takes. */
export const imageLatencyHint = (provider: MockupImageProvider, quality: MockupImageQuality): string => {
    const info = MOCKUP_IMAGE_MODELS[provider];
    const latency = provider === 'openai' && quality === 'high' ? 'this may take 30–60s' : info.draftLatency;
    return `${info.vendor} ${info.label} · ${latency}`;
};

/**
 * UI label for a render. A stored model id wins (an unknown id — e.g. a model
 * a newer build added — is shown verbatim). Renders from before the `model`
 * field existed take their provider's label: `fallbackProvider` for keyed
 * records, else OpenAI, since every pre-provider render was gpt-image-2.
 */
export const imageModelLabel = (
    modelId: string | undefined,
    fallbackProvider: MockupImageProvider = 'openai',
): string => {
    if (modelId) return LABEL_BY_MODEL_ID.get(modelId) ?? modelId;
    return MOCKUP_IMAGE_MODELS[fallbackProvider].label;
};
