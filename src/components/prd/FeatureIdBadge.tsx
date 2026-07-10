import { isDisplayableFeatureId } from '../../lib/derive/prdDecisions';

/**
 * Non-interactive feature-id badge (F1, F2, …). Mirrors the visual language
 * of the clickable FeatureReferenceChip used in User Flows so feature
 * references read the same everywhere in the app. Renders nothing for
 * uuid-shaped ids (hand-added features).
 */
export function FeatureIdBadge({ id, className }: { id?: string; className?: string }) {
    if (!isDisplayableFeatureId(id)) return null;
    return (
        <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-md bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 text-[11px] font-mono font-semibold uppercase leading-none shrink-0 ${className ?? ''}`}
        >
            {id}
        </span>
    );
}
