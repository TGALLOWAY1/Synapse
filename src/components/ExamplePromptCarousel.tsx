import { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Smartphone, Monitor } from 'lucide-react';
import type { ProjectPlatform } from '../types';

export interface ExamplePrompt {
    title: string;
    full: string;
    platform: ProjectPlatform;
}

interface ExamplePromptCarouselProps {
    examples: ExamplePrompt[];
    onSelect: (example: ExamplePrompt) => void;
}

const SCROLL_STEP = 264;

export function ExamplePromptCarousel({ examples, onSelect }: ExamplePromptCarouselProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const [canScrollPrev, setCanScrollPrev] = useState(false);
    const [canScrollNext, setCanScrollNext] = useState(false);
    const [canScrollAtAll, setCanScrollAtAll] = useState(false);

    const updateScrollState = useCallback(() => {
        const el = trackRef.current;
        if (!el) return;
        const { scrollLeft, scrollWidth, clientWidth } = el;
        setCanScrollAtAll(scrollWidth > clientWidth);
        setCanScrollPrev(scrollLeft > 1);
        setCanScrollNext(scrollLeft + clientWidth < scrollWidth - 1);
    }, []);

    useLayoutEffect(() => {
        updateScrollState();
        const el = trackRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => updateScrollState());
        observer.observe(el);
        return () => observer.disconnect();
    }, [updateScrollState, examples]);

    const scrollByStep = (direction: 1 | -1) => {
        trackRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' });
    };

    return (
        <div className="relative">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Try an example
            </div>
            <div className="relative">
                <div
                    ref={trackRef}
                    onScroll={updateScrollState}
                    className="scrollbar-hide flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pb-2"
                >
                    {examples.map((example) => (
                        <button
                            key={example.title}
                            type="button"
                            onClick={() => onSelect(example)}
                            className="w-60 shrink-0 snap-start rounded-xl border border-neutral-200 bg-white p-3 text-left transition hover:border-neutral-400"
                        >
                            <div className="flex items-center gap-1.5">
                                {example.platform === 'app' ? (
                                    <Smartphone
                                        size={16}
                                        strokeWidth={2.25}
                                        className="shrink-0 text-neutral-500"
                                        data-testid="icon-app"
                                    />
                                ) : (
                                    <Monitor
                                        size={16}
                                        strokeWidth={2.25}
                                        className="shrink-0 text-neutral-500"
                                        data-testid="icon-web"
                                    />
                                )}
                                <span className="text-sm font-semibold text-neutral-800">{example.title}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-500">
                                {example.full}
                            </p>
                        </button>
                    ))}
                </div>
            </div>
            {canScrollAtAll && (
                <div className="hidden md:flex items-center justify-end gap-1 mt-1">
                    <button
                        type="button"
                        onClick={() => scrollByStep(-1)}
                        disabled={!canScrollPrev}
                        aria-label="Previous examples"
                        className="p-1.5 rounded-lg border border-neutral-200 bg-white text-neutral-500 transition hover:text-neutral-900 hover:border-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={() => scrollByStep(1)}
                        disabled={!canScrollNext}
                        aria-label="Next examples"
                        className="p-1.5 rounded-lg border border-neutral-200 bg-white text-neutral-500 transition hover:text-neutral-900 hover:border-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            )}
        </div>
    );
}
