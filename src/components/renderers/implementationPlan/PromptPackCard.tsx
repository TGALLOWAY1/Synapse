import { useMemo, useState } from 'react';
import {
    Check,
    ChevronDown,
    ChevronUp,
    GitCommitHorizontal,
    ListChecks,
    ShieldCheck,
    Target,
} from 'lucide-react';
import type { ImplementationPromptPack } from '../../../types';
import { promptPackToClipboardText } from '../../../lib/services/implementationPlanAdapter';
import { parsePromptSections } from '../../../lib/services/implementationPlanInsights';
import { CopyTextButton } from './CopyTextButton';

interface Props {
    pack: ImplementationPromptPack;
    /** Name of the milestone this pack belongs to; shown as a chip. */
    milestoneName?: string;
    /** 1-based position in the recommended execution order ("Prompt 2 of 5"). */
    orderLabel?: string;
    /** Milestones that must complete before this prompt is safe to run. */
    prerequisites?: string[];
    /** Titles of the quality gates that check this prompt's output. */
    relatedGateTitles?: string[];
    /** Whether the user has copied this prompt (persisted plan progress). */
    copied?: boolean;
    /** Fired after a successful copy so progress can advance. */
    onCopied?: () => void;
    /** Collapse the prompt body by default (used in dense lists). */
    defaultCollapsed?: boolean;
    /** Visually mark this pack as the recommended next prompt. */
    highlight?: boolean;
}

/**
 * One copy-ready coding-agent prompt treated as a first-class build
 * instruction: purpose, prerequisites, expected changes (scope), acceptance
 * criteria, related quality gates, and a structured prompt preview. Copy
 * always uses `promptPackToClipboardText` so criteria/commit guidance travel
 * with the prompt when they aren't already part of it.
 */
export function PromptPackCard({
    pack,
    milestoneName,
    orderLabel,
    prerequisites,
    relatedGateTitles = [],
    copied = false,
    onCopied,
    defaultCollapsed = false,
    highlight = false,
}: Props) {
    const [expanded, setExpanded] = useState(!defaultCollapsed);
    const sections = useMemo(() => parsePromptSections(pack.prompt), [pack.prompt]);
    const structured = sections.length > 1;

    return (
        <article
            className={`bg-white rounded-xl border overflow-hidden ${
                highlight ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-neutral-200'
            }`}
        >
            <header className="px-4 py-3 border-b border-neutral-100">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
                                {orderLabel ?? 'Prompt Pack'}
                            </p>
                            {highlight && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-600 text-white font-semibold">
                                    Next up
                                </span>
                            )}
                            {copied && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                                    <Check size={10} /> Copied
                                </span>
                            )}
                        </div>
                        <h4 className="text-sm font-bold text-neutral-900 leading-snug mt-0.5">{pack.title}</h4>
                        <p className="text-xs text-neutral-600 mt-0.5">{pack.purpose}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {milestoneName && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 font-medium">
                                    {milestoneName}
                                </span>
                            )}
                            {pack.category && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 border border-neutral-200">
                                    {pack.category}
                                </span>
                            )}
                        </div>
                        {prerequisites !== undefined && (
                            <p className="text-[11px] text-neutral-500 mt-1.5">
                                <span className="font-semibold text-neutral-600">Prerequisites: </span>
                                {prerequisites.length > 0
                                    ? `Complete ${prerequisites.join(', ')} first`
                                    : 'None — safe to start here'}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <CopyTextButton
                            text={promptPackToClipboardText(pack)}
                            label="Copy Prompt"
                            onCopied={onCopied}
                        />
                        <button
                            type="button"
                            onClick={() => setExpanded(prev => !prev)}
                            aria-label={expanded ? 'Collapse prompt' : 'Expand prompt'}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-50 transition"
                        >
                            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                    </div>
                </div>
            </header>

            {expanded && (
                <>
                    {/* Structured prompt preview: generated packs use a fixed
                        `## Goal / ## Scope / …` heading structure — surface it
                        instead of a wall of monospace. Unstructured prompts
                        fall back to the plain block. */}
                    <div className="bg-neutral-900 text-neutral-100 px-4 py-3 text-xs leading-relaxed max-h-80 overflow-y-auto">
                        {structured ? (
                            <div className="space-y-2.5">
                                {sections.map((s, i) => (
                                    <div key={i}>
                                        {s.heading && (
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300 mb-0.5">
                                                {s.heading}
                                            </p>
                                        )}
                                        {s.body && (
                                            <pre className="font-mono whitespace-pre-wrap text-neutral-100">{s.body}</pre>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <pre className="font-mono whitespace-pre-wrap">{pack.prompt}</pre>
                        )}
                    </div>

                    {/* The adapter normalizes scope arrays, but stay defensive:
                        partial model output may omit include/exclude. */}
                    {(pack.scope?.include?.length || pack.scope?.exclude?.length) ? (
                        <div className="px-4 py-3 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {(pack.scope.include?.length ?? 0) > 0 && (
                                <div>
                                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                                        <ListChecks size={11} /> Expected Changes
                                    </p>
                                    <ul className="space-y-0.5 text-xs text-neutral-700">
                                        {pack.scope.include!.map((s, i) => <li key={i}>• {s}</li>)}
                                    </ul>
                                </div>
                            )}
                            {(pack.scope.exclude?.length ?? 0) > 0 && (
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Out of Scope</p>
                                    <ul className="space-y-0.5 text-xs text-neutral-700">
                                        {pack.scope.exclude!.map((s, i) => <li key={i}>• {s}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : null}

                    {(pack.acceptanceCriteria?.length ?? 0) > 0 && (
                        <div className="px-4 py-3 border-t border-neutral-100">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-1">
                                <Target size={11} /> Acceptance Criteria
                            </p>
                            <ul className="space-y-0.5 text-xs text-neutral-700">
                                {pack.acceptanceCriteria.map((c, i) => <li key={i}>• {c}</li>)}
                            </ul>
                        </div>
                    )}

                    {relatedGateTitles.length > 0 && (
                        <div className="px-4 py-2.5 border-t border-neutral-100 flex items-start gap-2">
                            <ShieldCheck size={13} className="mt-0.5 text-neutral-400 shrink-0" />
                            <p className="text-[11px] text-neutral-600">
                                <span className="font-semibold text-neutral-500">Validated by: </span>
                                {relatedGateTitles.join(' · ')}
                            </p>
                        </div>
                    )}

                    {pack.recommendedCommitMessage && (
                        <div className="px-4 py-2.5 border-t border-neutral-100 flex items-center gap-2">
                            <GitCommitHorizontal size={13} className="text-neutral-400 shrink-0" />
                            <code className="text-[11px] text-neutral-600 truncate">{pack.recommendedCommitMessage}</code>
                        </div>
                    )}
                </>
            )}
        </article>
    );
}
