import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    FileText, Image, Package, CheckCircle2, Loader2, Circle, AlertTriangle,
    RefreshCcw, Menu, X, ListChecks, History, Lock,
    Layers, Database, Code2, AppWindow, Waypoints,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProjectStore } from '../store/projectStore';
import { useIsMobile } from '../lib/useIsMobile';
import { artifactJobController } from '../lib/services/artifactJobController';
import { CORE_ARTIFACT_DISPLAY_ORDER, getArtifactMeta, isHiddenArtifactSubtype, isRetiredArtifactSubtype } from '../lib/coreArtifactPipeline';
import { ArtifactContentRenderer } from './renderers';
import { StructuredPRDView } from './StructuredPRDView';
import { MockupViewer } from './mockups/MockupViewer';
import { MockupErrorBoundary } from './mockups/MockupErrorBoundary';
import { GenerationProgress } from './GenerationProgress';
import { MOCKUP_GENERATION_STAGES, getArtifactStages } from './generationStages';
import { ConvertToTasksModal } from './ConvertToTasksModal';
import { TaskChecklist } from './tasks/TaskChecklist';
import { StalenessBadge } from './StalenessBadge';
import { VersionHistoryPanel, type VersionEntry } from './versions';
import { ChangeDirectionModal } from './setup/ChangeDirectionModal';
import { DesignDirectionControl } from './DesignDirectionControl';
import { v4 as uuidv4 } from 'uuid';
import {
    tryParsePayload, extractMockupSettings, mergeExtraScreens,
    mockupScreenFromInventoryScreen, readExtraMockupScreens,
} from '../lib/mockupParsing';
import { hasOpenAIKey } from '../lib/openaiClient';
import { useMockupImageStore } from '../store/mockupImageStore';
import { selectPreferredDesignTokens, selectPreferredDesignSystem } from '../lib/designTokens';
import {
    buildScreenIndex, readScreenEdits, readScreenLinks, readDismissedScreenIssues,
    type ScreenMetadataEdit,
} from '../lib/screenExperience';
import { ReferenceWarningsPanel } from './experience/ReferenceWarningsPanel';
import { parseScreenInventory } from '../lib/screenInventoryNormalize';
import { parseFlows } from './renderers/userFlows/parseFlow';
import type { ParsedFlow } from './renderers/userFlows/types';
import { ScreenListView } from './experience/ScreenListView';
import { ScreenDetailView } from './experience/ScreenDetailView';
import type { ScreenDetailTab } from './experience/ScreenDetailTabs';
import { DependencyGraphView } from './dependency/DependencyGraphView';
import type { DependencyNodeId } from '../lib/artifactDependencyGraph';
import type {
    ArtifactSlotKey, CoreArtifactSubtype, MockupScreen, ProjectPlatform, StructuredPRD,
    GenerationStatus, ProjectTask,
} from '../types';

// Stable empty reference for the tasks selector. Returning `[]` literal each
// call would make Zustand's useSyncExternalStore see a fresh snapshot on every
// render and bail out with React #185 (Maximum update depth) for any project
// without saved tasks — e.g. the demo project on first load.
const EMPTY_TASKS: ProjectTask[] = [];

// Stable empty flows list for the screen-experience join memo.
const EMPTY_FLOWS: ParsedFlow[] = [];

interface ArtifactWorkspaceProps {
    projectId: string;
    spineVersionId: string;
    prdContent: string;
    structuredPRD: StructuredPRD;
    projectPlatform?: ProjectPlatform;
    // One-shot signal that the user just arrived here by finalizing the PRD.
    // When true, the panel auto-selects the first meaningful non-PRD artifact
    // and opens the mobile drawer; consumed exactly once via onAutoOpenConsumed
    // so closing the drawer never triggers a reopen.
    autoOpenIntent?: boolean;
    onAutoOpenConsumed?: () => void;
}

// 'screens' is the Experience workspace's screen-centric view — a read-side
// join over screen_inventory + user_flows + mockup (src/lib/screenExperience.ts),
// not an artifact slot of its own. 'dependency_graph' is likewise a derived
// view (src/lib/artifactDependencyGraph.ts) — the project-integrity map over
// all artifact slots, never a slot itself.
type WorkspaceSelection = 'prd' | ArtifactSlotKey | 'screens' | 'dependency_graph';

interface SlotMeta {
    key: WorkspaceSelection;
    title: string;
    description: string;
    icon: typeof FileText;
}

interface ArtifactGroup {
    id: string;
    title: string;
    icon: typeof FileText;
    items: WorkspaceSelection[];
}

// Sidebar grouping is purely visual — subtype IDs are unchanged. Order within
// a group is the order rows render in. The "Project Foundation → Experience →
// Architecture → Development" sequence tells the product-build story; keep it in
// sync with the README/tour if either changes. The Design System sits under
// Project Foundation, directly below the PRD — it's the visual foundation every
// downstream asset is generated against.
const ARTIFACT_GROUPS: ArtifactGroup[] = [
    { id: 'foundation', title: 'Project Foundation', icon: FileText, items: ['prd', 'design_system'] },
    {
        id: 'experience',
        title: 'Experience',
        icon: Layers,
        // 'screens' consolidates the old Screen Inventory + Mockups sidebar rows
        // into one screen-centric view (list → per-screen Overview/Flow/Mockups
        // tabs). The screen_inventory and mockup artifacts still generate and
        // persist unchanged — renderMain's legacy branches remain internally
        // reachable as fallbacks; they just no longer render sidebar rows.
        // 'component_inventory' also still generates (mockups consume it) but is
        // a hidden subtype — see HIDDEN_ARTIFACT_SUBTYPES / docs/backlog §6.
        items: ['user_flows', 'screens'],
    },
    { id: 'architecture', title: 'Architecture', icon: Database, items: ['data_model'] },
    // Development consolidates the old Developer Prompts + Build Plan rows
    // into one Implementation Plan artifact (milestones + prompt packs +
    // quality gates). Legacy prompt_pack artifacts still exist in storage —
    // the Implementation Plan view consumes them through
    // implementationPlanAdapter rather than rendering a separate row.
    { id: 'development', title: 'Development', icon: Code2, items: ['implementation_plan'] },
    // The Dependency Graph is a read-side integrity view over every artifact
    // slot (staleness, impact, safe update order) — not an artifact itself.
    { id: 'map', title: 'Project Map', icon: Waypoints, items: ['dependency_graph'] },
];

function buildSlotMetas(): SlotMeta[] {
    const base: Record<WorkspaceSelection, SlotMeta> = {
        prd: { key: 'prd', title: 'PRD', description: 'Final product requirements document', icon: FileText },
        mockup: { key: 'mockup', title: 'Mockups', description: 'Interactive UI mockups', icon: Image },
        screens: { key: 'screens', title: 'Screens', description: 'Screen-by-screen experience workspace', icon: AppWindow },
        dependency_graph: {
            key: 'dependency_graph',
            title: 'Dependency Graph',
            description: 'How artifacts connect and what needs updating',
            icon: Waypoints,
        },
    } as Record<WorkspaceSelection, SlotMeta>;
    for (const meta of CORE_ARTIFACT_DISPLAY_ORDER) {
        base[meta.subtype as WorkspaceSelection] = {
            key: meta.subtype as WorkspaceSelection,
            title: meta.title,
            description: meta.description,
            icon: Package,
        };
    }
    // Materialize in the group order so the right rail / counts / mobile
    // header iterate in the same order the sidebar shows. Hidden artifact
    // subtypes (generated for downstream use but not surfaced) are dropped here
    // so they render no row anywhere in the workspace.
    return ARTIFACT_GROUPS.flatMap(group =>
        group.items
            .filter(key =>
                key === 'prd' || key === 'mockup' || key === 'screens' || key === 'dependency_graph'
                || (!isHiddenArtifactSubtype(key) && !isRetiredArtifactSubtype(key)))
            .map(key => base[key]),
    );
}

