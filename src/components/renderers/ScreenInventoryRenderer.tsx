import { useEffect } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { ExitPath, ScreenItem, ScreenPriority, ScreenState } from '../../types';
import { ScreenImageGallery, type ScreenImageGalleryContext } from './ScreenImageGallery';
import { useScreenInventoryImageStore } from '../../store/screenInventoryImageStore';
import { parseScreenInventory } from '../../lib/screenInventoryNormalize';

interface Props {
    content: string;
    /** When supplied, each screen card gets a copy-prompt + image-upload gallery. */
    imageContext?: ScreenImageGalleryContext;
}

const PRIORITY_STYLES: Record<ScreenPriority, string> = {
    P0: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200',
    P1: 'bg-sky-100 text-sky-700 ring-1 ring-sky-200',
    P2: 'bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200',
    P3: 'bg-neutral-50 text-neutral-400 ring-1 ring-neutral-100',
};

export function ScreenInventoryRenderer({ content, imageContext }: Props) {
    const inventory = parseScreenInventory(content);

    const loadForArtifactVersion = useScreenInventoryImageStore(s => s.loadForArtifactVersion);
    const artifactVersionId = imageContext?.artifactVersionId;
    useEffect(() => {
        if (artifactVersionId) void loadForArtifactVersion(artifactVersionId);
    }, [artifactVersionId, loadForArtifactVersion]);

    if (!inventory) return null;

    return (
        <div className="space-y-8">
            {inventory.sections.map((section, sectionIndex) => (
                <section key={sectionIndex}>
                    <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                            <h3 className="text-base font-semibold text-neutral-800">
                                <span className="text-neutral-400 font-normal mr-2">{sectionIndex + 1}.</span>
                                {section.title}
                            </h3>
                            {section.description && (
                                <p className="text-xs text-neutral-500 mt-0.5">{section.description}</p>
                            )}
                        </div>
                        {section.flowSummary && (
                            <p className="text-[11px] font-mono text-neutral-500 bg-neutral-50 rounded px-2 py-1">
                                <span className="text-neutral-400 mr-1">flow:</span>
                                {section.flowSummary}
                            </p>
                        )}
                    </header>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {section.screens.map((screen, screenIndex) => (
                            <ScreenCard
                                key={screenIndex}
                                screen={screen}
                                imageContext={imageContext}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function ScreenCard({
    screen,
    imageContext,
}: {
    screen: ScreenItem;
    imageContext?: ScreenImageGalleryContext;
}) {
    const ui = screen.coreUIElements && screen.coreUIElements.length > 0
        ? screen.coreUIElements
        : screen.components ?? [];
    const priority = (screen.priority in PRIORITY_STYLES
        ? screen.priority
        : 'P1') as ScreenPriority;

    return (
        <article className="bg-white rounded-lg border border-neutral-200 p-4 space-y-3">
            <header className="flex items-center justify-between gap-2">
                <h4 className="font-semibold text-neutral-800 text-sm leading-tight">
                    {screen.name}
                </h4>
                <div className="flex items-center gap-1.5 shrink-0">
                    {screen.type && screen.type !== 'screen' && (
                        <span className="text-[10px] uppercase tracking-wide text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded">
                            {screen.type}
                        </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[priority]}`}>
                        {priority}
                    </span>
                </div>
            </header>

            <p className="text-xs text-neutral-700">{screen.purpose}</p>

            {screen.userIntent && (
                <p className="text-xs italic text-neutral-500">
                    <span className="not-italic font-medium text-neutral-600 mr-1">Intent:</span>
                    {screen.userIntent}
                </p>
            )}

            {screen.states && screen.states.length > 0 && (
                <StatesRow states={screen.states} />
            )}

            {(screen.entryPoints?.length || screen.exitPaths?.length) ? (
                <FlowBlock screen={screen} />
            ) : null}

            {ui.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">Core UI</div>
                    <div className="flex flex-wrap gap-1">
                        {ui.map((c, ci) => (
                            <span key={ci} className="text-xs bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded">
                                {c}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {screen.outputData && screen.outputData.length > 0 && (
                <div className="text-xs">
                    <span className="text-[10px] uppercase tracking-wide text-neutral-400 mr-1">Outputs:</span>
                    <span className="text-neutral-600">{screen.outputData.join(' · ')}</span>
                </div>
            )}

            {screen.risks && screen.risks.length > 0 && (
                <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1.5 flex gap-1.5 items-start">
                    <AlertTriangle size={12} className="text-amber-600 mt-0.5 shrink-0" />
                    <ul className="text-xs text-amber-800 space-y-0.5">
                        {screen.risks.map((r, ri) => <li key={ri}>{r}</li>)}
                    </ul>
                </div>
            )}

            {screen.featureRefs && screen.featureRefs.length > 0 && (
                <div className="text-[10px] font-mono text-neutral-400">
                    {screen.featureRefs.join(' · ')}
                </div>
            )}

            {imageContext && <ScreenImageGallery screen={screen} context={imageContext} />}
        </article>
    );
}

function StatesRow({ states }: { states: ScreenState[] }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">States</div>
            <div className="flex flex-wrap gap-1">
                {states.map((s, i) => (
                    <span
                        key={i}
                        title={[s.description, s.trigger ? `Trigger: ${s.trigger}` : null, s.recoveryPath ? `Recovery: ${s.recoveryPath}` : null]
                            .filter(Boolean).join('\n')}
                        className="text-xs bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded border border-neutral-200"
                    >
                        {s.name}
                    </span>
                ))}
            </div>
        </div>
    );
}

function FlowBlock({ screen }: { screen: ScreenItem }) {
    const entry = screen.entryPoints ?? [];
    const exits: ExitPath[] = screen.exitPaths ?? [];
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {entry.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">Entry</div>
                    <ul className="text-neutral-600 space-y-0.5">
                        {entry.map((e, i) => (
                            <li key={i}>· {e}</li>
                        ))}
                    </ul>
                </div>
            )}
            {exits.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">Exits</div>
                    <ul className="text-neutral-600 space-y-0.5">
                        {exits.map((p, i) => (
                            <li key={i} className="flex items-center gap-1 flex-wrap">
                                <span>{p.label}</span>
                                <ArrowRight size={10} className="text-neutral-400 shrink-0" />
                                <span className="text-neutral-700">{p.target}</span>
                                {p.condition && (
                                    <span className="text-neutral-400 italic">— {p.condition}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
