import { v4 as uuidv4 } from 'uuid';
import type {
    ArtifactSlotKey,
    CoreArtifactSubtype,
    ProjectPlatform,
    SourceRef,
    StructuredPRD,
} from '../../types';
import { MOCKUP_SPEC_V1 } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { generateCoreArtifact, selectArtifactModel } from './coreArtifactService';
import { buildCanonicalPrdSpine } from '../canonicalPrdSpine';
import { generateMockup } from './mockupService';
import { validateArtifactContent } from '../artifactValidation';
import { validateCrossArtifactConsistency } from '../artifactOrchestration';
import {
    CORE_ARTIFACT_PIPELINE,
    MOCKUP_DEPENDENCIES,
    expandWithHiddenDependencyClosure,
    isRetiredArtifactSubtype,
    buildDependencyLayers,
    getArtifactMeta,
    isHiddenArtifactSubtype,
} from '../coreArtifactPipeline';
import { isAbortError } from '../concurrency';
import { evaluateSpineGenerationGate } from '../artifactGenerationGate';
import { getStrongModel } from '../geminiClient';
import { buildWorkflowRun, type NodeObservation } from '../metrics/buildWorkflowRun';
import { buildAutoMockupSettings } from '../mockupDefaults';
import { normalizeError } from '../errors';
import { useMockupImageStore } from '../../store/mockupImageStore';
import { hasOpenAIKey } from '../openaiClient';
import { selectPreferredDesignSystem } from '../designTokens';
import { parseScreenInventory } from '../screenInventoryNormalize';
import { parseComponentInventoryMarkdown } from '../componentInventoryParse';

export interface StartArgs {
    projectId: string;
    spineVersionId: string;
    prdContent: string;
    structuredPRD: StructuredPRD;
    projectPlatform?: ProjectPlatform;
    /**
     * Explicit, one-shot acknowledgement that the user accepts generating
     * downstream artifacts from an *incomplete* (partial) PRD. See
     * evaluateSpineGenerationGate — without it, an incomplete non-final spine
     * never auto-generates.
     */
    acknowledgeIncomplete?: boolean;
}

const ALL_SLOT_KEYS: ArtifactSlotKey[] = [
    ...CORE_ARTIFACT_PIPELINE.map(m => m.subtype),
    'mockup',
];

// Concurrency budget per project. Core artifacts run up to 4 in parallel
// within a layer; mockup runs in its own single-slot bucket. Mockup spec
// derivation is deterministic and cheap — the slow part is the downstream
// gpt-image-2 image generation which runs through its own image store and
// is not gated by this semaphore. Buckets are per-project so two projects
// in two browser tabs don't starve each other.
const CORE_CONCURRENCY_PER_PROJECT = 4;

interface Semaphore {
    acquire(): Promise<void>;
    release(): void;
}

function createSemaphore(limit: number): Semaphore {
    let inFlight = 0;
    const waiters: Array<() => void> = [];
    return {
        async acquire(): Promise<void> {
            if (inFlight < limit) {
                inFlight++;
                return;
            }
            await new Promise<void>(resolve => waiters.push(resolve));
            inFlight++;
        },
        release(): void {
            inFlight--;
            const next = waiters.shift();
            if (next) next();
        },
    };
}

const coreSemaphores = new Map<string, Semaphore>();
const mockupSemaphores = new Map<string, Semaphore>();

const getCoreSemaphore = (projectId: string): Semaphore => {
    let s = coreSemaphores.get(projectId);
    if (!s) {
        s = createSemaphore(CORE_CONCURRENCY_PER_PROJECT);
        coreSemaphores.set(projectId, s);
    }
    return s;
};

const getMockupSemaphore = (projectId: string): Semaphore => {
    let s = mockupSemaphores.get(projectId);
    if (!s) {
        s = createSemaphore(1);
        mockupSemaphores.set(projectId, s);
    }
    return s;
};

interface RunState {
    controller: AbortController;
    spineVersionId: string;
    promise: Promise<void>;
}

