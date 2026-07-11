// Canonical freshness badge (SYN-005) — the drop-in successor to StalenessBadge,
// driven by the canonical engine's DependencyNodeStatus instead of the legacy
// 3-value StalenessState.
//
// Like StalenessBadge, it renders NOTHING when the artifact isn't stale (up to
// date / source), and deliberately nothing for generating / missing / error /
// no-status — those states are owned by the surrounding surface (status dots,
// generation panels), not this small inline badge. So it only ever paints the
// two "you should consider regenerating" statuses.

import type { DependencyNodeStatus } from '../lib/artifactDependencyGraph';
import { DEPENDENCY_STATUS_LABELS } from '../lib/artifactFreshness';

interface FreshnessBadgeProps {
    status?: DependencyNodeStatus;
    /** Optional "what changed" tooltip shown on hover (native title). */
    detail?: string;
}

export function FreshnessBadge({ status, detail }: FreshnessBadgeProps) {
    // Narrow to the two stale statuses (mirrors isStaleStatus) so TS knows the
    // label lookup is safe below.
    if (status !== 'needs_update' && status !== 'update_recommended') return null;

    // Amber throughout (mirrors StalenessBadge). needs_update takes the stronger
    // amber tone (matching the canonical graph's own needs_update pill);
    // update_recommended matches StalenessBadge's possibly_outdated tone.
    const className = status === 'needs_update'
        ? 'bg-amber-50 text-amber-800 border-amber-300'
        : 'bg-amber-50 text-amber-700 border-amber-200';

    return (
        <span
            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${className} ${detail ? 'cursor-help' : ''}`}
            title={detail}
        >
            {DEPENDENCY_STATUS_LABELS[status]}
        </span>
    );
}
