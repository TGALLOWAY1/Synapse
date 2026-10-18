// An explicit "generate with this image model" action for the mockup pages.
// Unlike the main Generate action (which routes through the Settings primary →
// fallback chain), this runs on the named model only. A model without a key
// renders disabled with a "needs a key" hint, so the second model stays
// discoverable instead of silently missing.

import { Sparkles } from 'lucide-react';
import type { MockupImageProvider } from '../../types';
import { MOCKUP_IMAGE_MODELS } from '../../lib/mockupImageModels';
import { isMockupImageProviderAvailable } from '../../lib/artifactModelSettings';

interface Props {
    provider: MockupImageProvider;
    /** Leading verb, e.g. "Try" or "Use". */
    verb: string;
    onClick: (provider: MockupImageProvider) => void;
    /** Extra reason to disable (e.g. read-only project, upload mode). */
    disabled?: boolean;
    /** Tooltip suffix describing what the click does to existing renders. */
    note?: string;
}

export function ImageModelButton({ provider, verb, onClick, disabled = false, note }: Props) {
    const info = MOCKUP_IMAGE_MODELS[provider];
    const available = isMockupImageProviderAvailable(provider);
    const title = available
        ? `Generate with ${info.vendor} ${info.label}${note ? ` — ${note}` : ''}`
        : `Add a ${info.keyName} API key in Settings to use ${info.label}`;
    return (
        <button
            type="button"
            disabled={disabled || !available}
            onClick={() => onClick(provider)}
            title={title}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
            <Sparkles size={12} />
            {verb} {info.label}
        </button>
    );
}
