// Non-blocking reference-validation panel for the Screens list. Surfaces the
// join layer's findings (unmatched flow steps / mockup screens, slug
// collisions, name-only legacy matches) with low-risk repairs: relink a
// mockup screen to a canonical screen (persisted to metadata.screenLinks) or
// ignore a warning (persisted to metadata.dismissedScreenIssues). Rendering
// is never blocked by validation — this panel is purely advisory and
// collapsed by default.

import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, EyeOff, Link2 } from 'lucide-react';
import type { ScreenReferenceIssue, ScreenReferenceIssueKind } from '../../lib/screenExperience';

const KIND_META: Record<ScreenReferenceIssueKind, { label: string; chip: string }> = {
    unmatched_flow_step: { label: 'Flow', chip: 'bg-amber-100 text-amber-800' },
    unmatched_mockup_screen: { label: 'Mockup', chip: 'bg-red-50 text-red-700' },
    slug_collision: { label: 'Naming', chip: 'bg-amber-100 text-amber-800' },
    legacy_name_match: { label: 'Legacy match', chip: 'bg-neutral-100 text-neutral-600' },
};

interface Props {
    issues: ScreenReferenceIssue[];
    /** Canonical screens offered as relink targets. */
    screenOptions: Array<{ id: string; name: string }>;
    onRelink?: (mockupScreenId: string, screenId: string) => void;
    onDismiss?: (issueKey: string) => void;
}

export function ReferenceWarningsPanel({ issues, screenOptions, onRelink, onDismiss }: Props) {
    const [open, setOpen] = useState(false);
    if (issues.length === 0) return null;

    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left"
            >
                <span className="inline-flex items-center gap-2 text-xs font-medium text-amber-900">
                    <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                    {issues.length} {issues.length === 1 ? 'reference needs' : 'references need'} review
                </span>
                {open
                    ? <ChevronDown size={14} className="text-amber-500 shrink-0" />
                    : <ChevronRight size={14} className="text-amber-500 shrink-0" />}
            </button>
            {open && (
                <ul className="px-4 pb-3 space-y-2">
                    {issues.map(issue => (
                        <IssueRow
                            key={issue.key}
                            issue={issue}
                            screenOptions={screenOptions}
                            onRelink={onRelink}
                            onDismiss={onDismiss}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}

function IssueRow({
    issue, screenOptions, onRelink, onDismiss,
}: {
    issue: ScreenReferenceIssue;
    screenOptions: Array<{ id: string; name: string }>;
    onRelink?: (mockupScreenId: string, screenId: string) => void;
    onDismiss?: (issueKey: string) => void;
}) {
    // Default the relink target to the current match (legacy matches) so a
    // one-click "Relink" pins the existing behavior with a stable link.
    const [target, setTarget] = useState(issue.screenId ?? '');
    const meta = KIND_META[issue.kind];
    const canRelink = Boolean(onRelink && issue.mockupScreenId && screenOptions.length > 0);

    return (
        <li className="bg-white rounded-md border border-amber-200/70 p-2.5 text-xs">
            <div className="flex items-start gap-2">
                <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded mt-0.5 ${meta.chip}`}>
                    {meta.label}
                </span>
                <span className="min-w-0 flex-1 text-neutral-800">{issue.message}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap justify-end">
                {canRelink && (
                    <>
                        <select
                            value={target}
                            onChange={e => setTarget(e.target.value)}
                            aria-label="Screen to link this mockup to"
                            className="text-xs border border-neutral-300 rounded-md px-1.5 py-1 max-w-[220px]"
                        >
                            <option value="">Choose screen…</option>
                            {screenOptions.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            disabled={!target}
                            onClick={() => {
                                if (issue.mockupScreenId && target) onRelink?.(issue.mockupScreenId, target);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        >
                            {issue.kind === 'legacy_name_match' ? <Check size={11} /> : <Link2 size={11} />}
                            {issue.kind === 'legacy_name_match' ? 'Pin link' : 'Relink'}
                        </button>
                    </>
                )}
                {onDismiss && (
                    <button
                        type="button"
                        onClick={() => onDismiss(issue.key)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-neutral-500 hover:bg-neutral-100 transition"
                        title="Hide this warning (the current behavior is kept)"
                    >
                        <EyeOff size={11} /> Ignore
                    </button>
                )}
            </div>
        </li>
    );
}
