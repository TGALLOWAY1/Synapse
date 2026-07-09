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
    Feature, GenerationStatus, MockupPayload,
    MockupSettings, ScreenPriority, ScreenReviewChecklist, ScreenReviewMeta,
} from '../../types';
import {
    groupFlowRefsByFlow,
    type ScreenExperienceItem,
    type ScreenFlowGroup,
    type ScreenMetadataEdit,
} from '../../lib/screenExperience';
import {
    parseDecisionBranches,
    REVIEW_STATUS_LABELS,
    type ScreenReadiness, type ScreenReviewStatus,
} from '../../lib/screenReadiness';
import {
    buildScreenReviewModelForItem, buildScreenReviewSignature,
    type ScreenReviewModel,
} from '../../lib/screenReviewWorkflow';
import {
    buildScreenMockupVariants, formatVariantLabel, summarizeScreenVariants,
    VARIANT_STATUS_LABELS, type GeneratedVariantMap,
} from '../../lib/mockupVariants';
import type { MockupVariantSourceSignature, VariantTrustContext } from '../../lib/mockupVariantTrust';
import { useMockupVariantImageStore } from '../../store/mockupVariantImageStore';
import { MockupVariantsPanel } from './MockupVariantsPanel';
import { ScreenReviewPanel } from './ScreenReviewPanel';
import { ScreenOverviewPanel } from './ScreenOverviewPanel';
import { ReadinessBadge } from './ReadinessBadge';
import { PRIORITY_STYLES, stylablePriority } from '../renderers/screenPriority';
import type { ScreenImageGalleryContext } from '../renderers/ScreenImageGallery';
import { useScreenInventoryImageStore } from '../../store/screenInventoryImageStore';
import { FlowJourney } from '../renderers/userFlows/FlowJourney';
import { StepCard } from '../renderers/userFlows/StepCard';
import { FeatureDetailDrawer } from '../renderers/userFlows/FeatureDetailDrawer';
import type { FeatureRef, FlowIssue } from '../renderers/userFlows/types';
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
    /** Phase 3C: current screen/design/PRD context — captured into new variant
     * source signatures and used to derive freshness. */
    trustContext?: VariantTrustContext;
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
    /** True when the project is mobile-relevant (mobile-first / responsive) —
     * enables recommended Mobile variants on P1/supporting screens. */
    mobileRelevant?: boolean;
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
    screenImageContext, mockupContext, mobileRelevant, mockupStatus, onRetryMockup,
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

    // Phase 3B/4A: manifest-backed generated variants for this screen (viewport ×
    // state), loaded lazily so the review model + Mockups tab both reflect real
    // generation state. Lifted from MockupsTab so the review header can factor in
    // per-variant coverage/freshness.
    const versionId = mockupContext?.versionId;
    const loadVariantImages = useMockupVariantImageStore(s => s.loadForVersion);
    const variantImages = useMockupVariantImageStore(s => s.images);
    useEffect(() => {
        if (versionId) void loadVariantImages(versionId);
    }, [versionId, loadVariantImages]);
    const generatedVariants = useMemo<GeneratedVariantMap>(() => {
        if (!versionId) return {};
        const out: GeneratedVariantMap = {};
        for (const key of Object.keys(variantImages)) {
            const r = variantImages[key];
            if (r.versionId !== versionId || r.screenId !== item.id) continue;
            out[r.variantId] = {
                coverage: r.coverageManifest?.overallStatus ?? 'unknown',
                sourceSignature: r.sourceSignature as MockupVariantSourceSignature | undefined,
            };
        }
        return out;
    }, [variantImages, versionId, item.id]);

    // Phase 4A: derived review model (user status vs. system readiness, issues,
    // checklist, freshness). Uses the same variant inputs as the Mockups tab.
    const reviewModel = useMemo<ScreenReviewModel>(() => buildScreenReviewModelForItem(item, {
        platform: mockupContext?.settings.platform,
        mobileRelevant,
        features,
        trustContext: mockupContext?.trustContext,
        generatedVariants,
    }), [item, mockupContext?.settings.platform, mockupContext?.trustContext, mobileRelevant, features, generatedVariants]);

    // Persist a review change into the screenEdits overlay. Status rides
    // `reviewStatus`; the supporting record (checklist / note / override reason /
    // sign-off signature / timestamps) rides `review`. Merges from the existing
    // edit so name/notes/variant marks and any unknown fields survive.
    const persistReview = useCallback((change: {
        status?: ScreenReviewStatus;
        reviewPatch?: Partial<ScreenReviewMeta>;
        captureSignature?: boolean;
    }) => {
        if (!onSaveScreenEdit) return;
        const now = new Date().toISOString();
        const edit: ScreenMetadataEdit = { ...(item.edit ?? {}) };
        if (change.status) edit.reviewStatus = change.status;
        const review: ScreenReviewMeta = { ...(edit.review ?? {}), ...change.reviewPatch, updatedAt: now };
        if (change.captureSignature) {
            review.signature = buildScreenReviewSignature(item.screen, {
                prdVersionId: mockupContext?.trustContext?.prdVersionId,
                screenVersionId: mockupContext?.trustContext?.screenVersionId,
                designSystemVersionId: mockupContext?.trustContext?.designSystemVersionId,
            });
        }
        edit.review = review;
        onSaveScreenEdit(item.id, edit);
    }, [onSaveScreenEdit, item.edit, item.id, item.screen, mockupContext?.trustContext]);

    const handleAccept = useCallback((overrideReason?: string) => {
        const now = new Date().toISOString();
        persistReview({
            status: 'accepted',
            reviewPatch: { acceptedAt: now, overrideReason: overrideReason || undefined },
            captureSignature: true,
        });
    }, [persistReview]);
    const handleRequestChanges = useCallback((note?: string) => {
        const now = new Date().toISOString();
        persistReview({ status: 'needs_review', reviewPatch: { requestedChangesAt: now, notes: note || undefined } });
    }, [persistReview]);
    const handleMarkImplReady = useCallback((overrideReason?: string) => {
        const now = new Date().toISOString();
        persistReview({
            status: 'implementation_ready',
            reviewPatch: { implementationReadyAt: now, overrideReason: overrideReason || undefined },
            captureSignature: true,
        });
    }, [persistReview]);
    const handleReReview = useCallback(() => persistReview({ captureSignature: true }), [persistReview]);
    const handleToggleChecklist = useCallback((key: keyof ScreenReviewChecklist, checked: boolean) => {
        const checklist: ScreenReviewChecklist = { ...(item.edit?.review?.checklist ?? {}) };
        if (checked) checklist[key] = true;
        else delete checklist[key];
        persistReview({ reviewPatch: { checklist: Object.keys(checklist).length > 0 ? checklist : undefined } });
    }, [persistReview, item.edit?.review?.checklist]);

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

            <ScreenReviewPanel
                model={reviewModel}
                onAccept={handleAccept}
                onRequestChanges={handleRequestChanges}
                onMarkImplementationReady={handleMarkImplReady}
                onToggleChecklist={handleToggleChecklist}
                onReReview={handleReReview}
                readOnly={!onSaveScreenEdit}
            />

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
                    mobileRelevant={mobileRelevant}
                    mockupStatus={mockupStatus}
                    onRetryMockup={onRetryMockup}
                    onAddToMockups={onAddToMockups}
                    unmatchedMockups={unmatchedMockups}
                    onLinkMockup={onLinkMockup}
                    onSaveScreenEdit={onSaveScreenEdit}
                    generatedVariants={generatedVariants}
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

