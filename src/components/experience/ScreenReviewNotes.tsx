// "Review Notes" — the calm, collapsed, action-oriented replacement for the old
// "Readiness Issues" panel AND the standalone "Risks & Edge Cases" section.
//
// Guiding rule (item 2 of the Screens simplification): never raise a problem
// without giving the user a way to resolve it. Every row has an obvious next
// action:
//   - a generic review note → Edit (open the screen editor) or Navigate (jump to
//     the Flow / Mockups tab), plus "Mark addressed" to dismiss it;
//   - a risk → a "How should this be handled?" resolution box → Mark resolved,
//     which persists structured product-owner input the downstream artifacts can
//     consume.
//
// Collapsed by default behind a one-line banner ("N items may benefit from
// review"), so the screen content — not the warnings — is what the user sees
// first. Presentational only; all mutations flow back through the callbacks and
// persist on the screenEdits `review` overlay.

import { useState } from 'react';
import {
    AlertTriangle, Check, ChevronDown, ChevronUp, MessageSquare, Pencil, ArrowRight,
} from 'lucide-react';
import type { ScreenRiskDetail } from '../../types';
import type {
    ScreenReviewIssue, ScreenReviewIssueCategory, ScreenReviewIssueSeverity,
} from '../../lib/screenReviewWorkflow';
import type { ScreenDetailTab } from './ScreenDetailTabs';

/** Stable key for a risk (so a resolution survives re-renders / re-order). */
function riskKey(description: string): string {
    return description.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'risk';
}

const SEVERITY_DOT: Record<ScreenReviewIssueSeverity, string> = {
    blocking: 'bg-red-500',
    review: 'bg-amber-500',
    info: 'bg-neutral-300',
};

/** Where an issue's "obvious next action" should take the user. */
function issueAction(category: ScreenReviewIssueCategory): { kind: 'edit' } | { kind: 'nav'; tab: ScreenDetailTab } {
    switch (category) {
        case 'navigation':
        case 'flow':
            return { kind: 'nav', tab: 'flow' };
        case 'mockups':
        case 'mockup_freshness':
        case 'mobile':
            return { kind: 'nav', tab: 'mockups' };
        default:
            return { kind: 'edit' };
    }
}

interface Props {
    issues: ScreenReviewIssue[];
    risks: ScreenRiskDetail[];
    /** Issue ids the user already marked addressed. */
    dismissed: ReadonlySet<string>;
    /** Persisted risk resolutions, keyed by riskKey(description). */
    riskResolutions: Record<string, string>;
    onDismissIssue: (id: string, dismissed: boolean) => void;
    onResolveRisk: (key: string, resolution: string | null) => void;
    onNavigate: (tab: ScreenDetailTab) => void;
    onEdit: () => void;
    readOnly?: boolean;
}

