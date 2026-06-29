/**
 * Modal that reveals the prompt used to generate (or accompany the upload of)
 * a single mockup image. Lets the user inspect and copy the exact text the
 * image was created from — useful for auditing, refining the project's spec,
 * or re-running the same prompt elsewhere.
 *
 * Stateless on its own — the host (PageImageFooter) controls open state and
 * supplies the prompt and a short label (screen name).
 */

import { useEffect, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { copyToClipboard } from '../../lib/utils/copyToClipboard';

interface Props {
    open: boolean;
    onClose: () => void;
    screenName: string;
    prompt: string;
}

export function MockupPromptDialog({ open, onClose, screenName, prompt }: Props) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    const handleCopy = async () => {
        const ok = await copyToClipboard(prompt);
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center items-center overflow-y-auto p-4 md:p-8"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mockup-prompt-dialog-title"
        >
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-neutral-200 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2
                            id="mockup-prompt-dialog-title"
                            className="text-base font-semibold text-neutral-900 truncate"
                        >
                            Image prompt — {screenName}
                        </h2>
                        <p className="text-xs text-neutral-500 mt-0.5">
                            The exact text used to create this mockup image.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 -m-1 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-full transition shrink-0"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="px-5 py-4 overflow-y-auto">
                    {prompt ? (
                        <pre className="text-[12px] leading-relaxed text-neutral-800 bg-neutral-50 border border-neutral-200 rounded-md p-3 whitespace-pre-wrap break-words">
                            {prompt}
                        </pre>
                    ) : (
                        <div className="text-sm text-neutral-500 italic">
                            No prompt was recorded for this image.
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/60 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-xs px-3 py-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 transition"
                    >
                        Close
                    </button>
                    <button
                        type="button"
                        onClick={handleCopy}
                        disabled={!prompt}
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
                    >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? 'Copied' : 'Copy prompt'}
                    </button>
                </div>
            </div>
        </div>
    );
}
