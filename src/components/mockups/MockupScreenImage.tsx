/**
 * AI Image preview panel for a single MockupScreen, powered by OpenAI
 * gpt-image-2. Render states:
 *   - empty:    no image yet → CTA "Generate AI image" (low quality)
 *   - loading:  in-flight → spinner + cancel button
 *   - ready:    image rendered + quality switcher (when multiple variants
 *               exist) + "Regenerate as high quality" if no high yet
 *
 * Persistence and orchestration live in src/store/mockupImageStore.ts; this
 * component only reads the cache and dispatches actions. Each quality is
 * stored under its own IDB key so generating a high-quality render does not
 * discard the low-quality original — the user can flip back to compare.
 */

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Loader2, Image as ImageIcon, AlertTriangle, RefreshCw, X, Settings as SettingsIcon } from 'lucide-react';
import type { MockupImageQuality, MockupImageRecord, MockupPayload, MockupScreen, MockupSettings } from '../../types';
import { useMockupImageStore } from '../../store/mockupImageStore';
import { buildScreenScopeKey } from '../../lib/mockupImageStore';
import { hasOpenAIKey } from '../../lib/openaiClient';
import { getMockupImageMode, resolveMockupRender } from '../../lib/artifactModelSettings';
import { MockupScreenUpload } from './MockupScreenUpload';

interface Props {
    projectId: string;
    artifactId: string;
    versionId: string;
    screen: MockupScreen;
    payload: MockupPayload;
    settings: MockupSettings;
}

const QUALITY_RANK: Record<MockupImageQuality, number> = { low: 0, medium: 1, high: 2 };

const QUALITY_LABEL: Record<MockupImageQuality, string> = {
    low: 'Low quality',
    medium: 'Medium quality',
    high: 'High quality',
};

const pickInitialQuality = (records: MockupImageRecord[]): MockupImageQuality | null => {
    if (records.length === 0) return null;
    return records.reduce<MockupImageRecord>((best, r) =>
        QUALITY_RANK[r.quality] > QUALITY_RANK[best.quality] ? r : best,
        records[0],
    ).quality;
};

