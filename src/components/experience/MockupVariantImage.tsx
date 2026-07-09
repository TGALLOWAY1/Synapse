// Phase 3B: renders ONE non-default mockup variant's image with generation
// actions (generate / regenerate / retry), backed by the dedicated per-variant
// image store. The legacy "Desktop · Default" variant is NOT rendered here — it
// keeps using MockupScreenImage. Each variant is keyed independently, so
// generating one never overwrites another.
//
// Demo / API-key behavior mirrors MockupScreenImage: generation requires an
// OpenAI key (the demo project has none), so the action is disabled with a
// clear, non-alarming explanation rather than a silent failure.

import { useEffect } from 'react';
import {
    AlertTriangle, ImageOff, Loader2, RefreshCw, Settings as SettingsIcon, Sparkles, X,
} from 'lucide-react';
import type { MockupImageQuality, MockupPlatform } from '../../types';
import { hasOpenAIKey } from '../../lib/openaiClient';
import { getMockupImageMode } from '../../lib/artifactModelSettings';
import { useMockupVariantImageStore } from '../../store/mockupVariantImageStore';
import type { MockupVariantGenerationRequest } from '../../lib/mockupVariantRequest';
import { formatVariantLabel, type DerivedMockupVariant } from '../../lib/mockupVariants';

interface Props {
    projectId: string;
    artifactId: string;
    versionId: string;
    platform: MockupPlatform;
    variant: DerivedMockupVariant;
    request: MockupVariantGenerationRequest;
}

const DEMO_KEYLESS_MESSAGE =
    'Generating custom mockup variants requires your own OpenAI API key. Add one in Settings to customize this project.';
const UPLOAD_MODE_MESSAGE =
    'Mockup image source is set to “upload your own” in Settings. Switch it to AI generation to generate variants here.';

export function MockupVariantImage({
    projectId, artifactId, versionId, platform, variant, request,
}: Props) {
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

    const keyPresent = hasOpenAIKey();
    const uploadMode = getMockupImageMode() === 'user_uploaded';
    const canGenerate = keyPresent && !uploadMode;
    const gateReason = uploadMode ? UPLOAD_MODE_MESSAGE : DEMO_KEYLESS_MESSAGE;

    const handleGenerate = (quality: MockupImageQuality) => {
        if (!canGenerate) return;
        clearError(versionId, request.screenId, request.variantId);
        void generate({ projectId, artifactId, versionId, platform, request, quality });
    };

    const label = formatVariantLabel(variant);

    if (inFlight) {
        return (
            <div className="bg-white rounded-lg border border-neutral-200 p-8 flex flex-col items-center justify-center text-center min-h-[320px]">
                <Loader2 size={26} className="text-indigo-500 animate-spin mb-3" />
                <div className="text-sm font-medium text-neutral-800">Generating {label}…</div>
                <div className="text-xs text-neutral-500 mt-1">
                    OpenAI gpt-image-2 · usually 5–15s
                </div>
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
        return (
            <div className="overflow-hidden">
                <div className="relative bg-neutral-50 flex items-center justify-center rounded-lg border border-neutral-200 overflow-hidden">
                    <img
                        src={record.dataUrl}
                        alt={`AI mockup of ${request.screenName} — ${label}`}
                        className="max-w-full max-h-[560px] object-contain"
                    />
                </div>
                <div className="mt-2 flex items-center justify-end">
                    <button
                        type="button"
                        disabled={!canGenerate}
                        onClick={() => handleGenerate(record.quality)}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        title={canGenerate ? 'Regenerate this variant (replaces this render)' : gateReason}
                    >
                        <RefreshCw size={12} /> Regenerate variant
                    </button>
                </div>
                {!canGenerate && (
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
                    We couldn&rsquo;t generate this variant. You can retry, or review your API key in Settings.
                </p>
                <p className="text-[11px] text-amber-700 mt-2 max-w-md break-words">{error}</p>
                <button
                    type="button"
                    disabled={!canGenerate}
                    onClick={() => handleGenerate('low')}
                    className="mt-3 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
                >
                    <RefreshCw size={13} /> Retry generation
                </button>
            </div>
        );
    }

    // Missing — no image yet. Offer generation (gated).
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
                title={canGenerate ? 'Generate this variant (low-quality draft, 5–15s)' : gateReason}
            >
                <Sparkles size={14} /> Generate variant
            </button>
            {canGenerate ? (
                <p className="mt-2 text-[11px] text-amber-700 max-w-sm">
                    Paid OpenAI operation — billed to your account via your key (usually a few cents).
                </p>
            ) : (
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-neutral-500 max-w-sm">
                    <SettingsIcon size={11} className="shrink-0" /> {gateReason}
                </p>
            )}
        </div>
    );
}