export function ScreenReviewNotes({
    issues, risks, dismissed, riskResolutions,
    onDismissIssue, onResolveRisk, onNavigate, onEdit, readOnly,
}: Props) {
    // Risk-category issues are rendered as first-class risk rows below, so drop
    // the summary issue to avoid saying the same thing twice. Handoff-category
    // issues are dropped entirely: developer handoff moved to the Implementation
    // Plan artifact, so a "thin handoff" note is not resolvable from Screens and
    // would only route to a dead-end editor. (The lib still emits it for the
    // list-level handoff rollups; it just isn't a Screens review note.)
    const noteIssues = issues.filter(i => i.category !== 'risks' && i.category !== 'handoff');
    const visibleIssues = noteIssues.filter(i => !dismissed.has(i.id));
    const addressedCount = noteIssues.length - visibleIssues.length;

    const openRisks = risks.filter(r => !riskResolutions[riskKey(r.description)]?.trim());
    const resolvedRisks = risks.filter(r => riskResolutions[riskKey(r.description)]?.trim());

    const itemCount = visibleIssues.length + openRisks.length;
    const [open, setOpen] = useState(false);
    const [showAddressed, setShowAddressed] = useState(false);

    // Nothing to review → a quiet, positive line rather than an empty panel.
    if (itemCount === 0 && addressedCount === 0 && resolvedRisks.length === 0) {
        return (
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                <Check size={12} className="text-emerald-500" aria-hidden />
                Nothing flagged for review on this screen.
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-neutral-50 transition"
            >
                {/* Stacks left-aligned on narrow screens instead of wrapping into
                    a centered jumble; one row on sm+. */}
                <span className="flex flex-col items-start gap-0.5 min-w-0 text-left sm:flex-row sm:items-center sm:gap-2">
                    <span className="flex items-center gap-2">
                        <MessageSquare size={14} className="text-neutral-400 shrink-0" aria-hidden />
                        <span className="text-sm font-medium text-neutral-800">Review notes</span>
                    </span>
                    {itemCount > 0 ? (
                        <span className="text-[11px] text-neutral-500">
                            {itemCount} {itemCount === 1 ? 'item' : 'items'} may benefit from review
                        </span>
                    ) : (
                        <span className="text-[11px] text-emerald-600">All notes addressed</span>
                    )}
                </span>
                {open
                    ? <ChevronUp size={15} className="text-neutral-400 shrink-0" />
                    : <ChevronDown size={15} className="text-neutral-400 shrink-0" />}
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-4 border-t border-neutral-100 pt-3">
                    {/* Generic review notes */}
                    {visibleIssues.length > 0 && (
                        <ul className="space-y-2.5">
                            {visibleIssues.map(issue => {
                                const action = issueAction(issue.category);
                                return (
                                    <li key={issue.id} className="flex items-start gap-2.5">
                                        <span className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${SEVERITY_DOT[issue.severity]}`} aria-hidden />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-medium text-neutral-800">{issue.title}</p>
                                            <p className="text-[11px] text-neutral-600 mt-0.5">{issue.description}</p>
                                            {issue.recommendedAction && (
                                                <p className="text-[11px] text-neutral-500 mt-0.5">{issue.recommendedAction}</p>
                                            )}
                                            {!readOnly && (
                                                <div className="mt-1.5 flex items-center gap-3">
                                                    {action.kind === 'edit' ? (
                                                        <button
                                                            type="button"
                                                            onClick={onEdit}
                                                            className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                                                        >
                                                            <Pencil size={11} /> Edit
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => onNavigate(action.tab)}
                                                            className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                                                        >
                                                            Go to {action.tab === 'flow' ? 'Flow' : 'Mockups'} <ArrowRight size={11} />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => onDismissIssue(issue.id, true)}
                                                        className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700"
                                                    >
                                                        <Check size={11} /> Mark addressed
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {/* Risks → review comments with a resolution box */}
                    {risks.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                                Risks &amp; edge cases
                            </div>
                            {risks.map((r) => (
                                <RiskRow
                                    key={riskKey(r.description)}
                                    risk={r}
                                    resolution={riskResolutions[riskKey(r.description)] ?? ''}
                                    onResolve={(text) => onResolveRisk(riskKey(r.description), text)}
                                    readOnly={readOnly}
                                />
                            ))}
                        </div>
                    )}

                    {/* Addressed notes — recoverable */}
                    {addressedCount > 0 && (
                        <div>
                            <button
                                type="button"
                                onClick={() => setShowAddressed(s => !s)}
                                className="text-[11px] text-neutral-400 hover:text-neutral-600"
                            >
                                {showAddressed ? 'Hide' : 'Show'} {addressedCount} addressed
                            </button>
                            {showAddressed && (
                                <ul className="mt-2 space-y-1.5">
                                    {noteIssues.filter(i => dismissed.has(i.id)).map(issue => (
                                        <li key={issue.id} className="flex items-center justify-between gap-2 text-[11px] text-neutral-500">
                                            <span className="line-through decoration-neutral-300">{issue.title}</span>
                                            {!readOnly && (
                                                <button
                                                    type="button"
                                                    onClick={() => onDismissIssue(issue.id, false)}
                                                    className="text-indigo-500 hover:text-indigo-700 no-underline"
                                                >
                                                    Restore
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

const SEVERITY_STYLE: Record<string, string> = {
    low: 'text-neutral-500',
    medium: 'text-amber-600',
    high: 'text-red-600',
};

function RiskRow({
    risk, resolution, onResolve, readOnly,
}: {
    risk: ScreenRiskDetail;
    resolution: string;
    onResolve: (resolution: string | null) => void;
    readOnly?: boolean;
}) {
    // A risk is "resolved" once the product owner records an answer in the
    // overlay. A generated `proposedHandling` is only a suggestion — it pre-fills
    // the box but still needs the owner to confirm it.
    const resolved = Boolean(resolution.trim());
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(resolution || risk.proposedHandling || '');

    return (
        <div className={`rounded-lg border px-3 py-2.5 ${resolved ? 'border-neutral-200 bg-neutral-50/60' : 'border-amber-200 bg-amber-50/50'}`}>
            <div className="flex items-start gap-1.5">
                <AlertTriangle size={13} className={`${resolved ? 'text-neutral-400' : 'text-amber-600'} mt-0.5 shrink-0`} aria-hidden />
                <div className="min-w-0 flex-1">
                    <p className="text-xs text-neutral-800">{risk.description}</p>
                    {risk.severity && (
                        <span className={`text-[10px] uppercase tracking-wide font-medium ${SEVERITY_STYLE[risk.severity] ?? 'text-neutral-500'}`}>
                            {risk.severity} severity
                        </span>
                    )}
                </div>
            </div>

            {resolved && !editing ? (
                <div className="mt-1.5 pl-[19px] flex items-start justify-between gap-2">
                    <p className="text-[11px] text-neutral-600">
                        <span className="text-emerald-600 font-medium">Resolved · </span>{resolution}
                    </p>
                    {!readOnly && (
                        <button
                            type="button"
                            onClick={() => { setDraft(resolution); setEditing(true); }}
                            className="text-[11px] text-neutral-500 hover:text-neutral-700 shrink-0"
                        >
                            Edit
                        </button>
                    )}
                </div>
            ) : (
                !readOnly && (
                    editing || !resolved ? (
                        <div className="mt-2 pl-[19px] space-y-1.5">
                            <label className="block text-[10px] uppercase tracking-wide text-neutral-400">
                                How should this be handled?
                            </label>
                            <textarea
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                rows={2}
                                placeholder="e.g. show a friendly retry prompt and fall back to defaults"
                                className="w-full text-xs border border-neutral-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            />
                            <div className="flex items-center justify-end gap-2">
                                {editing && (
                                    <button
                                        type="button"
                                        onClick={() => setEditing(false)}
                                        className="text-[11px] text-neutral-500 hover:text-neutral-700 px-2 py-1"
                                    >
                                        Cancel
                                    </button>
                                )}
                                <button
                                    type="button"
                                    disabled={!draft.trim()}
                                    onClick={() => { onResolve(draft.trim() || null); setEditing(false); }}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                >
                                    <Check size={11} /> Mark resolved
                                </button>
                            </div>
                        </div>
                    ) : null
                )
            )}
        </div>
    );
}