const runs = new Map<string, RunState>();

// PRD section ids that failed to generate for this spine (empty when the PRD
// is complete). Used to stamp downstream artifact versions with degraded-input
// provenance.
function spineVersionForStamp(projectId: string, spineVersionId: string): string[] {
    const spine = (useProjectStore.getState().spineVersions[projectId] || [])
        .find(s => s.id === spineVersionId);
    return spine?.generationMeta?.failedSections ?? [];
}

function isSlotDoneForSpine(projectId: string, slot: ArtifactSlotKey, spineVersionId: string): boolean {
    const store = useProjectStore.getState();
    const type = slot === 'mockup' ? 'mockup' : 'core_artifact';
    const subtype: CoreArtifactSubtype | undefined = slot === 'mockup' ? undefined : slot;
    const artifacts = store.getArtifacts(projectId, type);
    const match = subtype
        ? artifacts.find(a => a.subtype === subtype)
        : artifacts[0];
    if (!match) return false;
    // Only the preferred (currently displayed) version counts as "done" for
    // this spine. Older versions linked to this spine — e.g. after the user
    // reverted to an earlier version — should not block re-generation.
    const preferred = store.getPreferredVersion(projectId, match.id);
    if (!preferred) return false;
    return preferred.sourceRefs.some(
        r => r.sourceType === 'spine' && r.sourceArtifactVersionId === spineVersionId,
    );
}

// Cap consecutive *failed* manual retries per slot. Without this a user can
// hammer the retry button against a deterministic failure (bad key, exhausted
// quota) and burn API calls indefinitely. A successful run clears the count;
// the map is module state, so a page reload also resets it.
const MAX_RETRY_FAILURES = 3;
const retryFailures = new Map<string, number>();
const retryFailureKey = (projectId: string, slot: ArtifactSlotKey) => `${projectId}:${slot}`;

function recordError(projectId: string, slot: ArtifactSlotKey, e: unknown): void {
    const err = normalizeError(e);
    console.error(`[artifactJobController] ${slot} failed`, err.raw);
    useProjectStore.getState().setSlotStatus(projectId, slot, {
        status: 'error',
        finishedAt: Date.now(),
        error: { message: err.message, category: err.category, timestamp: err.timestamp },
    });
}

