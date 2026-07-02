// Screen Detail — the "I am working on this screen" page of the Experience
// workspace. Joins the three experience artifacts for ONE screen:
//   Overview → the existing ScreenCard (screen_inventory details + upload
//              gallery), unchanged presentation;
//   Flow     → every user_flows flow that references this screen, rendered
//              with the existing FlowJourney/StepCard pieces and the current
//              screen's steps highlighted;
//   Mockups  → the matching MockupScreenImage (which internally routes to the
//              manual upload sheet per the image-source mode), or an honest
//              empty state — mockup generation only covers key screens.
// Read-only except for behavior the reused components already support
// (image generate/upload). All data arrives via props from ArtifactWorkspace;
// this component never queries artifacts from the store itself.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, ArrowLeft, Image as ImageIcon, Loader2, Pencil, RefreshCcw, RotateCcw, Workflow,
} from 'lucide-react';
import type {
    Feature, GenerationStatus, MockupPayload, MockupSettings, ScreenPriority,
} from '../../types';
import {
    groupFlowRefsByFlow,
    type ScreenExperienceItem,
    type ScreenFlowGroup,
    type ScreenMetadataEdit,
} from '../../lib/screenExperience';
import { ScreenCard } from '../renderers/ScreenInventoryRenderer';
import { PRIORITY_STYLES, stylablePriority } from '../renderers/screenPriority';
import type { ScreenImageGalleryContext } from '../renderers/ScreenImageGallery';
import { useScreenInventoryImageStore } from '../../store/screenInventoryImageStore';
import { FlowJourney } from '../renderers/userFlows/FlowJourney';
import { StepCard } from '../renderers/userFlows/StepCard';
import { FeatureDetailDrawer } from '../renderers/userFlows/FeatureDetailDrawer';
import type { FeatureRef, FlowIssue } from '../renderers/userFlows/types';
import { MockupScreenImage } from '../mockups/MockupScreenImage';
import { ScreenDetailTabs, type ScreenDetailTab } from './ScreenDetailTabs';

/** Everything the Mockups tab needs to render the reused mockup components. */
export interface ScreenDetailMockupContext {
    projectId: string;
    artifactId: string;
    versionId: string;
    payload: MockupPayload;
    settings: MockupSettings;
}

interface Props {
    item: ScreenExperienceItem;
    activeTab: ScreenDetailTab;
    onTabChange: (tab: ScreenDetailTab) => void;
    onBack: () => void;
    /** Navigate to another screen's detail (flow-node clicks). */
    onNavigateToScreen: (slug: string) => void;
    availableScreenSlugs: ReadonlySet<string>;
    /** Overview upload gallery context — absent for legacy inventories. */
    screenImageContext?: ScreenImageGalleryContext;
    /** Mockups tab context — absent when no parseable mockup artifact exists. */
    mockupContext?: ScreenDetailMockupContext;
    /** Mockup generation slot status, for honest Mockups-tab empty states. */
    mockupStatus?: GenerationStatus;
    onRetryMockup?: () => void;
    /** Canonical feature catalog for StepCard feature chips + the drawer. */
    features?: Feature[];
    /**
     * Persists a metadata edit overlay for this screen (null clears it back
     * to the generated content). Absent → the detail view stays read-only.
     */
    onSaveScreenEdit?: (screenId: string, edit: ScreenMetadataEdit | null) => void;
    /**
     * Adds this (uncovered) screen to the current mockup set — a free
     * metadata-overlay write; image generation stays a separate explicit,
     * cost-labeled action on the resulting panel. Absent when the screen is
     * already covered or no mockup artifact exists.
     */
    onAddToMockups?: () => void;
}

