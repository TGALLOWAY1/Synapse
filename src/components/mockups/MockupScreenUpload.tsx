/**
 * Manual mockup mode for a single MockupScreen. Shown instead of the OpenAI
 * gpt-image-2 generator when the user has chosen "User Uploaded" in Settings,
 * or when "GPT Image 2" is selected but no OpenAI key is configured (so we
 * never silently fail). Renders a generated, copyable prompt describing the
 * screen (goal, layout, visual style, expected upload format) and lets the user
 * upload their own image against it.
 *
 * Storage reuses the proven per-screen upload store
 * (`useScreenInventoryImageStore` + IndexedDB), keyed by the mockup version id,
 * so uploads are versioned, preferred-tracked, and quota-safe (IDB, not
 * localStorage).
 */

import { useEffect, useState } from 'react';
import { Upload, Copy, Check, Loader2, AlertTriangle, ImageUp, Info } from 'lucide-react';
import type { MockupPayload, MockupScreen, MockupSettings } from '../../types';
import { useScreenInventoryImageStore } from '../../store/screenInventoryImageStore';
import { slugifyScreenName } from '../../lib/screenInventoryImageStore';
import { buildScreenImagePrompt, pickImageSize } from '../../lib/services/mockupImageService';
import { copyToClipboard } from '../../lib/utils/copyToClipboard';
import { useProjectCapabilities } from '../../hooks/useProjectCapabilities';

interface Props {
    projectId: string;
    artifactId: string;
    versionId: string;
    screen: MockupScreen;
    payload: MockupPayload;
    settings: MockupSettings;
    /** True when this is a forced fallback (GPT Image 2 chosen but no key). */
    forcedFallback?: boolean;
}

// Which screen prompts were copied this session, keyed by version:screen
// bucket. Module-level so the checklist's "copied" step survives switching
// views/tabs within the app (deliberately not persisted project data).
const copiedPromptBuckets = new Set<string>();

const formatHint = (settings: MockupSettings): string => {
    const size = pickImageSize(settings.platform);
    const orientation =
        settings.platform === 'mobile' ? 'portrait' :
        settings.platform === 'desktop' ? 'landscape' : 'square';
    return `Upload PNG or JPG, ideally ~${size}px (${orientation}) to match this ${settings.platform} screen.`;
};