async function runCoreArtifactSlot(
    args: StartArgs,
    subtype: CoreArtifactSubtype,
    signal: AbortSignal,
    generatedArtifacts: Partial<Record<CoreArtifactSubtype, string>>,
    traceSessionId?: string,
): Promise<void> {
    const { projectId, spineVersionId, prdContent, structuredPRD } = args;

    console.info(`[artifactJobController] ${subtype} starting`);
    const semaphore = getCoreSemaphore(projectId);
    await semaphore.acquire();
    let content: string;
    let extraMetadata: Record<string, unknown> = {};
    try {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        const store = useProjectStore.getState();
        store.setSlotStatus(projectId, subtype, {
            status: 'generating',
            startedAt: Date.now(),
            attempt: (store.getSlot(projectId, subtype)?.attempt ?? 0) + 1,
            progressLog: [],
        });
        // Read the chosen design-system preset off the project here (rather than
        // threading it through every startAll/regenerate/resume call site) so
        // ALL generation paths consistently honor it. Only design_system uses it.
        const project = store.getProject(projectId);
        const designSystemPreset = project?.designSystemPreset;
        // Build the Canonical PRD Spine — the primary source of truth — freshly
        // from THIS run's structuredPRD (rather than trusting a persisted copy,
        // which could lag an edit). Deterministic and cheap. The persisted
        // spine on the SpineVersion is a diagnostic/diffing convenience only.
        const spineVersion = (store.spineVersions[projectId] || []).find(s => s.id === spineVersionId);
        const canonicalSpine = buildCanonicalPrdSpine(structuredPRD, {
            projectName: project?.productName || project?.name,
            platform: project?.platform,
            designSystemPreset,
            safetyReview: spineVersion?.safetyReview,
            sourceSpineVersionId: spineVersionId,
            sourcePrdVersion: spineVersion?.prdVersion,
        });
        const result = await generateCoreArtifact(subtype, prdContent, structuredPRD, {
            generatedArtifacts,
            signal,
            designSystemPreset,
            canonicalSpine,
            traceContext: {
                sessionId: traceSessionId,
                projectId,
                projectName: project?.productName || project?.name,
            },
            onProgress: (msg) => useProjectStore.getState().appendSlotProgress(projectId, subtype, msg),
        });
        content = result.content;
        if (result.metadata) extraMetadata = result.metadata;
    } finally {
        semaphore.release();
    }

    if (signal.aborted) throw new DOMException('aborted', 'AbortError');

    generatedArtifacts[subtype] = content;
    const meta = getArtifactMeta(subtype);
    const validation = validateArtifactContent(subtype, content);
    const consistencyWarnings = validateCrossArtifactConsistency(subtype, content, structuredPRD);
    const warnings = [...validation.warnings, ...consistencyWarnings];

    const writeStore = useProjectStore.getState();
    writeStore.appendSlotProgress(projectId, subtype, 'Saving artifact…');
    const existing = writeStore.getArtifacts(projectId, 'core_artifact').find(a => a.subtype === subtype);
    let artifactId: string;
    if (existing) {
        artifactId = existing.id;
    } else {
        artifactId = writeStore.createArtifact(projectId, 'core_artifact', meta.title, subtype).artifactId;
    }

    const versions = writeStore.getArtifactVersions(projectId, artifactId);
    const parentVersionId = versions.length > 0 ? versions[versions.length - 1].id : null;
    const dependencyTrace = meta.dependsOn.join(', ');

    // Record which upstream artifact versions were available as prompt context
    // (mirrors what runMockupSlot already does), so the dependency graph can
    // detect upstream drift precisely — not just via the spine ref. Legacy
    // versions lack these refs; staleness falls back to a timestamp heuristic.
    const sourceRefs: SourceRef[] = [
        { id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineVersionId, sourceType: 'spine' },
    ];
    for (const dep of meta.dependsOn) {
        const ref = readPreferredArtifactRef(projectId, dep, spineVersionId);
        if (ref) {
            sourceRefs.push({
                id: uuidv4(),
                sourceArtifactId: ref.artifactId,
                sourceArtifactVersionId: ref.versionId,
                sourceType: 'core_artifact',
            });
        }
    }

    // Provenance: stamp when this artifact was generated from an incomplete
    // (partial) PRD so the UI can flag it as generated from degraded input.
    const incompletePrdSections = spineVersionForStamp(projectId, spineVersionId);

    writeStore.createArtifactVersion(
        projectId,
        artifactId,
        content,
        {
            subtype,
            dependencyTrace,
            validationWarnings: warnings,
            ...(incompletePrdSections.length
                ? { generatedFromIncompletePrd: true, incompletePrdSections }
                : {}),
            ...extraMetadata,
        },
        sourceRefs,
        `Generate ${meta.title} from PRD${dependencyTrace ? ` (after: ${dependencyTrace})` : ''}`,
        parentVersionId,
    );

    writeStore.setSlotStatus(projectId, subtype, { status: 'done', finishedAt: Date.now() });
}

const readPreferredArtifactForSpine = (
    projectId: string,
    subtype: CoreArtifactSubtype,
    spineVersionId: string,
): string | null => {
    const store = useProjectStore.getState();
    const artifact = store.getArtifacts(projectId, 'core_artifact').find(a => a.subtype === subtype);
    if (!artifact) return null;
    const preferred = store.getPreferredVersion(projectId, artifact.id);
    if (!preferred) return null;
    const matches = preferred.sourceRefs.some(
        r => r.sourceType === 'spine' && r.sourceArtifactVersionId === spineVersionId,
    );
    return matches ? preferred.content : null;
};