function MockupsTab({
    item, mockupContext, mobileRelevant, mockupStatus, onRetryMockup, onAddToMockups,
    unmatchedMockups, onLinkMockup, onSaveScreenEdit, generatedVariants,
}: {
    item: ScreenExperienceItem;
    mockupContext?: ScreenDetailMockupContext;
    mobileRelevant?: boolean;
    mockupStatus?: GenerationStatus;
    onRetryMockup?: () => void;
    onAddToMockups?: () => void;
    unmatchedMockups?: Array<{ id: string; name: string }>;
    onLinkMockup?: (mockupScreenId: string) => void;
    onSaveScreenEdit?: (screenId: string, edit: ScreenMetadataEdit | null) => void;
    /** Manifest-backed generated variants for this screen (loaded by the parent). */
    generatedVariants: GeneratedVariantMap;
}) {
    const [linkTarget, setLinkTarget] = useState('');

    // Derived viewport × state variant grid (see src/lib/mockupVariants.ts).
    const variants = buildScreenMockupVariants(item, {
        platform: mockupContext?.settings.platform,
        mobileRelevant,
        trustContext: mockupContext?.trustContext,
        generatedVariants,
    });
    const variantSummary = summarizeScreenVariants(variants);

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
        return (
            <MockupVariantsPanel
                item={item}
                variants={variants}
                summary={variantSummary}
                mockupContext={mockupContext}
                onSetVariantStatus={setVariantStatus}
            />
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
        <div className="space-y-3">
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

        {/* Recommended variants discovery — even without a mockup, show what
            this screen probably wants so missing viewports/states are visible. */}
        {variantSummary.recommended > 0 && (
            <div className="bg-white rounded-lg border border-neutral-200 p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        Recommended variants
                    </h4>
                    <span className="text-[10px] text-neutral-400">
                        {variantSummary.generated} of {variantSummary.recommended} generated
                    </span>
                </div>
                <ul className="space-y-1 text-xs">
                    {variants.filter(v => v.required).map(v => (
                        <li key={v.id} className="flex items-center justify-between gap-2">
                            <span className="text-neutral-700">{formatVariantLabel(v)}</span>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 ${
                                v.status === 'missing'
                                    ? 'text-amber-700 bg-amber-50 ring-amber-200'
                                    : 'text-emerald-700 bg-emerald-50 ring-emerald-200'
                            }`}>
                                {VARIANT_STATUS_LABELS[v.status]}
                            </span>
                        </li>
                    ))}
                </ul>
                <p className="text-[11px] text-neutral-400 mt-2">
                    Derived from this screen&rsquo;s priority and documented states — tracked from
                    generated metadata, never from inspecting images. Add this screen to the mockups to
                    generate individual variants.
                </p>
            </div>
        )}
        </div>
    );
}
