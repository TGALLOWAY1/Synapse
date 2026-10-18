/**
 * AI Image preview panel for a single MockupScreen, rendered by one of two
 * image models — OpenAI GPT Image 2 or Google Nano Banana 2.1 (routing rules in
 * src/lib/mockupImageModels.ts). Render states:
 *   - empty:    no image yet → CTA "Generate AI image" (low quality) on the
 *               Settings primary model (falling back automatically), plus an
 *               explicit "Use <other model>" action
 *   - loading:  in-flight → spinner + which model is rendering (and whether
 *               it is the fallback) + cancel button
 *   - ready:    the displayed render + a switcher across every render of this
 *               screen (model × quality) + "Regenerate" (same model) and
 *               "Try <other model>" while that model has no render yet
 *
 * Persistence and orchestration live in src/store/mockupImageStore.ts; this
 * component only reads the cache and dispatches actions. Each quality and each
 * model is stored under its own IDB key, so a render from one model never
 * discards another's — the user can flip between them to compare.
 */

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Loader2, Image as ImageIcon, AlertTriangle, RefreshCw, X, Settings as SettingsIcon } from 'lucide-react';
import type {
    MockupImageProvider, MockupImageQuality, MockupImageRecord, MockupPayload, MockupScreen, MockupSettings,
} from '../../types';
import { useMockupImageStore } from '../../store/mockupImageStore';
import { buildScreenScopeKey, imageKeyProvider, pickDisplayedMockupImage } from '../../lib/mockupImageStore';
import {
    getMockupImageMode,
    getMockupImageModelPrefs,
    getMockupImageProviderChain,
    hasAnyMockupImageKey,
    isMockupImageProviderAvailable,
    resolveMockupRender,
} from '../../lib/artifactModelSettings';
import {
    MOCKUP_IMAGE_MODELS,
    MOCKUP_IMAGE_PROVIDERS,
    describeImageProviderChain,
    imageLatencyHint,
    imageModelLabel,
} from '../../lib/mockupImageModels';
import { MockupScreenUpload } from './MockupScreenUpload';
import { ImageModelButton } from './ImageModelButton';
import { useProjectCapabilities } from '../../hooks/useProjectCapabilities';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface Props {
    projectId: string;
    artifactId: string;
    versionId: string;
    screen: MockupScreen;
    payload: MockupPayload;
    settings: MockupSettings;
    /** Phase 3C: fired after a successful render so a caller (the variant panel)
     * can capture a default-variant coverage sidecar. Optional — other callers
     * of this component pass nothing and behave exactly as before. */
    onGenerated?: (record: MockupImageRecord) => void;
}

const QUALITY_RANK: Record<MockupImageQuality, number> = { low: 0, medium: 1, high: 2 };

const QUALITY_LABEL: Record<MockupImageQuality, string> = {
    low: 'Low quality',
    medium: 'Medium quality',
    high: 'High quality',
};

const QUALITY_SHORT: Record<MockupImageQuality, string> = { low: 'Low', medium: 'Medium', high: 'High' };

// High-quality renders are paid; the confirmation names who bills it.
const HIGH_QUALITY_CONFIRM: Record<MockupImageProvider, { title: string; body: string }> = {
    openai: {
        title: 'Generate a HIGH-quality image with OpenAI gpt-image-2?',
        body: 'This is a paid OpenAI operation billed to your own account (typically a few cents per image).',
    },
    gemini: {
        title: 'Generate a HIGH-quality image with Google Nano Banana 2.1?',
        body: 'This is a paid Google Gemini API operation billed to your own account (typically a few cents per image). High quality renders at 2K with extended reasoning.',
    },
};

const recordLabel = (r: MockupImageRecord): string => imageModelLabel(r.model, imageKeyProvider(r.key));