const readPreferredArtifactRef = (
    projectId: string,
    subtype: CoreArtifactSubtype,
    spineVersionId: string,
): { artifactId: string; versionId: string } | null => {
    const store = useProjectStore.getState();
    const artifact = store.getArtifacts(projectId, 'core_artifact').find(a => a.subtype === subtype);
    if (!artifact) return null;
    const preferred = store.getPreferredVersion(projectId, artifact.id);
    if (!preferred) return null;
    const matches = preferred.sourceRefs.some(
        r => r.sourceType === 'spine' && r.sourceArtifactVersionId === spineVersionId,
    );
    return matches ? { artifactId: artifact.id, versionId: preferred.id } : null;
};

async function runMockupSlot(args: StartArgs, signal: AbortSignal): Promise<void> {
    const { projectId, spineVersionId, prdContent, structuredPRD, projectPlatform } = args;
    const settings = buildAutoMockupSettings(prdContent, structuredPRD, projectPlatform);

    const semaphore = getMockupSemaphore(projectId);
    await semaphore.acquire();
    let result: ReturnType<typeof generateMockup>;
    try {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        const store = useProjectStore.getState();
        store.setSlotStatus(projectId, 'mockup', {
            status: 'generating',
            startedAt: Date.now(),
            attempt: (store.getSlot(projectId, 'mockup')?.attempt ?? 0) + 1,
            progressLog: [],
        });
        store.appendSlotProgress(projectId, 'mockup', 'Resolving upstream artifacts…');

        const screenInventoryRaw = readPreferredArtifactForSpine(
            projectId, 'screen_inventory', spineVersionId,
        );
        const componentInventoryRaw = readPreferredArtifactForSpine(
            projectId, 'component_inventory', spineVersionId,
        );

        const screenInventory = screenInventoryRaw
            ? parseScreenInventory(screenInventoryRaw)
            : null;
        const componentInventory = componentInventoryRaw
            ? parseComponentInventoryMarkdown(componentInventoryRaw)
            : null;

        store.appendSlotProgress(projectId, 'mockup', 'Composing screen specs from inventory…');
        result = generateMockup(
            settings,
            structuredPRD,
            screenInventory,
            componentInventory,
        );
    } finally {
        semaphore.release();
    }
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    useProjectStore.getState().appendSlotProgress(projectId, 'mockup', 'Saving mockup spec…');

    const { payload, warnings } = result;
    const writeStore = useProjectStore.getState();
    const title = payload.title?.trim() || `Mockup — ${settings.platform} / ${settings.fidelity} / ${settings.scope.replace('_', ' ')}`;

    const existing = writeStore.getArtifacts(projectId, 'mockup')[0];
    const artifactId = existing
        ? existing.id
        : writeStore.createArtifact(projectId, 'mockup', title).artifactId;

    const versions = writeStore.getArtifactVersions(projectId, artifactId);
    const parentVersionId = versions.length > 0 ? versions[versions.length - 1].id : null;

    // Build source refs spanning every upstream artifact this mockup
    // consumes. The design_system ref's `anchorInfo` carries the
    // tokensHash so staleness can detect token drift without re-comparing
    // the full token object.
    const designSystemPreferred = selectPreferredDesignSystem(writeStore, projectId);
    const sourceRefs: SourceRef[] = [
        { id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineVersionId, sourceType: 'spine' },
    ];
    for (const subtype of MOCKUP_DEPENDENCIES) {
        if (subtype === 'design_system') continue; // handled below to attach hash
        const ref = readPreferredArtifactRef(projectId, subtype, spineVersionId);
        if (ref) {
            sourceRefs.push({
                id: uuidv4(),
                sourceArtifactId: ref.artifactId,
                sourceArtifactVersionId: ref.versionId,
                sourceType: 'core_artifact',
            });
        }
    }
    if (designSystemPreferred) {
        sourceRefs.push({
            id: uuidv4(),
            sourceArtifactId: designSystemPreferred.artifactId,
            sourceArtifactVersionId: designSystemPreferred.versionId,
            sourceType: 'core_artifact',
            anchorInfo: designSystemPreferred.tokensHash,
        });
    }

    const incompletePrdSections = spineVersionForStamp(projectId, spineVersionId);
    const newVersion = writeStore.createArtifactVersion(
        projectId,
        artifactId,
        JSON.stringify(payload),
        {
            settings,
            format: MOCKUP_SPEC_V1,
            generationStrategy: 'mockup_spec_v1',
            autoGenerated: true,
            warnings,
            ...(designSystemPreferred ? { designSystemTokensHash: designSystemPreferred.tokensHash } : {}),
            ...(incompletePrdSections.length
                ? { generatedFromIncompletePrd: true, incompletePrdSections }
                : {}),
        },
        sourceRefs,
        `Auto-generate ${settings.fidelity} ${settings.platform} mockup (${settings.scope.replace('_', ' ')})`,
        parentVersionId,
    );

    writeStore.setSlotStatus(projectId, 'mockup', { status: 'done', finishedAt: Date.now() });

    // Fire-and-forget: kick off low-quality AI image generation for each
    // screen. The AI image is the sole visual deliverable, so kicking it
    // off as soon as the spec lands matches the expectation that the
    // mockup page lights up with images. Skipped when no OpenAI key is
    // configured (the empty-state CTA is shown instead).
    const versionId = newVersion?.versionId;
    if (versionId && hasOpenAIKey() && !signal.aborted) {
        const imageStore = useMockupImageStore.getState();
        for (const screen of payload.screens) {
            void imageStore.generate({
                projectId,
                artifactId,
                versionId,
                screen,
                payload,
                settings,
                quality: 'low',
            }).catch((err) => {
                console.warn('[artifactJobController] auto image generation failed', err);
            });
        }
    }
}

