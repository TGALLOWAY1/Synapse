import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, FileText, PenLine, Sparkles } from 'lucide-react';
import { ScreenShell, SkeletonLine } from '../components/ScreenShell';
import { RefineMenu } from '../components/RefineMenu';
import { useIsMobile } from '../../../lib/useIsMobile';
import { REFINE_DEMO, type RefineAction } from '../tourData';
import type { ScreenProps } from '../tourTypes';

const OTHER_SECTIONS = ['4. Core Problems', '5. Goals & Outcomes', '6. Key Features'];

/**
 * Screen 3 — the highlighted span and the Clarify/Expand/Specify/Alternative/
 * Replace menu are always visible (the menu floats over the document next to
 * the highlight, as in the mockup). An action is pre-selected so the AI
 * Conversation is populated; picking another action re-runs it, and "Apply to
 * PRD" swaps just that span. Teaches the Highlight → Refine → Consolidate loop.
 */
export default function ScreenRefine({ reducedMotion }: ScreenProps) {
    const isMobile = useIsMobile();
    // Pre-select Expand to mirror the mockup; the screen remounts fresh each
    // time it becomes active so it always demos from this state.
    const [action, setAction] = useState<RefineAction>('Expand');
    const [applied, setApplied] = useState(false);

    const script = REFINE_DEMO.scripts[action];

    const handleSelect = (a: RefineAction) => {
        setAction(a);
        setApplied(false);
    };

    return (
        <ScreenShell
            title="Refine specific"
            accent="parts of the document"
            subtitle="Highlight any section and improve it without rewriting everything."
        >
            <div className="grid gap-4 lg:grid-cols-2">
                {/* PRD panel */}
                <div className="relative rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                    <div className="mb-4 flex items-center gap-2">
                        <FileText size={18} className="text-indigo-300" />
                        <span className="text-sm font-semibold text-white">Product Requirements Document</span>
                    </div>

                    <p className="mb-1 text-sm font-medium text-neutral-200">{REFINE_DEMO.sectionHeading}</p>

                    {/* Highlighted span + always-visible refine menu */}
                    <div className="relative mb-4">
                        <span
                            className={`inline rounded text-sm leading-relaxed transition ${
                                applied
                                    ? 'text-neutral-200'
                                    : 'bg-indigo-500/25 text-indigo-100 underline decoration-indigo-400/60 underline-offset-4'
                            }`}
                        >
                            {applied ? script.refined : REFINE_DEMO.original}
                        </span>

                        <div
                            className={
                                isMobile
                                    ? 'mt-3 w-full max-w-[16rem]'
                                    : 'absolute left-6 top-full z-20 mt-2 w-56'
                            }
                        >
                            <RefineMenu onSelect={handleSelect} activeAction={action} />
                        </div>
                    </div>

                    {/* Context sections (menu floats over these on desktop) */}
                    <div className={isMobile ? '' : 'pointer-events-none opacity-60'}>
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
                </div>

                {/* Conversation panel */}
                <div className="flex flex-col rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                    <div className="mb-4 flex items-center justify-between">
                        <span className="text-sm font-semibold text-white">AI Conversation</span>
                        <Sparkles size={16} className="text-indigo-300" />
                    </div>

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={action}
                            initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={reducedMotion ? undefined : { opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-3"
                        >
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
                                    onClick={() => setApplied(true)}
                                    disabled={applied}
                                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:bg-emerald-600 disabled:opacity-100"
                                >
                                    {applied ? (
                                        <>
                                            <Check size={15} /> Applied to PRD
                                        </>
                                    ) : (
                                        'Apply to PRD'
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </AnimatePresence>
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
