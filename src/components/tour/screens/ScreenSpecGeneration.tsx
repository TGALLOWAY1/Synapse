import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, FileText, Sparkles } from 'lucide-react';
import { ScreenShell, SkeletonLine } from '../components/ScreenShell';
import { GenerationStep, type StepStatus } from '../components/GenerationStep';
import { SPEC_STEPS } from '../tourData';
import type { ScreenProps } from '../tourTypes';

const TOTAL = SPEC_STEPS.length;
const allDone = () => SPEC_STEPS.map(() => 'done' as StepStatus);
const stepSeconds = (durationMs: number) => Math.max(5, Math.round(durationMs / 120));

/**
 * Screen 2 — a live generation timeline. Each section walks
 * queued → generating → done so the user sees that generation is observable,
 * not a black box. Reduced motion shows the finished state immediately.
 */
export default function ScreenSpecGeneration({ isActive, reducedMotion }: ScreenProps) {
    // Initial state already reflects reduced motion (everything done); the
    // effect only drives the animated walk and is torn down on unmount — the
    // screen remounts fresh whenever it becomes active, so no synchronous reset
    // is needed.
    const [statuses, setStatuses] = useState<StepStatus[]>(() =>
        reducedMotion ? allDone() : SPEC_STEPS.map(() => 'queued'),
    );

    useEffect(() => {
        if (!isActive || reducedMotion) return;
        const timers: number[] = [];
        let acc = 400;
        SPEC_STEPS.forEach((step, i) => {
            timers.push(
                window.setTimeout(() => {
                    setStatuses((prev) => prev.map((s, j) => (j === i ? 'generating' : s)));
                }, acc),
            );
            acc += step.durationMs;
            timers.push(
                window.setTimeout(() => {
                    setStatuses((prev) => prev.map((s, j) => (j === i ? 'done' : s)));
                }, acc),
            );
        });
        return () => timers.forEach(clearTimeout);
    }, [isActive, reducedMotion]);

    const doneCount = statuses.filter((s) => s === 'done').length;
    const activeIndex = statuses.findIndex((s) => s === 'generating');
    const activeStep = activeIndex >= 0 ? SPEC_STEPS[activeIndex] : null;
    const percent = Math.round((doneCount / TOTAL) * 100);

    return (
        <ScreenShell
            title="AI builds the spec"
            accent="section by section"
            subtitle="Every section is generated independently so you can see exactly what is happening."
        >
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                {/* Progress timeline */}
                <div className="rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                    <h3 className="mb-4 text-sm font-semibold text-white">Progress</h3>
                    <ol>
                        {SPEC_STEPS.map((step, i) => (
                            <GenerationStep
                                key={step.id}
                                label={step.label}
                                status={statuses[i]}
                                reducedMotion={reducedMotion}
                                elapsedLabel={statuses[i] === 'done' ? `${stepSeconds(step.durationMs)}s` : undefined}
                                isLast={i === TOTAL - 1}
                            />
                        ))}
                    </ol>
                </div>

                {/* Document preview */}
                <div className="rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                    <div className="mb-4 flex items-center gap-2">
                        <FileText size={18} className="text-indigo-300" />
                        <span className="text-sm font-semibold text-white">Product Requirements Document</span>
                    </div>
                    <div className="mb-4 space-y-2">
                        <SkeletonLine width="w-11/12" />
                        <SkeletonLine width="w-9/12" />
                        <SkeletonLine width="w-7/12" />
                    </div>

                    {/* Active section card */}
                    <motion.div
                        key={activeStep?.id ?? 'done'}
                        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl border border-indigo-500/50 bg-indigo-500/[0.07] p-4"
                    >
                        <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-semibold text-white">
                                {activeStep ? activeStep.label : 'Goals & Outcomes'}
                            </span>
                            <Sparkles size={16} className="text-indigo-300" />
                        </div>
                        <ul className="space-y-2">
                            {[0, 1, 2, 3].map((n) => (
                                <li key={n} className="flex items-center gap-2">
                                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                                    <span className="block h-2 rounded bg-indigo-400/30" style={{ width: `${85 - n * 12}%` }} />
                                </li>
                            ))}
                        </ul>
                    </motion.div>

                    {/* Upcoming collapsed rows */}
                    <div className="mt-3 space-y-2">
                        {SPEC_STEPS.slice(Math.max(activeIndex + 1, 4), Math.max(activeIndex + 1, 4) + 3).map((s) => (
                            <div
                                key={s.id}
                                className="flex items-center justify-between rounded-lg border border-neutral-700 px-3 py-2.5 text-sm text-neutral-400"
                            >
                                {s.label}
                                <ChevronDown size={16} className="text-neutral-600" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Footer status */}
            <div className="mt-5 rounded-2xl border border-neutral-700 bg-neutral-800/40 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-neutral-200" aria-live="polite">
                    <Sparkles size={16} className="text-indigo-300" />
                    {activeStep ? (
                        <span>
                            <span className="font-semibold text-indigo-300">multiple AI models</span> are writing{' '}
                            {activeStep.label}…
                        </span>
                    ) : (
                        <span>{doneCount === TOTAL ? 'All sections generated.' : 'Preparing the pipeline…'}</span>
                    )}
                    <span className="ml-auto text-xs text-neutral-500">
                        {doneCount} / {TOTAL} sections
                    </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-700">
                    <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                        initial={false}
                        animate={{ width: `${percent}%` }}
                        transition={{ duration: reducedMotion ? 0 : 0.4 }}
                    />
                </div>
            </div>
        </ScreenShell>
    );
}