async function executeJob(args: StartArgs, controller: AbortController, slotKeys: ArtifactSlotKey[]): Promise<void> {
    const signal = controller.signal;
    const { projectId } = args;

    const wantsMockup = slotKeys.includes('mockup');
    const coreSubtypes = new Set(slotKeys.filter((k): k is CoreArtifactSubtype => k !== 'mockup'));

    const generatedArtifacts: Partial<Record<CoreArtifactSubtype, string>> = {};

    // Per-slot observations for the orchestration WorkflowRun (artifact bundle).
    // Captures wall-clock start/end + dependency edges so the Metrics dashboard
    // can show the layered concurrency / speedup of artifact generation. Token
    // capture for artifacts is a known TODO (see tasks/TODO.md).
    const artifactRunStart = Date.now();
    const nodeObs: NodeObservation[] = [];
    // One trace session id per artifact-bundle run so the developer-only Trace
    // Viewer groups every slot (and the mockup) under a single generation.
    const traceSessionId = `assets-${projectId}-${artifactRunStart}`;

    // Seed `generatedArtifacts` from the store for any core slot already done
    // for this spine — later layers may consume them as dependency context.
    for (const meta of CORE_ARTIFACT_PIPELINE) {
        if (coreSubtypes.has(meta.subtype)) continue;
        const existing = useProjectStore.getState().getArtifacts(projectId, 'core_artifact').find(a => a.subtype === meta.subtype);
        if (!existing) continue;
        const preferred = useProjectStore.getState().getPreferredVersion(projectId, existing.id);
        if (preferred && preferred.sourceRefs.some(r => r.sourceType === 'spine' && r.sourceArtifactVersionId === args.spineVersionId)) {
            generatedArtifacts[meta.subtype] = preferred.content;
        }
    }

    const corePromise = (async () => {
        const layers = buildDependencyLayers();
        for (const layer of layers) {
            if (signal.aborted) return;
            const tasks = layer
                .filter(meta => coreSubtypes.has(meta.subtype))
                .map(meta => async () => {
                    const startedAt = Date.now();
                    try {
                        await runCoreArtifactSlot(args, meta.subtype, signal, generatedArtifacts, traceSessionId);
                        nodeObs.push({
                            nodeId: meta.subtype,
                            nodeName: meta.title,
                            agentName: 'Artifact Agent',
                            model: selectArtifactModel(meta.subtype),
                            provider: 'gemini',
                            status: 'complete',
                            dependencyIds: meta.dependsOn,
                            startedAt,
                            completedAt: Date.now(),
                        });
                    } catch (e) {
                        if (isAbortError(e) || signal.aborted) return;
                        nodeObs.push({
                            nodeId: meta.subtype,
                            nodeName: meta.title,
                            agentName: 'Artifact Agent',
                            model: selectArtifactModel(meta.subtype),
                            provider: 'gemini',
                            status: 'error',
                            dependencyIds: meta.dependsOn,
                            startedAt,
                            completedAt: Date.now(),
                            errorMessage: e instanceof Error ? e.message : 'Unknown error',
                        });
                        recordError(projectId, meta.subtype, e);
                    }
                });
            if (tasks.length === 0) continue;
            await Promise.all(tasks.map(t => t()));
        }
    })();

    // Mockup is now tightly coupled to screen_inventory, component_inventory,
    // and design_system. Wait for the core pipeline to finish before kicking
    // it off so the spec builder reads completed (or at least attempted)
    // upstream artifacts. If any dep errored, generateMockup degrades
    // gracefully with warnings rather than failing.
    const mockupPromise = wantsMockup
        ? (async () => {
            try {
                await corePromise;
                if (signal.aborted) return;
                const startedAt = Date.now();
                await runMockupSlot(args, signal);
                nodeObs.push({
                    nodeId: 'mockup',
                    nodeName: 'Mockup',
                    agentName: 'Mockup Agent',
                    model: getStrongModel(),
                    provider: 'gemini',
                    status: 'complete',
                    dependencyIds: MOCKUP_DEPENDENCIES,
                    startedAt,
                    completedAt: Date.now(),
                });
            } catch (e) {
                if (isAbortError(e) || signal.aborted) return;
                recordError(projectId, 'mockup', e);
            }
        })()
        : Promise.resolve();

    await Promise.all([corePromise, mockupPromise]);

    if (signal.aborted) {
        useProjectStore.getState().markAllInterrupted(projectId);
        return;
    }

    // Record the artifact-bundle WorkflowRun for the Metrics dashboard. Wrapped
    // so a metrics failure can never break artifact generation.
    if (nodeObs.length > 0) {
        try {
            const project = useProjectStore.getState().getProject(projectId);
            const run = buildWorkflowRun({
                projectId,
                projectName: project?.name,
                workflowType: 'artifacts',
                startedAt: artifactRunStart,
                completedAt: Date.now(),
                nodes: nodeObs,
                metadata: { slots: slotKeys },
            });
            useProjectStore.getState().recordWorkflowRun(run);
        } catch (e) {
            console.warn('[artifactJobController] failed to record workflow metrics.', e);
        }
    }

    const job = useProjectStore.getState().getJob(projectId);
    if (job) {
        const summary = slotKeys
            .map(k => `${k}=${job.slots[k]?.status ?? 'unknown'}`)
            .join(' ');
        console.info(`[artifactJobController] job complete — ${summary}`);
    }
}

