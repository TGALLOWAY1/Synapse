// Phase 4A: the per-screen review & approval control, shown near the top of the
// Screen Detail view. Presents (and lets the user drive) two DISTINCT signals:
//
//   - User review status  — the human sign-off (Draft / Needs review / Accepted
//     / Ready to build), set via the action buttons here.
//   - System readiness     — Synapse's derived estimate (Ready to accept /
//     Review recommended / Blocking issues), never overridden by the buttons.
//
// It also renders the readiness issue list (blockers / review items / info), a
// lightweight review checklist, and a calm "review may be outdated" banner when
// the screen spec changed after sign-off. Presentational only — every mutation
// goes back through the callbacks (persisted by ScreenDetailView via the
// screenEdits overlay). Copy stays calm and helpful, never alarming.

import { useState } from 'react';
import {
    AlertOctagon, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, Info,
    RefreshCw, ShieldQuestion, X,
} from 'lucide-react';
import type { ScreenReviewChecklist } from '../../types';
import {
    CHECKLIST_LABELS, REVIEW_STATUS_LABELS, SYSTEM_READINESS_LABELS,
    reviewTransitionsFor,
    type ScreenReviewIssue, type ScreenReviewIssueSeverity, type ScreenReviewModel,
} from '../../lib/screenReviewWorkflow';

interface Props {
    model: ScreenReviewModel;
    /** Accept the screen. A reason is supplied only when overriding open issues. */
    onAccept: (overrideReason?: string) => void;
    /** Request changes, with an optional "what needs to change?" note. */
    onRequestChanges: (note?: string) => void;
    /** Promote to Ready to build. A reason is supplied only when overriding. */
    onMarkImplementationReady: (overrideReason?: string) => void;
    /** Toggle one review-checklist item. */
    onToggleChecklist: (key: keyof ScreenReviewChecklist, checked: boolean) => void;
    /** Re-affirm the review against the current spec (clears "outdated"). */
    onReReview: () => void;
    /** Absent onSave → the panel is read-only (demo / legacy inventory). */
    readOnly?: boolean;
}

const SYSTEM_READINESS_STYLES: Record<ScreenReviewModel['systemReadiness'], string> = {
    ready: 'text-emerald-700',
    needs_review: 'text-amber-700',
    blocked: 'text-red-700',
};

