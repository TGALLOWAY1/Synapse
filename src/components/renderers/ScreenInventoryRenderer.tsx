import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, ArrowRight } from 'lucide-react';
import type { ExitPath, ScreenItem, ScreenState } from '../../types';
import { ScreenImageGallery, type ScreenImageGalleryContext } from './ScreenImageGallery';
import { useScreenInventoryImageStore } from '../../store/screenInventoryImageStore';
import { parseScreenInventory } from '../../lib/screenInventoryNormalize';
import { PRIORITY_STYLES, stylablePriority } from './screenPriority';

interface Props {
    content: string;
    /** When supplied, each screen card gets a copy-prompt + image-upload gallery. */
    imageContext?: ScreenImageGalleryContext;
}

export function ScreenInventoryRenderer({ content, imageContext }: Props) {
    const inventory = parseScreenInventory(content);

    const loadForArtifactVersion = useScreenInventoryImageStore(s => s.loadForArtifactVersion);
    const artifactVersionId = imageContext?.artifactVersionId;
    useEffect(() => {
        if (artifactVersionId) void loadForArtifactVersion(artifactVersionId);
    }, [artifactVersionId, loadForArtifactVersion]);

    if (!inventory) return null;

    return (
        <div className="space-y-10">
            {inventory.sections.map((section, sectionIndex) => (
                <section key={sectionIndex}>
                    <SectionHeader
                        index={sectionIndex}
                        title={section.title}
                        description={section.description}
                        screenCount={section.screens.length}
                        flowSummary={section.flowSummary}
                    />
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

function SectionHeader({
    index,
    title,
    description,
    screenCount,
    flowSummary,
}: {
    index: number;
    title: string;
    description?: string;
    screenCount: number;
    flowSummary?: string;
}) {
    const journeySteps = parseJourney(flowSummary);
    return (
        <header className="mb-4 space-y-3">
            <div>
                <h3 className="text-base font-semibold text-neutral-800">
                    <span className="text-neutral-400 font-normal mr-2">{index + 1}.</span>
                    {title}
                </h3>
                {description && (
                    <p className="text-xs text-neutral-500 mt-1">{description}</p>
                )}
                <div className="mt-1.5 text-[11px] uppercase tracking-wide text-neutral-400">
                    {screenCount} {screenCount === 1 ? 'screen' : 'screens'}
                </div>
            </div>
            {journeySteps.length > 0 && <JourneyRow steps={journeySteps} />}
        </header>
    );
}

function parseJourney(flowSummary?: string): string[] {
    if (!flowSummary) return [];
    return flowSummary
        .split(/\s*(?:→|->|»|>)\s*/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

function JourneyRow({ steps }: { steps: string[] }) {
    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1.5">
                Journey
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap sm:flex-wrap pb-0.5">
                {steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs bg-white text-neutral-700 px-2 py-1 rounded-md border border-neutral-200 shadow-sm whitespace-nowrap">
                            {step}
                        </span>
                        {i < steps.length - 1 && (
                            <ChevronRight size={14} className="text-neutral-400 shrink-0" aria-hidden />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// Exported so the Experience workspace's Screen Detail "Overview" tab renders
// the exact same per-screen block as the standalone Screen Inventory renderer.
// `imageStorageName` (optional) is the stored generated name the upload
// gallery keys images by — the Experience workspace passes it so display
// renames never orphan uploads. Omitted (standalone renderer), the gallery
// keys by `screen.name` exactly as before.
export function ScreenCard({
    screen,
    imageContext,
    imageStorageName,
}: {
    screen: ScreenItem;
    imageContext?: ScreenImageGalleryContext;
    imageStorageName?: string;
}) {
    const ui = screen.coreUIElements && screen.coreUIElements.length > 0
        ? screen.coreUIElements
        : screen.components ?? [];
    const priority = stylablePriority(screen.priority);

    const hasNavigation = (screen.entryPoints?.length ?? 0) > 0
        || (screen.exitPaths?.length ?? 0) > 0;

    return (
        <article className="bg-white rounded-lg border border-neutral-200 p-4 space-y-3.5">
            <header className="flex items-start justify-between gap-2">
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

            {screen.purpose && (
                <p className="text-xs leading-relaxed text-neutral-700">{screen.purpose}</p>
            )}

            {screen.userIntent && (
                <CardField label="Intent">
                    <p className="text-xs italic text-neutral-600">{screen.userIntent}</p>
                </CardField>
            )}

            {screen.states && screen.states.length > 0 && (
                <CardField label="States">
                    <div className="flex flex-wrap gap-1">
                        {screen.states.map((s, i) => (
                            <StateChip key={i} state={s} />
                        ))}
                    </div>
                </CardField>
            )}

            {hasNavigation && <NavigationBlock screen={screen} />}

            {ui.length > 0 && (
                <CardField label="Core UI">
                    <div className="flex flex-wrap gap-1">
                        {ui.map((c, ci) => (
                            <span
                                key={ci}
                                className="text-xs bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded"
                            >
                                {c}
                            </span>
                        ))}
                    </div>
                </CardField>
            )}

            {screen.outputData && screen.outputData.length > 0 && (
                <CardField label="Outputs">
                    <ul className="text-xs text-neutral-700 space-y-0.5">
                        {screen.outputData.map((o, i) => (
                            <li key={i} className="flex gap-1.5">
                                <span className="text-neutral-300 select-none">·</span>
                                <span>{o}</span>
                            </li>
                        ))}
                    </ul>
                </CardField>
            )}

            {screen.risks && screen.risks.length > 0 && (
                <RisksBlock risks={screen.risks} />
            )}

            {screen.featureRefs && screen.featureRefs.length > 0 && (
                <LinkedFeatures refs={screen.featureRefs} />
            )}

            {imageContext && (
                <ScreenImageGallery screen={screen} context={imageContext} storageName={imageStorageName} />
            )}
        </article>
    );
}

function CardField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">
                {label}
            </div>
            {children}
        </div>
    );
}

function StateChip({ state }: { state: ScreenState }) {
    const tooltip = [
        state.description,
        state.trigger ? `Trigger: ${state.trigger}` : null,
        state.recoveryPath ? `Recovery: ${state.recoveryPath}` : null,
    ].filter(Boolean).join('\n');
    return (
        <span
            title={tooltip}
            className="text-xs bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded border border-neutral-200"
        >
            {state.name}
        </span>
    );
}

function NavigationBlock({ screen }: { screen: ScreenItem }) {
    const entry = screen.entryPoints ?? [];
    const exits: ExitPath[] = screen.exitPaths ?? [];
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1.5">
                Navigation
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {entry.length > 0 && (
                    <div>
                        <div className="text-[10px] font-medium text-neutral-500 mb-1">Entry</div>
                        <ul className="text-neutral-700 space-y-0.5">
                            {entry.map((e, i) => (
                                <li key={i} className="flex gap-1.5">
                                    <span className="text-neutral-300 select-none">·</span>
                                    <span>{e}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {exits.length > 0 && (
                    <div>
                        <div className="text-[10px] font-medium text-neutral-500 mb-1">Exit</div>
                        <ul className="text-neutral-700 space-y-1">
                            {exits.map((p, i) => (
                                <li key={i}>
                                    <div className="flex items-center gap-1 flex-wrap">
                                        <span>{p.label}</span>
                                        <ArrowRight size={10} className="text-neutral-400 shrink-0" aria-hidden />
                                        <span className="text-neutral-700">{p.target}</span>
                                    </div>
                                    {p.condition && (
                                        <div className="text-[11px] text-neutral-400 italic mt-0.5">
                                            when {p.condition}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}

function RisksBlock({ risks }: { risks: string[] }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">
                Risks / Edge Cases
            </div>
            <ul className="text-xs text-amber-800 space-y-1">
                {risks.map((r, i) => (
                    <li key={i} className="flex gap-1.5 items-start">
                        <AlertTriangle size={12} className="text-amber-600 mt-0.5 shrink-0" aria-hidden />
                        <span>{r}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

const FEATURE_REF_PATTERN = /^(f-?\d+|feat-?\d+)\b\s*[:\-—]?\s*(.*)$/i;

function parseFeatureRef(ref: string): { id: string; label?: string } {
    const trimmed = ref.trim();
    const match = trimmed.match(FEATURE_REF_PATTERN);
    if (match) {
        const id = match[1];
        const label = match[2]?.trim();
        return { id, label: label && label.length > 0 ? label : undefined };
    }
    return { id: trimmed };
}

function LinkedFeatures({ refs }: { refs: string[] }) {
    return (
        <CardField label="Linked Features">
            <div className="flex flex-wrap gap-1">
                {refs.map((ref, i) => {
                    const { id, label } = parseFeatureRef(ref);
                    return (
                        <span
                            key={i}
                            className="inline-flex items-center gap-1 text-[11px] bg-violet-50 text-violet-700 ring-1 ring-violet-200 rounded-md px-1.5 py-0.5"
                        >
                            <span className="font-mono font-medium">{id}</span>
                            {label && (
                                <span className="text-violet-600/90">{label}</span>
                            )}
                        </span>
                    );
                })}
            </div>
        </CardField>
    );
}