function StatusDot({ status }: { status: GenerationStatus }) {
    if (status === 'done') return <CheckCircle2 size={14} className="text-green-500 shrink-0" />;
    if (status === 'generating' || status === 'queued') {
        return <Loader2 size={14} className="text-sky-500 animate-spin shrink-0" />;
    }
    if (status === 'error') return <AlertTriangle size={14} className="text-red-500 shrink-0" />;
    if (status === 'interrupted') return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
    return <Circle size={14} className="text-neutral-300 shrink-0" />;
}

// The Screens row is fed by TWO slots — screen_inventory (the screen
// "breakdown") and mockup (the visual mockups) — which finish at different
// times: the breakdown almost always completes well before the mockups. A
// single green check on the row therefore misleads the user into thinking the
// mockups are ready too. This dot keeps the two sub-statuses distinct: while
// the breakdown is done but mockups are still in flight (or need attention) it
// pairs the breakdown's check with the mockups' live indicator, so the row
// reads "breakdown ready · mockups still working" instead of a flat "done".
export function ScreensStatusDot({ inventory, mockup }: { inventory: GenerationStatus; mockup: GenerationStatus }) {
    // Breakdown itself isn't ready yet → show its raw status; the mockups are
    // downstream of it and don't matter until it lands.
    if (inventory !== 'done') return <StatusDot status={inventory} />;
    // Breakdown ready, mockups still generating/queued → partial state.
    if (mockup === 'generating' || mockup === 'queued') {
        return (
            <span
                title="Screen breakdown ready — mockups still generating"
                className="inline-flex items-center gap-0.5 shrink-0"
            >
                <CheckCircle2 size={14} className="text-green-500" />
                <Loader2 size={12} className="text-sky-500 animate-spin" />
            </span>
        );
    }
    // Breakdown ready, mockups failed/interrupted → surface that on the row.
    if (mockup === 'error' || mockup === 'interrupted') {
        return (
            <span
                title="Screen breakdown ready — mockups need attention"
                className="inline-flex items-center gap-0.5 shrink-0"
            >
                <CheckCircle2 size={14} className="text-green-500" />
                <AlertTriangle size={12} className={mockup === 'error' ? 'text-red-500' : 'text-amber-500'} />
            </span>
        );
    }
    // Mockups done, idle, or never requested → the breakdown check stands alone.
    return <StatusDot status={inventory} />;
}

// The lock lives on the Design System row only. Every downstream asset is
// generated *against* the design system, so the lock signals "your visual
// direction is locked in" — one aesthetic, committed — rather than tagging
// each asset. Changing direction later is still possible (ChangeDirectionModal,
// with its downstream-regression warning), but the lock nudges against it.
function isLockedAsset(key: WorkspaceSelection): boolean {
    return key === 'design_system';
}

// Small lock shown on the generated Design System, signalling the project's
// visual direction is locked in. Rendered only once its slot is `done`.
function AssetLock() {
    const label = 'Visual direction locked in — changing it can require regenerating downstream screens';
    return (
        <span title={label} className="inline-flex shrink-0">
            <Lock size={11} className="text-neutral-400" aria-label={label} />
        </span>
    );
}

