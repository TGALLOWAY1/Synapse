import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Rocket } from 'lucide-react';
import { TOTAL_STEPS } from './tourTypes';

/**
 * Footer navigation shared by both modes: a back button, animated step dots,
 * and a Next / "Start Building" (final) primary action.
 */
export function TourNav({
    activeIndex,
    isLast,
    onPrev,
    onNext,
    onFinish,
    onGoto,
}: {
    activeIndex: number;
    isLast: boolean;
    onPrev: () => void;
    onNext: () => void;
    onFinish: () => void;
    onGoto: (index: number) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-1 border-t border-neutral-800 px-3 py-3 sm:gap-4 sm:px-8 sm:py-4">
            <button
                type="button"
                onClick={onPrev}
                aria-label="Previous"
                disabled={activeIndex === 0}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neutral-700 text-neutral-300 transition hover:border-indigo-500/60 hover:text-white sm:h-12 sm:w-12 ${
                    activeIndex === 0 ? 'pointer-events-none opacity-0' : 'opacity-100'
                }`}
            >
                <ArrowLeft size={20} />
            </button>

            <div className="flex items-center sm:gap-1" role="group" aria-label="Tour progress">
                {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
                    const isActive = i === activeIndex;
                    return (
                        <button
                            key={i}
                            type="button"
                            aria-current={isActive ? 'step' : undefined}
                            aria-label={`Go to step ${i + 1} of ${TOTAL_STEPS}`}
                            onClick={() => onGoto(i)}
                            className="flex min-h-6 min-w-6 items-center justify-center sm:min-w-7"
                        >
                            <motion.span
                                layout
                                className={`block h-2.5 rounded-full transition-all ${
                                    isActive
                                        ? 'w-5 bg-indigo-500 sm:w-7'
                                        : i < activeIndex
                                          ? 'w-2 bg-indigo-500/40 sm:w-2.5'
                                          : 'w-2 bg-neutral-700 sm:w-2.5'
                                }`}
                            />
                        </button>
                    );
                })}
            </div>

            {isLast ? (
                <button
                    type="button"
                    onClick={onFinish}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 sm:gap-2 sm:px-6"
                >
                    Start Building <Rocket size={17} />
                </button>
            ) : (
                <button
                    type="button"
                    onClick={onNext}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 sm:gap-2 sm:px-6"
                >
                    Next <ArrowRight size={17} />
                </button>
            )}
        </div>
    );
}
