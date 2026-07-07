// Canonical screen list for the Experience workspace. Read-only: every row is
// derived from the screen_inventory artifact via the pure join layer
// (src/lib/screenExperience.ts) — nothing here writes to the store. Rows show
// what the other experience artifacts say about each screen (flow-step count,
// mockup coverage) and click through to the Screen Detail view.

import { AppWindow, ChevronRight, Image as ImageIcon, Workflow } from 'lucide-react';
import { useState } from 'react';
import type { ScreenExperienceIndex, ScreenExperienceItem } from '../../lib/screenExperience';
import { PRIORITY_STYLES, stylablePriority } from '../renderers/screenPriority';

interface Props {
    index: ScreenExperienceIndex;
    /** Opens the Screen Detail view — keyed by the stable canonical id. */
    onSelectScreen: (screenId: string) => void;
    /**
     * Opens the confirmed "Generate remaining mockups" flow. Absent (no mockup
     * artifact yet / unparseable payload) the button is hidden. Nothing is
     * generated without this explicit confirmation.
     */
    onGenerateMissingMockups?: () => void;
}

export function ScreenListView({ index, onSelectScreen, onGenerateMissingMockups }: Props) {
    const [showAllCoverage, setShowAllCoverage] = useState(false);
    if (index.items.length === 0) {
        return (
            <div className="max-w-xl mx-auto bg-white rounded-xl border border-dashed border-neutral-300 p-10 text-center">
                <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-3">
                    <AppWindow size={20} className="text-indigo-500" />
                </div>
                <h3 className="text-sm font-semibold text-neutral-800">No screens yet</h3>
                <p className="text-xs text-neutral-500 mt-1">
                    Generate a Screen Inventory to see screens.
                </p>
            </div>
        );
    }

    const { summary, unmockedScreens } = index.mockupCoverage;
    const shownUnmocked = showAllCoverage ? unmockedScreens : unmockedScreens.slice(0, 3);
    const uncoveredLabel = summary.notMockedYetScreens === 1 ? '1 supporting screen available to generate' : `${summary.notMockedYetScreens} supporting screens available to generate`;

    return (
        <div className="max-w-3xl xl:max-w-5xl mx-auto space-y-8">
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-8 w-8 shrink-0 rounded-lg bg-indigo-50 flex items-center justify-center">
                        <ImageIcon size={16} className="text-indigo-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-neutral-900">Mockup Coverage</h3>
                        <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                            <span className="font-medium text-neutral-800">Mockups prioritize the most important screens.</span>{' '}
                            We created mockups for the core user-facing screens. Some supporting screens from the Screens artifact don’t have mockups yet, but they can be generated anytime.
                        </p>
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div className="rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2">
                                <span className="font-semibold text-neutral-900">{summary.mockedScreens} of {summary.totalScreens}</span> screens have mockups
                            </div>
                            <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-indigo-800">
                                <span className="font-semibold">{summary.notMockedYetScreens}</span> {summary.notMockedYetScreens === 1 ? 'supporting screen' : 'supporting screens'} available to generate
                            </div>
                        </div>
                        {summary.notMockedYetScreens > 0 && onGenerateMissingMockups && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button type="button" onClick={onGenerateMissingMockups} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition">
                                    <ImageIcon size={12} /> {summary.notMockedYetScreens === 1 ? 'Generate mockup' : 'Generate remaining mockups'}
                                </button>
                                <button type="button" onClick={onGenerateMissingMockups} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition">
                                    Choose screens to mock up
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                {summary.notMockedYetScreens > 0 && (
                    <div className="mt-4 border-t border-neutral-100 pt-3">
                        <div className="text-xs font-semibold text-neutral-700 mb-2">Not mocked yet</div>
                        <ul className="space-y-2">
                            {shownUnmocked.map(item => (
                                <li key={item.screenId} className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-medium text-neutral-900">Not mocked yet — {item.screenName}</p>
                                            <p className="mt-0.5 text-neutral-600">This supporting screen is defined in the Screens artifact but wasn’t included in the initial mockup set.</p>
                                        </div>
                                        {onGenerateMissingMockups && (
                                            <button type="button" onClick={onGenerateMissingMockups} className="shrink-0 text-indigo-700 hover:text-indigo-900 font-medium">Generate mockup</button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                        {unmockedScreens.length > 3 && (
                            <button type="button" onClick={() => setShowAllCoverage(v => !v)} className="mt-2 text-xs font-medium text-indigo-700 hover:text-indigo-900">
                                {showAllCoverage ? 'Hide' : `Show all ${unmockedScreens.length}`}
                            </button>
                        )}
                        <p className="sr-only">{uncoveredLabel}</p>
                    </div>
                )}
            </div>
            {/* Slug collisions and other reference problems surface in the
                ReferenceWarningsPanel rendered above this list (with repair
                and dismiss actions), not as a separate banner here. */}
            {index.sections.map((section, sectionIdx) => (
                <section key={sectionIdx}>
                    <header className="mb-3">
                        <h3 className="text-base font-semibold text-neutral-800">
                            <span className="text-neutral-400 font-normal mr-2">{sectionIdx + 1}.</span>
                            {section.title}
                        </h3>
                        {section.description && (
                            <p className="text-xs text-neutral-500 mt-1">{section.description}</p>
                        )}
                        <div className="mt-1 text-[11px] uppercase tracking-wide text-neutral-400">
                            {section.items.length} {section.items.length === 1 ? 'screen' : 'screens'}
                        </div>
                    </header>
                    <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {section.items.map(item => (
                            <li key={item.id}>
                                <ScreenRow item={item} onSelect={() => onSelectScreen(item.id)} />
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

function ScreenRow({ item, onSelect }: { item: ScreenExperienceItem; onSelect: () => void }) {
    const { screen } = item;
    const priority = stylablePriority(screen.priority);
    const flowCount = item.relatedFlows.length;
    const entryCount = screen.entryPoints?.length ?? 0;
    const exitCount = screen.exitPaths?.length ?? 0;

    return (
        <button
            type="button"
            onClick={onSelect}
            className="w-full text-left bg-white rounded-lg border border-neutral-200 p-4 hover:border-indigo-300 hover:shadow-sm transition group"
        >
            <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-neutral-800 text-sm leading-tight group-hover:text-indigo-700 transition-colors">
                    {screen.name}
                </h4>
                <div className="flex items-center gap-1.5 shrink-0">
                    {item.isEdited && (
                        <span className="text-[10px] uppercase tracking-wide text-violet-700 bg-violet-50 ring-1 ring-violet-200 px-1.5 py-0.5 rounded">
                            Edited
                        </span>
                    )}
                    {screen.type && screen.type !== 'screen' && (
                        <span className="text-[10px] uppercase tracking-wide text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded">
                            {screen.type}
                        </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[priority]}`}>
                        {priority}
                    </span>
                </div>
            </div>

            {screen.purpose && (
                <p className="text-xs leading-relaxed text-neutral-600 mt-2 line-clamp-2">
                    {screen.purpose}
                </p>
            )}

            <div className="mt-3 flex items-center gap-3 flex-wrap text-[11px] text-neutral-500">
                <span className="inline-flex items-center gap-1" title="User-flow steps referencing this screen">
                    <Workflow size={11} className={flowCount > 0 ? 'text-indigo-500' : 'text-neutral-300'} />
                    {flowCount > 0
                        ? `${flowCount} flow ${flowCount === 1 ? 'step' : 'steps'}`
                        : 'No flow refs'}
                </span>
                <span className="inline-flex items-center gap-1" title="Mockup coverage">
                    <ImageIcon size={11} className={item.mockupScreen ? 'text-emerald-500' : 'text-neutral-300'} />
                    {item.mockupScreen ? 'Mockup' : 'No mockup'}
                </span>
                {(entryCount > 0 || exitCount > 0) && (
                    <span title="Entry / exit paths">
                        {entryCount} in · {exitCount} out
                    </span>
                )}
                <ChevronRight size={13} className="ml-auto text-neutral-300 group-hover:text-indigo-400 transition-colors" aria-hidden />
            </div>
        </button>
    );
}
