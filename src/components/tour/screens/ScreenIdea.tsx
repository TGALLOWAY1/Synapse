import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, FileText, Sparkles } from 'lucide-react';
import { ScreenShell } from '../components/ScreenShell';
import { IDEA_PRD_SECTIONS, IDEA_SEED } from '../tourData';
import type { ScreenProps } from '../tourTypes';

/**
 * Screen 1 — tapping the idea card "runs" it and the PRD section cards fill in
 * one by one, teaching that Synapse starts from structure, not chat.
 */
export default function ScreenIdea({ isActive, reducedMotion }: ScreenProps) {
    // -1 = not started; otherwise the index of the last revealed section.
    const [revealed, setRevealed] = useState(reducedMotion ? IDEA_PRD_SECTIONS.length : -1);
    const isBuilding = revealed >= 0 && revealed < IDEA_PRD_SECTIONS.length - 1;
    const isDone = revealed >= IDEA_PRD_SECTIONS.length - 1;

    const run = () => {
        if (reducedMotion) {
            setRevealed(IDEA_PRD_SECTIONS.length);
            return;
        }
        setRevealed(0);
    };

    // Auto-play once when the screen becomes active.
    useEffect(() => {
        if (!isActive || reducedMotion) return;
        const t = setTimeout(() => setRevealed((r) => (r === -1 ? 0 : r)), 600);
        return () => clearTimeout(t);
    }, [isActive, reducedMotion]);

    // Step through the sections.
    useEffect(() => {
        if (reducedMotion || revealed < 0 || revealed >= IDEA_PRD_SECTIONS.length - 1) return;
        const t = setTimeout(() => setRevealed((r) => r + 1), 550);
        return () => clearTimeout(t);
    }, [revealed, reducedMotion]);

    return (
        <ScreenShell
            title="Start with"
            accent="a single idea"
            subtitle="Synapse transforms a plain-language concept into a structured product blueprint."
        >
            <div className="flex flex-col items-center gap-4 md:flex-row md:items-stretch md:gap-6">
                {/* Idea card */}
                <button
                    type="button"
                    onClick={run}
                    className="group w-full max-w-sm rounded-2xl border border-indigo-500/30 bg-indigo-500/[0.06] p-5 text-left transition hover:border-indigo-400/60 md:w-72"
                >
                    <span className="mb-2 flex items-center gap-2 text-sm text-neutral-400">
                        <Sparkles size={15} className="text-indigo-300" /> {IDEA_SEED.label}
                    </span>
                    <span className="block text-lg font-medium text-neutral-100">{IDEA_SEED.prompt}</span>
                    <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-300 group-hover:text-indigo-200">
                        {isDone ? 'Tap to replay' : 'Tap to generate'} <ArrowRight size={13} />
                    </span>
                </button>

                <div className="flex items-center justify-center text-indigo-400 md:px-1" aria-hidden="true">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-indigo-500/40">
                        <ArrowRight size={18} />
                    </span>
                </div>

                {/* PRD document */}
                <div className="w-full max-w-md flex-1 rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                    <div className="mb-4 flex items-center gap-2 border-b border-neutral-700/70 pb-3">
                        <FileText size={18} className="text-indigo-300" />
                        <span className="text-sm font-semibold text-white">Product Requirements Document</span>
                    </div>
                    <ul className="space-y-4">
                        {IDEA_PRD_SECTIONS.map((section, i) => {
                            const shown = i <= revealed;
                            return (
                                <motion.li
                                    key={section.id}
                                    initial={false}
                                    animate={{ opacity: shown ? 1 : 0.35 }}
                                    transition={{ duration: reducedMotion ? 0 : 0.25 }}
                                >
                                    <span className="mb-2 block text-sm font-medium text-neutral-200">
                                        {section.heading}
                                    </span>
                                    <span className="block h-1.5 overflow-hidden rounded-full bg-neutral-700">
                                        <motion.span
                                            className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                                            initial={false}
                                            animate={{ width: shown ? '100%' : '0%' }}
                                            transition={{ duration: reducedMotion ? 0 : 0.5, ease: 'easeOut' }}
                                        />
                                    </span>
                                </motion.li>
                            );
                        })}
                    </ul>
                </div>
            </div>

            <div className="mt-6 flex justify-center md:justify-start" aria-live="polite">
                <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 px-4 py-2 text-sm text-indigo-200">
                    <Sparkles size={15} className={isBuilding && !reducedMotion ? 'animate-pulse' : ''} />
                    {isDone ? 'Your working plan is ready to review' : isBuilding ? 'AI is drafting a working plan…' : 'Tap the idea to begin'}
                </span>
            </div>
        </ScreenShell>
    );
}
