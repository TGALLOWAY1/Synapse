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
    AlertTriangle, ArrowLeft, GitBranch, Image as ImageIcon, Link2, Loader2, Pencil,
    RefreshCcw, RotateCcw, Workflow,
} from 'lucide-react';
import type {
    Feature, GenerationStatus, MockupFidelity, MockupPayload, MockupPlatform,
    MockupSettings, ScreenPriority,
} from '../../types';
import {
    groupFlowRefsByFlow,
    type ScreenExperienceItem,
    type ScreenFlowGroup,
    type ScreenMetadataEdit,
} from '../../lib/screenExperience';
import {
    buildMockupSpecCoverage, buildMockupVariantRows, parseDecisionBranches,
    REVIEW_STATUS_LABELS,
    type MockupVariantRow, type ScreenReadiness, type ScreenReviewStatus,
} from '../../lib/screenReadiness';
import { ScreenOverviewPanel } from './ScreenOverviewPanel';
import { ReadinessBadge } from './ReadinessBadge';
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
    /** Mockup artifact version number (metadata line). */
    versionNumber?: number;
    /** "Version N" label of the PRD the mockup was generated from. */
    prdVersionLabel?: string;
}

interface Props {
    item: ScreenExperienceItem;
    /** Derived/user-set review readiness (src/lib/screenReadiness.ts). */
    readiness?: ScreenReadiness;
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
    /** Orphaned mockup screens (matched to no canonical screen) offered for
     * relinking to THIS screen from its Mockups tab. */
    unmatchedMockups?: Array<{ id: string; name: string }>;
    /** Persists a screenLinks repair binding the chosen mockup to this screen. */
    onLinkMockup?: (mockupScreenId: string) => void;
}