function pendingSlotsForSpine(args: StartArgs): ArtifactSlotKey[] {
    // Retired subtypes (e.g. prompt_pack, folded into the consolidated
    // implementation_plan) never generate in new runs — they're excluded
    // here so startAll/resume/regenerate can't schedule them.
    return ALL_SLOT_KEYS.filter(k =>
        (k === 'mockup' || !isRetiredArtifactSubtype(k))
        && !isSlotDoneForSpine(args.projectId, k, args.spineVersionId));
}

// A slot is "hidden" when its subtype is hidden from the assets list. 'mockup'
// is always visible. Hidden slots still generate (startAll includes them), but
// they must never be the *reason* auto-resume wakes a run — the user has no row
// to see or retry them, so retrying an errored hidden slot on every remount is
// invisible churn. resumeIfNeeded therefore gates on visible pending slots only.
const isHiddenSlot = (slot: ArtifactSlotKey): boolean =>
    slot !== 'mockup' && isHiddenArtifactSubtype(slot);

export const artifactJobController = {
    isActive(projectId: string): boolean {
        const run = runs.get(projectId);
        return !!run && !run.controller.signal.aborted;
    },

    /**
     * Kick off generation of every downstream slot not yet done for this
     * spine. Idempotent: a re-call while active is a no-op; a re-call after
     * completion only queues slots still missing.
     */
    startAll(args: StartArgs): void {
        // Downstream protection: a spine blocked by safety review — or an
        // incomplete (partial) PRD the user hasn't acknowledged — can never
        // drive artifact generation, even if startAll is reached directly.
        const spine = (useProjectStore.getState().spineVersions[args.projectId] || [])
            .find(s => s.id === args.spineVersionId);
        if (!evaluateSpineGenerationGate(spine, { acknowledgeIncomplete: args.acknowledgeIncomplete }).allowed) return;

        const existing = runs.get(args.projectId);
        if (existing && !existing.controller.signal.aborted && existing.spineVersionId === args.spineVersionId) {
            return;
        }
        // Different spine or stale entry — cancel any prior run.
        if (existing) {
            existing.controller.abort();
            runs.delete(args.projectId);
        }

        const pending = pendingSlotsForSpine(args);
        if (pending.length === 0) return;

        const store = useProjectStore.getState();
        store.initJob(args.projectId, args.spineVersionId, pending);
        // Mark already-completed slots as 'done' so the UI shows them green.
        for (const key of ALL_SLOT_KEYS) {
            if (!pending.includes(key)) {
                store.setSlotStatus(args.projectId, key, { status: 'done', finishedAt: Date.now() });
            }
        }

        const controller = new AbortController();
        const promise = executeJob(args, controller, pending).finally(() => {
            const current = runs.get(args.projectId);
            if (current && current.controller === controller) {
                runs.delete(args.projectId);
            }
        });
        runs.set(args.projectId, { controller, spineVersionId: args.spineVersionId, promise });
    },

    /**
     * Force-regenerate an explicit set of slots in dependency order (the
     * Dependency Graph's "update" actions). Unlike startAll, already-done
     * slots ARE regenerated. Reuses executeJob, so core slots run layer by
     * layer (an artifact never regenerates before an upstream input that is
     * also in the set) and the mockup runs after the core pipeline settles.
     * No-op while another run is active for the project — callers disable
     * their update buttons off the live job state.
     */
    regenerateSlots(slots: ArtifactSlotKey[], args: StartArgs): void {
        const spine = (useProjectStore.getState().spineVersions[args.projectId] || [])
            .find(s => s.id === args.spineVersionId);
        if (!evaluateSpineGenerationGate(spine, { acknowledgeIncomplete: args.acknowledgeIncomplete }).allowed) return;

        const visible = slots.filter(k => k === 'mockup' || !isRetiredArtifactSubtype(k));
        if (visible.length === 0) return;
        // Graph-driven batches only name visible nodes; pull in any hidden
        // subtype whose consumer is in the batch and whose inputs are being
        // regenerated (or which isn't done for this spine), so e.g. the
        // mockup never rebuilds against a component_inventory generated from
        // the old screen_inventory. See expandWithHiddenDependencyClosure.
        const filtered = expandWithHiddenDependencyClosure(
            visible,
            subtype => isSlotDoneForSpine(args.projectId, subtype, args.spineVersionId),
        );

        const existing = runs.get(args.projectId);
        if (existing && !existing.controller.signal.aborted) return;
        if (existing) runs.delete(args.projectId);

        useProjectStore.getState().initJob(args.projectId, args.spineVersionId, filtered);

        const controller = new AbortController();
        const promise = executeJob(args, controller, filtered).finally(() => {
            const current = runs.get(args.projectId);
            if (current && current.controller === controller) {
                runs.delete(args.projectId);
            }
        });
        runs.set(args.projectId, { controller, spineVersionId: args.spineVersionId, promise });
    },

    cancelAll(projectId: string): void {
        const run = runs.get(projectId);
        if (!run) return;
        run.controller.abort();
        useProjectStore.getState().markAllInterrupted(projectId);
        runs.delete(projectId);
    },

    /**
     * Retry a single slot. Reuses the active controller if one exists; else
     * spins up a per-slot controller and registers it in `runs` so that a
     * subsequent `cancelAll` can see it and a subsequent `startAll` won't
     * race against it.
     */
    retrySlot(slot: ArtifactSlotKey, args: StartArgs): void {
        const failureKey = retryFailureKey(args.projectId, slot);
        if ((retryFailures.get(failureKey) ?? 0) >= MAX_RETRY_FAILURES) {
            useProjectStore.getState().setSlotStatus(args.projectId, slot, {
                status: 'error',
                finishedAt: Date.now(),
                error: {
                    message: `Retry stopped after ${MAX_RETRY_FAILURES} consecutive failures — the same error keeps recurring. Check your API key and quota in Settings, then reload the page to try again.`,
                    category: 'unknown',
                    timestamp: Date.now(),
                },
            });
            return;
        }
        const existingRun = runs.get(args.projectId);
        const reuseExisting = existingRun && !existingRun.controller.signal.aborted;
        const controller = reuseExisting ? existingRun!.controller : new AbortController();

        const store = useProjectStore.getState();
        if (!store.getJob(args.projectId)) {
            store.initJob(args.projectId, args.spineVersionId, [slot]);
        }
        store.setSlotStatus(args.projectId, slot, { status: 'queued', error: undefined });

        const generatedArtifacts: Partial<Record<CoreArtifactSubtype, string>> = {};
        for (const meta of CORE_ARTIFACT_PIPELINE) {
            const existing = store.getArtifacts(args.projectId, 'core_artifact').find(a => a.subtype === meta.subtype);
            if (!existing) continue;
            const preferred = store.getPreferredVersion(args.projectId, existing.id);
            if (preferred && preferred.sourceRefs.some(r => r.sourceType === 'spine' && r.sourceArtifactVersionId === args.spineVersionId)) {
                generatedArtifacts[meta.subtype] = preferred.content;
            }
        }

        const promise = (async () => {
            try {
                if (slot === 'mockup') {
                    await runMockupSlot(args, controller.signal);
                } else {
                    await runCoreArtifactSlot(args, slot, controller.signal, generatedArtifacts);
                }
                retryFailures.delete(failureKey);
            } catch (e) {
                if (isAbortError(e) || controller.signal.aborted) return;
                retryFailures.set(failureKey, (retryFailures.get(failureKey) ?? 0) + 1);
                recordError(args.projectId, slot, e);
            }
        })().finally(() => {
            // Only clear the run entry if we own it AND nothing else has
            // taken it over. The reused-controller case is owned by the
            // active run, so leave it alone.
            const current = runs.get(args.projectId);
            if (!reuseExisting && current && current.controller === controller) {
                runs.delete(args.projectId);
            }
        });

        if (!reuseExisting) {
            runs.set(args.projectId, { controller, spineVersionId: args.spineVersionId, promise });
        }
    },

    /**
     * On app boot or workspace mount, queue any slots missing for the current
     * final spine. Skips when generation is already active.
     */
    resumeIfNeeded(args: StartArgs): void {
        if (this.isActive(args.projectId)) return;
        // Only auto-wake for *visible* pending slots. A hidden slot that errored
        // stays pending forever (no version), and without this filter every
        // workspace remount would spin up a run just to retry it — invisibly,
        // with no user-facing status or retry affordance. When a visible slot is
        // pending, startAll still includes the hidden slot in its own pending
        // set, so hidden artifacts are best-effort regenerated alongside.
        const pending = pendingSlotsForSpine(args).filter(k => !isHiddenSlot(k));
        if (pending.length === 0) return;
        this.startAll(args);
    },
};
