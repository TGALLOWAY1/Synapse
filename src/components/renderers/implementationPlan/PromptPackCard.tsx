import { useState } from 'react';
import { ChevronDown, ChevronUp, GitCommitHorizontal, Target } from 'lucide-react';
import type { ImplementationPromptPack } from '../../../types';
import { promptPackToClipboardText } from '../../../lib/services/implementationPlanAdapter';
import { CopyTextButton } from './CopyTextButton';

interface Props {
    pack: ImplementationPromptPack;
    /** Name of the milestone this pack belongs to; shown as a chip. */
    milestoneName?: string;
    /** Collapse the prompt body by default (used in dense lists). */
    defaultCollapsed?: boolean;
}

/**
 * One copy-ready coding-agent prompt: purpose, scope, acceptance criteria,
 * commit guidance, and the prompt body itself. Copy always uses
 * `promptPackToClipboardText` so criteria/commit guidance travel with the
 * prompt when they aren't already part of it.
 */
export function PromptPackCard({ pack, milestoneName, defaultCollapsed = false }: Props) {
    const [expanded, setExpanded] = useState(!defaultCollapsed);
    return (
        <article className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <header className="px-4 py-3 border-b border-neutral-100">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
                            Prompt Pack
                        </p>
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
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <CopyTextButton text={promptPackToClipboardText(pack)} label="Copy Prompt" />
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
                    <div className="bg-neutral-900 text-neutral-100 px-4 py-3 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                        {pack.prompt}
                    </div>

                    {(pack.scope?.include.length || pack.scope?.exclude.length) ? (
                        <div className="px-4 py-3 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {pack.scope.include.length > 0 && (
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">In Scope</p>
                                    <ul className="space-y-0.5 text-xs text-neutral-700">
                                        {pack.scope.include.map((s, i) => <li key={i}>• {s}</li>)}
                                    </ul>
                                </div>
                            )}
                            {pack.scope.exclude.length > 0 && (
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Out of Scope</p>
                                    <ul className="space-y-0.5 text-xs text-neutral-700">
                                        {pack.scope.exclude.map((s, i) => <li key={i}>• {s}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : null}

                    {pack.acceptanceCriteria.length > 0 && (
                        <div className="px-4 py-3 border-t border-neutral-100">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-1">
                                <Target size={11} /> Acceptance Criteria
                            </p>
                            <ul className="space-y-0.5 text-xs text-neutral-700">
                                {pack.acceptanceCriteria.map((c, i) => <li key={i}>• {c}</li>)}
                            </ul>
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