const USER_STATUS_STYLES: Record<NonNullable<ScreenReviewModel['userStatus']>, string> = {
    draft: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
    needs_review: 'bg-amber-50 text-amber-700 ring-amber-200',
    accepted: 'bg-sky-50 text-sky-700 ring-sky-200',
    implementation_ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const SEVERITY_META: Record<ScreenReviewIssueSeverity, { label: string; dot: string; text: string }> = {
    blocking: { label: 'Blocking', dot: 'bg-red-500', text: 'text-red-700' },
    review: { label: 'Review recommended', dot: 'bg-amber-500', text: 'text-amber-700' },
    info: { label: 'For your information', dot: 'bg-neutral-400', text: 'text-neutral-600' },
};

type PendingAction = 'accept' | 'implementation_ready' | 'request_changes' | null;

export function ScreenReviewPanel({
    model, onAccept, onRequestChanges, onMarkImplementationReady,
    onToggleChecklist, onReReview, readOnly,
}: Props) {
    const [pending, setPending] = useState<PendingAction>(null);
    const [reason, setReason] = useState('');
    const [showChecklist, setShowChecklist] = useState(false);
    const [showIssues, setShowIssues] = useState(true);

    const transitions = reviewTransitionsFor(model.userStatus);
    const hasBlockers = model.blockingCount > 0;

    const closePending = () => { setPending(null); setReason(''); };

    const confirmPending = () => {
        const trimmed = reason.trim() || undefined;
        if (pending === 'accept') onAccept(trimmed);
        else if (pending === 'implementation_ready') onMarkImplementationReady(trimmed);
        else if (pending === 'request_changes') onRequestChanges(trimmed);
        closePending();
    };

    const startAccept = () => {
        if (hasBlockers) { setPending('accept'); setReason(''); }
        else onAccept();
    };
    const startImplReady = () => {
        // Promoting to Ready to build over blockers needs an explicit reason.
        if (hasBlockers) { setPending('implementation_ready'); setReason(''); }
        else onMarkImplementationReady();
    };

    const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed';

    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm space-y-3">
            {/* Status line */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] uppercase tracking-wide text-neutral-400">User review</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ring-1 ${
                            model.userStatus
                                ? USER_STATUS_STYLES[model.userStatus]
                                : 'bg-neutral-50 text-neutral-500 ring-neutral-200'
                        }`}>
                            {model.userStatus ? REVIEW_STATUS_LABELS[model.userStatus] : 'Not reviewed'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className="text-[11px] uppercase tracking-wide text-neutral-400">System readiness</span>
                        <span className={`font-medium ${SYSTEM_READINESS_STYLES[model.systemReadiness]}`}>
                            {SYSTEM_READINESS_LABELS[model.systemReadiness]}
                        </span>
                        <span className="text-neutral-400">·</span>
                        <span className="text-neutral-500">
                            {model.blockingCount > 0 && `${model.blockingCount} ${model.blockingCount === 1 ? 'blocker' : 'blockers'}`}
                            {model.blockingCount > 0 && model.reviewCount > 0 && ' · '}
                            {model.reviewCount > 0 && `${model.reviewCount} review ${model.reviewCount === 1 ? 'item' : 'items'}`}
                            {model.blockingCount === 0 && model.reviewCount === 0 && 'No blocking issues'}
                        </span>
                    </div>
                    {model.acceptedOverWarnings && (
                        <p className="text-[11px] text-amber-700">
                            Accepted with open review items — see the issues below.
                        </p>
                    )}
                </div>
                {!readOnly && (
                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                        {transitions.canRequestChanges && model.userStatus !== 'needs_review' && (
                            <button
                                type="button"
                                onClick={() => { setPending('request_changes'); setReason(''); }}
                                className={`${btn} bg-neutral-100 hover:bg-neutral-200 text-neutral-700`}
                            >
                                Request changes
                            </button>
                        )}
                        {transitions.canAccept && (
                            <button
                                type="button"
                                onClick={startAccept}
                                className={`${btn} bg-sky-600 hover:bg-sky-700 text-white`}
                            >
                                <CheckCircle2 size={13} /> Accept screen
                            </button>
                        )}
                        {transitions.canMarkImplementationReady && (
                            <button
                                type="button"
                                onClick={startImplReady}
                                className={`${btn} ${
                                    model.userStatus === 'accepted'
                                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                        : 'bg-white ring-1 ring-neutral-200 hover:ring-emerald-300 text-neutral-700 hover:text-emerald-700'
                                }`}
                            >
                                Mark ready to build
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Inline reason / note capture */}
            {pending && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-neutral-700">
                            {pending === 'request_changes'
                                ? 'What needs to change? (optional)'
                                : hasBlockers
                                    ? `${pending === 'accept' ? 'Accept' : 'Mark ready'} with a review note`
                                    : 'Add a note (optional)'}
                        </span>
                        <button type="button" onClick={closePending} className="text-neutral-400 hover:text-neutral-600">
                            <X size={14} />
                        </button>
                    </div>
                    {pending !== 'request_changes' && hasBlockers && (
                        <p className="text-[11px] text-amber-700">
                            This screen still has {model.blockingCount} blocking {model.blockingCount === 1 ? 'issue' : 'issues'}.
                            You can proceed with a note explaining why.
                        </p>
                    )}
                    <textarea
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        rows={2}
                        placeholder={pending === 'request_changes' ? 'e.g. the empty state is missing' : 'e.g. mockup will follow in a later pass'}
                        className="w-full text-sm border border-neutral-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                    <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={closePending} className="px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 rounded-md">
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={confirmPending}
                            className={`${btn} bg-indigo-600 hover:bg-indigo-700 text-white`}
                        >
                            {pending === 'request_changes'
                                ? 'Request changes'
                                : hasBlockers ? 'Proceed with note' : 'Confirm'}
                        </button>
                    </div>
                </div>
            )}

            {/* Review outdated banner */}
            {model.freshness === 'outdated' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                    <RefreshCw size={14} className="text-amber-600 mt-0.5 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-amber-800">This screen changed after it was reviewed.</p>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                            The spec was edited or regenerated since sign-off. Re-review recommended.
                            Changing an accepted screen may also make downstream artifacts (mockups, data
                            model, implementation plan) worth re-checking.
                        </p>
                    </div>
                    {!readOnly && (
                        <button
                            type="button"
                            onClick={onReReview}
                            className={`${btn} bg-amber-600 hover:bg-amber-700 text-white shrink-0`}
                        >
                            Re-review
                        </button>
                    )}
                </div>
            )}

            {/* Readiness issues */}
            {model.issues.length > 0 && (
                <div className="rounded-lg border border-neutral-200 overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setShowIssues(v => !v)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-neutral-50 hover:bg-neutral-100 transition"
                    >
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                            Readiness issues
                        </span>
                        {showIssues ? <ChevronUp size={14} className="text-neutral-400" /> : <ChevronDown size={14} className="text-neutral-400" />}
                    </button>
                    {showIssues && (
                        <ul className="divide-y divide-neutral-100">
                            {model.issues.map(issue => <IssueRow key={issue.id} issue={issue} />)}
                        </ul>
                    )}
                </div>
            )}

            {/* Review checklist */}
            <div className="rounded-lg border border-neutral-200 overflow-hidden">
                <button
                    type="button"
                    onClick={() => setShowChecklist(v => !v)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-neutral-50 hover:bg-neutral-100 transition"
                >
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        <ClipboardCheck size={13} className="text-neutral-400" />
                        Review checklist
                        <span className="font-normal normal-case tracking-normal text-neutral-400">
                            {model.checklistProgress.checked} / {model.checklistProgress.total}
                        </span>
                    </span>
                    {showChecklist ? <ChevronUp size={14} className="text-neutral-400" /> : <ChevronDown size={14} className="text-neutral-400" />}
                </button>
                {showChecklist && (
                    <div className="p-3">
                        <p className="text-[11px] text-neutral-400 mb-2">
                            Optional — checking items tracks your progress but never blocks a status change.
                        </p>
                        <ul className="space-y-1.5">
                            {(Object.keys(CHECKLIST_LABELS) as Array<keyof ScreenReviewChecklist>).map(key => (
                                <li key={key}>
                                    <label className="flex items-center gap-2 text-xs text-neutral-700 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={model.checklist[key] === true}
                                            disabled={readOnly}
                                            onChange={e => onToggleChecklist(key, e.target.checked)}
                                            className="rounded border-neutral-300 text-indigo-600 focus:ring-indigo-300 disabled:opacity-50"
                                        />
                                        {CHECKLIST_LABELS[key]}
                                    </label>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}

function IssueRow({ issue }: { issue: ScreenReviewIssue }) {
    const meta = SEVERITY_META[issue.severity];
    const Icon = issue.severity === 'blocking'
        ? AlertOctagon
        : issue.severity === 'review'
            ? ShieldQuestion
            : Info;
    return (
        <li className="px-3 py-2.5 flex items-start gap-2.5">
            <Icon size={14} className={`${meta.text} mt-0.5 shrink-0`} aria-hidden />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-neutral-800">{issue.title}</span>
                    <span className={`inline-flex items-center gap-1 text-[9px] uppercase tracking-wide ${meta.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                        {meta.label}
                    </span>
                </div>
                <p className="text-[11px] text-neutral-600 mt-0.5">{issue.description}</p>
                {issue.recommendedAction && (
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                        <span className="text-neutral-400">Suggested: </span>{issue.recommendedAction}
                    </p>
                )}
            </div>
        </li>
    );
}
