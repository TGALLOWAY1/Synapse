import { v4 as uuidv4 } from 'uuid';
import type {
    ArtifactSlotKey,
    CoreArtifactSubtype,
    ProjectPlatform,
    StructuredPRD,
} from '../../types';
import { MOCKUP_HTML_V1 } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { generateCoreArtifact } from './coreArtifactService';
import { generateMockup } from './mockupService';
import { validateArtifactContent } from '../artifactValidation';
import { validateCrossArtifactConsistency } from '../artifactOrchestration';
import {
    CORE_ARTIFACT_PIPELINE,
    buildDependencyLayers,
    getArtifactMeta,
} from '../coreArtifactPipeline';
import { isAbortError } from '../concurrency';
import { buildAutoMockupSettings } from '../mockupDefaults';
import { normalizeError } from '../errors';

export interface StartArgs {
    projectId: string;
    spineVersionId: string;
    prdContent: string;
    structuredPRD: StructuredPRD;
    projectPlatform?: ProjectPlatform;
}

const ALL_SLOT_KEYS: ArtifactSlotKey[] = [
    ...CORE_ARTIFACT_PIPELINE.map(m => m.subtype),
    'mockup',
];

const GLOBAL_CONCURRENCY = 4;

function createSemaphore(limit: number) {
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

const semaphore = createSemaphore(GLOBAL_CONCURRENCY);

interface RunState {
    controller: AbortController;
    spineVersionId: string;
    promise: Promise<void>;
}

const runs = new Map<string, RunState>();

function isSlotDoneForSpine(projectId: string, slot: ArtifactSlotKey, spineVersionId: string): boolean {
    const store = useProjectStore.getState();
    const type = slot === 'mockup' ? 'mockup' : 'core_artifact';
    const subtype: CoreArtifactSubtype | undefined = slot === 'mockup' ? undefined : slot;
    const artifacts = store.getArtifacts(projectId, type);
    const match = subtype
        ? artifacts.find(a => a.subtype === subtype)
        : artifacts[0];
    if (!match) return false;
    const versions = store.getArtifactVersions(projectId, match.id);
    return versions.some(v =>
        v.sourceRefs.some(r => r.sourceType === 'spine' && r.sourceArtifactVersionId === spineVersionId),
    );
}

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
): Promise<void> {
    const { projectId, spineVersionId, prdContent, structuredPRD } = args;

    await semaphore.acquire();
    let content: string;
    try {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        const store = useProjectStore.getState();
        store.setSlotStatus(projectId, subtype, {
            status: 'generating',
            startedAt: Date.now(),
            attempt: (store.getSlot(projectId, subtype)?.attempt ?? 0) + 1,
        });
        content = await generateCoreArtifact(subtype, prdContent, structuredPRD, {
            generatedArtifacts,
            signal,
        });
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

    writeStore.createArtifactVersion(
        projectId,
        artifactId,
        content,
        { subtype, dependencyTrace, validationWarnings: warnings },
        [{ id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineVersionId, sourceType: 'spine' }],
        `Generate ${meta.title} from PRD${dependencyTrace ? ` (after: ${dependencyTrace})` : ''}`,
        parentVersionId,
    );

    writeStore.setSlotStatus(projectId, subtype, { status: 'done', finishedAt: Date.now() });
}

async function runMockupSlot(args: StartArgs, signal: AbortSignal): Promise<void> {
    const { projectId, spineVersionId, prdContent, structuredPRD, projectPlatform } = args;
    const settings = buildAutoMockupSettings(prdContent, structuredPRD, projectPlatform);

    await semaphore.acquire();
    let result: Awaited<ReturnType<typeof generateMockup>>;
    try {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        const store = useProjectStore.getState();
        store.setSlotStatus(projectId, 'mockup', {
            status: 'generating',
            startedAt: Date.now(),
            attempt: (store.getSlot(projectId, 'mockup')?.attempt ?? 0) + 1,
        });
        result = await generateMockup(prdContent, settings, structuredPRD);
    } finally {
        semaphore.release();
    }
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');

    const { payload, warnings, critique } = result;
    const usedFallback = warnings.some(w => w.includes('safe fallback'));
    const writeStore = useProjectStore.getState();
    const title = payload.title?.trim() || `Mockup — ${settings.platform} / ${settings.fidelity} / ${settings.scope.replace('_', ' ')}`;

    const existing = writeStore.getArtifacts(projectId, 'mockup')[0];
    const artifactId = existing
        ? existing.id
        : writeStore.createArtifact(projectId, 'mockup', title).artifactId;

    const versions = writeStore.getArtifactVersions(projectId, artifactId);
    const parentVersionId = versions.length > 0 ? versions[versions.length - 1].id : null;

    writeStore.createArtifactVersion(
        projectId,
        artifactId,
        JSON.stringify(payload),
        {
            settings,
            format: MOCKUP_HTML_V1,
            alignmentCritique: {
                score: critique.alignmentScore,
                severity: critique.severity,
                missingConcepts: critique.missingConcepts,
            },
            generationStrategy: 'mockup_strategy_v2',
            usedFallbackTemplate: usedFallback,
            autoGenerated: true,
        },
        [{ id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineVersionId, sourceType: 'spine' }],
        `Auto-generate ${settings.fidelity} ${settings.platform} mockup (${settings.scope.replace('_', ' ')})`,
        parentVersionId,
    );

    writeStore.setSlotStatus(projectId, 'mockup', { status: 'done', finishedAt: Date.now() });
}

async function executeJob(args: StartArgs, controller: AbortController, slotKeys: ArtifactSlotKey[]): Promise<void> {
    const signal = controller.signal;
    const { projectId } = args;

    const wantsMockup = slotKeys.includes('mockup');
    const coreSubtypes = new Set(slotKeys.filter((k): k is CoreArtifactSubtype => k !== 'mockup'));

    const generatedArtifacts: Partial<Record<CoreArtifactSubtype, string>> = {};

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
                    try {
                        await runCoreArtifactSlot(args, meta.subtype, signal, generatedArtifacts);
                    } catch (e) {
                        if (isAbortError(e) || signal.aborted) return;
                        recordError(projectId, meta.subtype, e);
                    }
                });
            if (tasks.length === 0) continue;
            await Promise.all(tasks.map(t => t()));
        }
    })();

    const mockupPromise = wantsMockup
        ? (async () => {
            try {
                await runMockupSlot(args, signal);
            } catch (e) {
                if (isAbortError(e) || signal.aborted) return;
                recordError(projectId, 'mockup', e);
            }
        })()
        : Promise.resolve();

    await Promise.all([corePromise, mockupPromise]);

    if (signal.aborted) {
        useProjectStore.getState().markAllInterrupted(projectId);
    }
}