export function ScreenDetailView({
    item, readiness, activeTab, onTabChange, onBack,
    onNavigateToScreen, availableScreenSlugs,
    screenImageContext, mockupContext, mockupStatus, onRetryMockup,
    features, onSaveScreenEdit, onAddToMockups, unmatchedMockups, onLinkMockup,
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
                        {readiness && <ReadinessBadge readiness={readiness} />}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[priority]}`}>
                            {priority}
                        </span>
                    </div>
                </div>
                {readiness && readiness.status !== 'implementation_ready' && readiness.reasons.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-amber-700">
                        {readiness.source === 'derived' ? 'Estimated status — ' : ''}
                        {readiness.reasons.join(' ')}
                    </p>
                )}
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
                            <ScreenOverviewPanel
                                item={item}
                                readiness={readiness}
                                features={features}
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
                    unmatchedMockups={unmatchedMockups}
                    onLinkMockup={onLinkMockup}
                    onSaveScreenEdit={onSaveScreenEdit}
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
    const [reviewStatus, setReviewStatus] = useState<ScreenReviewStatus | ''>(item.edit?.reviewStatus ?? '');

    const handleSave = () => {
        // Start from the existing overlay so fields this form doesn't edit
        // (mockupVariantStatus, anything written by newer code) survive a
        // read-modify-write — then own only this form's fields.
        const edit: ScreenMetadataEdit = { ...(item.edit ?? {}) };
        delete edit.name;
        delete edit.purpose;
        delete edit.userIntent;
        delete edit.priority;
        delete edit.notes;
        delete edit.reviewStatus;
        const trimmedName = name.trim();
        if (trimmedName && trimmedName !== baseScreen.name) edit.name = trimmedName;
        if (purpose !== (baseScreen.purpose ?? '')) edit.purpose = purpose;
        if (userIntent !== (baseScreen.userIntent ?? '')) edit.userIntent = userIntent;
        if (priority !== stylablePriority(baseScreen.priority)) edit.priority = priority;
        if (notes.trim()) edit.notes = notes;
        if (reviewStatus) edit.reviewStatus = reviewStatus;
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
                <span className="text-[10px] uppercase tracking-wide text-neutral-400">Review status</span>
                <select
                    className={field}
                    value={reviewStatus}
                    onChange={e => setReviewStatus(e.target.value as ScreenReviewStatus | '')}
                >
                    <option value="">Estimate automatically (default)</option>
                    {(Object.keys(REVIEW_STATUS_LABELS) as ScreenReviewStatus[]).map(s => (
                        <option key={s} value={s}>{REVIEW_STATUS_LABELS[s]}</option>
                    ))}
                </select>
                <span className="block mt-0.5 text-[11px] text-neutral-400">
                    Setting a status overrides the estimated one — derived warnings stay visible.
                </span>
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
                const repeated = group.steps.length > 1;
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
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2.5 mb-3">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 mb-1.5">
                                This screen appears in
                            </div>
                            <ul className="space-y-1.5">
                                {group.steps.map(({ step, stepIndex }, appearanceIdx) => {
                                    const decisionCount = step.decisions.length;
                                    // The flow only knows this screen by name, so a repeated
                                    // appearance is labeled by its step position; the User/System
                                    // lines below distinguish the phase where the flow does.
                                    return (
                                        <li key={stepIndex} className="text-xs text-neutral-700">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="font-medium text-indigo-800">
                                                    {repeated
                                                        ? `${item.screen.name} — Step ${stepIndex + 1} (appearance ${appearanceIdx + 1} of ${group.steps.length})`
                                                        : `Step ${stepIndex + 1}`}
                                                </span>
                                                {decisionCount > 0 && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 px-1.5 py-0.5 rounded-full">
                                                        <GitBranch size={9} aria-hidden />
                                                        {decisionCount} {decisionCount === 1 ? 'decision' : 'decisions'}
                                                    </span>
                                                )}
                                            </div>
                                            {step.userAction && (
                                                <div className="mt-0.5 text-[11px] text-neutral-500">
                                                    <span className="font-medium text-neutral-400 uppercase tracking-wide text-[9px] mr-1">User</span>
                                                    {step.userAction}
                                                </div>
                                            )}
                                            {step.systemBehavior && (
                                                <div className="mt-0.5 text-[11px] text-neutral-500">
                                                    <span className="font-medium text-neutral-400 uppercase tracking-wide text-[9px] mr-1">System</span>
                                                    {step.systemBehavior}
                                                </div>
                                            )}
                                            {step.decisions.map((decision, di) => (
                                                <DecisionBranches key={di} decision={decision} />
                                            ))}
                                        </li>
                                    );
                                })}
                            </ul>
                            {repeated && (
                                <p className="mt-2 text-[11px] text-neutral-500">
                                    Repeated appearances usually represent different phases or states of
                                    this screen — the step details above distinguish them where the flow does.
                                </p>
                            )}
                        </div>
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

/**
 * One flow decision rendered branch-aware: when the decision text parses into
 * condition → outcome pairs (see parseDecisionBranches) they render as an
 * explicit branch list; otherwise the raw text shows with an honest
 * "branch outcomes not specified" nudge — never an invented branch.
 */
function DecisionBranches({ decision }: { decision: string }) {
    const branches = parseDecisionBranches(decision);
    if (branches.length === 0) {
        return (
            <div className="mt-0.5 text-[11px]">
                <span className="text-neutral-500">
                    <span className="font-medium text-neutral-400 uppercase tracking-wide text-[9px] mr-1">Decision</span>
                    {decision}
                </span>
                <span className="text-amber-700"> — branch outcomes not specified in the flow. Review recommended.</span>
            </div>
        );
    }
    return (
        <div className="mt-1 text-[11px]">
            <div className="font-medium text-neutral-400 uppercase tracking-wide text-[9px]">Decision branches</div>
            <ul className="mt-0.5 space-y-0.5">
                {branches.map((b, i) => (
                    <li key={i} className="flex items-center gap-1 flex-wrap text-neutral-600">
                        <span>{b.condition}</span>
                        <span className="text-neutral-300" aria-hidden>→</span>
                        <span className="text-neutral-800">{b.outcome}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// --- Mockups tab ------------------------------------------------------------

const PLATFORM_LABELS: Record<MockupPlatform, string> = {
    mobile: 'Mobile',
    desktop: 'Desktop',
    responsive: 'Responsive',
};

const FIDELITY_LABELS: Record<MockupFidelity, string> = {
    low: 'Low fidelity',
    mid: 'Mid fidelity',
    high: 'High fidelity',
};

function MockupsTab({
    item, mockupContext, mockupStatus, onRetryMockup, onAddToMockups,
    unmatchedMockups, onLinkMockup, onSaveScreenEdit,
}: {
    item: ScreenExperienceItem;
    mockupContext?: ScreenDetailMockupContext;
    mockupStatus?: GenerationStatus;
    onRetryMockup?: () => void;
    onAddToMockups?: () => void;
    unmatchedMockups?: Array<{ id: string; name: string }>;
    onLinkMockup?: (mockupScreenId: string) => void;
    onSaveScreenEdit?: (screenId: string, edit: ScreenMetadataEdit | null) => void;
}) {
    const [linkTarget, setLinkTarget] = useState('');

    // Persist a per-variant status into the screen's edit overlay (null
    // clears the override back to the tracked/derived status). Merges into
    // the existing edit so name/notes/reviewStatus and any unknown overlay
    // fields survive untouched.
    const setVariantStatus = onSaveScreenEdit
        ? (variantId: string, status: 'accepted' | 'not_needed' | null) => {
            const current: ScreenMetadataEdit = { ...(item.edit ?? {}) };
            const statuses = { ...(current.mockupVariantStatus ?? {}) };
            if (status) statuses[variantId] = status;
            else delete statuses[variantId];
            if (Object.keys(statuses).length > 0) current.mockupVariantStatus = statuses;
            else delete current.mockupVariantStatus;
            onSaveScreenEdit(item.id, Object.keys(current).length > 0 ? current : null);
        }
        : undefined;

    if (mockupContext && item.mockupScreen) {
        const specCoverage = buildMockupSpecCoverage(
            item.baseScreen,
            item.mockupScreen.coreUIElements,
        );
        const variantRows = buildMockupVariantRows(item, mockupContext.settings.platform);
        const metaParts = [
            'Generated product screen preview',
            PLATFORM_LABELS[mockupContext.settings.platform],
            FIDELITY_LABELS[mockupContext.settings.fidelity],
        ];
        if (mockupContext.prdVersionLabel) metaParts.push(`Generated from PRD ${mockupContext.prdVersionLabel}`);
        if (mockupContext.versionNumber) metaParts.push(`Mockup v${mockupContext.versionNumber}`);
        return (
            <div className="space-y-3">
                <p className="text-[11px] text-neutral-500">
                    {metaParts.join(' · ')}
                </p>
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

                <MockupVariantsCard
                    rows={variantRows}
                    prdVersionLabel={mockupContext.prdVersionLabel}
                    mockupVersionNumber={mockupContext.versionNumber}
                    onSetVariantStatus={setVariantStatus}
                />

                {specCoverage.length > 0 && (
                    <div className="bg-white rounded-lg border border-neutral-200 p-4">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                            Spec coverage in mockup
                        </h4>
                        <ul className="space-y-1 text-xs">
                            {specCoverage.map((row, i) => (
                                <li key={i} className="flex items-center justify-between gap-2">
                                    <span className="text-neutral-700">{row.element}</span>
                                    {row.status === 'in_spec' ? (
                                        <span className="text-emerald-700 font-medium">In mockup spec</span>
                                    ) : (
                                        <span className="text-amber-700">Not in mockup spec</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <p className="text-[11px] text-neutral-400 mt-2">
                            Compared against the mockup&rsquo;s generation spec, not the rendered image —
                            treat &ldquo;Not in mockup spec&rdquo; as a prompt to double-check the visual.
                        </p>
                    </div>
                )}
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
            {onLinkMockup && unmatchedMockups && unmatchedMockups.length > 0 && (
                <div className="mt-5 pt-4 border-t border-neutral-200 max-w-sm mx-auto">
                    <p className="text-[11px] text-neutral-500 mb-2">
                        Or link an existing mockup that lost its screen match
                        (e.g. after a regeneration renamed things):
                    </p>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                        <select
                            value={linkTarget}
                            onChange={e => setLinkTarget(e.target.value)}
                            aria-label="Orphaned mockup to link to this screen"
                            className="text-xs border border-neutral-300 rounded-md px-2 py-1.5 max-w-[220px]"
                        >
                            <option value="">Choose mockup…</option>
                            {unmatchedMockups.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            disabled={!linkTarget}
                            onClick={() => linkTarget && onLinkMockup(linkTarget)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        >
                            <Link2 size={12} /> Link mockup
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// --- Mockup variants card -----------------------------------------------------

const VARIANT_STATUS_META: Record<MockupVariantRow['status'], { label: string; className: string }> = {
    generated: { label: 'Generated', className: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
    missing: { label: 'Missing', className: 'text-amber-700 bg-amber-50 ring-amber-200' },
    accepted: { label: 'Accepted', className: 'text-sky-700 bg-sky-50 ring-sky-200' },
    not_needed: { label: 'Not needed', className: 'text-neutral-500 bg-neutral-100 ring-neutral-200' },
};

/**
 * Per-state / per-platform mockup variant tracking. Status comes from
 * generated mockup METADATA (the spec-to-spec join) plus the user's overlay —
 * never from inspecting the rendered image, and the copy says so. Per-variant
 * image generation isn't wired yet, so the only actions offered are the two
 * that really work: mark a variant accepted, or mark a recommended variant
 * not needed (both persist to the screen's edit overlay).
 */
function MockupVariantsCard({
    rows, prdVersionLabel, mockupVersionNumber, onSetVariantStatus,
}: {
    rows: MockupVariantRow[];
    prdVersionLabel?: string;
    mockupVersionNumber?: number;
    onSetVariantStatus?: (variantId: string, status: 'accepted' | 'not_needed' | null) => void;
}) {
    if (rows.length === 0) return null;
    const missingRequired = rows.filter(r => r.required && r.status === 'missing').length;
    const generatedFrom = [
        prdVersionLabel ? `PRD ${prdVersionLabel}` : null,
        mockupVersionNumber ? `mockup v${mockupVersionNumber}` : null,
    ].filter(Boolean).join(' · ');
    return (
        <div className="bg-white rounded-lg border border-neutral-200 p-4">
            <header className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    Mockup variants
                </h4>
                <span className="text-[9px] uppercase tracking-wide text-indigo-500 bg-indigo-50 ring-1 ring-indigo-100 px-1.5 py-0.5 rounded">
                    Tracked from generated mockup metadata
                </span>
            </header>
            <ul className="divide-y divide-neutral-100">
                {rows.map(row => {
                    const meta = VARIANT_STATUS_META[row.status];
                    return (
                        <li key={row.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-medium text-neutral-800">{row.label}</span>
                                    {row.platform && (
                                        <span className="text-[10px] text-neutral-500 bg-neutral-100 px-1.5 py-px rounded">
                                            {PLATFORM_LABELS[row.platform]}
                                        </span>
                                    )}
                                    {row.stateType && row.stateType !== 'default' && (
                                        <span className="text-[9px] uppercase tracking-wide text-sky-700 bg-sky-50 ring-1 ring-sky-100 px-1.5 py-px rounded">
                                            {row.stateType}
                                        </span>
                                    )}
                                    {row.required && row.id !== 'default' && (
                                        <span className="text-[9px] uppercase tracking-wide text-violet-700 bg-violet-50 ring-1 ring-violet-100 px-1.5 py-px rounded">
                                            Recommended
                                        </span>
                                    )}
                                </div>
                                {row.status === 'generated' && generatedFrom && (
                                    <div className="text-[10px] text-neutral-400 mt-0.5">
                                        Generated from {generatedFrom}
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 ${meta.className}`}>
                                    {meta.label}
                                </span>
                                {onSetVariantStatus && (
                                    row.userSet ? (
                                        <button
                                            type="button"
                                            onClick={() => onSetVariantStatus(row.id, null)}
                                            className="text-[10px] text-neutral-500 hover:text-neutral-700 underline decoration-dotted"
                                        >
                                            Undo
                                        </button>
                                    ) : row.status === 'generated' ? (
                                        <button
                                            type="button"
                                            onClick={() => onSetVariantStatus(row.id, 'accepted')}
                                            className="text-[10px] px-2 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition"
                                        >
                                            Mark accepted
                                        </button>
                                    ) : row.status === 'missing' ? (
                                        <button
                                            type="button"
                                            onClick={() => onSetVariantStatus(row.id, 'not_needed')}
                                            className="text-[10px] px-2 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition"
                                            title="Skip this recommended variant — it stops counting as a readiness gap"
                                        >
                                            Not needed
                                        </button>
                                    ) : null
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
            <p className="text-[11px] text-neutral-400 mt-2">
                {missingRequired > 0
                    ? `${missingRequired} recommended ${missingRequired === 1 ? 'variant has' : 'variants have'} no mockup yet. `
                    : ''}
                Per-variant generation isn&rsquo;t wired yet — regenerate the full mockup from the
                artifact actions, or upload a variant image and mark it accepted here.
            </p>
        </div>
    );
}
