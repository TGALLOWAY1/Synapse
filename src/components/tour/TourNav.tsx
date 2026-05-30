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
        <div className="flex items-center justify-between gap-4 border-t border-neutral-800 px-5 py-4 sm:px-8">
            <button
                type="button"
                onClick={onPrev}
                aria-label="Previous"
                className={`flex h-12 w-12 items-center justify-center rounded-full border border-neutral-700 text-neutral-300 transition hover:border-indigo-500/60 hover:text-white ${
                    activeIndex === 0 ? 'pointer-events-none opacity-0' : 'opacity-100'
                }`}
            >
                <ArrowLeft size={20} />
            </button>

            <div className="flex items-center gap-2" role="tablist" aria-label="Tour progress">
                {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
                    const isActive = i === activeIndex;
                    return (
                        <button
                            key={i}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-label={`Go to step ${i + 1} of ${TOTAL_STEPS}`}
                            onClick={() => onGoto(i)}
                            className="py-2"
                        >
                            <motion.span
                                layout
                                className={`block h-2.5 rounded-full transition-colors ${
                                    isActive
                                        ? 'bg-indigo-500'
                                        : i < activeIndex
                                          ? 'bg-indigo-500/40'
                                          : 'bg-neutral-700'
                                }`}
                                animate={{ width: isActive ? 28 : 10 }}
                                transition={{ duration: 0.25 }}
                            />
                        </button>
                    );
                })}
            </div>

            {isLast ? (
                <button
                    type="button"
                    onClick={onFinish}
                    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 sm:px-6"
                >
                    Start Building <Rocket size={17} />
                </button>
            ) : (
                <button
                    type="button"
                    onClick={onNext}
                    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 sm:px-6"
                >
                    Next <ArrowRight size={17} />
                </button>
            )}
        </div>
    );
}