function pendingSlotsForSpine(args: StartArgs): ArtifactSlotKey[] {
    return ALL_SLOT_KEYS.filter(k => !isSlotDoneForSpine(args.projectId, k, args.spineVersionId));
}

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

    cancelAll(projectId: string): void {
        const run = runs.get(projectId);
        if (!run) return;
        run.controller.abort();
        useProjectStore.getState().markAllInterrupted(projectId);
        runs.delete(projectId);
    },

    /**
     * Retry a single slot. Reuses the active controller if one exists; else
     * spins up a per-slot controller. Safe to call multiple times.
     */
    retrySlot(slot: ArtifactSlotKey, args: StartArgs): void {
        const run = runs.get(args.projectId);
        const controller = run && !run.controller.signal.aborted ? run.controller : new AbortController();

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

        void (async () => {
            try {
                if (slot === 'mockup') {
                    await runMockupSlot(args, controller.signal);
                } else {
                    await runCoreArtifactSlot(args, slot, controller.signal, generatedArtifacts);
                }
            } catch (e) {
                if (isAbortError(e) || controller.signal.aborted) return;
                recordError(args.projectId, slot, e);
            }
        })();
    },

    /**
     * On app boot or workspace mount, queue any slots missing for the current
     * final spine. Skips when generation is already active.
     */
    resumeIfNeeded(args: StartArgs): void {
        if (this.isActive(args.projectId)) return;
        const pending = pendingSlotsForSpine(args);
        if (pending.length === 0) return;
        this.startAll(args);
    },
};
