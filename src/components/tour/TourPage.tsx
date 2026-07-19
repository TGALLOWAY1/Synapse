import { Suspense, lazy, useEffect, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useTourState } from '../../lib/useTourState';
import { useIsMobile } from '../../lib/useIsMobile';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import { TOTAL_STEPS, TOUR_SCREENS, type ScreenProps } from './tourTypes';
import { TourContainer } from './TourContainer';
import { TourNav } from './TourNav';
import { TourProgressRail } from './TourProgressRail';
import { ModeToggle } from './ModeToggle';

// Each screen is its own lazily-loaded chunk so all seven never load at once.
const SCREENS: ComponentType<ScreenProps>[] = [
    lazy(() => import('./screens/ScreenIdea')),
    lazy(() => import('./screens/ScreenSpecGeneration')),
    lazy(() => import('./screens/ScreenRefine')),
    lazy(() => import('./screens/ScreenDecisions')),
    lazy(() => import('./screens/ScreenVersions')),
    lazy(() => import('./screens/ScreenAssets')),
    lazy(() => import('./screens/ScreenConnections')),
];

function ScreenFallback() {
    return (
        <div className="flex h-full items-center justify-center" aria-hidden="true">
            <Loader2 className="animate-spin text-neutral-500" size={24} />
        </div>
    );
}

/**
 * Interactive product tour ("Meet Synapse"). Two modes share one source of
 * truth (`useTourState`): a guided story for first-timers and an overview
 * navigator for returning users. All navigation inputs — buttons, the dot rail,
 * the overview tabs, arrow keys, and mobile swipe — funnel through `dispatch`.
 */
export function TourPage() {
    const navigate = useNavigate();
    const { state, dispatch } = useTourState();
    const isMobile = useIsMobile();
    const reducedMotion = usePrefersReducedMotion();

    const { activeIndex, mode, direction } = state;
    const isLast = activeIndex === TOTAL_STEPS - 1;
    const ActiveScreen = SCREENS[activeIndex];

    const finish = () => navigate('/');

    // Desktop arrow-key navigation. Ignored while typing in a field.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.altKey || e.metaKey || e.ctrlKey) return;
            const el = e.target as HTMLElement | null;
            const tag = el?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
            if (e.key === 'ArrowRight') dispatch({ type: 'NEXT' });
            else if (e.key === 'ArrowLeft') dispatch({ type: 'PREV' });
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [dispatch]);

    return (
        <div className="flex h-[100dvh] flex-col bg-neutral-900 text-neutral-100">
            {/* Header — branded so the tour reads as a product demo, not an
                internal step-through. The wordmark and the "Open Synapse" CTA
                both lead back to the live app. */}
            <header className="flex items-center justify-between gap-3 px-5 pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-8">
                <div className="flex min-w-0 items-center gap-3">
                    <Link
                        to="/"
                        aria-label="Synapse home"
                        className="flex min-w-0 items-center gap-2.5 transition hover:opacity-90"
                    >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
                            S
                        </span>
                        <span className="flex min-w-0 flex-col leading-tight">
                            <span className="text-sm font-semibold text-white">Synapse</span>
                            <span className="hidden truncate text-[11px] text-neutral-500 sm:block">
                                From plain-language to product blueprint
                            </span>
                        </span>
                    </Link>
                    <span className="hidden items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-200 md:inline-flex">
                        Interactive demo
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="hidden text-xs text-neutral-500 sm:inline" aria-hidden="true">
                        {activeIndex + 1} / {TOTAL_STEPS}
                    </span>
                    <ModeToggle mode={mode} onChange={(m) => dispatch({ type: 'SET_MODE', mode: m })} />
                    <button
                        type="button"
                        onClick={finish}
                        className="text-sm font-medium text-neutral-400 transition hover:text-white"
                    >
                        Open Synapse
                    </button>
                </div>
            </header>

            {/* sr-only live announcement of the current screen */}
            <p className="sr-only" aria-live="polite">
                Step {activeIndex + 1} of {TOTAL_STEPS}: {TOUR_SCREENS[activeIndex].title}
            </p>

            {/* Overview-mode section navigator */}
            {mode === 'overview' && (
                <div className="mt-3">
                    <TourProgressRail
                        activeIndex={activeIndex}
                        onGoto={(index) => dispatch({ type: 'GOTO', index })}
                        onRestart={() => dispatch({ type: 'RESTART' })}
                    />
                </div>
            )}

            {/* Animated screen host */}
            <TourContainer
                activeIndex={activeIndex}
                direction={direction}
                reducedMotion={reducedMotion}
                drag={isMobile && !reducedMotion}
                onCommit={(decision) => dispatch({ type: decision === 'next' ? 'NEXT' : 'PREV' })}
            >
                <Suspense fallback={<ScreenFallback />}>
                    <ActiveScreen isActive reducedMotion={reducedMotion} />
                </Suspense>
            </TourContainer>

            {/* Footer navigation */}
            <TourNav
                activeIndex={activeIndex}
                isLast={isLast}
                onPrev={() => dispatch({ type: 'PREV' })}
                onNext={() => dispatch({ type: 'NEXT' })}
                onFinish={finish}
                onGoto={(index) => dispatch({ type: 'GOTO', index })}
            />
        </div>
    );
}
