// Phase 3B: renders ONE non-default mockup variant's image with generation
// actions (generate / regenerate / retry), backed by the dedicated per-variant
// image store. The legacy "Desktop · Default" variant is NOT rendered here — it
// keeps using MockupScreenImage. Each variant is keyed independently, so
// generating one never overwrites another.
//
// Generation routes like MockupScreenImage: the main action runs the Settings
// primary image model (falling back automatically); "Try / Use <model>" runs
// that model only. Variant keys carry no model, so a render from the other
// model becomes current and the previous one moves to the variant history.
//
// Demo / API-key behavior mirrors MockupScreenImage: generation requires an
// OpenAI or Gemini key (the demo project has neither), so the action is
// disabled with a clear, non-alarming explanation rather than a silent failure.

import { useEffect } from 'react';
import {
    AlertTriangle, ImageOff, Loader2, RefreshCw, Settings as SettingsIcon, Sparkles, X,
} from 'lucide-react';
import type { MockupImageProvider, MockupImageQuality, MockupPlatform, MockupVariantImageRecord } from '../../types';
import {
    getMockupImageMode,
    getMockupImageProviderChain,
    hasAnyMockupImageKey,
    isMockupImageProviderAvailable,
} from '../../lib/artifactModelSettings';
import {
    MOCKUP_IMAGE_MODELS,
    MOCKUP_IMAGE_PROVIDERS,
    describeImageProviderChain,
    imageLatencyHint,
    imageModelLabel,
    imageProviderForModel,
} from '../../lib/mockupImageModels';
import { useMockupVariantImageStore } from '../../store/mockupVariantImageStore';
import type { MockupVariantGenerationRequest } from '../../lib/mockupVariantRequest';
import type { MockupVariantSourceSignature } from '../../lib/mockupVariantTrust';
import { formatVariantLabel, type DerivedMockupVariant } from '../../lib/mockupVariants';
import { useProjectCapabilities } from '../../hooks/useProjectCapabilities';
import { ImageModelButton } from '../mockups/ImageModelButton';

interface Props {
    projectId: string;
    artifactId: string;
    versionId: string;
    platform: MockupPlatform;
    variant: DerivedMockupVariant;
    request: MockupVariantGenerationRequest;
    /** Phase 3C: source signature to store with this render (freshness). The
     * createdAt is re-stamped at generation time. */
    sourceSignature?: MockupVariantSourceSignature;
    generatedFrom?: MockupVariantImageRecord['generatedFrom'];
}

const DEMO_KEYLESS_MESSAGE =
    'Generating custom mockup variants requires your own OpenAI or Gemini API key. Add one in Settings to customize this project.';
const UPLOAD_MODE_MESSAGE =
    'Mockup image source is set to “upload your own” in Settings. Switch it to AI generation to generate variants here.';
const NO_DEFAULT_MODEL_MESSAGE =
    'Your primary image model has no key and no fallback is set — pick a model here, or adjust the mockup models in Settings.';