export function ScreenDetailView({
    item, activeTab, onTabChange, onBack,
    onNavigateToScreen, availableScreenSlugs,
    screenImageContext, mockupContext, mockupStatus, onRetryMockup,
    features, onSaveScreenEdit, onAddToMockups,
}: Props) {
    const { screen } = item;
    const priority = stylablePriority(screen.priority);
    const [editing, setEditing] = useState(false);

    // Hydrate the per-screen upload gallery (Overview tab) exactly like the
    // standalone ScreenInventoryRenderer does.
    const loadForArtifactVersion = useScreenInventoryImageStore(s => s.loadForArtifactVersion);
    const artifactVersionId = screenImageContext?.artifactVersionId;
    useEffect(() => {
        if (artifactVersionId) void loadForArtifactVersion(artifactVersionId);
    }, [artifactVersionId, loadForArtifactVersion]);

    const flowGroups = useMemo(
        () => groupFlowRefsByFlow(item.relatedFlows),
        [item.relatedFlows],
    );

    const renamed = item.isEdited && item.screen.name !== item.baseScreen.name;

    return (
        <div className="max-w-3xl xl:max-w-5xl mx-auto space-y-4">
            <div>
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-indigo-700 transition"
                >
                    <ArrowLeft size={13} /> All screens
                </button>
                <div className="mt-2 flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-neutral-900 leading-tight">
                            {screen.name}
                        </h2>
                        <p className="text-[11px] uppercase tracking-wide text-neutral-400 mt-0.5">
                            {item.sectionTitle}
                            {renamed && (
                                <span className="normal-case tracking-normal text-neutral-400">
                                    {' '}· generated as &ldquo;{item.baseScreen.name}&rdquo;
                                </span>
                            )}
                        </p>
                    </div>
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
            </div>

            <ScreenDetailTabs
                active={activeTab}
                onChange={onTabChange}
                flowRefCount={item.relatedFlows.length}
                hasMockup={Boolean(item.mockupScreen)}
            />

            {activeTab === 'overview' && (
                <div className="space-y-3">
                    {onSaveScreenEdit && !editing && (
                        <div className="flex items-center justify-end gap-2">
                            {item.isEdited && (
                                <button
                                    type="button"
                                    onClick={() => onSaveScreenEdit(item.id, null)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 rounded-md transition"
                                    title="Discard your edits and show the generated content"
                                >
                                    <RotateCcw size={12} /> Reset to generated
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setEditing(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                            >
                                <Pencil size={12} /> Edit details
                            </button>
                        </div>
                    )}
                    {onSaveScreenEdit && editing ? (
                        <ScreenEditForm
                            item={item}
                            onSave={(edit) => {
                                onSaveScreenEdit(item.id, edit);
                                setEditing(false);
                            }}
                            onCancel={() => setEditing(false)}
                        />
                    ) : (
                        <>
                            <ScreenCard
                                screen={screen}
                                imageContext={screenImageContext}
                                imageStorageName={item.baseScreen.name}
                            />
                            {item.edit?.notes && (
                                <div className="bg-violet-50/60 rounded-lg border border-violet-200 p-3">
                                    <div className="text-[10px] uppercase tracking-wide text-violet-600 mb-1">
                                        Notes
                                    </div>
                                    <p className="text-xs text-neutral-700 whitespace-pre-wrap">
                                        {item.edit.notes}
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {activeTab === 'flow' && (
                <FlowTab
                    item={item}
                    flowGroups={flowGroups}
                    onNavigateToScreen={onNavigateToScreen}
                    availableScreenSlugs={availableScreenSlugs}
                    features={features}
                />
            )}

            {activeTab === 'mockups' && (
                <MockupsTab
                    item={item}
                    mockupContext={mockupContext}
                    mockupStatus={mockupStatus}
                    onRetryMockup={onRetryMockup}
                    onAddToMockups={onAddToMockups}
                />
            )}
        </div>
    );
}

// --- Overview edit form -------------------------------------------------------

const EDIT_PRIORITIES: ScreenPriority[] = ['P0', 'P1', 'P2', 'P3'];

/**
 * Minimal, rename-safe metadata editor. Saves an overlay (see
 * ScreenMetadataEdit) containing only the fields that differ from the stored
 * generated screen — an overlay equal to the generated content saves as null,
 * clearing the edit. The generated artifact content is never rewritten.
 */
function ScreenEditForm({
    item, onSave, onCancel,
}: {
    item: ScreenExperienceItem;
    onSave: (edit: ScreenMetadataEdit | null) => void;
    onCancel: () => void;
}) {
    const { screen, baseScreen } = item;
    const [name, setName] = useState(screen.name);
    const [purpose, setPurpose] = useState(screen.purpose ?? '');
    const [userIntent, setUserIntent] = useState(screen.userIntent ?? '');
    const [priority, setPriority] = useState<ScreenPriority>(stylablePriority(screen.priority));
    const [notes, setNotes] = useState(item.edit?.notes ?? '');

    const handleSave = () => {
        const edit: ScreenMetadataEdit = {};
        const trimmedName = name.trim();
        if (trimmedName && trimmedName !== baseScreen.name) edit.name = trimmedName;
        if (purpose !== (baseScreen.purpose ?? '')) edit.purpose = purpose;
        if (userIntent !== (baseScreen.userIntent ?? '')) edit.userIntent = userIntent;
        if (priority !== stylablePriority(baseScreen.priority)) edit.priority = priority;
        if (notes.trim()) edit.notes = notes;
        onSave(Object.keys(edit).length > 0 ? edit : null);
    };

    const field = 'w-full text-sm border border-neutral-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300';

    return (
        <div className="bg-white rounded-lg border border-indigo-200 p-4 space-y-3">
            <p className="text-[11px] text-neutral-500">
                Edits are saved as an overlay on this artifact version — the generated
                content is kept, and mockups, flows, and uploaded images stay attached
                even when you rename the screen.
            </p>
            <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-neutral-400">Name</span>
                <input className={field} value={name} onChange={e => setName(e.target.value)} />
            </label>
            <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-neutral-400">Purpose</span>
                <textarea className={field} rows={2} value={purpose} onChange={e => setPurpose(e.target.value)} />
            </label>
            <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-neutral-400">User intent</span>
                <textarea className={field} rows={2} value={userIntent} onChange={e => setUserIntent(e.target.value)} />
            </label>
            <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-neutral-400">Priority</span>
                <select
                    className={field}
                    value={priority}
                    onChange={e => setPriority(e.target.value as ScreenPriority)}
                >
                    {EDIT_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
            </label>
            <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-neutral-400">Notes (internal)</span>
                <textarea
                    className={field}
                    rows={2}
                    placeholder="Anything the team should know about this screen…"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                />
            </label>
            <div className="flex items-center justify-end gap-2 pt-1">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 rounded-md transition"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition font-medium"
                >
                    Save
                </button>
            </div>
        </div>
    );
}

// --- Flow tab ---------------------------------------------------------------

function FlowTab({
    item, flowGroups, onNavigateToScreen, availableScreenSlugs, features,
}: {
    item: ScreenExperienceItem;
    flowGroups: ScreenFlowGroup[];
    onNavigateToScreen: (slug: string) => void;
    availableScreenSlugs: ReadonlySet<string>;
    features?: Feature[];
}) {
    // Feature-chip drawer, mirroring UserFlowsRenderer's wiring so StepCard
    // chips stay functional inside the detail view.
    const featuresById = useMemo(() => {
        if (!features) return undefined;
        const map = new Map<string, Feature>();
        for (const f of features) {
            map.set(f.id.toLowerCase().replace(/-/g, ''), f);
        }
        return map;
    }, [features]);
    const [drawerRef, setDrawerRef] = useState<FeatureRef | null>(null);
    const [drawerPinned, setDrawerPinned] = useState(false);
    const onSelectFeature = useCallback((refToken: FeatureRef) => setDrawerRef(refToken), []);
    const onCloseDrawer = useCallback(() => {
        if (drawerPinned) return;
        setDrawerRef(null);
    }, [drawerPinned]);
    const onTogglePin = useCallback(() => setDrawerPinned(p => !p), []);

    if (flowGroups.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-dashed border-neutral-300 p-8 text-center">
                <Workflow size={20} className="text-neutral-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-neutral-700">
                    No user flow currently references this screen.
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                    Flow steps link to screens by their exact screen name
                    (&ldquo;[{item.screen.name}] — action → response&rdquo;).
                </p>
            </div>
        );
    }

    const drawerFeature = drawerRef ? featuresById?.get(drawerRef.id) : undefined;
    const allFlows = flowGroups.map(g => g.flow);

    return (
        <div className="not-prose space-y-6">
            {flowGroups.map(group => {
                const highlighted = new Set(group.steps.map(s => s.stepIndex));
                // Per-step issue links, mirroring UserFlowsRenderer.
                const inlineByStep = new Map<number, FlowIssue[]>();
                const issuesByStep = new Map<number, number>();
                for (const issue of group.flow.issues) {
                    if (typeof issue.linkedStepIndex !== 'number') continue;
                    const list = inlineByStep.get(issue.linkedStepIndex) ?? [];
                    list.push(issue);
                    inlineByStep.set(issue.linkedStepIndex, list);
                    issuesByStep.set(
                        issue.linkedStepIndex,
                        (issuesByStep.get(issue.linkedStepIndex) ?? 0) + 1,
                    );
                }
                return (
                    <section key={group.flowIndex}>
                        <header className="mb-2 flex items-baseline justify-between gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold text-neutral-800">
                                {group.flow.title}
                            </h3>
                            <span className="text-[11px] text-neutral-400">
                                Flow {group.flowIndex + 1} · appears in{' '}
                                {group.steps.length === 1
                                    ? `step ${group.steps[0].stepIndex + 1}`
                                    : `${group.steps.length} steps`}
                            </span>
                        </header>
                        {group.flow.goal && (
                            <p className="text-xs text-neutral-500 mb-3">{group.flow.goal}</p>
                        )}
                        <FlowJourney
                            flowIndex={group.flowIndex}
                            steps={group.flow.steps}
                            issuesByStep={issuesByStep}
                            highlightedStepIndices={highlighted}
                            onNavigateToScreen={onNavigateToScreen}
                            availableScreenSlugs={availableScreenSlugs}
                        />
                        {group.steps.map(({ step, stepIndex }) => (
                            <StepCard
                                key={stepIndex}
                                flowIndex={group.flowIndex}
                                step={step}
                                inlineIssues={inlineByStep.get(stepIndex) ?? []}
                                featuresById={featuresById}
                                onSelectFeature={onSelectFeature}
                            />
                        ))}
                    </section>
                );
            })}

            <FeatureDetailDrawer
                open={drawerRef !== null}
                refToken={drawerRef}
                feature={drawerFeature}
                flows={allFlows}
                onClose={onCloseDrawer}
                pinned={drawerPinned}
                onTogglePin={onTogglePin}
            />
        </div>
    );
}

// --- Mockups tab ------------------------------------------------------------

function MockupsTab({
    item, mockupContext, mockupStatus, onRetryMockup, onAddToMockups,
}: {
    item: ScreenExperienceItem;
    mockupContext?: ScreenDetailMockupContext;
    mockupStatus?: GenerationStatus;
    onRetryMockup?: () => void;
    onAddToMockups?: () => void;
}) {
    if (mockupContext && item.mockupScreen) {
        return (
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                <MockupScreenImage
                    projectId={mockupContext.projectId}
                    artifactId={mockupContext.artifactId}
                    versionId={mockupContext.versionId}
                    screen={item.mockupScreen}
                    payload={mockupContext.payload}
                    settings={mockupContext.settings}
                />
            </div>
        );
    }

    if (mockupStatus === 'generating' || mockupStatus === 'queued') {
        return (
            <div className="bg-white rounded-xl border border-neutral-200 p-8 text-center">
                <Loader2 size={20} className="text-indigo-500 animate-spin mx-auto mb-2" />
                <p className="text-sm font-medium text-neutral-700">Mockups are being generated…</p>
                <p className="text-xs text-neutral-500 mt-1">
                    Check back once the run completes to see whether this screen is covered.
                </p>
            </div>
        );
    }

    if (mockupStatus === 'error' || mockupStatus === 'interrupted') {
        return (
            <div className="bg-white rounded-xl border border-neutral-200 p-8 text-center">
                <AlertTriangle size={20} className="text-amber-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-neutral-700">Mockup generation didn&rsquo;t finish.</p>
                {onRetryMockup && (
                    <button
                        type="button"
                        onClick={onRetryMockup}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                    >
                        <RefreshCcw size={14} /> Retry mockup generation
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-dashed border-neutral-300 p-8 text-center">
            <ImageIcon size={20} className="text-neutral-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-neutral-700">
                No mockup has been generated for this screen yet.
            </p>
            <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
                Mockup generation covers the key screens by default. Add this screen to the
                mockup set to generate an AI image or upload your own — adding it is free;
                image generation stays a separate, clearly-priced action.
            </p>
            {onAddToMockups && (
                <button
                    type="button"
                    onClick={onAddToMockups}
                    className="mt-4 inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition font-medium"
                >
                    <ImageIcon size={14} /> Add to mockups
                </button>
            )}
        </div>
    );
}