export function MockupScreenImage({ projectId, artifactId, versionId, screen, payload, settings, onGenerated }: Props) {
    const capabilities = useProjectCapabilities(projectId);
    const scope = buildScreenScopeKey(versionId, screen.id);
    // Subscribe to the whole image map; filtered records are derived below.
    // The previous implementation subscribed only to a single keyed entry,
    // which broke once we started storing per-quality variants.
    const allImages = useMockupImageStore((s) => s.images);
    const inFlight = useMockupImageStore((s) => s.inFlight[scope]);
    const error = useMockupImageStore((s) => s.errors[scope]);
    const selectedKey = useMockupImageStore((s) => s.selected[scope]);
    const generate = useMockupImageStore((s) => s.generate);
    const cancel = useMockupImageStore((s) => s.cancel);
    const clearError = useMockupImageStore((s) => s.clearError);
    const loadForVersion = useMockupImageStore((s) => s.loadForVersion);
    const select = useMockupImageStore((s) => s.select);

    const records = useMemo(() => {
        const out: MockupImageRecord[] = [];
        for (const k of Object.keys(allImages)) {
            if (k.startsWith(scope)) out.push(allImages[k]);
        }
        // Group by model, then quality, so the render switcher reads predictably.
        out.sort((a, b) =>
            MOCKUP_IMAGE_PROVIDERS.indexOf(imageKeyProvider(a.key)) - MOCKUP_IMAGE_PROVIDERS.indexOf(imageKeyProvider(b.key))
            || QUALITY_RANK[a.quality] - QUALITY_RANK[b.quality]);
        return out;
    }, [allImages, scope]);

    // Displayed render: the user's switcher choice (or the latest generation),
    // else the highest quality — the same pick the page thumbnail uses.
    const activeRecord = pickDisplayedMockupImage(records, selectedKey);

    // High-quality renders are paid; ask before spending (see handleGenerate).
    // `provider` is the explicit model the confirmed render will use.
    const [confirmHighQuality, setConfirmHighQuality] = useState<{ provider?: MockupImageProvider } | null>(null);

    // Hydrate this version's records from IDB on mount so reload / tab
    // switches surface every cached render. We seed once per versionId;
    // loadForVersion is itself idempotent. `hydrated` gates the forced-fallback
    // routing below so we don't briefly flash the manual upload sheet before
    // existing AI images load (e.g. the public demo).
    const [hydratedVersion, setHydratedVersion] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        void loadForVersion(versionId).finally(() => {
            if (!cancelled) setHydratedVersion(versionId);
        });
        return () => { cancelled = true; };
    }, [versionId, loadForVersion]);
    // Until this version's load settles, hydratedVersion still points at the
    // prior version, so a version switch correctly reads as not-yet-hydrated.
    const hydrated = hydratedVersion === versionId;

    // The models a default generation will try, in order (Settings primary,
    // then fallback), keeping only those with a key. `anyKey` is broader: one
    // keyed model is enough for the generator view and its per-model actions.
    const chain = getMockupImageProviderChain();
    const anyModel = chain.length > 0;
    const anyKey = hasAnyMockupImageKey();

    // Image source routing (Settings → Generation Models → Mockups):
    //  - 'user_uploaded'                → always the manual upload sheet
    //  - 'ai_generated' with no model   → fall back to the manual sheet (never
    //                                     silently fail) and explain why — BUT
    //                                     only when there are no AI images to
    //                                     show. Already-generated renders (e.g.
    //                                     the public demo project, cross-device
    //                                     sync, or images made in an earlier
    //                                     keyed session) must still render even
    //                                     without a key, otherwise the manual
    //                                     sheet — which reads a different store
    //                                     (screenInventoryImageStore) — hides
    //                                     them and the mockups appear to vanish.
    //  - 'ai_generated' with a model    → the AI generator below
    const mode = getMockupImageMode();
    const { forcedFallback } = resolveMockupRender(mode, anyKey);
    const hasAiImages = records.length > 0;
    // While a forced-fallback version is still hydrating we don't yet know if AI
    // images exist; render the loading state until we do rather than guessing.
    if (forcedFallback && !hydrated && !hasAiImages) {
        return (
            <div className="bg-white rounded-lg border border-neutral-200 p-8 flex items-center justify-center min-h-[420px]">
                <Loader2 size={24} className="text-neutral-300 animate-spin" />
            </div>
        );
    }
    const manual = mode === 'user_uploaded' || (forcedFallback && !hasAiImages);
    if (manual) {
        return (
            <MockupScreenUpload
                projectId={projectId}
                artifactId={artifactId}
                versionId={versionId}
                screen={screen}
                payload={payload}
                settings={settings}
                forcedFallback={forcedFallback}
            />
        );
    }

    /** `provider` set = that model only; omitted = the primary → fallback chain. */
    const runGenerate = (quality: MockupImageQuality, provider?: MockupImageProvider) => {
        clearError(versionId, screen.id);
        void generate({ projectId, artifactId, versionId, screen, payload, settings, quality, provider, onGenerated });
    };

    const handleGenerate = (quality: MockupImageQuality, provider?: MockupImageProvider) => {
        if (!capabilities.canGenerateArtifacts) return;
        // High quality is the expensive variant — confirm before spending. Paid
        // usage is billed to the user's own account via their key.
        if (quality === 'high') {
            setConfirmHighQuality({ provider });
            return;
        }
        runGenerate(quality, provider);
    };

    if (inFlight) {
        return (
            <div className="bg-white rounded-lg border border-neutral-200 p-8 flex flex-col items-center justify-center text-center min-h-[420px]">
                <Loader2 size={28} className="text-indigo-500 animate-spin mb-3" />
                <div className="text-sm font-medium text-neutral-800">
                    Generating {inFlight.quality}-quality image…
                </div>
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
                    onClick={() => cancel(versionId, screen.id)}
                    className="mt-4 inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 px-2 py-1 rounded-md hover:bg-neutral-50 transition"
                >
                    <X size={12} /> Cancel
                </button>
            </div>
        );
    }

    const confirmProvider = confirmHighQuality ? confirmHighQuality.provider ?? chain[0] ?? 'openai' : null;
    const confirmDialog = confirmHighQuality && confirmProvider && (
        <ConfirmDialog
            portal
            title={HIGH_QUALITY_CONFIRM[confirmProvider].title}
            cancelLabel="Cancel"
            confirmLabel="Generate"
            onCancel={() => setConfirmHighQuality(null)}
            onConfirm={() => {
                setConfirmHighQuality(null);
                runGenerate('high', confirmHighQuality.provider);
            }}
        >
            <p className="text-sm text-neutral-700 mt-1">{HIGH_QUALITY_CONFIRM[confirmProvider].body}</p>
        </ConfirmDialog>
    );

    if (activeRecord) {
        // Quality is now chosen in Settings, not per-card — the old "Generate
        // high quality" inline upgrade button was removed to keep the artifact
        // surface focused on a single primary action. Several renders can still
        // exist (another model, or another quality from older sessions), and the
        // switcher lets the user flip between them.
        const activeProvider = imageKeyProvider(activeRecord.key);
        const activeLabel = recordLabel(activeRecord);
        const activeAvailable = isMockupImageProviderAvailable(activeProvider);
        // Offer each other model until it has a render at this quality — after
        // that, it is one click away in the switcher.
        const tryProviders = MOCKUP_IMAGE_PROVIDERS.filter((p) => p !== activeProvider
            && !records.some((r) => imageKeyProvider(r.key) === p && r.quality === activeRecord.quality));
        return (
            <div className="overflow-hidden">
                <div className="relative bg-neutral-50 flex items-center justify-center">
                    <img
                        src={activeRecord.dataUrl}
                        alt={`AI image preview of ${screen.name} (${activeLabel}, ${activeRecord.quality} quality)`}
                        className="max-w-full max-h-[680px] object-contain"
                    />
                </div>
                {records.length > 1 && (
                    <div className="px-4 py-2 border-t border-neutral-100 flex items-center justify-end">
                        <div className="inline-flex flex-wrap items-center bg-neutral-100 rounded-md p-0.5 text-[11px] font-medium" role="group" aria-label="Switch render">
                            {records.map((r) => {
                                const selected = r.key === activeRecord.key;
                                return (
                                    <button
                                        key={r.key}
                                        type="button"
                                        onClick={() => select(versionId, screen.id, r.key)}
                                        aria-pressed={selected}
                                        className={`px-2 py-0.5 rounded transition ${
                                            selected
                                                ? 'bg-white text-neutral-900 shadow-sm'
                                                : 'text-neutral-500 hover:text-neutral-800'
                                        }`}
                                        title={`${recordLabel(r)} · ${QUALITY_LABEL[r.quality]}`}
                                    >
                                        {recordLabel(r)} · {QUALITY_SHORT[r.quality]}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className="px-4 py-2 border-t border-neutral-100 flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] text-neutral-500">
                        {activeLabel} · {QUALITY_LABEL[activeRecord.quality]}
                    </span>
                    {capabilities.canGenerateArtifacts && (
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            {tryProviders.map((p) => (
                                <ImageModelButton
                                    key={p}
                                    provider={p}
                                    verb="Try"
                                    note="keeps this render so you can compare"
                                    onClick={(chosen) => handleGenerate(activeRecord.quality, chosen)}
                                />
                            ))}
                            <button
                                type="button"
                                disabled={!activeAvailable}
                                onClick={() => handleGenerate(activeRecord.quality, activeProvider)}
                                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                title={activeAvailable
                                    ? `Re-run this screen with ${activeLabel} at the same quality (replaces this render)`
                                    : `Add a ${MOCKUP_IMAGE_MODELS[activeProvider].keyName} API key in Settings to enable`}
                            >
                                <RefreshCw size={12} />
                                Regenerate
                            </button>
                        </div>
                    )}
                </div>
                {error && (
                    <div className="px-4 pb-2 flex justify-end">
                        <div className="inline-flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 max-w-md">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            <span className="text-left break-words">{error}</span>
                        </div>
                    </div>
                )}
                {confirmDialog}
            </div>
        );
    }

    // Empty state.
    const prefs = getMockupImageModelPrefs();
    const lead = chain[0];
    const alternates = MOCKUP_IMAGE_PROVIDERS.filter((p) => p !== lead);
    return (
        <div className="bg-white rounded-lg border border-dashed border-neutral-300 p-8 flex flex-col items-center justify-center text-center min-h-[420px]">
            <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-3">
                <ImageIcon size={20} className="text-indigo-500" />
            </div>
            <div className="text-sm font-medium text-neutral-800">
                {error ? 'AI image preview unavailable' : 'No AI image yet'}
            </div>
            <div className="text-xs text-neutral-500 mt-1 max-w-sm">
                {error
                    ? 'Tap retry below to try again.'
                    : lead
                        ? `Generate a quick draft image of this screen with ${describeImageProviderChain(chain)}. Renders from each model are kept side by side so you can compare.`
                        : 'Generate a quick draft image of this screen. Renders from each model are kept side by side so you can compare.'}
            </div>
            {!error && lead !== prefs.primary && anyKey && (
                <div className="text-[11px] text-neutral-500 mt-1 max-w-sm">
                    Your primary model, {MOCKUP_IMAGE_MODELS[prefs.primary].label}, needs a{' '}
                    {MOCKUP_IMAGE_MODELS[prefs.primary].keyName} key —{' '}
                    {lead ? 'using your fallback.' : 'and no fallback is set, so pick a model below or adjust Settings.'}
                </div>
            )}
            {!error && lead && (
                <div className="text-[11px] text-amber-700 mt-2 max-w-sm">
                    Paid {MOCKUP_IMAGE_MODELS[lead].vendor} operation — billed to your account via your key (usually a few cents per image).
                </div>
            )}
            {error && (
                <div className="mt-3 inline-flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 max-w-md">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span className="text-left break-words">{error}</span>
                </div>
            )}
            {capabilities.canGenerateArtifacts && <button
                type="button"
                disabled={!anyModel}
                onClick={() => handleGenerate('low')}
                className="mt-4 inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
                title={lead
                    ? `Generate a low-quality draft with ${describeImageProviderChain(chain)}`
                    : anyKey
                        ? 'Your primary image model has no key and no fallback is set — pick a model below or adjust Settings'
                        : 'Add an OpenAI or Gemini API key in Settings to enable'}
            >
                <Sparkles size={14} />
                Generate AI image (low quality)
            </button>}
            {capabilities.canGenerateArtifacts && anyKey && alternates.length > 0 && (
                <div className="mt-2 flex items-center justify-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-neutral-400">or</span>
                    {alternates.map((p) => (
                        <ImageModelButton key={p} provider={p} verb="Use" onClick={(chosen) => handleGenerate('low', chosen)} />
                    ))}
                </div>
            )}
            {capabilities.canGenerateArtifacts && !anyKey && (
                <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <SettingsIcon size={11} />
                    Add an OpenAI or Gemini API key in Settings (gear icon) to enable.
                </div>
            )}
            {confirmDialog}
        </div>
    );
}
