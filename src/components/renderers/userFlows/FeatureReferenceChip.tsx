import type { Feature } from '../../../types';
import type { FeatureRef } from './types';

interface Props {
    refToken: FeatureRef;
    feature?: Feature;
    onSelect: (refToken: FeatureRef) => void;
    showName?: boolean;
}

/**
 * Inline chip that replaces dead `[f1]` text with a clickable badge.
 * If we have a matching `Feature` from the PRD we also surface its name.
 * Falls back to the raw id when feature metadata isn't available.
 */
export function FeatureReferenceChip({ refToken, feature, onSelect, showName = true }: Props) {
    const idLabel = feature?.id ?? refToken.id.toUpperCase();
    const name = feature?.name;
    return (
        <button
            type="button"
            onClick={() => onSelect(refToken)}
            className="inline-flex items-center gap-1 align-baseline px-1.5 py-0.5 rounded-md bg-fuchsia-50 hover:bg-fuchsia-100 border border-fuchsia-200 text-fuchsia-700 text-[11px] font-semibold leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-fuchsia-300"
            aria-label={`Open feature ${idLabel}${name ? ` (${name})` : ''}`}
            data-testid={`feature-ref-${refToken.id}`}
        >
            <span className="font-mono uppercase">{idLabel}</span>
            {showName && name && (
                <span className="hidden sm:inline font-medium normal-case text-fuchsia-800">
                    {name}
                </span>
            )}
        </button>
    );
}
