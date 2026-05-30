import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, FileText, PenLine, Sparkles } from 'lucide-react';
import { ScreenShell, SkeletonLine } from '../components/ScreenShell';
import { RefineMenu } from '../components/RefineMenu';
import { REFINE_DEMO, type RefineAction } from '../tourData';
import type { ScreenProps } from '../tourTypes';

type Phase = 'idle' | 'menu' | 'conversation' | 'applied';

const OTHER_SECTIONS = ['4. Core Problems', '5. Goals & Outcomes', '6. Key Features'];

/**
 * Screen 3 — highlight a span, pick a refinement action, watch a scripted
 * conversation, then "Apply to PRD" to swap just that span. Teaches the
 * Highlight → Refine → Consolidate loop without touching a backend.
 */
export default function ScreenRefine({ reducedMotion }: ScreenProps) {
    // The screen remounts fresh each time it becomes active, so it always demos
    // from the top — no isActive reset needed.
    const [phase, setPhase] = useState<Phase>('idle');
    const [action, setAction] = useState<RefineAction | null>(null);

    const script = action ? REFINE_DEMO.scripts[action] : null;
    const isApplied = phase === 'applied';

    const handleSelect = (a: RefineAction) => {
        setAction(a);
        setPhase('conversation');
    };

    return (
        <ScreenShell
            title="Refine specific"
            accent="parts of the document"
            subtitle="Highlight any section and improve it without rewriting everything."
        >
            <div className="grid gap-4 lg:grid-cols-2">
                {/* PRD panel */}
                <div className="rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                    <div className="mb-4 flex items-center gap-2">
                        <FileText size={18} className="text-indigo-300" />
                        <span className="text-sm font-semibold text-white">Product Requirements Document</span>
                    </div>

                    <p className="mb-1 text-sm font-medium text-neutral-200">{REFINE_DEMO.sectionHeading}</p>
                    <div className="mb-4">
                        <button
                            type="button"
                            onClick={() => phase === 'idle' && setPhase('menu')}
                            disabled={phase !== 'idle'}
                            className={`rounded text-left text-sm leading-relaxed transition ${
                                isApplied
                                    ? 'text-neutral-200'
                                    : 'bg-indigo-500/25 text-indigo-100 decoration-indigo-400/60 underline-offset-4 hover:bg-indigo-500/35'
                            } ${phase === 'idle' ? 'cursor-pointer underline' : ''}`}
                        >
                            {isApplied && script ? script.refined : REFINE_DEMO.original}
                        </button>
                        {phase === 'idle' && (
                            <span className="mt-1 block text-xs text-neutral-500">Tap the highlighted text to refine it</span>
                        )}

                        <AnimatePresence>
                            {phase === 'menu' && (
                                <motion.div
                                    initial={reducedMotion ? false : { opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    className="mt-2 max-w-[15rem]"
                                >
                                    <RefineMenu onSelect={handleSelect} activeAction={action} />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {OTHER_SECTIONS.map((heading) => (
                        <div key={heading} className="mb-4 opacity-70">
                            <p className="mb-2 text-sm font-medium text-neutral-300">{heading}</p>
                            <div className="space-y-2">
                                <SkeletonLine width="w-10/12" />
                                <SkeletonLine width="w-7/12" />
                            </div>
                        </div>
                    ))}
                </div>

                {/* Conversation panel */}
                <div className="flex flex-col rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                    <div className="mb-4 flex items-center justify-between">
                        <span className="text-sm font-semibold text-white">AI Conversation</span>
                        <Sparkles size={16} className="text-indigo-300" />
                    </div>

                    {!script ? (
                        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-neutral-700 p-8 text-center text-sm text-neutral-500">
                            Pick a refinement action to start a conversation about this section.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="rounded-2xl rounded-tl-sm bg-neutral-700/50 px-3 py-2 text-sm text-neutral-200">
                                How would you like to refine this section?
                            </div>
                            <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-500/20 px-3 py-2 text-sm text-indigo-100">
                                {script.request}
                            </div>
                            <div className="rounded-2xl rounded-tl-sm bg-neutral-700/50 px-3 py-2 text-sm text-neutral-200">
                                {script.reply}
                                <div className="mt-3 rounded-lg border border-neutral-600 bg-neutral-800/70 p-3">
                                    <p className="mb-1 text-xs font-medium text-indigo-300">{REFINE_DEMO.sectionHeading}</p>
                                    <p className="text-xs leading-relaxed text-neutral-200">{script.refined}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPhase('applied')}
                                    disabled={isApplied}
                                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:bg-emerald-600 disabled:opacity-100"
                                >
                                    {isApplied ? (
                                        <>
                                            <Check size={15} /> Applied to PRD
                                        </>
                                    ) : (
                                        'Apply to PRD'
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Callout */}
            <div className="mt-5 flex items-start gap-4 rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-300">
                    <PenLine size={20} />
                </span>
                <div>
                    <p className="text-base font-semibold text-white">Be precise. Stay in control.</p>
                    <p className="mt-1 text-sm text-neutral-400">
                        Edit one idea without affecting the rest. Synapse creates a new version so you can compare and choose.
                    </p>
                </div>
            </div>
        </ScreenShell>
    );
}
