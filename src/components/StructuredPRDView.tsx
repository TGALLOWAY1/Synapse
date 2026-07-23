import { useState, useEffect, useMemo, useRef } from 'react';
import { Pencil, Check, X, Plus, Trash2, Sparkles, Loader2, ChevronDown, ChevronRight, ListChecks, ArrowRight } from 'lucide-react';
import Mark from 'mark.js';
import { useProjectStore } from '../store/projectStore';
import { structuredPRDToMarkdown, replyInBranch } from '../lib/llmProvider';
import { regenerateGroundingFields } from '../lib/services/groundingService';
import { SafetyBlockedError } from '../lib/safety';
import { FeatureCard } from './FeatureCard';
import { useSelectionPopover } from '../lib/useSelectionPopover';
import { useIsMobile } from '../lib/useIsMobile';
import { SelectionActionDialog } from './SelectionActionDialog';
import { MobileSelectionToolbar } from './MobileSelectionToolbar';
import { v4 as uuidv4 } from 'uuid';
import type { StructuredPRD, Feature, PlanningRecord } from '../types';
import {
    parseEntities,
    parseActions,
    serializeEntities,
    serializeActions,
} from '../lib/groundingFields';
import { PrdViewTabs } from './prd/PrdViewTabs';
import { FeatureIdBadge } from './prd/FeatureIdBadge';
import { isDisplayableFeatureId } from '../lib/derive/prdDecisions';
import { assumptionSourceKey } from '../lib/planning/assumptionImport';
import { projectDecision } from '../lib/planning/decisionProjection';
import type { ConsequentialPrdEditRecognition } from '../lib/planning';
import type { PlanningReturnTarget } from '../lib/planning/planningNavigation';
import {
    deriveDeferredFeatureIds,
    deriveImplementationSummary,
    featureDetailAnchorId,
    isImplementationSummaryEmpty,
    type SummaryFeature,
} from '../lib/derive/implementationSummary';
import {
    coercePrdView,
    deriveFeatureTrace,
    featureFilterCounts,
    filterFeatures,
    groupFeaturesBySystem,
    splitDecisionInputs,
    FEATURE_FILTERS,
    type FeatureFilterId,
    type PrdViewId,
} from '../lib/derive/prdViews';
import {
    ExecutiveSummarySection,
    ProductThesisSection,
    JtbdSection,
    PrinciplesSection,
    UserLoopsSection,
    UxArchitectureSection,
    DataModelSection,
    StateMachinesSection,
    RolesSection,
    ArchFlowsSection,
    MetricsSection,
} from './prd/PremiumSections';

interface StructuredPRDViewProps {
    projectId: string;
    spineId: string;
    structuredPRD: StructuredPRD;
    readOnly: boolean;
    /**
     * Active view (Overview | Features). Optional controlled prop: hosts wire it
     * to URL query state (`?prdView=…`) for deep-linkable, refresh-stable
     * navigation. When omitted the component keeps view state internally, so it
     * renders standalone (e.g. in tests) without a router. This is purely
     * NAVIGATIONAL UI state — never persisted as PRD content.
     */
    view?: PrdViewId;
    onViewChange?: (view: PrdViewId) => void;
    onOpenDecisions?: (recordId?: string, returnTo?: PlanningReturnTarget) => void;
    /**
     * Fired the moment a branch is created from the selection popover (before the
     * AI reply resolves). Hosts use it to reveal the branches sidebar so the new
     * branch thread + "Consolidate to Document" bar are immediately visible.
     * Optional — standalone/legacy usages (e.g. tests) render unchanged.
     */
    onBranchCreated?: () => void;
}

const EMPTY_PLANNING_RECORDS: PlanningRecord[] = [];

type EditingSection =
    | 'vision'
    | 'targetUsers'
    | 'coreProblem'
    | 'architecture'
    | 'risks'
    | 'domainEntities'
    | 'primaryActions'
    | null;

// Human labels for edit-summary provenance (e.g. "Updated section: Vision").
const SECTION_LABELS: Record<'vision' | 'coreProblem' | 'architecture' | 'targetUsers' | 'risks', string> = {
    vision: 'Vision',
    coreProblem: 'Core Problem',
    architecture: 'Architecture',
    targetUsers: 'Target Users',
    risks: 'Risks',
};