export function MockupScreenImage({ projectId, artifactId, versionId, screen, payload, settings }: Props) {
    const scope = buildScreenScopeKey(versionId, screen.id);
    // Subscribe to the whole image map; filtered records are derived below.
    // The previous implementation subscribed only to a single keyed entry,
    // which broke once we started storing per-quality variants.
    const allImages = useMockupImageStore((s) => s.images);
    const inFlight = useMockupImageStore((s) => s.inFlight[scope]);
    const error = useMockupImageStore((s) => s.errors[scope]);
    const generate = useMockupImageStore((s) => s.generate);
    const cancel = useMockupImageStore((s) => s.cancel);
    const clearError = useMockupImageStore((s) => s.clearError);
    const loadForVersion = useMockupImageStore((s) => s.loadForVersion);

    const records = useMemo(() => {
        const out: MockupImageRecord[] = [];
        for (const k of Object.keys(allImages)) {
            if (k.startsWith(scope)) out.push(allImages[k]);
        }
        out.sort((a, b) => QUALITY_RANK[a.quality] - QUALITY_RANK[b.quality]);
        return out;
    }, [allImages, scope]);

    // Active quality: defaults to the highest available; user can flip back
    // to lower qualities via the quality switcher.
    const [activeQuality, setActiveQuality] = useState<MockupImageQuality | null>(null);

    const fallbackQuality = useMemo(() => pickInitialQuality(records), [records]);
    const effectiveQuality: MockupImageQuality | null =
        activeQuality && records.some((r) => r.quality === activeQuality)
            ? activeQuality
            : fallbackQuality;
    const activeRecord = effectiveQuality
        ? records.find((r) => r.quality === effectiveQuality)
        : undefined;

    // Hydrate this version's records from IDB on mount so reload / tab
    // switches surface every cached quality variant. We seed once per
    // versionId; loadForVersion is itself idempotent. `hydrated` gates the
    // forced-fallback routing below so we don't briefly flash the manual
    // upload sheet before existing AI images load (e.g. the public demo).
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

    const keyPresent = hasOpenAIKey();

    // Image source routing (Settings → Artifact Generation Models → Mockups):
    //  - 'user_uploaded'             → always the manual upload sheet
    //  - 'gpt_image' without a key   → fall back to the manual sheet (never
    //                                  silently fail) and explain why — BUT only
    //                                  when there are no AI images to show.
    //                                  Already-generated renders (e.g. the public
    //                                  demo project, cross-device sync, or images
    //                                  made in an earlier keyed session) must
    //                                  still render even without a key, otherwise
    //                                  the manual sheet — which reads a different
    //                                  store (screenInventoryImageStore) — hides
    //                                  them and the mockups appear to vanish.
    //  - 'gpt_image' with a key      → the OpenAI generator below
    const mode = getMockupImageMode();
    const { forcedFallback } = resolveMockupRender(mode, keyPresent);
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

    const handleGenerate = (quality: MockupImageQuality) => {
        // High quality is the expensive variant — confirm before spending. Paid
        // OpenAI usage is billed to the user's own account via their key.
        if (quality === 'high' && typeof window !== 'undefined') {
            const ok = window.confirm(
                'Generate a HIGH-quality image with OpenAI gpt-image-2?\n\n'
                + 'This is a paid OpenAI operation billed to your own account '
                + '(typically a few cents per image).',
            );
            if (!ok) return;
        }
        clearError(versionId, screen.id);
        void generate({ projectId, artifactId, versionId, screen, payload, settings, quality });
    };

    if (inFlight) {
        return (
            <div className="bg-white rounded-lg border border-neutral-200 p-8 flex flex-col items-center justify-center text-center min-h-[420px]">
                <Loader2 size={28} className="text-indigo-500 animate-spin mb-3" />
                <div className="text-sm font-medium text-neutral-800">
                    Generating {inFlight.quality}-quality image…
                </div>
                <div className="text-xs text-neutral-500 mt-1">
                    OpenAI gpt-image-2 · {inFlight.quality === 'high' ? 'this may take 30-60s' : 'usually 5-15s'}
                </div>
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

    if (activeRecord) {
        // Quality is now chosen in Settings, not per-card — the old "Generate
        // high quality" inline upgrade button was removed to keep the artifact
        // surface focused on a single primary action. Multiple quality
        // variants can still exist (e.g. from older sessions), and we keep the
        // small toggle so the user can flip between them.
        return (
            <div className="overflow-hidden">
                <div className="relative bg-neutral-50 flex items-center justify-center">
                    <img
                        src={activeRecord.dataUrl}
                        alt={`AI image preview of ${screen.name} (${activeRecord.quality} quality)`}
                        className="max-w-full max-h-[680px] object-contain"
                    />
                </div>
                {records.length > 1 && (
                    <div className="px-4 py-2 border-t border-neutral-100 flex items-center justify-end">
                        <div className="inline-flex items-center bg-neutral-100 rounded-md p-0.5 text-[11px] font-medium" role="group" aria-label="Switch quality">
                            {records.map((r) => {
                                const selected = r.quality === effectiveQuality;
                                return (
                                    <button
                                        key={r.quality}
                                        type="button"
                                        onClick={() => setActiveQuality(r.quality)}
                                        className={`px-2 py-0.5 rounded transition ${
                                            selected
                                                ? 'bg-white text-neutral-900 shadow-sm'
                                                : 'text-neutral-500 hover:text-neutral-800'
                                        }`}
                                        title={QUALITY_LABEL[r.quality]}
                                    >
                                        {QUALITY_LABEL[r.quality]}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className="px-4 py-2 border-t border-neutral-100 flex items-center justify-end">
                    <button
                        type="button"
                        disabled={!keyPresent}
                        onClick={() => handleGenerate(activeRecord.quality)}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        title={keyPresent ? 'Re-run this screen at the same quality (replaces this render)' : 'Add an OpenAI API key in Settings to enable'}
                    >
                        <RefreshCw size={12} />
                        Regenerate
                    </button>
                </div>
            </div>
        );
    }

    // Empty state.
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
                    : 'Generate a quick draft image of this screen via OpenAI gpt-image-2. You can regenerate at high quality once you like the draft — both renders stay accessible.'}
            </div>
            {!error && keyPresent && (
                <div className="text-[11px] text-amber-700 mt-2 max-w-sm">
                    Paid OpenAI operation — billed to your account via your key (usually a few cents per image).
                </div>
            )}
            {error && (
                <div className="mt-3 inline-flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 max-w-md">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span className="text-left break-words">{error}</span>
                </div>
            )}
            <button
                type="button"
                disabled={!keyPresent}
                onClick={() => handleGenerate('low')}
                className="mt-4 inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
                title={keyPresent ? 'Generate low-quality draft (5-15s)' : 'Add an OpenAI API key in Settings to enable'}
            >
                <Sparkles size={14} />
                Generate AI image (low quality)
            </button>
            {!keyPresent && (
                <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <SettingsIcon size={11} />
                    Add an OpenAI API key in Settings (gear icon) to enable.
                </div>
            )}
        </div>
    );
}
