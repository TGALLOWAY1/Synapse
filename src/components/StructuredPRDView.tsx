import { useState, useEffect, useMemo, useRef } from 'react';
import { Pencil, Check, X, Plus, Trash2, Sparkles, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
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
import type { StructuredPRD, Feature } from '../types';
import {
    parseEntities,
    parseActions,
    serializeEntities,
    serializeActions,
} from '../lib/groundingFields';
import { ImplementationSummarySection } from './prd/ImplementationSummarySection';
import { ReviewConfirmSection } from './prd/ReviewConfirmSection';
import { DecisionLogSection } from './prd/DecisionLogSection';
import { splitAssumptions, deriveDecisionLog } from '../lib/derive/prdDecisions';
import {
    deriveDeferredFeatureIds,
    deriveImplementationSummary,
    featureDetailAnchorId,
    isImplementationSummaryEmpty,
    splitFeaturesByTier,
} from '../lib/derive/implementationSummary';
import {
    ExecutiveSummarySection,
    ProductThesisSection,
    JtbdSection,
    PrinciplesSection,
    UserLoopsSection,
    UxArchitectureSection,
    FeatureSystemsSection,
    DataModelSection,
    StateMachinesSection,
    RolesSection,
    ArchFlowsSection,
    RisksDetailedSection,
    MetricsSection,
    HandoffAppendixSection,
} from './prd/PremiumSections';

interface StructuredPRDViewProps {
    projectId: string;
    spineId: string;
    structuredPRD: StructuredPRD;
    readOnly: boolean;
}

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

export function StructuredPRDView({ projectId, spineId, structuredPRD, readOnly }: StructuredPRDViewProps) {
    const { editSpineStructuredPRD, createBranch, addBranchMessage, branches } = useProjectStore();
    const [editingSection, setEditingSection] = useState<EditingSection>(null);
    const [editValue, setEditValue] = useState('');
    const [intent, setIntent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

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
    const savePRD = (updated: StructuredPRD, editSummary: string) => {
        const markdown = structuredPRDToMarkdown(updated);
        editSpineStructuredPRD(projectId, spineId, updated, {
            responseText: markdown,
            changeSource: 'user_edit',
            editSummary,
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
            savePRD(merged, 'Updated grounding fields');
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

    // ── Review & Confirm / Decision Log ────────────────────────────────
    // Confirmations are PRD edits like any other: they append a new spine
    // version (never overwrite) with a descriptive edit summary, so every
    // decision is undoable through version history too.
    const truncate = (s: string, max = 60) =>
        s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;

    const patchAssumption = (
        assumptionId: string,
        patch: Partial<NonNullable<StructuredPRD['assumptions']>[number]>,
        editSummary: string,
    ) => {
        const updated = {
            ...structuredPRD,
            assumptions: (structuredPRD.assumptions ?? []).map(a =>
                a.id === assumptionId ? { ...a, ...patch } : a,
            ),
        };
        savePRD(updated, editSummary);
    };

    const handleConfirmAssumption = (assumptionId: string) => {
        const a = structuredPRD.assumptions?.find(x => x.id === assumptionId);
        if (!a) return;
        patchAssumption(
            assumptionId,
            { decision: 'confirmed', decisionNote: undefined, decidedAt: Date.now() },
            `Confirmed assumption: ${truncate(a.statement)}`,
        );
    };

    const handleRejectAssumption = (assumptionId: string, note: string) => {
        const a = structuredPRD.assumptions?.find(x => x.id === assumptionId);
        if (!a) return;
        patchAssumption(
            assumptionId,
            { decision: 'rejected', decisionNote: note || undefined, decidedAt: Date.now() },
            `Marked assumption incorrect: ${truncate(a.statement)}`,
        );
    };

    const handleUndoAssumption = (assumptionId: string) => {
        const a = structuredPRD.assumptions?.find(x => x.id === assumptionId);
        if (!a) return;
        patchAssumption(
            assumptionId,
            { decision: undefined, decisionNote: undefined, decidedAt: undefined },
            `Reopened assumption: ${truncate(a.statement)}`,
        );
    };

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
        savePRD(
            updated,
            confirmed
                ? `Confirmed feature: ${feature.name || 'Untitled'}`
                : `Reopened feature: ${feature.name || 'Untitled'}`,
        );
    };

    const { unresolved: unresolvedAssumptions } = splitAssumptions(structuredPRD.assumptions);
    const decisionLog = deriveDecisionLog(structuredPRD);

    // ── Detailed Features grouping & summary ↔ detail navigation ───────
    // MVP (and unclassified) features render by default; V1 features sit
    // behind a collapsed disclosure; deferred (tier 'later') features are
    // NOT rendered here — they appear only as Decision Log entries above.
    const deferredFeatureIds = useMemo(
        () => deriveDeferredFeatureIds(structuredPRD),
        [structuredPRD],
    );
    const featureGroups = useMemo(
        () => splitFeaturesByTier(structuredPRD.features, deferredFeatureIds),
        [structuredPRD.features, deferredFeatureIds],
    );
    const [showV1Features, setShowV1Features] = useState(false);
    const pendingScrollRef = useRef<string | null>(null);

    const summaryPresent = useMemo(
        () =>
            !isImplementationSummaryEmpty(deriveImplementationSummary(structuredPRD))
            || !!structuredPRD.mvpScope?.rationale,
        [structuredPRD],
    );

    const scrollToAnchor = (elementId: string) => {
        document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // Jump from an Implementation Summary card to the feature's detail card,
    // expanding the collapsed V1 group first when the target lives inside it.
    const handleNavigateToFeature = (featureId: string) => {
        const elementId = featureDetailAnchorId(featureId);
        if (!showV1Features && featureGroups.v1.some(f => f.id === featureId)) {
            pendingScrollRef.current = elementId;
            setShowV1Features(true);
            return;
        }
        scrollToAnchor(elementId);
    };

    // Scroll to a just-expanded V1 feature once it is actually in the DOM.
    useEffect(() => {
        if (!pendingScrollRef.current) return;
        const elementId = pendingScrollRef.current;
        pendingScrollRef.current = null;
        document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [showV1Features]);

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
    const renderFeatureCard = (feature: Feature) => (
        <div key={feature.id} id={featureDetailAnchorId(feature.id)} className="relative group/feature scroll-mt-24">
            <FeatureCard
                feature={feature}
                onUpdate={handleFeatureUpdate}
                onToggleConfirm={handleToggleFeatureConfirm}
                onBackToSummary={summaryPresent ? () => scrollToAnchor('prd-implementation-summary') : undefined}
                readOnly={readOnly}
            />
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

    return (
        <div className="relative">
            <div ref={contentRef} className="space-y-2">
                {renderGroundingBackfill()}

                {/* Premium PRD top — present only on PRDs generated by the new pipeline */}
                {structuredPRD.executiveSummary && (
                    <ExecutiveSummarySection summary={structuredPRD.executiveSummary} />
                )}

                {/* Implementation summary — synthesized from existing fields so a
                    reader can answer "what should I build first?" without scrolling
                    the entire document. THE section presenting MVP/V1 scope (the old
                    MVP Scope lists duplicated it); its cards jump to the feature
                    detail cards below. Hidden if the PRD has no actionable signal. */}
                <ImplementationSummarySection
                    prd={structuredPRD}
                    onNavigateToFeature={handleNavigateToFeature}
                />

                {/* Review & Confirm — the actionable home for assumptions / open
                    decisions (highest confidence first). Confirmed/corrected items
                    move to the Decision Log below; both hide when empty. */}
                <ReviewConfirmSection
                    assumptions={unresolvedAssumptions}
                    onConfirm={handleConfirmAssumption}
                    onReject={handleRejectAssumption}
                    readOnly={readOnly}
                />

                <DecisionLogSection
                    entries={decisionLog}
                    onUndoAssumption={handleUndoAssumption}
                    onUndoFeature={(featureId) => {
                        const f = structuredPRD.features.find(x => x.id === featureId);
                        if (f) handleToggleFeatureConfirm(f);
                    }}
                    readOnly={readOnly}
                />

                {/* Section order is a logical reading flow (mirrors
                    prdMarkdownRenderer): Product Overview → Target Users →
                    Features → UX → Metrics → Risks → Technical Architecture →
                    Data Model → State Machines → reference → Where the Detail
                    Lives (static handoff appendix). MVP/V1 scope lives in the
                    Implementation Summary at the top; deferred scope in the
                    Decision Log. */}

                {/* Product Overview: Vision → Problem → Thesis → Principles */}
                {renderTextSection('Vision', 'vision', structuredPRD.vision)}

                {renderTextSection('Core Problem', 'coreProblem', structuredPRD.coreProblem)}

                {structuredPRD.productThesis && (
                    <ProductThesisSection thesis={structuredPRD.productThesis} />
                )}

                {structuredPRD.principles && structuredPRD.principles.length > 0 && (
                    <PrinciplesSection principles={structuredPRD.principles} />
                )}

                {/* Target Users — JTBD if available, else legacy targetUsers list */}
                {structuredPRD.jtbd && structuredPRD.jtbd.length > 0
                    ? <JtbdSection jtbd={structuredPRD.jtbd} />
                    : renderListSection('Target Users', 'targetUsers', structuredPRD.targetUsers)}

                {/* Core Features — concrete features first, system grouping after.
                    MVP (and unclassified) features show by default; V1 features are
                    collapsed; deferred features render only in the Decision Log. */}
                <div className="mb-8" id="prd-features">
                    <div className="flex items-center justify-between mb-4 border-b border-neutral-200 pb-2">
                        <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">Detailed Features</h3>
                        {!readOnly && (
                            <button
                                onClick={handleAddFeature}
                                className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition"
                            >
                                <Plus size={14} />
                                Add Feature
                            </button>
                        )}
                    </div>
                    <div className="space-y-3">
                        {featureGroups.mvp.map(feature => renderFeatureCard(feature))}
                    </div>
                    {featureGroups.v1.length > 0 && (
                        <div className="mt-4">
                            <button
                                type="button"
                                onClick={() => setShowV1Features(v => !v)}
                                aria-expanded={showV1Features}
                                className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900 transition"
                            >
                                {showV1Features ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                V1 — soon after launch
                                <span className="font-normal normal-case tracking-normal text-neutral-400">
                                    {featureGroups.v1.length} feature{featureGroups.v1.length === 1 ? '' : 's'} · {showV1Features ? 'hide' : 'show'}
                                </span>
                            </button>
                            {showV1Features && (
                                <div className="space-y-3 mt-3">
                                    {featureGroups.v1.map(feature => renderFeatureCard(feature))}
                                </div>
                            )}
                        </div>
                    )}
                    {featureGroups.deferred.length > 0 && (
                        <p className="mt-4 text-xs text-neutral-500">
                            {featureGroups.deferred.length} deferred feature{featureGroups.deferred.length === 1 ? ' is' : 's are'} recorded in the{' '}
                            <a
                                href="#prd-decision-log"
                                onClick={(e) => { e.preventDefault(); scrollToAnchor('prd-decision-log'); }}
                                className="text-indigo-600 hover:text-indigo-800 underline"
                            >
                                Decision Log
                            </a>.
                        </p>
                    )}
                </div>

                {structuredPRD.featureSystems && structuredPRD.featureSystems.length > 0 && (
                    <FeatureSystemsSection systems={structuredPRD.featureSystems} deferredFeatureIds={deferredFeatureIds} />
                )}

                {/* User Experience: UX Architecture → Core User Loops */}
                {structuredPRD.uxPages && structuredPRD.uxPages.length > 0 && (
                    <UxArchitectureSection pages={structuredPRD.uxPages} />
                )}

                {structuredPRD.userLoops && structuredPRD.userLoops.length > 0 && (
                    <UserLoopsSection loops={structuredPRD.userLoops} />
                )}

                {/* Success Metrics */}
                {structuredPRD.successMetrics && structuredPRD.successMetrics.length > 0 && (
                    <MetricsSection metrics={structuredPRD.successMetrics} />
                )}

                {/* Risks: prefer detailed, fall back to legacy bullet list */}
                {structuredPRD.risksDetailed && structuredPRD.risksDetailed.length > 0
                    ? <RisksDetailedSection risks={structuredPRD.risksDetailed} />
                    : renderListSection('Risks', 'risks', structuredPRD.risks)}

                {/* Technical Architecture → Roles → Data Model → State Machines */}
                {renderTextSection('Architecture', 'architecture', structuredPRD.architecture)}

                {structuredPRD.architectureFlows && structuredPRD.architectureFlows.length > 0 && (
                    <ArchFlowsSection flows={structuredPRD.architectureFlows} />
                )}

                {structuredPRD.roles && structuredPRD.roles.length > 0 && (
                    <RolesSection roles={structuredPRD.roles} />
                )}

                {structuredPRD.richDataModel && structuredPRD.richDataModel.entities.length > 0 && (
                    <DataModelSection model={structuredPRD.richDataModel} />
                )}

                {structuredPRD.stateMachines && structuredPRD.stateMachines.length > 0 && (
                    <StateMachinesSection machines={structuredPRD.stateMachines} />
                )}

                {/* Appendix / Reference Material. Assumptions no longer render
                    here — they live in Review & Confirm / Decision Log above. */}
                {renderDomainEntities()}
                {renderPrimaryActions()}

                <HandoffAppendixSection />
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

            {/* Mobile-only: explicit selection mode so the iOS toolbar and the
                Synapse action sheet don't fight. Hidden while the sheet is open
                or while inline-editing a section. */}
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
