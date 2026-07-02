// Canonical screen list for the Experience workspace. Read-only: every row is
// derived from the screen_inventory artifact via the pure join layer
// (src/lib/screenExperience.ts) — nothing here writes to the store. Rows show
// what the other experience artifacts say about each screen (flow-step count,
// mockup coverage) and click through to the Screen Detail view.

import { AppWindow, ChevronRight, Image as ImageIcon, Workflow } from 'lucide-react';
import type { ScreenExperienceIndex, ScreenExperienceItem } from '../../lib/screenExperience';
import { PRIORITY_STYLES, stylablePriority } from '../renderers/screenPriority';

interface Props {
    index: ScreenExperienceIndex;
    /** Opens the Screen Detail view — keyed by the stable canonical id. */
    onSelectScreen: (screenId: string) => void;
    /**
     * Opens the confirmed "Generate missing mockups" flow. Absent (no mockup
     * artifact yet / unparseable payload) the button is hidden. Nothing is
     * generated without this explicit confirmation.
     */
    onGenerateMissingMockups?: () => void;
}

export function ScreenListView({ index, onSelectScreen, onGenerateMissingMockups }: Props) {
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

    const coveredCount = index.items.filter(i => i.mockupScreen).length;
    const missingCount = index.items.length - coveredCount;

    return (
        <div className="max-w-3xl xl:max-w-5xl mx-auto space-y-8">
            {/* Mockup coverage summary — makes partial coverage explicit
                instead of leaving users to discover empty Mockups tabs. */}
            <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg border border-neutral-200 bg-white px-4 py-2.5">
                <span className="inline-flex items-center gap-2 text-xs text-neutral-600">
                    <ImageIcon size={13} className={coveredCount > 0 ? 'text-emerald-500' : 'text-neutral-300'} />
                    <span>
                        Mockups: <span className="font-semibold text-neutral-800">{coveredCount} of {index.items.length}</span> screens covered
                    </span>
                </span>
                {onGenerateMissingMockups && missingCount > 0 && (
                    <button
                        type="button"
                        onClick={onGenerateMissingMockups}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                    >
                        <ImageIcon size={12} /> Generate missing mockups ({missingCount})
                    </button>
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
