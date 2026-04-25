/**
 * AI Image preview panel for a single MockupScreen, powered by OpenAI
 * gpt-image-2. Three render states:
 *   - empty:    no image yet → CTA "Generate AI image" (low quality)
 *   - loading:  in-flight → spinner + cancel button
 *   - ready:    image rendered + "Regenerate as high quality" if low/medium
 *
 * Persistence and orchestration live in src/store/mockupImageStore.ts; this
 * component only reads the cache and dispatches actions.
 */

import { useEffect } from 'react';
import { Sparkles, Loader2, Image as ImageIcon, AlertTriangle, RefreshCw, X, Settings as SettingsIcon } from 'lucide-react';
import type { MockupPayload, MockupScreen, MockupSettings } from '../../types';
import { useMockupImageStore } from '../../store/mockupImageStore';
import { buildImageKey } from '../../lib/mockupImageStore';
import { hasOpenAIKey } from '../../lib/openaiClient';

interface Props {
    projectId: string;
    artifactId: string;
    versionId: string;
    screen: MockupScreen;
    payload: MockupPayload;
    settings: MockupSettings;
}

export function MockupScreenImage({ projectId, artifactId, versionId, screen, payload, settings }: Props) {
    const key = buildImageKey(versionId, screen.id);
    const record = useMockupImageStore((s) => s.images[key]);
    const inFlight = useMockupImageStore((s) => s.inFlight[key]);
    const error = useMockupImageStore((s) => s.errors[key]);
    const generate = useMockupImageStore((s) => s.generate);
    const cancel = useMockupImageStore((s) => s.cancel);
    const clearError = useMockupImageStore((s) => s.clearError);
    const getRecord = useMockupImageStore((s) => s.getRecord);

    // Hydrate from IndexedDB on mount (and when the screen changes) so reload
    // / tab switches don't lose the cached image.
    useEffect(() => {
        if (!record) {
            void getRecord(versionId, screen.id);
        }
    }, [versionId, screen.id, record, getRecord]);

    const keyPresent = hasOpenAIKey();

    const handleGenerate = (quality: 'low' | 'high') => {
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

    if (record) {
        return (
            <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
                <div className="relative bg-neutral-50 flex items-center justify-center">
                    <img
                        src={record.dataUrl}
                        alt={`AI image preview of ${screen.name}`}
                        className="max-w-full max-h-[680px] object-contain"
                    />
                </div>
                <div className="px-4 py-3 border-t border-neutral-100 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 font-medium inline-flex items-center gap-1">
                        <Sparkles size={10} />
                        gpt-image-2 · {record.quality}
                    </span>
                    <span className="text-[11px] text-neutral-400">
                        {new Date(record.generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                        {record.quality !== 'high' && (
                            <button
                                type="button"
                                disabled={!keyPresent}
                                onClick={() => handleGenerate('high')}
                                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                title={keyPresent ? 'Regenerate at high quality (slower, ~30-60s)' : 'Add an OpenAI API key in Settings to enable'}
                            >
                                <RefreshCw size={12} />
                                Regenerate as high quality
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={!keyPresent}
                            onClick={() => handleGenerate('low')}
                            className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                            title="Discard and re-generate at low quality"
                        >
                            <RefreshCw size={12} />
                            Redo
                        </button>
                    </div>
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
            <div className="text-sm font-medium text-neutral-800">No AI image yet</div>
            <div className="text-xs text-neutral-500 mt-1 max-w-sm">
                Generate a quick draft image of this screen via OpenAI gpt-image-2.
                Use it as a sanity check when the HTML mockup feels off — you can
                regenerate at high quality once you like the draft.
            </div>
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
