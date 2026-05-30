import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { useRef, type ReactNode } from 'react';
import { shouldCommitSwipe } from '../../lib/swipeMath';
import type { TourDirection } from './tourTypes';

const slideVariants = {
    enter: (dir: TourDirection) => ({ x: dir === 'forward' ? '100%' : '-100%', opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: TourDirection) => ({ x: dir === 'forward' ? '-100%' : '100%', opacity: 0 }),
};

const fadeVariants = {
    enter: { opacity: 0 },
    center: { opacity: 1 },
    exit: { opacity: 0 },
};

/**
 * Animated, swipe-aware screen host. Only the active screen is mounted (the
 * caller passes it as `children`); AnimatePresence keeps the outgoing screen
 * around just long enough to slide it out. Drag is enabled only when `drag` is
 * true (mobile, motion allowed); `dragDirectionLock` + `touch-pan-y` keep
 * vertical scrolling intact. Reduced motion collapses to an instant fade.
 */
export function TourContainer({
    activeIndex,
    direction,
    reducedMotion,
    drag,
    onCommit,
    children,
}: {
    activeIndex: number;
    direction: TourDirection;
    reducedMotion: boolean;
    drag: boolean;
    onCommit: (decision: 'next' | 'prev') => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);

    const handleDragEnd = (_e: unknown, info: PanInfo) => {
        const width = ref.current?.offsetWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1);
        const decision = shouldCommitSwipe({ offset: info.offset.x, velocity: info.velocity.x, width });
        if (decision !== 'none') onCommit(decision);
    };

    return (
        <div ref={ref} className="relative flex-1 overflow-hidden">
            <AnimatePresence custom={direction} mode="popLayout" initial={false}>
                <motion.div
                    key={activeIndex}
                    custom={direction}
                    variants={reducedMotion ? fadeVariants : slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: reducedMotion ? 0 : 0.32, ease: [0.32, 0.72, 0, 1] }}
                    drag={drag ? 'x' : false}
                    dragDirectionLock
                    dragElastic={0.18}
                    dragConstraints={{ left: 0, right: 0 }}
                    onDragEnd={drag ? handleDragEnd : undefined}
                    className="absolute inset-0 touch-pan-y overflow-y-auto px-5 py-6 sm:px-8"
                >
                    {children}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
