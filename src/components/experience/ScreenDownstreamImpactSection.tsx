// Phase 4B: the per-screen "Downstream impact" section, shown in the Screen
// Detail view below the review panel. When an accepted screen changed after
// sign-off (or a P0 screen carries blockers, or its mockups read stale), it
// names the downstream artifacts worth re-checking — grouped by artifact, with
// calm severity language. Purely presentational over the derived
// ScreenDownstreamImpact (src/lib/screenDownstreamImpact.ts). Never blocks use.

import { AlertOctagon, CheckCircle2, HelpCircle, Info, ShieldQuestion } from 'lucide-react';
import type {
    DownstreamArtifactKind, DownstreamImpactSeverity, ScreenDownstreamImpact,
} from '../../lib/screenDownstreamImpact';

const ARTIFACT_LABELS: Record<DownstreamArtifactKind, string> = {
    mockups: 'Mockups',
    data_model: 'Data Model',
    implementation_plan: 'Implementation Plan',
    prompt_pack: 'Developer Prompts',
    user_flows: 'User Flows',
    design_system: 'Design System',
    export: 'Export',
};

const SEVERITY_META: Record<DownstreamImpactSeverity, { label: string; dot: string; text: string }> = {
    blocking: { label: 'Blocking', dot: 'bg-red-500', text: 'text-red-700' },
    review: { label: 'Review recommended', dot: 'bg-amber-500', text: 'text-amber-700' },
    info: { label: 'For your information', dot: 'bg-neutral-400', text: 'text-neutral-600' },
};

interface Props {
    impact: ScreenDownstreamImpact;
}

export function ScreenDownstreamImpactSection({ impact }: Props) {
    const { impactedArtifacts, summary } = impact;
    const signedOff = impact.userStatus === 'accepted' || impact.userStatus === 'implementation_ready';

    // No impacts: distinguish "cannot confirm for a legacy review" from a clean
    // "no impact detected".
    if (impactedArtifacts.length === 0) {
        if (signedOff && impact.reviewFreshness === 'unknown') {
            return (
                <Shell tone="neutral">
                    <div className="flex items-start gap-2">
                        <HelpCircle size={14} className="text-neutral-400 mt-0.5 shrink-0" aria-hidden />
                        <p className="text-xs text-neutral-600">
                            Downstream impact cannot be fully confirmed for this older review.
                            Review before implementation if this screen is critical.
                        </p>
                    </div>
                </Shell>
            );
        }
        return (
            <Shell tone="good">
                <div className="flex items-start gap-2">
                    <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" aria-hidden />
                    <p className="text-xs text-neutral-600">No downstream impact detected for this screen.</p>
                </div>
            </Shell>
        );
    }

    const lead = summary.hasBlockingImpact
        ? 'This screen affects downstream artifacts. Resolve the blockers before building.'
        : 'This screen changed or needs review. The artifacts below may be worth re-checking before implementation.';

    return (
        <Shell tone={summary.hasBlockingImpact ? 'warn' : 'review'}>
            <p className="text-xs text-neutral-600 mb-2">{lead}</p>
            <ul className="space-y-2">
                {impactedArtifacts.map(a => {
                    const meta = SEVERITY_META[a.severity];
                    const Icon = a.severity === 'blocking'
                        ? AlertOctagon
                        : a.severity === 'review' ? ShieldQuestion : Info;
                    return (
                        <li key={a.kind} className="flex items-start gap-2.5">
                            <Icon size={14} className={`${meta.text} mt-0.5 shrink-0`} aria-hidden />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-neutral-800">{ARTIFACT_LABELS[a.kind]}</span>
                                    <span className={`inline-flex items-center gap-1 text-[9px] uppercase tracking-wide ${meta.text}`}>
                                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                                        {meta.label}
                                    </span>
                                </div>
                                <p className="text-[11px] text-neutral-600 mt-0.5">{a.description}</p>
                                {a.recommendedAction && (
                                    <p className="text-[11px] text-neutral-500 mt-0.5">
                                        <span className="text-neutral-400">Suggested: </span>{a.recommendedAction}
                                    </p>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </Shell>
    );
}

function Shell({ children, tone }: { children: React.ReactNode; tone: 'good' | 'neutral' | 'review' | 'warn' }) {
    const border = tone === 'warn'
        ? 'border-amber-200 bg-amber-50/50'
        : tone === 'review'
            ? 'border-amber-200 bg-white'
            : 'border-neutral-200 bg-white';
    return (
        <div className={`rounded-xl border p-4 shadow-sm ${border}`}>
            <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    Downstream impact
                </span>
            </div>
            {children}
        </div>
    );
}