export function MockupVariantImage({
    projectId, artifactId, versionId, platform, variant, request,
    sourceSignature, generatedFrom,
}: Props) {
    const capabilities = useProjectCapabilities(projectId);
    const scope = `${versionId}:${request.screenId}:${request.variantId}`;
    const record = useMockupVariantImageStore(s => s.getBestRecord(versionId, request.screenId, request.variantId));
    // Subscribe to the images map so a freshly-stored record re-renders us.
    useMockupVariantImageStore(s => s.images);
    const inFlight = useMockupVariantImageStore(s => s.inFlight[scope]);
    const error = useMockupVariantImageStore(s => s.errors[scope]);
    const generate = useMockupVariantImageStore(s => s.generate);
    const cancel = useMockupVariantImageStore(s => s.cancel);
    const clearError = useMockupVariantImageStore(s => s.clearError);
    const loadForVersion = useMockupVariantImageStore(s => s.loadForVersion);

    // Hydrate this version's variant images from IDB (reload / tab switch).
    useEffect(() => {
        void loadForVersion(versionId);
    }, [versionId, loadForVersion]);

    // The models a default generation will try (Settings primary, then
    // fallback), keeping only those with a key.
    const chain = getMockupImageProviderChain();
    const uploadMode = getMockupImageMode() === 'user_uploaded';
    const canGenerate = capabilities.canGenerateArtifacts && chain.length > 0 && !uploadMode;
    // Explicit per-model actions need ANY keyed model, not the Settings chain
    // (a keyless primary with the fallback off still leaves the other model).
    const canPickModel = capabilities.canGenerateArtifacts && !uploadMode && hasAnyMockupImageKey();
    const gateReason = !capabilities.canGenerateArtifacts
        ? 'This example project is read-only.'
        : uploadMode ? UPLOAD_MODE_MESSAGE
            : canPickModel ? NO_DEFAULT_MODEL_MESSAGE : DEMO_KEYLESS_MESSAGE;

    /** `provider` set = that model only; omitted = the primary → fallback chain. */
    const handleGenerate = (quality: MockupImageQuality, provider?: MockupImageProvider) => {
        if (provider ? !canPickModel : !canGenerate) return;
        clearError(versionId, request.screenId, request.variantId);
        // Re-stamp createdAt so the stored signature's timestamp reflects the
        // actual generation moment (the hash itself is unchanged).
        const signature = sourceSignature
            ? { ...sourceSignature, createdAt: new Date().toISOString() }
            : undefined;
        void generate({
            projectId, artifactId, versionId, platform, request, quality, provider,
            sourceSignature: signature, generatedFrom,
        });
    };

    const label = formatVariantLabel(variant);

    if (inFlight) {
        return (
            <div className="bg-white rounded-lg border border-neutral-200 p-8 flex flex-col items-center justify-center text-center min-h-[320px]">
                <Loader2 size={26} className="text-indigo-500 animate-spin mb-3" />
                <div className="text-sm font-medium text-neutral-800">Generating {label}…</div>
                <div className="text-xs text-neutral-500 mt-1">
                    {imageLatencyHint(inFlight.provider, inFlight.quality)}
                </div>
                {inFlight.fallbackFrom && (
                    <div className="text-[11px] text-amber-700 mt-1 max-w-sm">
                        {MOCKUP_IMAGE_MODELS[inFlight.fallbackFrom].label} failed — trying your fallback model,{' '}
                        {MOCKUP_IMAGE_MODELS[inFlight.provider].label}.
                    </div>
                )}
                <button
                    type="button"
                    onClick={() => cancel(versionId, request.screenId, request.variantId)}
                    className="mt-4 inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 px-2 py-1 rounded-md hover:bg-neutral-50 transition"
                >
                    <X size={12} /> Cancel
                </button>
            </div>
        );
    }

    if (record) {
        const recordProvider = imageProviderForModel(record.model);
        const recordLabel = imageModelLabel(record.model);
        const regenerateAvailable = canPickModel && isMockupImageProviderAvailable(recordProvider);
        return (
            <div className="overflow-hidden">
                <div className="relative bg-neutral-50 flex items-center justify-center rounded-lg border border-neutral-200 overflow-hidden">
                    <img
                        src={record.dataUrl}
                        alt={`AI mockup of ${request.screenName} — ${label} (${recordLabel})`}
                        className="max-w-full max-h-[560px] object-contain"
                    />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] text-neutral-500">Made with {recordLabel}</span>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {canPickModel && MOCKUP_IMAGE_PROVIDERS.filter((p) => p !== recordProvider).map((p) => (
                            <ImageModelButton
                                key={p}
                                provider={p}
                                verb="Try"
                                note="the current render moves to the variant history"
                                onClick={(chosen) => handleGenerate(record.quality, chosen)}
                            />
                        ))}
                        <button
                            type="button"
                            disabled={!regenerateAvailable}
                            onClick={() => handleGenerate(record.quality, recordProvider)}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                            title={regenerateAvailable
                                ? `Regenerate this variant with ${recordLabel} (replaces this render)`
                                : canPickModel
                                    ? `Add a ${MOCKUP_IMAGE_MODELS[recordProvider].keyName} API key in Settings to enable`
                                    : gateReason}
                        >
                            <RefreshCw size={12} /> Regenerate variant
                        </button>
                    </div>
                </div>
                {error && (
                    <p className="mt-1 text-[11px] text-amber-700 text-right break-words">{error}</p>
                )}
                {!canPickModel && (
                    <p className="mt-1 text-[11px] text-neutral-400 text-right">{gateReason}</p>
                )}
            </div>
        );
    }

    // Failed (no record + error) — honest failure state with retry.
    if (error) {
        return (
            <div className="bg-white rounded-lg border border-amber-200 bg-amber-50/40 p-6 flex flex-col items-center justify-center text-center min-h-[240px]">
                <AlertTriangle size={20} className="text-amber-500 mb-2" />
                <div className="text-sm font-medium text-neutral-800">{label} — generation failed</div>
                <p className="text-[11px] text-neutral-600 mt-1 max-w-sm">
                    We couldn&rsquo;t generate this variant. You can retry, try the other image model, or review your API keys in Settings.
                </p>
                <p className="text-[11px] text-amber-700 mt-2 max-w-md break-words">{error}</p>
                <div className="mt-3 flex items-center justify-center gap-1.5 flex-wrap">
                    <button
                        type="button"
                        disabled={!canGenerate}
                        onClick={() => handleGenerate('low')}
                        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
                    >
                        <RefreshCw size={13} /> Retry generation
                    </button>
                    {canPickModel && MOCKUP_IMAGE_PROVIDERS.map((p) => (
                        <ImageModelButton key={p} provider={p} verb="Use" onClick={(chosen) => handleGenerate('low', chosen)} />
                    ))}
                </div>
            </div>
        );
    }

    // Missing — no image yet. Offer generation (gated).
    const lead = chain[0];
    return (
        <div className="bg-white rounded-lg border border-dashed border-neutral-300 p-6 flex flex-col items-center justify-center text-center min-h-[240px]">
            <ImageOff size={20} className="text-neutral-300 mb-2" />
            <div className="text-sm font-medium text-neutral-800">No {label} mockup yet</div>
            <p className="text-[11px] text-neutral-500 mt-1 max-w-sm">
                {variant.notes[0] ?? 'Recommended for this screen.'} Generate just this variant — it
                won&rsquo;t change any other mockup.
            </p>
            <button
                type="button"
                disabled={!canGenerate}
                onClick={() => handleGenerate('low')}
                className="mt-4 inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
                title={canGenerate ? `Generate this variant with ${describeImageProviderChain(chain)} (low-quality draft)` : gateReason}
            >
                <Sparkles size={14} /> Generate variant
            </button>
            {canPickModel && (
                <div className="mt-2 flex items-center justify-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-neutral-400">or</span>
                    {MOCKUP_IMAGE_PROVIDERS.filter((p) => p !== lead).map((p) => (
                        <ImageModelButton key={p} provider={p} verb="Use" onClick={(chosen) => handleGenerate('low', chosen)} />
                    ))}
                </div>
            )}
            {canGenerate && lead ? (
                <p className="mt-2 text-[11px] text-amber-700 max-w-sm">
                    Uses {describeImageProviderChain(chain)}. Paid {MOCKUP_IMAGE_MODELS[lead].vendor} operation — billed to your account via your key (usually a few cents).
                </p>
            ) : (
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-neutral-500 max-w-sm">
                    <SettingsIcon size={11} className="shrink-0" /> {gateReason}
                </p>
            )}
        </div>
    );
}