export function MockupScreenUpload({
    projectId,
    artifactId,
    versionId,
    screen,
    payload,
    settings,
    forcedFallback,
}: Props) {
    const capabilities = useProjectCapabilities(projectId);
    const loadForArtifactVersion = useScreenInventoryImageStore((s) => s.loadForArtifactVersion);
    const upload = useScreenInventoryImageStore((s) => s.upload);
    const clearError = useScreenInventoryImageStore((s) => s.clearError);
    const allImages = useScreenInventoryImageStore((s) => s.images);
    const uploading = useScreenInventoryImageStore((s) => s.uploading);
    const errors = useScreenInventoryImageStore((s) => s.errors);
    const peekPreferred = useScreenInventoryImageStore((s) => s.peekPreferred);

    const [copied, setCopied] = useState(false);
    const [copiedOnce, setCopiedOnce] = useState(false);

    useEffect(() => {
        void loadForArtifactVersion(versionId);
    }, [versionId, loadForArtifactVersion]);

    // `allImages` / `uploading` / `errors` are subscribed above so this
    // re-derives reactively as uploads land.
    void allImages;
    const preferred = peekPreferred(versionId, screen.name);

    const promptText = `${buildScreenImagePrompt(payload, screen, settings)}\n\n${formatHint(settings)}`;
    // Bucket key matches the store's internal `${artifactVersionId}:${slug}`.
    const bucket = `${versionId}:${slugifyScreenName(screen.name)}`;
    const isUploading = !!uploading[bucket];
    const error = errors[bucket];

    useEffect(() => {
        setCopiedOnce(copiedPromptBuckets.has(bucket));
    }, [bucket]);

    const handleCopy = async () => {
        const ok = await copyToClipboard(promptText);
        if (ok) {
            copiedPromptBuckets.add(bucket);
            setCopiedOnce(true);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    };

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allow re-selecting the same file
        if (!file) return;
        clearError(versionId, screen.name);
        void upload({
            projectId,
            artifactId,
            artifactVersionId: versionId,
            screenName: screen.name,
            file,
            prompt: promptText,
        });
    };

    return (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
            {preferred ? (
                <>
                    <div className="relative bg-neutral-50 flex items-center justify-center">
                        <img
                            src={preferred.dataUrl}
                            alt={`Uploaded mockup of ${screen.name}`}
                            className="max-w-full max-h-[680px] object-contain"
                        />
                    </div>
                    <div className="px-4 py-3 border-t border-neutral-100 flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 font-medium inline-flex items-center gap-1">
                            <ImageUp size={10} />
                            Uploaded
                        </span>
                        <span className="text-[11px] text-neutral-400">
                            {new Date(preferred.generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {capabilities.canEditArtifacts && <label className="ml-auto inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 cursor-pointer transition">
                            <Upload size={12} />
                            Replace
                            <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
                        </label>}
                    </div>
                </>
            ) : capabilities.isReadOnly ? (
                // Showcase surfaces never show configuration homework — a quiet
                // placeholder instead of key warnings and prompt plumbing.
                <div className="p-6 flex flex-col items-center justify-center text-center gap-2 min-h-[160px]">
                    <ImageUp size={20} className="text-neutral-300" aria-hidden />
                    <p className="text-sm font-medium text-neutral-600">No mockup image for this screen yet</p>
                    <p className="text-xs text-muted max-w-xs">
                        In your own project, Synapse generates this image automatically or walks you
                        through uploading one.
                    </p>
                </div>
            ) : (
                <div className="p-5">
                    {forcedFallback && capabilities.showsProviderSetupWarnings && (
                        <div className="mb-4 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                            <Info size={13} className="mt-0.5 shrink-0" />
                            <span>
                                Automatic generation is off — <strong>GPT Image 2</strong> is selected but no
                                OpenAI key is configured. Add one in Settings, or follow the steps below.
                            </span>
                        </div>
                    )}

                    <ol className="space-y-3">
                        <li className="flex items-start gap-3">
                            <span
                                aria-hidden
                                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                                    copiedOnce ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700'
                                }`}
                            >
                                {copiedOnce ? <Check size={12} /> : '1'}
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm text-neutral-700">
                                        <span className="font-medium">Copy the mockup prompt</span>
                                        {copiedOnce && <span className="ml-2 text-[11px] text-emerald-600 font-medium">Copied</span>}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md text-brand-600 hover:bg-brand-50 transition"
                                    >
                                        {copied ? <Check size={12} /> : <Copy size={12} />}
                                        {copied ? 'Copied' : copiedOnce ? 'Copy again' : 'Copy prompt'}
                                    </button>
                                </div>
                                <details className="mt-1.5">
                                    <summary className="cursor-pointer text-[11px] text-muted hover:text-neutral-700 transition">
                                        View full prompt — {screen.name}
                                    </summary>
                                    <pre className="mt-2 text-[11px] leading-relaxed text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-md p-3 whitespace-pre-wrap break-words max-h-56 overflow-auto overscroll-contain">
                                        {promptText}
                                    </pre>
                                </details>
                            </div>
                        </li>
                        <li className="flex items-start gap-3">
                            <span aria-hidden className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 text-[11px] font-bold">2</span>
                            <p className="text-sm text-neutral-700 pt-0.5">
                                <span className="font-medium">Generate the image</span>
                                <span className="text-muted"> in your image tool (ChatGPT, Midjourney, …)</span>
                            </p>
                        </li>
                        <li className="flex items-start gap-3">
                            <span aria-hidden className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 text-[11px] font-bold">3</span>
                            <div className="min-w-0 flex-1 pt-0.5">
                                <p className="text-sm text-neutral-700 font-medium">Upload the result</p>
                                <p className="mt-0.5 text-[11px] text-muted">{formatHint(settings)}</p>
                                {error && (
                                    <div className="mt-2 inline-flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                                        <span className="text-left break-words">{error}</span>
                                    </div>
                                )}
                                {capabilities.canEditArtifacts && (
                                    <label className={`mt-2.5 inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md font-medium cursor-pointer transition ${
                                        isUploading
                                            ? 'bg-neutral-200 text-neutral-500 cursor-wait'
                                            : 'bg-brand-600 text-white hover:bg-brand-700'
                                    }`}>
                                        {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                        {isUploading ? 'Uploading…' : 'Upload mockup image'}
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            disabled={isUploading}
                                            onChange={handleFile}
                                        />
                                    </label>
                                )}
                            </div>
                        </li>
                    </ol>
                </div>
            )}
        </div>
    );
}