export function ArtifactWorkspace({
    projectId, spineVersionId, prdContent, structuredPRD, projectPlatform,
    autoOpenIntent, onAutoOpenConsumed,
}: ArtifactWorkspaceProps) {
    const isMobile = useIsMobile();
    const {
        getArtifacts, getPreferredVersion, getArtifactStaleness, getJob, getProject,
        updateArtifactVersionMetadata, getArtifactVersions, getSpineVersions,
        revertArtifactToVersion, setProjectDesignSystemPreset,
    } = useProjectStore();
    // Reactive read of the project's chosen visual direction, so the Design
    // System "Design direction" control re-renders when it changes.
    const designSystemPreset = useProjectStore(s => s.projects[projectId]?.designSystemPreset);
    // Which artifact's version-history panel is open (null = none).
    const [versionHistoryArtifactId, setVersionHistoryArtifactId] = useState<string | null>(null);
    // Subscribe to tasks so the Implementation Plan button label tracks saved
    // count reactively (the checklist itself reads the store directly).
    const projectTasks = useProjectStore(s => s.tasks[projectId] ?? EMPTY_TASKS);
    // Active design tokens, so the Screen Inventory copy-prompt embeds the same
    // Design System Brief the internal mockups use. selectPreferredDesignTokens
    // is reference-stable per ArtifactVersion, so it's safe inside a selector.
    const designTokens = useProjectStore(s => selectPreferredDesignTokens(s, projectId));

    const slotMetas = useMemo(() => buildSlotMetas(), []);
    const [selected, setSelected] = useState<WorkspaceSelection>('prd');
    // The scrollable content pane. Reset to the top whenever the user switches
    // pages so a new artifact never inherits the previous page's scroll offset.
    const mainRef = useRef<HTMLElement>(null);
    // Mobile-only: the left rail is a slide-in drawer below the md breakpoint.
    // Closed by default so the content pane is fully visible on first paint.
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    // Holds the artifact id + content the modal should extract tasks from.
    // Stored as state (rather than derived) so the modal keeps working even
    // if the user mutates the artifact in another tab while it's open.
    const [tasksModalSource, setTasksModalSource] = useState<
        { artifactId: string; content: string } | null
    >(null);
    // Mockup regenerate confirm — surfaces "Creates Version N. Current
    // version remains available." before kicking off a new run so the user
    // doesn't fear losing their existing render.
    const [mockupRegenConfirm, setMockupRegenConfirm] = useState<
        { nextVersion: number } | null
    >(null);
    // Post-finalization "design direction" flow on the Design System artifact:
    // the preset picker, and the confirm before regenerating the design system.
    const [showDirectionPicker, setShowDirectionPicker] = useState(false);
    const [designRegenConfirm, setDesignRegenConfirm] = useState<
        { nextVersion: number } | null
    >(null);
    // Experience workspace (Screens) navigation state — URL-addressable:
    // /p/:projectId?screen=<canonical id>[&screenTab=flow|mockups]. The URL
    // is the single source of truth for which screen is open, so deep links,
    // refresh, and browser back/forward all work without a state↔URL sync
    // effect (which would also trip react-hooks/set-state-in-effect). An
    // invalid/stale id simply misses `byId` and falls back to the list.
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedScreenId = searchParams.get('screen');
    const rawScreenTab = searchParams.get('screenTab');
    const screenTab: ScreenDetailTab =
        rawScreenTab === 'flow' || rawScreenTab === 'mockups' ? rawScreenTab : 'overview';

    // Update the screen params, preserving unrelated query params (debug
    // flags etc). `replace` is used for tab switches so history stays one
    // entry per screen, not per tab click.
    const setScreenParams = (
        screenId: string | null,
        tab: ScreenDetailTab = 'overview',
        opts?: { replace?: boolean },
    ) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (screenId) {
                next.set('screen', screenId);
                if (tab !== 'overview') next.set('screenTab', tab);
                else next.delete('screenTab');
            } else {
                next.delete('screen');
                next.delete('screenTab');
            }
            return next;
        }, { replace: opts?.replace });
    };

    // The rendered selection: an open screen param always means the Screens
    // view (derived — never synced), so back/forward re-entering ?screen=…
    // reopens the detail page even if another artifact row was selected.
    const activeSelection: WorkspaceSelection = selectedScreenId ? 'screens' : selected;

    const job = getJob(projectId);

    // --- Experience (Screens) join layer ------------------------------------
    // Preferred versions of the three experience artifacts. The version
    // objects are stable references in the store until a new version lands,
    // so they are safe useMemo dependencies.
    const coreArtifacts = getArtifacts(projectId, 'core_artifact');
    const invArtifact = coreArtifacts.find(a => a.subtype === 'screen_inventory');
    const invPreferred = invArtifact ? getPreferredVersion(projectId, invArtifact.id) : undefined;
    const flowsArtifact = coreArtifacts.find(a => a.subtype === 'user_flows');
    const flowsPreferred = flowsArtifact ? getPreferredVersion(projectId, flowsArtifact.id) : undefined;
    const mockupArtifact = getArtifacts(projectId, 'mockup')[0];
    const mockupPreferred = mockupArtifact ? getPreferredVersion(projectId, mockupArtifact.id) : undefined;

    // Effective mockup payload: stored screens + the version's user-added
    // extraScreens overlay (metadata — keeps the version id, so existing
    // per-screen images stay keyed correctly).
    const mockupPayload = useMemo(() => {
        if (!mockupPreferred) return null;
        const parsed = tryParsePayload(mockupPreferred);
        return parsed ? mergeExtraScreens(parsed, mockupPreferred.metadata) : null;
    }, [mockupPreferred]);

    // Read-side screen index: joins the parsed screen_inventory, user_flows,
    // and mockup contents by canonical screen id / slug. Pure + memoized —
    // nothing new is persisted here, and missing artifacts degrade to a
    // stable empty index. `screenEdits` is the per-version user overlay
    // (metadata.screenEdits — the promptEdits pattern); a save patches the
    // version metadata, which swaps the invPreferred reference and recomputes.
    const screenIndex = useMemo(() => {
        const inventory = invPreferred ? parseScreenInventory(invPreferred.content) : null;
        const flows = flowsPreferred ? parseFlows(flowsPreferred.content) : EMPTY_FLOWS;
        return buildScreenIndex(
            inventory,
            flows,
            mockupPayload,
            readScreenEdits(invPreferred?.metadata),
            readScreenLinks(mockupPreferred?.metadata),
        );
    }, [invPreferred, flowsPreferred, mockupPayload, mockupPreferred]);

    // Validation issues minus the user's persisted dismissals.
    const visibleScreenIssues = useMemo(() => {
        const dismissed = readDismissedScreenIssues(invPreferred?.metadata);
        return screenIndex.issues.filter(i => !dismissed.has(i.key));
    }, [screenIndex, invPreferred]);

    // Repair: pin/relink a mockup screen to a canonical screen (persisted on
    // the mockup version — survives renames and name drift thereafter).
    const handleRelinkMockupScreen = (mockupScreenId: string, screenId: string) => {
        if (!mockupArtifact || !mockupPreferred) return;
        const links = { ...readScreenLinks(mockupPreferred.metadata), [mockupScreenId]: screenId };
        updateArtifactVersionMetadata(projectId, mockupArtifact.id, mockupPreferred.id, { screenLinks: links });
    };

    // Repair: hide a warning (current behavior is kept — nothing else changes).
    const handleDismissScreenIssue = (issueKey: string) => {
        if (!invArtifact || !invPreferred) return;
        const dismissed = new Set(readDismissedScreenIssues(invPreferred.metadata));
        dismissed.add(issueKey);
        updateArtifactVersionMetadata(projectId, invArtifact.id, invPreferred.id, {
            dismissedScreenIssues: Array.from(dismissed),
        });
    };

    // Persist (or clear, with null) one screen's metadata edit overlay.
    const handleSaveScreenEdit = (screenId: string, edit: ScreenMetadataEdit | null) => {
        if (!invArtifact || !invPreferred) return;
        const current = readScreenEdits(invPreferred.metadata);
        const next: Record<string, ScreenMetadataEdit> = { ...current };
        if (edit) next[screenId] = edit;
        else delete next[screenId];
        updateArtifactVersionMetadata(projectId, invArtifact.id, invPreferred.id, { screenEdits: next });
    };

    // --- Mockup coverage actions --------------------------------------------
    // Add inventory screens to the CURRENT mockup version's extraScreens
    // overlay. No AI call happens here — image generation stays an explicit
    // per-screen action (or the confirmed batch below), so adding coverage is
    // free. Returns the appended MockupScreen specs.
    const addScreensToMockups = (screenIds: string[]): MockupScreen[] => {
        if (!mockupArtifact || !mockupPreferred) return [];
        const existing = readExtraMockupScreens(mockupPreferred.metadata);
        const appended: MockupScreen[] = [];
        for (const id of screenIds) {
            const item = screenIndex.byId.get(id);
            if (!item || item.mockupScreen) continue; // already covered
            if (existing.some(e => e.sourceScreenId === item.id)) continue;
            const mockup = mockupScreenFromInventoryScreen(item.baseScreen, uuidv4(), item.id);
            existing.push(mockup);
            appended.push(mockup);
        }
        if (appended.length > 0) {
            updateArtifactVersionMetadata(projectId, mockupArtifact.id, mockupPreferred.id, {
                extraScreens: existing,
            });
        }
        return appended;
    };

    const handleAddScreenToMockups = (screenId: string) => {
        addScreensToMockups([screenId]);
    };

    // Confirmed batch: add every uncovered screen, then (only with an OpenAI
    // key) kick off low-quality draft generation per screen. Each generation
    // is individually tracked and cancellable via the standard per-screen
    // panel; failures leave that screen on its generate/upload placeholder.
    const [missingMockupsConfirm, setMissingMockupsConfirm] = useState<{ count: number } | null>(null);
    const handleGenerateMissingMockups = () => {
        const missing = screenIndex.items.filter(i => !i.mockupScreen).map(i => i.id);
        if (missing.length === 0 || !mockupArtifact || !mockupPreferred || !mockupPayload) {
            setMissingMockupsConfirm(null);
            return;
        }
        const appended = addScreensToMockups(missing);
        setMissingMockupsConfirm(null);
        if (!hasOpenAIKey()) return; // screens now show the upload sheet instead
        const settings = extractMockupSettings(mockupPreferred);
        const payloadForPrompt = { ...mockupPayload, screens: [...mockupPayload.screens, ...appended] };
        const imageStore = useMockupImageStore.getState();
        for (const mockup of appended) {
            void imageStore.generate({
                projectId,
                artifactId: mockupArtifact.id,
                versionId: mockupPreferred.id,
                screen: mockup,
                payload: payloadForPrompt,
                settings,
                quality: 'low',
            });
        }
    };

    // Per-screen upload-gallery context for the detail view's Overview tab —
    // mirrors the context the standalone screen_inventory branch builds below.
    const invScreenImageContext = invArtifact && invPreferred
        ? {
            projectId,
            artifactId: invArtifact.id,
            artifactVersionId: invPreferred.id,
            productTitle: structuredPRD.productName ?? getProject(projectId)?.name ?? 'this product',
            productSummary: structuredPRD.executiveSummary ?? structuredPRD.vision,
            designTokens,
            platformHint: (projectPlatform === 'app'
                ? 'mobile'
                : projectPlatform === 'web'
                    ? 'desktop'
                    : 'responsive') as 'mobile' | 'desktop' | 'responsive',
        }
        : undefined;

    // Mockups-tab context for the detail view. Absent when the mockup
    // artifact is missing or its payload is unparseable — the tab shows an
    // empty state instead.
    const mockupDetailContext = mockupArtifact && mockupPreferred && mockupPayload
        ? {
            projectId,
            artifactId: mockupArtifact.id,
            versionId: mockupPreferred.id,
            payload: mockupPayload,
            settings: extractMockupSettings(mockupPreferred),
        }
        : undefined;

    // Auto-resume any slots that didn't finish before the last unmount /
    // page reload. The job state is transient (stripped from persisted
    // store), so without this the user lands on a workspace where missing
    // artifacts silently sit at "Idle" with no resume affordance.
    useEffect(() => {
        artifactJobController.resumeIfNeeded({
            projectId, spineVersionId, prdContent, structuredPRD, projectPlatform,
        });
    }, [projectId, spineVersionId, prdContent, structuredPRD, projectPlatform]);

    // Scroll the content pane back to the top on every page switch (including
    // opening/closing a screen detail page).
    useEffect(() => {
        mainRef.current?.scrollTo({ top: 0 });
    }, [activeSelection, selectedScreenId]);

    const slotStatusFor = (key: WorkspaceSelection): GenerationStatus => {
        // 'dependency_graph' is a derived view over all slots, not a slot —
        // it is always available (its row renders no status dot).
        if (key === 'prd' || key === 'dependency_graph') return 'done';
        // 'screens' is a derived view over screen_inventory — surface that
        // slot's status so the sidebar dot tracks the screens' source artifact.
        const slotKey: ArtifactSlotKey = key === 'screens' ? 'screen_inventory' : key;
        const fromJob = job?.slots[slotKey]?.status;
        if (fromJob && fromJob !== 'idle') return fromJob;
        // No active job state — derive from artifact presence so previously
        // completed artifacts still show as "Ready" after the job is cleared.
        const type = slotKey === 'mockup' ? 'mockup' : 'core_artifact';
        const subtype: CoreArtifactSubtype | undefined = slotKey === 'mockup' ? undefined : slotKey;
        const artifacts = getArtifacts(projectId, type);
        const existing = subtype ? artifacts.find(a => a.subtype === subtype) : artifacts[0];
        if (existing && existing.currentVersionId) return 'done';
        return 'idle';
    };

    const slotErrorFor = (key: WorkspaceSelection) => {
        if (key === 'prd' || key === 'dependency_graph') return undefined;
        const slotKey: ArtifactSlotKey = key === 'screens' ? 'screen_inventory' : key;
        return job?.slots[slotKey]?.error;
    };

    // Post-finalization auto-open. Runs once each time the parent arms
    // autoOpenIntent: pick the first meaningful non-PRD artifact (prefer one
    // that's already done, else generating, else queued, else the first slot
    // in display order) so the user never lands on the PRD again, and open the
    // mobile drawer so the asset list is visible. Consumed immediately so a
    // user who closes the drawer is never re-interrupted.
    useEffect(() => {
        if (!autoOpenIntent) return;
        // Exclude the always-'done' derived views so a fresh finalize never
        // auto-lands on the Dependency Graph instead of a real artifact.
        const candidates = slotMetas.map(s => s.key).filter(k => k !== 'prd' && k !== 'dependency_graph');
        const firstWith = (s: GenerationStatus) => candidates.find(k => slotStatusFor(k) === s);
        const pick = firstWith('done') ?? firstWith('generating') ?? firstWith('queued') ?? candidates[0];
        if (pick) setSelected(pick);
        if (isMobile) setMobileSidebarOpen(true);
        onAutoOpenConsumed?.();
        // slotStatusFor/slotMetas are stable for this purpose; we intentionally
        // react only to the intent flag flipping on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoOpenIntent]);

    // Drives the in-pane "Creating your build assets…" placeholder so an
    // idle slot doesn't read as empty while siblings are still in flight.
    // 'mockup' no longer renders a sidebar row (it lives inside the Screens
    // view), so it's re-added here explicitly to keep the in-flight signal.
    const isActive = ([...slotMetas.map(s => s.key), 'mockup'] as WorkspaceSelection[]).some(key => {
        const status = slotStatusFor(key);
        return status === 'generating' || status === 'queued';
    });

    const handleRetrySlot = (slot: ArtifactSlotKey) => {
        artifactJobController.retrySlot(slot, {
            projectId, spineVersionId, prdContent, structuredPRD, projectPlatform,
        });
    };

    // Open a screen's detail view by its stable canonical id (Screens list,
    // flow-node navigation). Pushes a history entry so browser Back returns
    // to the previous view.
    const handleOpenScreen = (screenId: string) => {
        setSelected('screens');
        setScreenParams(screenId);
        setMobileSidebarOpen(false);
    };

    // Slug-based entry point for User Flows journey nodes (flows are markdown
    // and only know screen names) — resolved to the canonical id here.
    const handleNavigateToScreen = (slug: string) => {
        const item = screenIndex.bySlug.get(slug);
        if (item) handleOpenScreen(item.id);
    };

    // Dependency Graph "Open artifact" → the workspace view that hosts that
    // node. screen_inventory and mockup have no rows of their own anymore —
    // both live inside the Screens experience view.
    const handleOpenGraphNode = (nodeId: DependencyNodeId) => {
        if (nodeId === 'screen_inventory' || nodeId === 'mockup') {
            setSelected('screens');
        } else if (nodeId === 'prd' || slotMetas.some(s => s.key === nodeId)) {
            setSelected(nodeId as WorkspaceSelection);
        } else {
            return; // hidden/retired subtype — no view to open
        }
        if (selectedScreenId) setScreenParams(null);
        setMobileSidebarOpen(false);
    };

    // Persist a newly-chosen visual direction, then surface the regenerate
    // confirm — the preset only takes effect when the design system is
    // regenerated, so we lead the user straight into that step.
    const handleChooseDirection = (presetId: string) => {
        setProjectDesignSystemPreset(projectId, presetId);
        setShowDirectionPicker(false);
        const ds = getArtifacts(projectId, 'core_artifact').find(a => a.subtype === 'design_system');
        const preferred = ds ? getPreferredVersion(projectId, ds.id) : undefined;
        setDesignRegenConfirm({ nextVersion: (preferred?.versionNumber ?? 0) + 1 });
    };

    // Resolve a spine source-ref id to its positional "Version N" label, matching
    // the label the PRD workspace shows.
    const resolveSpineLabel = (spineId?: string): string | undefined => {
        if (!spineId) return undefined;
        const idx = getSpineVersions(projectId).findIndex(s => s.id === spineId);
        return idx >= 0 ? `Version ${idx + 1}` : undefined;
    };

    // Header strip shown above a generated artifact: provenance chip ("Generated
    // from PRD Version X"), staleness badge, and a Version history entry point.
    const renderVersionControls = (
        artifactId: string,
        preferred: { sourceRefs: { sourceType: string; sourceArtifactVersionId: string }[] },
    ) => {
        const staleness = getArtifactStaleness(projectId, artifactId);
        const spineRef = preferred.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId;
        const prdLabel = resolveSpineLabel(spineRef);
        return (
            <div className="flex items-center gap-2 flex-wrap">
                {prdLabel && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 font-medium">
                        Generated from PRD {prdLabel}
                    </span>
                )}
                <StalenessBadge staleness={staleness} />
                <button
                    type="button"
                    onClick={() => setVersionHistoryArtifactId(artifactId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                >
                    <History size={12} /> Version history
                </button>
            </div>
        );
    };

    const renderMain = () => {
        if (activeSelection === 'prd') {
            return (
                <div className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl mx-auto">
                    <StructuredPRDView
                        projectId={projectId}
                        spineId={spineVersionId}
                        structuredPRD={structuredPRD}
                        readOnly
                    />
                </div>
            );
        }

        // --- Project Map → Dependency Graph (derived integrity view) --------
        if (activeSelection === 'dependency_graph') {
            return (
                <DependencyGraphView
                    projectId={projectId}
                    spineVersionId={spineVersionId}
                    prdContent={prdContent}
                    structuredPRD={structuredPRD}
                    projectPlatform={projectPlatform}
                    onOpenNode={handleOpenGraphNode}
                />
            );
        }

        // --- Experience → Screens (read-side consolidation) -----------------
        if (activeSelection === 'screens') {
            const screensStatus = slotStatusFor('screens'); // = screen_inventory slot
            const screensError = slotErrorFor('screens');
            if (screensStatus === 'queued' || screensStatus === 'generating') {
                return (
                    <div className="max-w-2xl mx-auto">
                        <GenerationProgress
                            stages={getArtifactStages('screen_inventory')}
                            variant="systematic"
                            title={screensStatus === 'queued' ? 'Queued: Screens' : 'Generating Screen Inventory'}
                            subtitle={screensStatus === 'queued' ? 'Queued — will start as a generation slot frees up' : undefined}
                            history={job?.slots.screen_inventory?.progressLog ?? []}
                        />
                    </div>
                );
            }
            if (screensStatus === 'error' || screensStatus === 'interrupted') {
                // The Screens view is fed by screen_inventory, so its retry
                // re-runs that slot (there is no standalone sidebar row for it
                // anymore).
                return (
                    <div className="max-w-2xl mx-auto bg-white border border-neutral-200 rounded-xl p-6 shadow-sm">
                        <div className="flex items-start gap-3">
                            <AlertTriangle size={20} className={screensStatus === 'error' ? 'text-red-500' : 'text-amber-500'} />
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-neutral-900">
                                    {screensStatus === 'error' ? 'Screen Inventory generation failed' : 'Screen Inventory generation interrupted'}
                                </h3>
                                {screensError?.message && (
                                    <p className="text-sm text-neutral-600 mt-1 break-words">{screensError.message}</p>
                                )}
                                <button
                                    type="button"
                                    onClick={() => handleRetrySlot('screen_inventory')}
                                    className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                                >
                                    <RefreshCcw size={14} /> Retry
                                </button>
                            </div>
                        </div>
                    </div>
                );
            }
            if (screensStatus === 'idle' && isActive) {
                return <BuildAssetsLoading />;
            }

            // Legacy fallback: a screen_inventory version exists but isn't
            // parseable structured JSON (old markdown artifacts). Render it
            // through the standalone renderer so the content stays reachable
            // instead of dead-ending on an empty Screens list.
            if (screenIndex.items.length === 0 && invPreferred && invArtifact) {
                return (
                    <div className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl mx-auto space-y-4">
                        <div className="flex items-center justify-start">
                            {renderVersionControls(invArtifact.id, invPreferred)}
                        </div>
                        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-6 prose prose-sm prose-neutral max-w-none overflow-auto">
                            <ArtifactContentRenderer
                                subtype="screen_inventory"
                                content={invPreferred.content}
                                screenImageContext={invScreenImageContext}
                                projectId={projectId}
                            />
                        </div>
                    </div>
                );
            }

            const detailItem = selectedScreenId
                ? screenIndex.byId.get(selectedScreenId)
                : undefined;
            if (detailItem) {
                return (
                    <ScreenDetailView
                        item={detailItem}
                        activeTab={screenTab}
                        onTabChange={(tab) => setScreenParams(detailItem.id, tab, { replace: true })}
                        onBack={() => setScreenParams(null)}
                        onNavigateToScreen={handleNavigateToScreen}
                        availableScreenSlugs={screenIndex.availableSlugs}
                        screenImageContext={invScreenImageContext}
                        mockupContext={mockupDetailContext}
                        mockupStatus={slotStatusFor('mockup')}
                        onRetryMockup={() => handleRetrySlot('mockup')}
                        features={structuredPRD.features}
                        onSaveScreenEdit={invArtifact && invPreferred ? handleSaveScreenEdit : undefined}
                        onAddToMockups={
                            mockupDetailContext && !detailItem.mockupScreen
                                ? () => handleAddScreenToMockups(detailItem.id)
                                : undefined
                        }
                        unmatchedMockups={
                            mockupPayload && !detailItem.mockupScreen
                                ? mockupPayload.screens
                                    .filter(s => !screenIndex.items.some(i => i.mockupScreen?.id === s.id))
                                    .map(s => ({ id: s.id, name: s.name }))
                                : undefined
                        }
                        onLinkMockup={
                            mockupArtifact && mockupPreferred && !detailItem.mockupScreen
                                ? (mockupScreenId) => handleRelinkMockupScreen(mockupScreenId, detailItem.id)
                                : undefined
                        }
                    />
                );
            }

            // Artifact-level controls for the two source artifacts that no
            // longer have their own sidebar rows: Screen Inventory version
            // history / staleness, and Mockup version history / regenerate
            // (incl. the design-system drift prompt). Without these here the
            // consolidation would orphan restore + regenerate flows.
            const mockupDesignRef = mockupPreferred?.sourceRefs.find(
                r => r.sourceType === 'core_artifact' && typeof r.anchorInfo === 'string',
            );
            const currentDesignForScreens = selectPreferredDesignSystem(useProjectStore.getState(), projectId);
            const screensDesignDrift = !!mockupDesignRef
                && !!currentDesignForScreens?.tokensHash
                && currentDesignForScreens.tokensHash !== mockupDesignRef.anchorInfo;

            // Stale screen id (e.g. inventory regenerated) falls back to the list.
            return (
                <div className="space-y-4">
                    {(invPreferred || mockupPreferred) && (
                        <div className="max-w-3xl xl:max-w-5xl mx-auto flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                                {invArtifact && invPreferred && renderVersionControls(invArtifact.id, invPreferred)}
                            </div>
                            {mockupArtifact && mockupPreferred && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <button
                                        type="button"
                                        onClick={() => setVersionHistoryArtifactId(mockupArtifact.id)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                                    >
                                        <History size={12} /> Mockup history
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setMockupRegenConfirm({ nextVersion: mockupPreferred.versionNumber + 1 })}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                                    >
                                        <RefreshCcw size={12} /> Regenerate Mockup
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    {screensDesignDrift && mockupPreferred && (
                        <div className="max-w-3xl xl:max-w-5xl mx-auto flex items-start justify-between gap-3 flex-wrap rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="flex items-start gap-2 min-w-0">
                                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-amber-900">
                                        Design system changed since these mockups were generated
                                    </p>
                                    <p className="text-xs text-amber-700 mt-0.5">
                                        Regenerate the mockups to apply the new visual direction.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setMockupRegenConfirm({ nextVersion: mockupPreferred.versionNumber + 1 })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-md transition shrink-0"
                            >
                                <RefreshCcw size={12} /> Regenerate Mockup
                            </button>
                        </div>
                    )}
                    {visibleScreenIssues.length > 0 && (
                        <div className="max-w-3xl xl:max-w-5xl mx-auto">
                            <ReferenceWarningsPanel
                                issues={visibleScreenIssues}
                                screenOptions={screenIndex.items.map(i => ({ id: i.id, name: i.screen.name }))}
                                onRelink={mockupArtifact && mockupPreferred ? handleRelinkMockupScreen : undefined}
                                onDismiss={invArtifact && invPreferred ? handleDismissScreenIssue : undefined}
                            />
                        </div>
                    )}
                    <ScreenListView
                        index={screenIndex}
                        onSelectScreen={handleOpenScreen}
                        onGenerateMissingMockups={
                            mockupDetailContext
                                ? () => setMissingMockupsConfirm({
                                    count: screenIndex.items.filter(i => !i.mockupScreen).length,
                                })
                                : undefined
                        }
                    />
                </div>
            );
        }

        const status = slotStatusFor(activeSelection);
        const error = slotErrorFor(activeSelection);

        if (status === 'queued' || status === 'generating') {
            const meta = activeSelection === 'mockup' ? null : getArtifactMeta(activeSelection);
            const stages = activeSelection === 'mockup' ? MOCKUP_GENERATION_STAGES : getArtifactStages(activeSelection);
            const displayName = activeSelection === 'mockup' ? 'Mockup' : (meta?.title ?? activeSelection);
            const title = status === 'queued'
                ? `Queued: ${displayName}`
                : activeSelection === 'mockup'
                    ? 'Designing your product interface'
                    : `Generating ${displayName}`;
            return (
                <div className="max-w-2xl mx-auto">
                    <GenerationProgress
                        stages={stages}
                        variant={activeSelection === 'mockup' ? 'creative' : 'systematic'}
                        title={title}
                        subtitle={status === 'queued' ? 'Queued — will start as a generation slot frees up' : undefined}
                        history={job?.slots[activeSelection]?.progressLog ?? []}
                    />
                </div>
            );
        }

        if (status === 'error' || status === 'interrupted') {
            return (
                <div className="max-w-2xl mx-auto bg-white border border-neutral-200 rounded-xl p-6 shadow-sm">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className={status === 'error' ? 'text-red-500' : 'text-amber-500'} />
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-neutral-900">
                                {status === 'error' ? 'Generation failed' : 'Generation interrupted'}
                            </h3>
                            {error?.message && (
                                <p className="text-sm text-neutral-600 mt-1 break-words">{error.message}</p>
                            )}
                            <button
                                type="button"
                                onClick={() => handleRetrySlot(activeSelection)}
                                className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                            >
                                <RefreshCcw size={14} /> Retry
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        // Idle while the overall run is still in flight means this slot hasn't
        // started yet (e.g. cleared job, or waiting behind the concurrency
        // limit). Show the global "creating your build assets" state rather
        // than a bare "Not generated yet" so the workspace never looks empty.
        if (status === 'idle' && isActive) {
            return <BuildAssetsLoading />;
        }

        // status === 'done' or 'idle' — try to render the existing artifact.
        if (activeSelection === 'mockup') {
            const mockup = getArtifacts(projectId, 'mockup')[0];
            const preferred = mockup ? getPreferredVersion(projectId, mockup.id) : undefined;
            if (!mockup || !preferred) {
                return <EmptyState message="No mockup yet" />;
            }
            const parsed = tryParsePayload(preferred);
            const payload = parsed ? mergeExtraScreens(parsed, preferred.metadata) : null;
            if (!payload) {
                return (
                    <div className="bg-white rounded-xl border border-neutral-200 p-5 prose prose-sm prose-neutral max-w-none overflow-auto max-h-[600px]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{preferred.content}</ReactMarkdown>
                    </div>
                );
            }
            const settings = extractMockupSettings(preferred);
            const staleness = getArtifactStaleness(projectId, mockup.id);
            // Did the design system's tokens change since these mockups were
            // generated? Mirrors stalenessSlice's mockup check: compare the
            // tokensHash recorded on the mockup's design_system source ref
            // against the project's current preferred design system. When they
            // differ, prompt the user to regenerate so the new visual direction
            // actually reaches the images.
            const designRef = preferred.sourceRefs.find(
                r => r.sourceType === 'core_artifact' && typeof r.anchorInfo === 'string',
            );
            const currentDesign = selectPreferredDesignSystem(useProjectStore.getState(), projectId);
            const designSystemDrift = !!designRef
                && !!currentDesign?.tokensHash
                && currentDesign.tokensHash !== designRef.anchorInfo;
            return (
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        {renderVersionControls(mockup.id, preferred)}
                        <button
                            type="button"
                            onClick={() => setMockupRegenConfirm({ nextVersion: preferred.versionNumber + 1 })}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                        >
                            <RefreshCcw size={12} /> Regenerate Mockup
                        </button>
                    </div>
                    {designSystemDrift && (
                        <div className="flex items-start justify-between gap-3 flex-wrap rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="flex items-start gap-2 min-w-0">
                                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-amber-900">
                                        Design system changed since these mockups were generated
                                    </p>
                                    <p className="text-xs text-amber-700 mt-0.5">
                                        Regenerate the mockups to apply the new visual direction.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setMockupRegenConfirm({ nextVersion: preferred.versionNumber + 1 })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-md transition shrink-0"
                            >
                                <RefreshCcw size={12} /> Regenerate Mockup
                            </button>
                        </div>
                    )}
                    <MockupErrorBoundary resetKey={preferred.id}>
                        <MockupViewer
                            payload={payload}
                            settings={settings}
                            staleness={staleness}
                            versionNumber={preferred.versionNumber}
                            createdAt={preferred.createdAt}
                            sourceSpineVersionId={preferred.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId}
                            versionId={preferred.id}
                            projectId={projectId}
                            artifactId={mockup.id}
                        />
                    </MockupErrorBoundary>
                </div>
            );
        }

        // Core artifact done state.
        const subtype = activeSelection;
        const artifact = getArtifacts(projectId, 'core_artifact').find(a => a.subtype === subtype);
        const preferred = artifact ? getPreferredVersion(projectId, artifact.id) : undefined;
        if (!artifact || !preferred) {
            return <EmptyState message="Not generated yet" />;
        }
        const screenImageContext = subtype === 'screen_inventory'
            ? {
                projectId,
                artifactId: artifact.id,
                artifactVersionId: preferred.id,
                productTitle: structuredPRD.productName ?? getProject(projectId)?.name ?? 'this product',
                productSummary: structuredPRD.executiveSummary ?? structuredPRD.vision,
                designTokens,
                platformHint: (projectPlatform === 'app'
                    ? 'mobile'
                    : projectPlatform === 'web'
                        ? 'desktop'
                        : 'responsive') as 'mobile' | 'desktop' | 'responsive',
            }
            : undefined;
        const promptEdits = subtype === 'prompt_pack'
            ? ((preferred.metadata?.promptEdits as Record<number, string> | undefined) ?? {})
            : undefined;
        // Legacy projects may hold a standalone prompt_pack artifact (retired
        // subtype, no sidebar row). The Implementation Plan view consumes its
        // content through the adapter so those prompts appear as prompt packs.
        const legacyPromptPackContent = subtype === 'implementation_plan'
            ? (() => {
                const packArtifact = getArtifacts(projectId, 'core_artifact').find(a => a.subtype === 'prompt_pack');
                const packPreferred = packArtifact ? getPreferredVersion(projectId, packArtifact.id) : undefined;
                return packPreferred?.content;
            })()
            : undefined;
        const handleUpdatePromptEdits = subtype === 'prompt_pack'
            ? (next: Record<number, string>) => {
                updateArtifactVersionMetadata(projectId, artifact.id, preferred.id, { promptEdits: next });
            }
            : undefined;
        return (
            <div className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl mx-auto space-y-4">
                <div className="flex items-center justify-start">
                    {renderVersionControls(artifact.id, preferred)}
                </div>
                {subtype === 'design_system' && (
                    <DesignDirectionControl
                        presetId={designSystemPreset}
                        onChangeDirection={() => setShowDirectionPicker(true)}
                        onRegenerate={() =>
                            setDesignRegenConfirm({ nextVersion: preferred.versionNumber + 1 })
                        }
                    />
                )}
                {subtype === 'implementation_plan' && (() => {
                    const savedCount = projectTasks.filter(t => t.sourceArtifactId === artifact.id).length;
                    return (
                        <div className="flex items-center justify-end">
                            <button
                                type="button"
                                onClick={() =>
                                    setTasksModalSource({
                                        artifactId: artifact.id,
                                        content: preferred.content,
                                    })
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                            >
                                <ListChecks size={12} />
                                {savedCount > 0 ? `Manage Tasks (${savedCount})` : 'Convert to Tasks'}
                            </button>
                        </div>
                    );
                })()}
                {subtype === 'implementation_plan' && (
                    <TaskChecklist projectId={projectId} sourceArtifactId={artifact.id} />
                )}
                <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-6 prose prose-sm prose-neutral max-w-none overflow-auto">
                    <MockupErrorBoundary
                        resetKey={preferred.id}
                        fallback={
                            <div className="text-sm text-neutral-500 not-prose">
                                <p className="font-medium text-neutral-700 mb-1">Unable to render this artifact</p>
                                <p>
                                    The saved content for this version could not be displayed. Try
                                    regenerating the artifact or selecting a different version.
                                </p>
                            </div>
                        }
                    >
                    <ArtifactContentRenderer
                        subtype={subtype}
                        content={preferred.content}
                        screenImageContext={screenImageContext}
                        metadata={preferred.metadata}
                        projectId={projectId}
                        features={
                            subtype === 'prompt_pack' || subtype === 'user_flows'
                                ? structuredPRD.features
                                : undefined
                        }
                        uxPages={subtype === 'user_flows' ? structuredPRD.uxPages : undefined}
                        domainEntities={subtype === 'user_flows' ? structuredPRD.domainEntities : undefined}
                        featureSystems={subtype === 'user_flows' ? structuredPRD.featureSystems : undefined}
                        implementationPlan={subtype === 'user_flows' ? structuredPRD.implementationPlan : undefined}
                        onNavigateToScreen={subtype === 'user_flows' ? handleNavigateToScreen : undefined}
                        availableScreenSlugs={subtype === 'user_flows' ? screenIndex.availableSlugs : undefined}
                        promptPackContent={legacyPromptPackContent}
                        promptEdits={promptEdits}
                        onUpdatePromptEdits={handleUpdatePromptEdits}
                        generatedAt={subtype === 'prompt_pack' ? preferred.createdAt : undefined}
                        versionNumber={subtype === 'prompt_pack' ? preferred.versionNumber : undefined}
                    />
                    </MockupErrorBoundary>
                </div>
            </div>
        );
    };

    const selectedMeta = slotMetas.find(s => s.key === activeSelection);
    const handleSelect = (key: WorkspaceSelection) => {
        setSelected(key);
        // Any sidebar selection (including re-clicking "Screens") lands on the
        // top of that view, closing an open Screen Detail (clears the URL
        // params, so Back can return to the screen).
        if (selectedScreenId) setScreenParams(null);
        setMobileSidebarOpen(false);
    };

    return (
        <div className="flex h-full flex-1 min-w-0 relative bg-neutral-50">
            {/* Mobile drawer backdrop */}
            {mobileSidebarOpen && (
                <button
                    type="button"
                    aria-label="Close artifact list"
                    onClick={() => setMobileSidebarOpen(false)}
                    className="md:hidden absolute inset-0 bg-black/30 z-30"
                />
            )}

            {/* Left rail — fixed sidebar on md+, slide-in drawer on mobile */}
            <aside
                className={`
                    absolute md:static inset-y-0 left-0 z-40 w-64 shrink-0
                    border-r border-neutral-200 bg-white overflow-y-auto
                    transition-transform duration-200 ease-out
                    ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                    md:translate-x-0
                `}
            >
                <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-neutral-100">
                    <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Artifacts</span>
                    <button
                        type="button"
                        onClick={() => setMobileSidebarOpen(false)}
                        aria-label="Close artifact list"
                        className="p-1.5 -mr-1 text-neutral-500 hover:text-neutral-900"
                    >
                        <X size={18} />
                    </button>
                </div>
                <nav aria-label="Artifacts" className="py-2">
                    {ARTIFACT_GROUPS.map((group, groupIdx) => {
                        const SectionIcon = group.icon;
                        const groupSlots = group.items
                            .map(key => slotMetas.find(s => s.key === key))
                            .filter((s): s is SlotMeta => Boolean(s));
                        if (groupSlots.length === 0) return null;
                        return (
                            <div
                                key={group.id}
                                className={
                                    groupIdx > 0
                                        ? 'mt-3 pt-3 border-t border-neutral-200/70'
                                        : undefined
                                }
                            >
                                <div className="px-4 pb-1.5 flex items-center gap-2">
                                    <SectionIcon size={14} className="shrink-0 text-indigo-500" aria-hidden="true" />
                                    <span className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider">
                                        {group.title}
                                    </span>
                                </div>
                                <ul>
                                    {groupSlots.map(slot => {
                                        const status = slotStatusFor(slot.key);
                                        const isSel = activeSelection === slot.key;
                                        const Icon = slot.icon;
                                        // The Screens row spans two slots; when the breakdown is
                                        // done but mockups are still working, say so on the row.
                                        const mockupStatus = slot.key === 'screens' ? slotStatusFor('mockup') : 'idle';
                                        const screensMockupsPending =
                                            slot.key === 'screens' && status === 'done'
                                            && (mockupStatus === 'generating' || mockupStatus === 'queued');
                                        return (
                                            <li key={slot.key}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelect(slot.key)}
                                                    className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition border-l-2 ${
                                                        isSel
                                                            ? 'bg-indigo-50 border-indigo-500'
                                                            : 'border-transparent hover:bg-neutral-50'
                                                    }`}
                                                >
                                                    <Icon size={16} className={`shrink-0 mt-0.5 ${isSel ? 'text-indigo-600' : 'text-neutral-400'}`} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`text-sm font-medium truncate ${isSel ? 'text-indigo-900' : 'text-neutral-800'}`}>
                                                                {slot.title}
                                                            </span>
                                                            {slot.key === 'screens' ? (
                                                                <ScreensStatusDot inventory={status} mockup={mockupStatus} />
                                                            ) : slot.key !== 'dependency_graph' && <StatusDot status={status} />}
                                                            {status === 'done' && isLockedAsset(slot.key) && (
                                                                <AssetLock />
                                                            )}
                                                        </div>
                                                        <div className={`text-[11px] leading-tight truncate ${screensMockupsPending ? 'text-sky-600' : 'text-neutral-500'}`}>
                                                            {screensMockupsPending ? 'Breakdown ready · mockups generating…' : slot.description}
                                                        </div>
                                                    </div>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        );
                    })}
                </nav>
            </aside>

            {/* Main pane */}
            <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto bg-neutral-50 relative">
                {/* Mobile-only header with sidebar toggle and current artifact name */}
                <div className="md:hidden sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-white border-b border-neutral-200">
                    <button
                        type="button"
                        onClick={() => setMobileSidebarOpen(true)}
                        aria-label="Open artifact list"
                        className="p-1.5 -ml-1 text-neutral-700 hover:text-neutral-900"
                    >
                        <Menu size={20} />
                    </button>
                    <span className="text-sm font-semibold text-neutral-800 truncate">
                        {selectedMeta?.title ?? 'Artifacts'}
                    </span>
                    {activeSelection !== 'prd' && activeSelection !== 'dependency_graph' && (
                        <span className="ml-auto shrink-0 flex items-center gap-1.5">
                            {activeSelection === 'screens' ? (
                                <ScreensStatusDot inventory={slotStatusFor('screens')} mockup={slotStatusFor('mockup')} />
                            ) : (
                                <StatusDot status={slotStatusFor(activeSelection)} />
                            )}
                            {slotStatusFor(activeSelection) === 'done' && isLockedAsset(activeSelection) && (
                                <AssetLock />
                            )}
                        </span>
                    )}
                </div>
                <div className="p-4 md:p-8">
                    {renderMain()}
                </div>
            </main>

            {tasksModalSource && (
                <ConvertToTasksModal
                    projectId={projectId}
                    sourceArtifactId={tasksModalSource.artifactId}
                    sourceSpineVersionId={spineVersionId}
                    artifactContent={tasksModalSource.content}
                    projectName={getProject(projectId)?.name}
                    onClose={() => setTasksModalSource(null)}
                />
            )}

            {mockupRegenConfirm && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
                    onClick={() => setMockupRegenConfirm(null)}
                    role="presentation"
                >
                    <div
                        className="bg-white rounded-xl shadow-xl border border-neutral-200 w-full max-w-sm overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="mockup-regen-title"
                    >
                        <div className="px-5 pt-5 pb-3">
                            <h3 id="mockup-regen-title" className="text-base font-bold text-neutral-900">
                                Regenerate Mockup
                            </h3>
                            <p className="text-sm text-neutral-700 mt-1">
                                Creates Version {mockupRegenConfirm.nextVersion}.
                            </p>
                            <p className="text-xs text-neutral-500 mt-1">
                                Current version remains available in version history.
                            </p>
                        </div>
                        <div className="px-5 pb-4 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setMockupRegenConfirm(null)}
                                className="px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setMockupRegenConfirm(null);
                                    handleRetrySlot('mockup');
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md transition"
                            >
                                <RefreshCcw size={13} /> Regenerate
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {missingMockupsConfirm && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
                    onClick={() => setMissingMockupsConfirm(null)}
                    role="presentation"
                >
                    <div
                        className="bg-white rounded-xl shadow-xl border border-neutral-200 w-full max-w-sm overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="missing-mockups-title"
                    >
                        <div className="px-5 pt-5 pb-3">
                            <h3 id="missing-mockups-title" className="text-base font-bold text-neutral-900">
                                Generate missing mockups
                            </h3>
                            <p className="text-sm text-neutral-700 mt-1">
                                Adds {missingMockupsConfirm.count} uncovered{' '}
                                {missingMockupsConfirm.count === 1 ? 'screen' : 'screens'} to the current
                                mockup set.
                            </p>
                            {hasOpenAIKey() ? (
                                <p className="text-xs text-amber-700 mt-2">
                                    A low-quality draft image will be generated per screen via OpenAI
                                    gpt-image-2 — {missingMockupsConfirm.count} paid image{' '}
                                    {missingMockupsConfirm.count === 1 ? 'call' : 'calls'} billed to your
                                    own key (typically a few cents each). You can cancel any screen
                                    while it&rsquo;s generating.
                                </p>
                            ) : (
                                <p className="text-xs text-neutral-500 mt-2">
                                    No OpenAI key is configured, so nothing will be generated — each
                                    added screen shows a copyable prompt and an upload sheet instead.
                                </p>
                            )}
                        </div>
                        <div className="px-5 pb-4 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setMissingMockupsConfirm(null)}
                                className="px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleGenerateMissingMockups}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md transition"
                            >
                                <Image size={13} /> {hasOpenAIKey() ? 'Add & generate' : 'Add screens'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDirectionPicker && (
                <ChangeDirectionModal
                    currentPresetId={designSystemPreset}
                    onChoose={handleChooseDirection}
                    onClose={() => setShowDirectionPicker(false)}
                />
            )}

            {designRegenConfirm && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
                    onClick={() => setDesignRegenConfirm(null)}
                    role="presentation"
                >
                    <div
                        className="bg-white rounded-xl shadow-xl border border-neutral-200 w-full max-w-sm overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="design-regen-title"
                    >
                        <div className="px-5 pt-5 pb-3">
                            <h3 id="design-regen-title" className="text-base font-bold text-neutral-900">
                                Regenerate design system
                            </h3>
                            <p className="text-sm text-neutral-700 mt-1">
                                Creates Version {designRegenConfirm.nextVersion} using your chosen direction.
                            </p>
                            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
                                <p className="text-xs text-amber-800">
                                    This changes the visual foundation, so your downstream assets —
                                    mockups and the screen-level prompts you copy for external image
                                    tools — may become out of date. You can regenerate them afterward.
                                    The current version stays in version history.
                                </p>
                            </div>
                        </div>
                        <div className="px-5 pb-4 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setDesignRegenConfirm(null)}
                                className="px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setDesignRegenConfirm(null);
                                    handleRetrySlot('design_system');
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md transition"
                            >
                                <RefreshCcw size={13} /> Regenerate
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {versionHistoryArtifactId && (() => {
                const artifactId = versionHistoryArtifactId;
                const versions = getArtifactVersions(projectId, artifactId);
                const preferred = getPreferredVersion(projectId, artifactId);
                const entries: VersionEntry[] = [...versions]
                    .sort((a, b) => b.versionNumber - a.versionNumber)
                    .map(v => ({
                        id: v.id,
                        label: `Version ${v.versionNumber}`,
                        isCurrent: v.isPreferred,
                        createdAt: v.createdAt,
                        changeSource: v.provenance?.changeSource,
                        editSummary: v.provenance?.editSummary,
                    }));
                return (
                    <VersionHistoryPanel
                        title="Artifact version history"
                        entries={entries}
                        restoreKind="artifact"
                        getCompareInput={(id) => ({
                            kind: 'text',
                            before: versions.find(v => v.id === id)?.content ?? '',
                            after: preferred?.content ?? '',
                        })}
                        onRestore={(id) => revertArtifactToVersion(projectId, artifactId, id)}
                        onClose={() => setVersionHistoryArtifactId(null)}
                    />
                );
            })()}
        </div>
    );
}

function BuildAssetsLoading() {
    return (
        <div className="max-w-lg mx-auto text-center py-16">
            <Loader2 size={32} className="mx-auto mb-4 text-indigo-500 animate-spin" />
            <h3 className="text-lg font-semibold text-neutral-900">Creating your build assets…</h3>
            <p className="text-sm text-neutral-500 mt-2 leading-relaxed">
                We&apos;re generating your data model, user flows, screen inventory, components,
                design system, implementation plan, prompt pack, and mockups. Each appears in
                the panel as it&apos;s ready.
            </p>
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="max-w-md mx-auto text-center text-neutral-500 py-12">
            <Circle size={28} className="mx-auto mb-3 text-neutral-300" />
            <p className="text-sm">{message}</p>
        </div>
    );
}
