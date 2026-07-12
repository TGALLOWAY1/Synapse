import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check, Upload, Image as ImageIcon, X, AlertTriangle, Loader2 } from 'lucide-react';
import type { DesignTokens, ScreenItem } from '../../types';
import { useScreenInventoryImageStore } from '../../store/screenInventoryImageStore';
import { buildExternalMockupPrompt } from '../../lib/services/screenInventoryImageService';
import { slugifyScreenName } from '../../lib/screenInventoryImageStore';
import { useProjectCapabilities } from '../../hooks/useProjectCapabilities';
import { copyToClipboard } from '../../lib/utils/copyToClipboard';

export interface ScreenImageGalleryContext {
    projectId: string;
    artifactId: string;
    artifactVersionId: string;
    productTitle: string;
    productSummary: string;
    /**
     * Active project design system tokens, when present. Threaded into the
     * copied external prompt so it matches the internal mockup's visual
     * language. Optional — legacy projects / pre-design-system states omit it.
     */
    designTokens?: DesignTokens;
    /** Platform hint for the rendered mockup (app → mobile, web → desktop). */
    platformHint?: 'mobile' | 'desktop' | 'responsive';
}

interface Props {
    screen: ScreenItem;
    context: ScreenImageGalleryContext;
    /**
     * Name used for image storage/lookup (slug derivation + upload bucket).
     * Defaults to `screen.name`. The Experience workspace passes the screen's
     * *stored generated* name here while `screen` carries the display-edited
     * one, so renaming a screen never orphans its uploaded images.
     */
    storageName?: string;
}

export function ScreenImageGallery({ screen, context, storageName }: Props) {
    const { projectId, artifactId, artifactVersionId, productTitle, productSummary, designTokens, platformHint } = context;
    const capabilities = useProjectCapabilities(projectId);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [copied, setCopied] = useState(false);
    const [lightboxKey, setLightboxKey] = useState<string | null>(null);

    // Subscribe to the raw images map (stable reference) and derive the
    // per-screen list via useMemo. Calling listForScreen() inside the selector
    // returns a fresh array on every render, which Zustand v5 treats as a
    // changed snapshot under Object.is — that loops setState and trips
    // React error #185 (max update depth).
    const allImages = useScreenInventoryImageStore(s => s.images);
    const storageScreenName = storageName ?? screen.name;
    const screenSlug = slugifyScreenName(storageScreenName);
    const versions = useMemo(() => {
        return Object.values(allImages)
            .filter(r => r.artifactVersionId === artifactVersionId && r.screenSlug === screenSlug)
            .sort((a, b) => a.versionNumber - b.versionNumber);
    }, [allImages, artifactVersionId, screenSlug]);
    const bucketKey = `${artifactVersionId}:${screenSlug}`;
    const isUploading = useScreenInventoryImageStore(s => Boolean(s.uploading[bucketKey]));
    const error = useScreenInventoryImageStore(s => s.errors[bucketKey]);
    const upload = useScreenInventoryImageStore(s => s.upload);
    const setPreferred = useScreenInventoryImageStore(s => s.setPreferred);
    const clearError = useScreenInventoryImageStore(s => s.clearError);

    const prompt = buildExternalMockupPrompt(screen, { productTitle, productSummary, designTokens, platformHint });
    const preferred = versions.find(v => v.isPreferred);
    const lightboxRecord = lightboxKey ? versions.find(v => v.key === lightboxKey) : null;

    const handleCopy = () => {
        void copyToClipboard(prompt).then((ok) => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleFile = (file: File | null | undefined) => {
        if (!file) return;
        if (error) clearError(artifactVersionId, storageScreenName);
        void upload({ projectId, artifactId, artifactVersionId, screenName: storageScreenName, file, prompt });
    };

    return (
        <div className="pt-2 mt-1 border-t border-neutral-100 space-y-2">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={handleCopy}
                    title="Copy an image-generation prompt for this screen"
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition"
                >
                    {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy image prompt'}
                </button>
                {capabilities.canEditArtifacts && <>
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 disabled:cursor-not-allowed transition"
                    >
                        {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                        {isUploading ? 'Uploading…' : versions.length === 0 ? 'Upload image' : 'Upload new'}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                            handleFile(e.target.files?.[0]);
                            // Reset so re-uploading the same filename still triggers onChange.
                            if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                    />
                </>}
            </div>

            {error && (
                <div className="flex items-center gap-1.5 text-[11px] text-red-600">
                    <AlertTriangle size={11} /> {error}
                </div>
            )}

            {versions.length > 0 && (
                <div className="space-y-1.5">
                    {preferred && (
                        <button
                            type="button"
                            onClick={() => setLightboxKey(preferred.key)}
                            className="block w-full"
                            title="Click to view full size"
                        >
                            <img
                                src={preferred.dataUrl}
                                alt={`${screen.name} (v${preferred.versionNumber})`}
                                className="w-full rounded border border-neutral-200 bg-neutral-50 object-cover max-h-48"
                            />
                        </button>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-neutral-400 mr-1">
                            <ImageIcon size={10} className="inline -mt-0.5 mr-0.5" />
                            history
                        </span>
                        {versions.map(v => {
                            const isActive = v.isPreferred;
                            return (
                                <button
                                    key={v.key}
                                    type="button"
                                    onClick={() => {
                                        if (isActive) setLightboxKey(v.key);
                                        else if (capabilities.canEditArtifacts) void setPreferred(artifactVersionId, screen.name, v.versionNumber);
                                        else setLightboxKey(v.key);
                                    }}
                                    title={isActive
                                        ? `v${v.versionNumber} (active) — click to enlarge`
                                        : capabilities.canEditArtifacts ? `Switch to v${v.versionNumber}` : `View v${v.versionNumber}`}
                                    className={`relative w-10 h-10 rounded overflow-hidden border transition ${
                                        isActive
                                            ? 'border-indigo-500 ring-2 ring-indigo-200'
                                            : 'border-neutral-200 hover:border-neutral-400'
                                    }`}
                                >
                                    <img src={v.dataUrl} alt={`v${v.versionNumber}`} className="w-full h-full object-cover" />
                                    <span className={`absolute bottom-0 left-0 right-0 text-[9px] font-bold text-center leading-tight ${
                                        isActive ? 'bg-indigo-600 text-white' : 'bg-black/50 text-white'
                                    }`}>
                                        v{v.versionNumber}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {lightboxRecord && (
                <Lightbox record={lightboxRecord} onClose={() => setLightboxKey(null)} />
            )}
        </div>
    );
}

function Lightbox({
    record,
    onClose,
}: {
    record: { dataUrl: string; screenName: string; versionNumber: number };
    onClose: () => void;
}) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
            onClick={onClose}
        >
            <div className="relative max-w-5xl max-h-full" onClick={(e) => e.stopPropagation()}>
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute -top-3 -right-3 bg-white rounded-full p-1.5 shadow-lg hover:bg-neutral-100"
                    aria-label="Close"
                >
                    <X size={16} />
                </button>
                <img
                    src={record.dataUrl}
                    alt={`${record.screenName} v${record.versionNumber}`}
                    className="max-w-full max-h-[85vh] rounded-lg shadow-2xl bg-white"
                />
                <div className="mt-2 text-center text-xs text-white/80">
                    {record.screenName} · v{record.versionNumber}
                </div>
            </div>
        </div>
    );
}