export function StructuredPRDView({ projectId, spineId, structuredPRD, readOnly, view, onViewChange, onOpenDecisions, onBranchCreated }: StructuredPRDViewProps) {
    const { editSpineStructuredPRD, createBranch, addBranchMessage, branches } = useProjectStore();
    const planningRecords = useProjectStore(state => state.planningRecords[projectId] ?? EMPTY_PLANNING_RECORDS);
    const [editingSection, setEditingSection] = useState<EditingSection>(null);
    const [editValue, setEditValue] = useState('');
    const [intent, setIntent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editRecognition, setEditRecognition] = useState<ConsequentialPrdEditRecognition | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // View state: controlled by the host (URL) when `view` is provided, else
    // internal. Navigational only — never a PRD content revision.
    const [internalView, setInternalView] = useState<PrdViewId>('overview');
    const activeView = coercePrdView(view ?? internalView);
    const setView = (next: PrdViewId) => {
        if (onViewChange) onViewChange(next);
        else setInternalView(next);
    };

    // Feature filter (Features view). Purely navigational component state.
    const [featureFilter, setFeatureFilter] = useState<FeatureFilterId>('all');
    // Collapsed feature-system groups (by id).
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    // Overview: progressively disclose the technical/architecture detail so the
    // brief stays calm and editorial (one level of disclosure, not nested).
    const [showTechnicalDetail, setShowTechnicalDetail] = useState(false);

    // On mobile, gate selection behind an explicit "Select text to edit" mode so
    // the Synapse sheet doesn't collide with the native iOS toolbar. Desktop is
    // unchanged.
    const isMobile = useIsMobile();
    const [mobileSelectMode, setMobileSelectMode] = useState(false);

    // Shared, touch-aware selection pipeline. Disabled while inline-editing a
    // section so the textarea selection doesn't open the branch dialog.
    const { selection, pendingText, commit, clear } = useSelectionPopover({
        containerRef: contentRef,
        enabled: !readOnly && !editingSection && (!isMobile || mobileSelectMode),
        manualCommit: isMobile && mobileSelectMode,
    });

    // Get active branches for this spine to highlight their anchors.
    // Memoized so the Mark.js effect below doesn't re-run on every parent
    // render — the project store is destructured wholesale, so any unrelated
    // store change would otherwise re-trigger the expensive DOM traversal.
    const anchorTexts = useMemo(
        () => (branches[projectId] || [])
            .filter(b => b.spineVersionId === spineId && b.status === 'active' && b.anchorText)
            .map(b => b.anchorText as string),
        [branches, projectId, spineId],
    );

    // Highlight branch anchors with mark.js. Deferred to an idle/next-frame
    // callback so the initial mount paints before the synchronous DOM
    // traversal starts — switching to the PRD tab from the workspace would
    // otherwise stall on a large structured PRD.
    useEffect(() => {
        if (!contentRef.current) return;
        let cancelled = false;
        let instance: Mark | null = null;
        const ric = (window as unknown as {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
            cancelIdleCallback?: (id: number) => void;
        });
        const schedule = ric.requestIdleCallback
            ? (cb: () => void) => ric.requestIdleCallback!(cb, { timeout: 200 })
            : (cb: () => void) => window.setTimeout(cb, 0) as unknown as number;
        const cancel = ric.cancelIdleCallback
            ? (id: number) => ric.cancelIdleCallback!(id)
            : (id: number) => window.clearTimeout(id);

        const handle = schedule(() => {
            if (cancelled || !contentRef.current) return;
            instance = new Mark(contentRef.current);
            instance.unmark();
            anchorTexts.forEach(text => {
                instance!.mark(text, {
                    className: '!bg-indigo-500/20 !text-inherit !border-l-2 !border-indigo-500 !p-0.5 !rounded',
                    accuracy: 'partially',
                    separateWordSearch: false,
                    diacritics: false,
                    acrossElements: true,
                });
            });
        });

        return () => {
            cancelled = true;
            cancel(handle);
            instance?.unmark();
        };
    }, [structuredPRD, anchorTexts]);

    const dismiss = () => {
        clear();
        setIntent('');
        setMobileSelectMode(false);
    };

    // Single branch-creation path shared by the typed-intent form (desktop) and
    // the one-tap action chips (mobile). Same history-tracked flow as before.
    const submitBranch = async (rawIntent: string) => {
        if (!selection || !rawIntent.trim() || isSubmitting) return;
        try {
            setIsSubmitting(true);
            const anchorText = selection.text;
            const userIntent = rawIntent.trim();
            const { branchId } = createBranch(projectId, spineId, anchorText, userIntent);
            // Reveal the branches sidebar right away — before awaiting the AI
            // reply — so the new thread and its Consolidate bar are visible.
            onBranchCreated?.();
            clear();
            setIntent('');
            setMobileSelectMode(false);
            const response = await replyInBranch({ anchorText, intent: userIntent, threadHistory: [] });
            addBranchMessage(projectId, branchId, 'assistant', response);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        submitBranch(intent);
    };

    const handleQuickAction = (tag: string) => {
        submitBranch(tag + ': ');
    };

    // Edits must NOT overwrite the current version in place — append a new
    // version (preserving history) via editSpineStructuredPRD. Each call site
    // passes a useful default summary; no manual entry required.
    const savePRD = (
        updated: StructuredPRD,
        editSummary: string,
        options?: { recognizeConsequentialEdit?: boolean },
    ) => {
        const result = editSpineStructuredPRD(projectId, spineId, updated, {
            responseText: structuredPRDToMarkdown(updated),
            changeSource: 'user_edit',
            editSummary,
            recognizeConsequentialEdit: options?.recognizeConsequentialEdit,
        });
        setEditRecognition(result.recognition?.classification === 'copy_edit' ? null : result.recognition ?? null);
    };

    // Decisions-tab confirm/reject/undo edits. These coalesce onto the latest
    // spine version in place (see editSpineStructuredPRD) so a burst of clicks
    // doesn't spawn N near-identical full PRD copies. The markdown re-render
    // mirrors savePRD; the decisionDelta drives the coalesced aggregate summary.
    const saveDecision = (
        updated: StructuredPRD,
        summary: string,
        kind: 'confirmed' | 'corrected' | 'reopened',
        count = 1,
    ) => {
        editSpineStructuredPRD(projectId, spineId, updated, {
            responseText: structuredPRDToMarkdown(updated),
            changeSource: 'decision_edit',
            editSummary: summary,
            decisionDelta: { [kind]: count },
        });
    };

    const startEditing = (section: EditingSection, currentValue: string) => {
        if (readOnly) return;
        setEditingSection(section);
        setEditValue(currentValue);
    };

    const cancelEditing = () => {
        setEditingSection(null);
        setEditValue('');
    };

    const saveTextSection = (section: 'vision' | 'coreProblem' | 'architecture') => {
        const updated = { ...structuredPRD, [section]: editValue };
        savePRD(updated, `Updated section: ${SECTION_LABELS[section]}`);
        setEditingSection(null);
    };

    const saveListSection = (section: 'targetUsers' | 'risks') => {
        const items = editValue.split('\n').map(s => s.trim()).filter(Boolean);
        const updated = { ...structuredPRD, [section]: items };
        savePRD(updated, `Updated section: ${SECTION_LABELS[section]}`);
        setEditingSection(null);
    };

    const saveDomainEntities = () => {
        const updated = { ...structuredPRD, domainEntities: parseEntities(editValue) };
        savePRD(updated, 'Updated section: Domain Entities');
        setEditingSection(null);
    };

    const savePrimaryActions = () => {
        const updated = { ...structuredPRD, primaryActions: parseActions(editValue) };
        savePRD(updated, 'Updated section: Primary Actions');
        setEditingSection(null);
    };

    // Phase B backfill: older projects have no domainEntities / primaryActions
    // because they were generated before those fields existed. This button
    // re-runs the structured-PRD generator on a concise summary of the
    // existing PRD and merges only the new grounding fields back in —
    // existing vision / features / risks are left untouched.
    const [isRefreshingGrounding, setIsRefreshingGrounding] = useState(false);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const groundingMissing =
        !structuredPRD.domainEntities || structuredPRD.domainEntities.length === 0
        || !structuredPRD.primaryActions || structuredPRD.primaryActions.length === 0;

    const handleRefreshGrounding = async () => {
        setRefreshError(null);
        setIsRefreshingGrounding(true);
        try {
            // Synthesize a compact prompt from the existing structured PRD
            // so the generator sees the same product context it originally
            // produced, not a stale raw prompt.
            const summaryLines: string[] = [];
            if (structuredPRD.vision) summaryLines.push(`Vision: ${structuredPRD.vision}`);
            if (structuredPRD.coreProblem) summaryLines.push(`Core problem: ${structuredPRD.coreProblem}`);
            if (structuredPRD.targetUsers?.length) summaryLines.push(`Personas: ${structuredPRD.targetUsers.join(', ')}`);
            if (structuredPRD.features?.length) {
                summaryLines.push(`Features:\n${structuredPRD.features.slice(0, 8).map(f => `- ${f.name}: ${f.description}`).join('\n')}`);
            }
            const regenerated = await regenerateGroundingFields(summaryLines.join('\n\n'));
            const merged: StructuredPRD = {
                ...structuredPRD,
                domainEntities: regenerated.domainEntities?.length
                    ? regenerated.domainEntities
                    : structuredPRD.domainEntities,
                primaryActions: regenerated.primaryActions?.length
                    ? regenerated.primaryActions
                    : structuredPRD.primaryActions,
            };
            // Grounding backfill is generated assistance, not an explicit user
            // decision about entities/actions. Preserve the version but do not
            // attribute its interpretation to the user.
            savePRD(merged, 'Updated grounding fields', { recognizeConsequentialEdit: false });
        } catch (e) {
            if (e instanceof SafetyBlockedError) {
                setRefreshError(
                    e.result.userFacingReason
                    || 'This request was blocked by the safety review and cannot be processed.',
                );
            } else {
                setRefreshError(e instanceof Error ? e.message : 'Failed to refresh grounding fields.');
            }
        } finally {
            setIsRefreshingGrounding(false);
        }
    };

    const handleFeatureUpdate = (updatedFeature: Feature) => {
        const updated = {
            ...structuredPRD,
            features: structuredPRD.features.map(f => f.id === updatedFeature.id ? updatedFeature : f),
        };
        savePRD(updated, `Edited feature: ${updatedFeature.name || 'Untitled'}`);
    };

    // ── Feature confirmation (Features view) ───────────────────────────
    // Confirmations are PRD edits like any other: they append a new spine
    // version (never overwrite) with a descriptive edit summary, so every
    // decision is undoable through version history too. Assumption/decision
    // verdicts now live in the Decision Center (Challenge stage), not here.
    const handleToggleFeatureConfirm = (feature: Feature) => {
        const confirmed = !feature.confirmed;
        const updated = {
            ...structuredPRD,
            features: structuredPRD.features.map(f =>
                f.id === feature.id
                    ? { ...f, confirmed: confirmed || undefined, confirmedAt: confirmed ? Date.now() : undefined }
                    : f,
            ),
        };
        saveDecision(
            updated,
            confirmed
                ? `Confirmed feature: ${feature.name || 'Untitled'}`
                : `Reopened feature: ${feature.name || 'Untitled'}`,
            confirmed ? 'confirmed' : 'reopened',
        );
    };

    // Unresolved assumptions still drive the Overview/Features "planning items
    // need review" badges (which link into the Decision Center); the decision
    // list/log/risks themselves render in the Decision Center, not here.
    const { needsInput, toValidate } = splitDecisionInputs(structuredPRD.assumptions);

    // ── Features view derivations ──────────────────────────────────────
    const deferredFeatureIds = useMemo(
        () => deriveDeferredFeatureIds(structuredPRD),
        [structuredPRD],
    );
    const filterCounts = useMemo(
        () => featureFilterCounts(structuredPRD.features, deferredFeatureIds),
        [structuredPRD.features, deferredFeatureIds],
    );
    // Display-only tally of confirmed features (legacy data may lack `features`).
    const confirmedCount = useMemo(
        () => (structuredPRD.features ?? []).filter(f => f.confirmed).length,
        [structuredPRD.features],
    );
    const filteredFeatures = useMemo(
        () => filterFeatures(structuredPRD.features, featureFilter, deferredFeatureIds),
        [structuredPRD.features, featureFilter, deferredFeatureIds],
    );
    const featureGroups = useMemo(
        () => groupFeaturesBySystem(filteredFeatures, structuredPRD),
        [filteredFeatures, structuredPRD],
    );
    const pendingScrollRef = useRef<string | null>(null);

    const summaryPresent = useMemo(
        () =>
            !isImplementationSummaryEmpty(deriveImplementationSummary(structuredPRD))
            || !!structuredPRD.mvpScope?.rationale,
        [structuredPRD],
    );

    // Cross-view navigation: an Implementation Summary card (Overview) jumps to
    // the feature's detail card in the Features view; a feature card jumps back
    // to the summary. The scroll is deferred until the target view has rendered.
    const handleNavigateToFeature = (featureId: string) => {
        pendingScrollRef.current = featureDetailAnchorId(featureId);
        if (featureFilter !== 'all') setFeatureFilter('all');
        setView('features');
        // Same-view case (already on Features): scroll on next frame.
        if (activeView === 'features') requestAnimationFrame(runPendingScroll);
    };

    const navigateToSummary = () => {
        pendingScrollRef.current = 'prd-implementation-summary';
        setView('overview');
        if (activeView === 'overview') requestAnimationFrame(runPendingScroll);
    };

    const toggleGroup = (id: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const runPendingScroll = () => {
        if (!pendingScrollRef.current) return;
        const elementId = pendingScrollRef.current;
        pendingScrollRef.current = null;
        const el = document.getElementById(elementId);
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    // Run a pending cross-view scroll once the newly-active view has rendered.
    useEffect(() => {
        runPendingScroll();
    }, [activeView]);

    const handleAddFeature = () => {
        const newFeature: Feature = {
            id: uuidv4(),
            name: 'New Feature',
            description: '',
            userValue: '',
            complexity: 'medium',
        };
        const updated = { ...structuredPRD, features: [...structuredPRD.features, newFeature] };
        savePRD(updated, 'Added feature: New Feature');
    };

    const handleDeleteFeature = (featureId: string) => {
        const removed = structuredPRD.features.find(f => f.id === featureId);
        const updated = {
            ...structuredPRD,
            features: structuredPRD.features.filter(f => f.id !== featureId),
        };
        savePRD(updated, `Removed feature: ${removed?.name || 'Untitled'}`);
    };

    const unresolvedAssumptions = [...needsInput, ...toValidate];
    const normalizeSectionName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const assumptionsAffecting = (section: string) => {
        const target = normalizeSectionName(section);
        return unresolvedAssumptions.filter(assumption => [
            ...(assumption.affectedPrdSections ?? []),
            ...(assumption.affectedPlanLocations ?? []).map(location => location.section),
        ].some(raw => {
            const source = normalizeSectionName(raw);
            return source === target || source.includes(target) || target.includes(source);
        }));
    };
    const planningRecordsAffecting = (section: string) => {
        const target = normalizeSectionName(section);
        return planningRecords.filter(record => {
            // PRD assumptions already render through their compatibility
            // projection above; do not count the imported record twice.
            if (record.sources?.some(source => source.sourceType === 'prd_assumption')) return false;
            const status = projectDecision(record).status;
            if (status !== 'open' && status !== 'proposed' && !(record.type === 'conflict' && status === 'deferred')) return false;
            return [
                ...(record.affectedPrdSections ?? []),
                ...(record.affectedPlanLocations ?? []).map(location => location.section),
            ].some(raw => {
                const source = normalizeSectionName(raw);
                return source === target || source.includes(target) || target.includes(source);
            });
        });
    };
    const renderSectionUncertainty = (section: string) => {
        const assumptions = assumptionsAffecting(section);
        const durableRecords = planningRecordsAffecting(section);
        if (assumptions.length + durableRecords.length === 0) return null;
        const preciseLabels = [...assumptions.flatMap(assumption =>
            (assumption.affectedPlanLocations ?? [])
                .filter(location => normalizeSectionName(location.section) === normalizeSectionName(section))
                .map(location => location.label),
        ), ...durableRecords.flatMap(record =>
            (record.affectedPlanLocations ?? [])
                .filter(location => normalizeSectionName(location.section) === normalizeSectionName(section))
                .map(location => location.label),
        )].filter((label, index, labels) => labels.indexOf(label) === index);
        const assumptionRecords = assumptions.flatMap(assumption => {
            const sourceKey = assumptionSourceKey(assumption.id);
            const record = planningRecords.find(candidate => candidate.sources?.some(source => source.key === sourceKey));
            return record ? [record] : [];
        });
        const materialityOrder: Record<NonNullable<PlanningRecord['materiality']>, number> = {
            blocking: 0, high: 1, normal: 2, low: 3,
        };
        const exactRecord = [...assumptionRecords, ...durableRecords]
            .filter((record, index, records) => records.findIndex(candidate => candidate.id === record.id) === index)
            .sort((a, b) => (materialityOrder[a.materiality ?? 'high'] - materialityOrder[b.materiality ?? 'high'])
                || a.createdAt - b.createdAt)[0];
        const anchorId = `prd-uncertainty-${normalizeSectionName(section).replace(/\s+/g, '-')}`;
        return (
            <button
                id={anchorId}
                type="button"
                onClick={() => {
                    onOpenDecisions?.(exactRecord?.id, {
                        destination: { kind: 'prd', anchorId },
                        label: `Return to ${section}`,
                    });
                }}
                aria-label={exactRecord
                    ? `Review planning item: ${exactRecord.title}`
                    : 'Review planning item'}
                className="mb-3 flex w-full scroll-mt-24 items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-amber-900 hover:bg-amber-100"
            >
                <span className="text-xs leading-5">
                    <strong>Planning item needs review</strong> in this section.
                    {preciseLabels.length > 0 && <span className="mt-0.5 block text-amber-800">Affected: {preciseLabels.slice(0, 2).join(', ')}{preciseLabels.length > 2 ? ` +${preciseLabels.length - 2} more` : ''}</span>}
                </span>
                <span className="shrink-0 text-xs font-semibold underline underline-offset-2">Review planning item</span>
            </button>
        );
    };

    const renderTextSection = (
        title: string,
        section: 'vision' | 'coreProblem' | 'architecture',
        content: string,
    ) => (
        <div className="mb-8">
            <div className="flex items-center justify-between mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">{title}</h3>
                {!readOnly && editingSection !== section && (
                    <button
                        onClick={() => startEditing(section, content)}
                        className="p-1 text-neutral-300 hover:text-neutral-500 transition"
                        title={`Edit ${title.toLowerCase()}`}
                        aria-label={`Edit ${title.toLowerCase()}`}
                    >
                        <Pencil size={14} />
                    </button>
                )}
            </div>
            {editingSection === section ? (
                <div className="space-y-2">
                    <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-full bg-neutral-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm text-neutral-700 focus:outline-none focus:border-indigo-400 min-h-[80px]"
                        autoFocus
                    />
                    <div className="flex justify-end gap-2">
                        <button onClick={cancelEditing} className="p-1.5 text-neutral-400 hover:text-neutral-600" title="Cancel" aria-label="Cancel editing">
                            <X size={16} />
                        </button>
                        <button onClick={() => saveTextSection(section)} className="p-1.5 text-indigo-500 hover:text-indigo-700" title="Save" aria-label="Save changes">
                            <Check size={16} />
                        </button>
                    </div>
                </div>
            ) : (
                <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-lg text-sm text-neutral-700 whitespace-pre-wrap">
                    {content}
                </div>
            )}
        </div>
    );

    const renderListSection = (
        title: string,
        section: 'targetUsers' | 'risks',
        items: string[],
    ) => (
        <div className="mb-8">
            <div className="flex items-center justify-between mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">{title}</h3>
                {!readOnly && editingSection !== section && (
                    <button
                        onClick={() => startEditing(section, items.join('\n'))}
                        className="p-1 text-neutral-300 hover:text-neutral-500 transition"
                        title={`Edit ${title.toLowerCase()}`}
                        aria-label={`Edit ${title.toLowerCase()}`}
                    >
                        <Pencil size={14} />
                    </button>
                )}
            </div>
            {editingSection === section ? (
                <div className="space-y-2">
                    <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-full bg-neutral-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm text-neutral-700 focus:outline-none focus:border-indigo-400 min-h-[80px]"
                        placeholder="One item per line"
                        autoFocus
                    />
                    <div className="flex justify-end gap-2">
                        <button onClick={cancelEditing} className="p-1.5 text-neutral-400 hover:text-neutral-600" title="Cancel" aria-label="Cancel editing">
                            <X size={16} />
                        </button>
                        <button onClick={() => saveListSection(section)} className="p-1.5 text-indigo-500 hover:text-indigo-700" title="Save" aria-label="Save changes">
                            <Check size={16} />
                        </button>
                    </div>
                </div>
            ) : (
                <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
                    <ul className="space-y-1">
                        {items.map((item, i) => (
                            <li key={i} className="text-sm text-neutral-700 flex items-start gap-2">
                                <span className="text-neutral-400 mt-0.5">-</span>
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );

    const renderDomainEntities = () => {
        const items = structuredPRD.domainEntities ?? [];
        const editing = editingSection === 'domainEntities';
        return (
            <div className="mb-8">
                <div className="flex items-center justify-between mb-3 border-b border-neutral-200 pb-2">
                    <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">Domain Entities</h3>
                    {!readOnly && !editing && (
                        <button
                            onClick={() => startEditing('domainEntities', serializeEntities(items))}
                            className="p-1 text-neutral-300 hover:text-neutral-500 transition"
                            title="Edit domain entities"
                            aria-label="Edit domain entities"
                        >
                            <Pencil size={14} />
                        </button>
                    )}
                </div>
                <p className="text-xs text-neutral-500 mb-3">
                    The core "things" your product stores and shows — Synapse uses them to ground screens, data models, and mockups.
                </p>
                {editing ? (
                    <div className="space-y-2">
                        <textarea
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-full bg-neutral-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm text-neutral-700 focus:outline-none focus:border-indigo-400 min-h-[140px] font-mono"
                            placeholder={'Name | description | example1, example2\n(one entity per line; description and examples are optional)'}
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={cancelEditing} className="p-1.5 text-neutral-400 hover:text-neutral-600" title="Cancel" aria-label="Cancel editing">
                                <X size={16} />
                            </button>
                            <button onClick={saveDomainEntities} className="p-1.5 text-indigo-500 hover:text-indigo-700" title="Save" aria-label="Save changes">
                                <Check size={16} />
                            </button>
                        </div>
                    </div>
                ) : items.length === 0 ? (
                    <div className="p-4 bg-neutral-50 border border-dashed border-neutral-200 rounded-lg text-xs text-neutral-500">
                        No domain entities captured. These names drive table columns and labels in generated mockups — use "Refresh grounding fields" or edit to add them.
                    </div>
                ) : (
                    <ul className="p-4 bg-neutral-50 border border-neutral-200 rounded-lg space-y-3">
                        {items.map((entity, i) => (
                            <li key={`${entity.name}-${i}`} className="text-sm text-neutral-700">
                                <p className="font-semibold text-neutral-900">{entity.name}</p>
                                {entity.description && (
                                    <p className="text-xs text-neutral-600 mt-0.5">{entity.description}</p>
                                )}
                                {entity.exampleValues && entity.exampleValues.length > 0 && (
                                    <p className="text-xs text-neutral-500 mt-1">
                                        <span className="text-neutral-400">Examples:</span> {entity.exampleValues.join(', ')}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    };

    const renderPrimaryActions = () => {
        const items = structuredPRD.primaryActions ?? [];
        const editing = editingSection === 'primaryActions';
        return (
            <div className="mb-8">
                <div className="flex items-center justify-between mb-3 border-b border-neutral-200 pb-2">
                    <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">Primary Actions</h3>
                    {!readOnly && !editing && (
                        <button
                            onClick={() => startEditing('primaryActions', serializeActions(items))}
                            className="p-1 text-neutral-300 hover:text-neutral-500 transition"
                            title="Edit primary actions"
                            aria-label="Edit primary actions"
                        >
                            <Pencil size={14} />
                        </button>
                    )}
                </div>
                {editing ? (
                    <div className="space-y-2">
                        <textarea
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-full bg-neutral-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm text-neutral-700 focus:outline-none focus:border-indigo-400 min-h-[120px] font-mono"
                            placeholder={'Verb | target\n(one action per line; both parts required)'}
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={cancelEditing} className="p-1.5 text-neutral-400 hover:text-neutral-600" title="Cancel" aria-label="Cancel editing">
                                <X size={16} />
                            </button>
                            <button onClick={savePrimaryActions} className="p-1.5 text-indigo-500 hover:text-indigo-700" title="Save" aria-label="Save changes">
                                <Check size={16} />
                            </button>
                        </div>
                    </div>
                ) : items.length === 0 ? (
                    <div className="p-4 bg-neutral-50 border border-dashed border-neutral-200 rounded-lg text-xs text-neutral-500">
                        No primary actions captured. These become the primary CTAs across generated mockups.
                    </div>
                ) : (
                    // Compact chip row — these ground mockup CTAs, so they stay in
                    // the PRD, but as a scannable reference rather than a heavy list.
                    <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                        <p className="text-[11px] text-neutral-500 mb-2">
                            The primary calls-to-action generated mockups are grounded on.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {items.map((action, i) => (
                                <span
                                    key={`${action.verb}-${action.target}-${i}`}
                                    className="inline-flex items-baseline gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-700"
                                >
                                    <span className="font-semibold text-neutral-900">{action.verb}</span>
                                    {action.target}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // One feature detail card. Anchored so the Implementation Summary cards
    // can deep-link to it, with a back affordance returning to the summary.
    // Restrained, explicit-only traceability strip below a feature card:
    // system membership + resolved dependency features. No inferred goal/metric
    // links (we never fabricate relationships from keyword overlap).
    const renderFeatureTrace = (feature: Feature, hideSystem = false) => {
        const trace = deriveFeatureTrace(feature, structuredPRD);
        const showSystem = trace.system && !hideSystem;
        if (!showSystem && trace.dependencies.length === 0) return null;
        return (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                {showSystem && trace.system && (
                    <span className="inline-flex items-center gap-1">
                        <span className="font-semibold text-neutral-400 uppercase tracking-wider">Part of</span>
                        <span className="text-neutral-700">{trace.system.name}</span>
                    </span>
                )}
                {trace.dependencies.length > 0 && (
                    <span className="inline-flex items-center gap-1 flex-wrap">
                        <span className="font-semibold text-neutral-400 uppercase tracking-wider">Depends on</span>
                        {trace.dependencies.map(d => (
                            <button
                                key={d.id}
                                type="button"
                                onClick={() => handleNavigateToFeature(d.id)}
                                className="text-indigo-600 hover:text-indigo-800 hover:underline"
                                title={`Go to ${d.name}`}
                            >
                                {d.name}
                            </button>
                        ))}
                    </span>
                )}
            </div>
        );
    };

    const renderFeatureCard = (feature: Feature, hideSystem = false) => (
        <div key={feature.id} id={featureDetailAnchorId(feature.id)} className="relative group/feature scroll-mt-24">
            <FeatureCard
                feature={feature}
                onUpdate={handleFeatureUpdate}
                onToggleConfirm={deferredFeatureIds.has(feature.id) ? undefined : handleToggleFeatureConfirm}
                onBackToSummary={summaryPresent ? navigateToSummary : undefined}
                readOnly={readOnly}
            />
            {renderFeatureTrace(feature, hideSystem)}
            {!readOnly && (
                <button
                    onClick={() => {
                        if (window.confirm(`Delete feature "${feature.name}"?`)) {
                            handleDeleteFeature(feature.id);
                        }
                    }}
                    className="absolute -right-2 -top-2 p-1 bg-white border border-neutral-200 rounded-full text-neutral-300 hover:text-red-500 opacity-0 group-hover/feature:opacity-100 transition shadow-sm"
                    title="Delete feature"
                    aria-label="Delete feature"
                >
                    <Trash2 size={12} />
                </button>
            )}
        </div>
    );

    const renderGroundingBackfill = () => {
        if (readOnly || !groundingMissing) return null;
        return (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                    <Sparkles size={16} className="text-amber-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-amber-900">Grounding fields missing</p>
                        <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                            This project was created before domain entities and primary actions were captured.
                            Refresh to let the PRD generator fill them in — used by the mockup engine to ground
                            table columns, section labels, and primary CTAs.
                        </p>
                        <button
                            type="button"
                            onClick={handleRefreshGrounding}
                            disabled={isRefreshingGrounding}
                            className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                        >
                            {isRefreshingGrounding
                                ? <Loader2 size={12} className="animate-spin" />
                                : <Sparkles size={12} />}
                            {isRefreshingGrounding ? 'Refreshing…' : 'Refresh grounding fields'}
                        </button>
                        {refreshError && (
                            <p className="mt-2 text-xs text-red-700">Refresh failed: {refreshError}</p>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // ── Overview view: the concise product brief ───────────────────────
    const renderConstraints = () => {
        const constraints = structuredPRD.constraints ?? [];
        const nfrs = structuredPRD.nonFunctionalRequirements ?? [];
        if (constraints.length === 0 && nfrs.length === 0) return null;
        return (
            <div className="mb-8">
                <div className="flex items-center justify-between mb-3 border-b border-neutral-200 pb-2">
                    <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">Constraints</h3>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                    {constraints.length > 0 && (
                        <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">Boundaries</p>
                            <ul className="list-disc pl-4 space-y-0.5 text-sm text-neutral-700">
                                {constraints.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                        </div>
                    )}
                    {nfrs.length > 0 && (
                        <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">Quality & Performance Requirements</p>
                            <ul className="list-disc pl-4 space-y-0.5 text-sm text-neutral-700">
                                {nfrs.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Compact scope surface for the Overview. Deliberately NOT the full feature
    // list (that lives in the Features view) — it states the scope proposal
    // (rationale), which features are in MVP / next as reference cards, and how
    // many are deferred. Cards link into the Features/Decisions views.
    const renderScopeBucket = (
        label: string,
        icon: typeof ListChecks,
        accent: 'green' | 'blue',
        items: SummaryFeature[],
        emptyHint: string,
    ) => {
        const Icon = icon;
        const headerClasses = accent === 'green' ? 'text-green-700' : 'text-blue-700';
        const cardClasses = accent === 'green'
            ? 'bg-green-50/60 border-green-200'
            : 'bg-blue-50/60 border-blue-200';
        return (
            <div>
                <div className="flex items-center gap-2 mb-2">
                    <Icon size={14} className={headerClasses} />
                    <h4 className={`text-[11px] font-bold uppercase tracking-wider ${headerClasses}`}>{label}</h4>
                    <span className="text-[11px] text-neutral-400">{items.length}</span>
                </div>
                {items.length === 0 ? (
                    <p className="text-[11px] text-neutral-400 italic">{emptyHint}</p>
                ) : (
                    <div className="space-y-1.5">
                        {items.map((f, i) => {
                            const clickable = !!f.id && isDisplayableFeatureId(f.id);
                            const body = (
                                <>
                                    <div className="flex items-baseline gap-2">
                                        {clickable && <FeatureIdBadge id={f.id} />}
                                        <span className="min-w-0 break-words text-sm font-semibold text-neutral-900">{f.name}</span>
                                        {!f.id && (
                                            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">
                                                not traced to a feature
                                            </span>
                                        )}
                                    </div>
                                    {f.reason && (
                                        <p className="text-[11px] text-neutral-600 mt-0.5 line-clamp-2">{f.reason}</p>
                                    )}
                                </>
                            );
                            return clickable ? (
                                <button
                                    key={f.id}
                                    type="button"
                                    onClick={() => handleNavigateToFeature(f.id!)}
                                    title={`Go to ${f.name} in Features`}
                                    className={`block w-full text-left rounded-md border ${cardClasses} px-3 py-2 hover:border-indigo-300 hover:shadow-sm transition`}
                                >
                                    {body}
                                </button>
                            ) : (
                                <div
                                    key={`${f.name}-${i}`}
                                    // A scope entry with no id resolved to no PRD feature —
                                    // downstream assets generate from features only, so this
                                    // entry won't reach them. Advisory label only: never
                                    // gate rendering/generation or rewrite the PRD here.
                                    title={!f.id ? 'This scope entry does not reference a PRD feature, so downstream assets are generated without it.' : undefined}
                                    className={`rounded-md border ${cardClasses} px-3 py-2`}
                                >
                                    {body}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    const renderScope = () => {
        const summary = deriveImplementationSummary(structuredPRD);
        const rationale = structuredPRD.mvpScope?.rationale;
        const deferredCount = deferredFeatureIds.size;
        if (isImplementationSummaryEmpty(summary) && !rationale) return null;
        return (
            <div className="mb-8 scroll-mt-24" id="prd-implementation-summary">
                <div className="flex items-center justify-between mb-3 border-b border-neutral-200 pb-2">
                    <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">Current proposed scope</h3>
                </div>
                {rationale && (
                    <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                        <span className="text-[10px] uppercase font-bold tracking-wider mr-2 px-1.5 py-0.5 rounded bg-indigo-200 text-indigo-900">Synapse proposal</span>
                        {rationale}
                    </div>
                )}
                {!isImplementationSummaryEmpty(summary) && (
                    <div className="bg-gradient-to-br from-indigo-50/40 to-white border border-indigo-100 rounded-xl p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {renderScopeBucket('Build first', ListChecks, 'green', summary.buildFirst, 'No MVP features tagged.')}
                            {renderScopeBucket('Build next', ArrowRight, 'blue', summary.buildNext, 'No V1 features tagged.')}
                        </div>
                    </div>
                )}
                {deferredCount > 0 && (
                    <p className="text-xs text-neutral-500 mt-3">
                        {deferredCount} feature{deferredCount === 1 ? '' : 's'} deferred — recorded in the{' '}
                        {onOpenDecisions ? (
                            <button type="button" onClick={() => onOpenDecisions()} className="text-indigo-600 hover:text-indigo-800 underline">
                                Decision Center
                            </button>
                        ) : (
                            <span className="text-neutral-600">Decision Center</span>
                        )}
                        .
                    </p>
                )}
                <p className="text-[11px] text-neutral-400 mt-2">
                    Full feature detail lives in the{' '}
                    <button type="button" onClick={() => setView('features')} className="text-indigo-600 hover:text-indigo-800 underline">
                        Features
                    </button>{' '}tab.
                </p>
            </div>
        );
    };

    const hasTechnicalDetail =
        !!structuredPRD.architecture
        || !!structuredPRD.architectureFlows?.length
        || !!structuredPRD.roles?.length
        || !!structuredPRD.uxPages?.length
        || !!structuredPRD.userLoops?.length
        || (structuredPRD.richDataModel?.entities.length ?? 0) > 0
        || !!structuredPRD.stateMachines?.length;

    const renderOverview = () => (
        <>
            {renderGroundingBackfill()}

            {/* Product Summary — the fastest way to understand the product. */}
            {structuredPRD.executiveSummary && (
                <ExecutiveSummarySection summary={structuredPRD.executiveSummary} />
            )}

            {/* Problem & Opportunity, then Vision / Value proposition. */}
            {renderSectionUncertainty('Core Problem')}
            {renderTextSection('Core Problem', 'coreProblem', structuredPRD.coreProblem)}

            {structuredPRD.productThesis && (
                <ProductThesisSection thesis={structuredPRD.productThesis} />
            )}

            {renderSectionUncertainty('Vision')}
            {renderTextSection('Vision', 'vision', structuredPRD.vision)}

            {structuredPRD.principles && structuredPRD.principles.length > 0 && (
                <PrinciplesSection principles={structuredPRD.principles} />
            )}

            {/* Target Users — JTBD if available, else legacy targetUsers list */}
            {renderSectionUncertainty('Target Users')}
            {structuredPRD.jtbd && structuredPRD.jtbd.length > 0
                ? <JtbdSection jtbd={structuredPRD.jtbd} />
                : renderListSection('Target Users', 'targetUsers', structuredPRD.targetUsers)}

            {/* Goals & Success Metrics */}
            {structuredPRD.successMetrics && structuredPRD.successMetrics.length > 0 && (
                <MetricsSection metrics={structuredPRD.successMetrics} />
            )}

            {/* Scope — the scope DECISION + compact references, not the full
                feature list (that lives in the Features view). */}
            {renderScope()}

            {renderConstraints()}

            {/* Grounding appendix — domain nouns/verbs the mockup engine uses. */}
            {renderDomainEntities()}
            {renderPrimaryActions()}

            {/* Architecture & additional context — progressively disclosed so the
                brief stays calm. Preserves legacy technical sections without a
                separate artifact. */}
            {hasTechnicalDetail && (
                <div className="mb-8">
                    <button
                        type="button"
                        onClick={() => setShowTechnicalDetail(v => !v)}
                        aria-expanded={showTechnicalDetail}
                        className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700 hover:text-neutral-900 transition"
                    >
                        {showTechnicalDetail ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        Architecture &amp; additional context
                    </button>
                    {showTechnicalDetail && (
                        <div className="mt-4">
                            {renderSectionUncertainty('Architecture')}
                            {structuredPRD.architecture &&
                                renderTextSection('Architecture', 'architecture', structuredPRD.architecture)}
                            {structuredPRD.architectureFlows && structuredPRD.architectureFlows.length > 0 && (
                                <ArchFlowsSection flows={structuredPRD.architectureFlows} />
                            )}
                            {structuredPRD.roles && structuredPRD.roles.length > 0 && (
                                <RolesSection roles={structuredPRD.roles} />
                            )}
                            {structuredPRD.uxPages && structuredPRD.uxPages.length > 0 && (
                                <UxArchitectureSection pages={structuredPRD.uxPages} />
                            )}
                            {structuredPRD.userLoops && structuredPRD.userLoops.length > 0 && (
                                <UserLoopsSection loops={structuredPRD.userLoops} />
                            )}
                            {structuredPRD.richDataModel && structuredPRD.richDataModel.entities.length > 0 && (
                                <DataModelSection model={structuredPRD.richDataModel} />
                            )}
                            {structuredPRD.stateMachines && structuredPRD.stateMachines.length > 0 && (
                                <StateMachinesSection machines={structuredPRD.stateMachines} />
                            )}
                        </div>
                    )}
                </div>
            )}
        </>
    );

    // ── Features view: feature systems → individual features ───────────
    const renderFeatureGroup = (group: ReturnType<typeof groupFeaturesBySystem>[number]) => {
        const collapsed = collapsedGroups.has(group.id);
        return (
            <section key={group.id} className="rounded-xl border border-neutral-200 overflow-hidden">
                <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={!collapsed}
                    className="w-full flex items-start gap-3 px-4 py-3 bg-neutral-50 hover:bg-neutral-100 text-left transition"
                >
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            {collapsed ? <ChevronRight size={16} className="text-neutral-400 shrink-0" /> : <ChevronDown size={16} className="text-neutral-400 shrink-0" />}
                            <h4 className="font-bold text-neutral-900 min-w-0 break-words">{group.name}</h4>
                        </div>
                        {group.purpose && <p className="text-xs text-neutral-600 mt-1 ml-6">{group.purpose}</p>}
                        {group.outcome && (
                            <p className="text-xs text-neutral-500 mt-0.5 ml-6">
                                <span className="font-semibold">Outcome:</span> {group.outcome}
                            </p>
                        )}
                    </div>
                </button>
                {!collapsed && (
                    <div className="p-4 space-y-3">
                        {group.features.map(feature => renderFeatureCard(feature, !group.ungrouped))}
                    </div>
                )}
            </section>
        );
    };

    const renderFeatures = () => {
        const noFeatures = structuredPRD.features.length === 0;
        return (
            <>
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">Features</h3>
                        <span className="text-[11px] text-neutral-400">
                            {filterCounts.all} in scope
                            {confirmedCount > 0 && <span className="text-emerald-600"> · {confirmedCount} confirmed</span>}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <label htmlFor="prd-feature-filter" className="sr-only">Filter features</label>
                        <select
                            id="prd-feature-filter"
                            value={featureFilter}
                            onChange={e => setFeatureFilter(e.target.value as FeatureFilterId)}
                            className="text-sm border border-neutral-200 rounded-md px-2.5 py-1.5 bg-white text-neutral-700 focus:outline-none focus:border-indigo-400"
                        >
                            {FEATURE_FILTERS.map(f => (
                                <option key={f.id} value={f.id}>{f.label} ({filterCounts[f.id]})</option>
                            ))}
                        </select>
                        {!readOnly && (
                            <button
                                onClick={handleAddFeature}
                                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-md px-2.5 py-1.5 transition"
                            >
                                <Plus size={14} />
                                Add
                            </button>
                        )}
                    </div>
                </div>
                {noFeatures ? (
                    <div className="p-6 bg-neutral-50 border border-dashed border-neutral-200 rounded-lg text-sm text-neutral-500 text-center">
                        No features captured in this PRD yet.
                    </div>
                ) : filteredFeatures.length === 0 ? (
                    <div className="p-6 bg-neutral-50 border border-dashed border-neutral-200 rounded-lg text-sm text-neutral-500 text-center">
                        No features match this filter.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {featureGroups.map(group => renderFeatureGroup(group))}
                    </div>
                )}
            </>
        );
    };

    const renderEditRecognition = () => {
        if (!editRecognition) return null;
        const definite = editRecognition.classification === 'meaning_changed';
        const conflicts = editRecognition.possibleConflictRecordIds.length;
        return (
            <div className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50/70 p-4" role="status">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-indigo-950">
                            {definite ? 'Plan meaning updated' : 'This edit may affect the plan'}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-indigo-800">
                            {editRecognition.reason}{' '}
                            {editRecognition.affectedPrdSections.length > 0
                                ? `${editRecognition.affectedPrdSections.length} related plan area${editRecognition.affectedPrdSections.length === 1 ? '' : 's'} should be reviewed.`
                                : ''}
                            {conflicts > 0 ? ` Synapse also found ${conflicts} possible conflict${conflicts === 1 ? '' : 's'}.` : ''}
                        </p>
                        {onOpenDecisions && (
                            <button
                                type="button"
                                onClick={() => onOpenDecisions(editRecognition.planningRecordIds[0])}
                                className="mt-2 text-xs font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
                            >
                                Review planning impact
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => setEditRecognition(null)}
                        className="shrink-0 rounded p-1 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
                        aria-label="Dismiss edit impact notice"
                    >
                        <X size={15} />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="relative">
            <PrdViewTabs
                active={activeView}
                onChange={setView}
                counts={{
                    features: filterCounts.all,
                }}
            />
            <div
                ref={contentRef}
                role="tabpanel"
                id={`prd-panel-${activeView}`}
                aria-labelledby={`prd-tab-${activeView}`}
                tabIndex={0}
                // pb-24 on mobile keeps the last action clear of the pinned
                // "Select text to edit" pill (see MobileSelectionToolbar below).
                className="space-y-2 focus:outline-none pb-24 md:pb-0"
            >
                {renderEditRecognition()}
                {activeView === 'overview' && renderOverview()}
                {activeView === 'features' && (
                    <>
                        {renderSectionUncertainty('Features')}
                        {renderFeatures()}
                    </>
                )}
            </div>

            {selection && (
                <SelectionActionDialog
                    selection={selection}
                    intent={intent}
                    setIntent={setIntent}
                    isSubmitting={isSubmitting}
                    onSubmit={handleSubmit}
                    onQuickAction={handleQuickAction}
                    onDismiss={dismiss}
                />
            )}

            {/* On mobile the idle "Select text to edit" pill is pinned
                bottom-right (visible while scrolling); the content panel above
                carries pb-24 so the last action clears it. Once the user opts
                in, the active footer replaces it. */}
            {isMobile && !readOnly && !editingSection && !selection && (
                <MobileSelectionToolbar
                    active={mobileSelectMode}
                    hasSelection={!!pendingText}
                    pendingText={pendingText}
                    onActivate={() => setMobileSelectMode(true)}
                    onEdit={commit}
                    onCancel={() => {
                        setMobileSelectMode(false);
                        clear();
                    }}
                />
            )}
        </div>
    );
}
