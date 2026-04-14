import { useRef, useState } from 'react';
import { Package, Plus, RefreshCcw, Sparkles, Loader2, CheckCircle2, XCircle, AlertTriangle, StopCircle } from 'lucide-react';
import { ArtifactContentRenderer } from './renderers';
import { useProjectStore } from '../store/projectStore';
import { generateCoreArtifact, refineCoreArtifact } from '../lib/llmProvider';
import { validateArtifactContent } from '../lib/artifactValidation';
import { validateCrossArtifactConsistency } from '../lib/artifactOrchestration';
import { normalizeError, userMessage } from '../lib/errors';
import { ErrorBanner } from './ErrorBanner';
import { StalenessBadge } from './StalenessBadge';
import { FeedbackModal } from './FeedbackModal';
import { GenerationProgress } from './GenerationProgress';
import { STALE_REFRESH_STAGES, BUNDLE_GENERATION_STAGES, getArtifactStages } from './generationStages';
import type { StructuredPRD, CoreArtifactSubtype } from '../types';
import { v4 as uuidv4 } from 'uuid';
import {
    CORE_ARTIFACT_PIPELINE,
    CORE_ARTIFACT_DISPLAY_ORDER,
    buildDependencyLayers,
    getArtifactMeta,
} from '../lib/coreArtifactPipeline';

interface ArtifactsViewProps {
    projectId: string;
    spineVersionId: string;
    prdContent: string;
    structuredPRD?: StructuredPRD;
}

// Display uses the user-facing order; generation uses dependency-layered order.
const CORE_ARTIFACTS_DISPLAY = CORE_ARTIFACT_DISPLAY_ORDER;
const TOTAL_CORE_ARTIFACTS = CORE_ARTIFACT_PIPELINE.length;
// Max artifacts that can run in parallel within a single dependency layer.
const MAX_PARALLEL_PER_LAYER = Math.max(...buildDependencyLayers().map(layer => layer.length));

function isAbortError(reason: unknown): boolean {
    return reason instanceof DOMException && reason.name === 'AbortError';
}

// Run async tasks with a concurrency limit
async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
    const results: PromiseSettledResult<T>[] = new Array(tasks.length);
    let nextIndex = 0;

    async function runNext(): Promise<void> {
        while (nextIndex < tasks.length) {
            const index = nextIndex++;
            try {
                const value = await tasks[index]();
                results[index] = { status: 'fulfilled', value };
            } catch (reason) {
                results[index] = { status: 'rejected', reason };
            }
        }
    }

    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
    await Promise.all(workers);
    return results;
}

type ArtifactGenStatus = 'pending' | 'generating' | 'done' | 'error';

export function ArtifactsView({ projectId, spineVersionId, prdContent, structuredPRD }: ArtifactsViewProps) {
    const {
        createArtifact, createArtifactVersion,
        getArtifacts, getArtifactVersions,
        getArtifactStaleness,
    } = useProjectStore();

    const [generatingSubtype, setGeneratingSubtype] = useState<CoreArtifactSubtype | 'bundle' | null>(null);
    const [bundleStatus, setBundleStatus] = useState<Record<CoreArtifactSubtype, ArtifactGenStatus>>({} as Record<CoreArtifactSubtype, ArtifactGenStatus>);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [feedbackVersionId, setFeedbackVersionId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refineSubtype, setRefineSubtype] = useState<CoreArtifactSubtype | null>(null);
    const [refineInstruction, setRefineInstruction] = useState('');
    const [validationWarnings, setValidationWarnings] = useState<Record<string, string[]>>({});
    const [warningsOpen, setWarningsOpen] = useState<Record<string, boolean>>({});

    const abortRef = useRef<AbortController | null>(null);

    const coreArtifacts = getArtifacts(projectId, 'core_artifact');

    const bundleDoneCount = Object.values(bundleStatus).filter(s => s === 'done').length;

    // Count stale artifacts
    const staleCount = CORE_ARTIFACTS_DISPLAY.reduce((count, meta) => {
        const existing = coreArtifacts.find(a => a.subtype === meta.subtype);
        if (!existing) return count;
        const staleness = getArtifactStaleness(projectId, existing.id);
        return staleness === 'possibly_outdated' || staleness === 'outdated' ? count + 1 : count;
    }, 0);

    const getExistingArtifact = (subtype: CoreArtifactSubtype) =>
        coreArtifacts.find(a => a.subtype === subtype);

    const handleGenerateOne = async (subtype: CoreArtifactSubtype) => {
        if (!structuredPRD) return;
        setError(null);
        setGeneratingSubtype(subtype);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const meta = getArtifactMeta(subtype);
            const content = await generateCoreArtifact(subtype, prdContent, structuredPRD, { signal: controller.signal });

            // Validate output quality
            const validation = validateArtifactContent(subtype, content);
            const consistencyWarnings = validateCrossArtifactConsistency(subtype, content, structuredPRD);
            const mergedWarnings = [...validation.warnings, ...consistencyWarnings];
            if (mergedWarnings.length > 0) {
                setValidationWarnings(prev => ({ ...prev, [subtype]: mergedWarnings }));
            } else {
                setValidationWarnings(prev => { const next = { ...prev }; delete next[subtype]; return next; });
            }

            const existing = getExistingArtifact(subtype);
            let artifactId: string;
            if (existing) {
                artifactId = existing.id;
            } else {
                const result = createArtifact(projectId, 'core_artifact', meta.title, subtype);
                artifactId = result.artifactId;
            }

            const versions = getArtifactVersions(projectId, artifactId);
            const parentVersionId = versions.length > 0 ? versions[versions.length - 1].id : null;

            createArtifactVersion(
                projectId, artifactId, content,
                { subtype },
                [{ id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineVersionId, sourceType: 'spine' }],
                `Generate ${meta.title} from PRD`,
                parentVersionId,
            );

            setExpandedId(artifactId);
        } catch (e) {
            if (isAbortError(e)) {
                // User-initiated cancel — don't surface as an error.
            } else {
                const err = normalizeError(e);
                console.error('[Artifact generation failed]', err.raw);
                setError(userMessage(err));
            }
        } finally {
            abortRef.current = null;
            setGeneratingSubtype(null);
        }
    };

    const handleRefine = async (subtype: CoreArtifactSubtype) => {
        if (!structuredPRD || !refineInstruction.trim()) return;
        const existing = getExistingArtifact(subtype);
        if (!existing) return;

        const versions = getArtifactVersions(projectId, existing.id);
        const preferredVersion = versions.find(v => v.isPreferred);
        if (!preferredVersion) return;

        setError(null);
        setGeneratingSubtype(subtype);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const content = await refineCoreArtifact(
                subtype,
                preferredVersion.content,
                refineInstruction.trim(),
                prdContent,
                structuredPRD,
                { signal: controller.signal },
            );

            const meta = getArtifactMeta(subtype);
            createArtifactVersion(
                projectId, existing.id, content,
                { subtype },
                [{ id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineVersionId, sourceType: 'spine' }],
                `Refine ${meta.title}: ${refineInstruction.trim().slice(0, 80)}`,
                preferredVersion.id,
            );

            setRefineSubtype(null);
            setRefineInstruction('');
        } catch (e) {
            if (isAbortError(e)) {
                // User cancelled — silent.
            } else {
                const err = normalizeError(e);
                console.error('[Artifact refinement failed]', err.raw);
                setError(userMessage(err));
            }
        } finally {
            abortRef.current = null;
            setGeneratingSubtype(null);
        }
    };

    const handleRefreshStale = async () => {
        if (!structuredPRD) return;
        setError(null);
        setGeneratingSubtype('bundle');
        const controller = new AbortController();
        abortRef.current = controller;

        const staleArtifacts = CORE_ARTIFACT_PIPELINE.filter(meta => {
            const existing = coreArtifacts.find(a => a.subtype === meta.subtype);
            if (!existing) return false;
            const staleness = getArtifactStaleness(projectId, existing.id);
            return staleness === 'possibly_outdated' || staleness === 'outdated';
        });

        const initialStatus = {} as Record<CoreArtifactSubtype, ArtifactGenStatus>;
        staleArtifacts.forEach(meta => { initialStatus[meta.subtype] = 'pending'; });
        setBundleStatus(initialStatus);

        const tasks = staleArtifacts.map(meta => async () => {
            setBundleStatus(prev => ({ ...prev, [meta.subtype]: 'generating' }));
            const content = await generateCoreArtifact(meta.subtype, prdContent, structuredPRD, { signal: controller.signal });

            const existing = getExistingArtifact(meta.subtype)!;
            const versions = getArtifactVersions(projectId, existing.id);
            const parentVersionId = versions.length > 0 ? versions[versions.length - 1].id : null;

            createArtifactVersion(
                projectId, existing.id, content,
                { subtype: meta.subtype },
                [{ id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineVersionId, sourceType: 'spine' }],
                `Refresh stale ${meta.title} from updated PRD`,
                parentVersionId,
            );

            setBundleStatus(prev => ({ ...prev, [meta.subtype]: 'done' }));
            return meta.subtype;
        });

        const results = await withConcurrency(tasks, 3);
        const aborted = controller.signal.aborted;
        const nonAbortFailures = results.filter(r => r.status === 'rejected' && !isAbortError(r.reason));

        results.forEach((r, i) => {
            if (r.status === 'rejected') {
                if (isAbortError(r.reason)) {
                    setBundleStatus(prev => {
                        const current = prev[staleArtifacts[i].subtype];
                        // Keep 'done' if completed before abort; otherwise mark pending.
                        return current === 'done' ? prev : { ...prev, [staleArtifacts[i].subtype]: 'pending' };
                    });
                } else {
                    console.error('[Stale artifact refresh failed]', r.reason);
                    setBundleStatus(prev => ({ ...prev, [staleArtifacts[i].subtype]: 'error' }));
                }
            }
        });

        if (nonAbortFailures.length > 0) {
            const succeeded = results.length - nonAbortFailures.length - (aborted ? results.filter(r => r.status === 'rejected' && isAbortError(r.reason)).length : 0);
            setError(`${nonAbortFailures.length} artifact(s) could not be refreshed.${succeeded > 0 ? ` ${succeeded} updated successfully.` : ''} You can retry the failed items individually.`);
        }

        abortRef.current = null;
        setGeneratingSubtype(null);
    };

    const handleStop = () => {
        abortRef.current?.abort();
    };

    const handleGenerateBundle = async () => {
        if (!structuredPRD) return;
        setError(null);
        setGeneratingSubtype('bundle');
        const controller = new AbortController();
        abortRef.current = controller;

        // Initialize all statuses to pending (display order determines UI spinners,
        // but layered dependency order drives actual generation below).
        const initialStatus = {} as Record<CoreArtifactSubtype, ArtifactGenStatus>;
        CORE_ARTIFACT_PIPELINE.forEach(meta => { initialStatus[meta.subtype] = 'pending'; });
        setBundleStatus(initialStatus);
        const generatedArtifacts: Partial<Record<CoreArtifactSubtype, string>> = {};
        const layers = buildDependencyLayers();
        let failedCount = 0;
        let abortedCount = 0;

        layers: for (const layer of layers) {
            if (controller.signal.aborted) break;

            const tasks = layer.map(meta => async () => {
                setBundleStatus(prev => ({ ...prev, [meta.subtype]: 'generating' }));
                const startTime = performance.now();
                const content = await generateCoreArtifact(meta.subtype, prdContent, structuredPRD, {
                    generatedArtifacts,
                    signal: controller.signal,
                });
                console.log(`[GEN] ${meta.subtype}: ${(performance.now() - startTime).toFixed(0)}ms`);
                generatedArtifacts[meta.subtype] = content;

                const consistencyWarnings = validateCrossArtifactConsistency(meta.subtype, content, structuredPRD);
                if (consistencyWarnings.length > 0) {
                    setValidationWarnings(prev => ({ ...prev, [meta.subtype]: consistencyWarnings }));
                }

                const existing = getExistingArtifact(meta.subtype);
                let artifactId: string;
                if (existing) {
                    artifactId = existing.id;
                } else {
                    const result = createArtifact(projectId, 'core_artifact', meta.title, meta.subtype);
                    artifactId = result.artifactId;
                }

                const versions = getArtifactVersions(projectId, artifactId);
                const parentVersionId = versions.length > 0 ? versions[versions.length - 1].id : null;
                const dependencyTrace = getArtifactMeta(meta.subtype).dependsOn.join(', ');

                createArtifactVersion(
                    projectId, artifactId, content,
                    { subtype: meta.subtype, dependencyTrace },
                    [{ id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineVersionId, sourceType: 'spine' }],
                    `Generate ${meta.title} from PRD (pipeline${dependencyTrace ? ` after: ${dependencyTrace}` : ''})`,
                    parentVersionId,
                );
                setBundleStatus(prev => ({ ...prev, [meta.subtype]: 'done' }));
            });

            const results = await withConcurrency(tasks, layer.length);

            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const meta = layer[i];
                if (r.status === 'rejected') {
                    if (isAbortError(r.reason)) {
                        abortedCount += 1;
                        setBundleStatus(prev => {
                            const current = prev[meta.subtype];
                            return current === 'done' ? prev : { ...prev, [meta.subtype]: 'pending' };
                        });
                    } else {
                        failedCount += 1;
                        console.error('[Bundle artifact generation failed]', r.reason);
                        setBundleStatus(prev => ({ ...prev, [meta.subtype]: 'error' }));
                    }
                }
            }

            // If the user aborted mid-layer, stop queuing further layers.
            if (controller.signal.aborted) break layers;
        }

        if (failedCount > 0) {
            const succeeded = TOTAL_CORE_ARTIFACTS - failedCount - abortedCount;
            setError(`${failedCount} of ${TOTAL_CORE_ARTIFACTS} artifact(s) could not be generated.${succeeded > 0 ? ` ${succeeded} completed successfully.` : ''} You can retry the failed items individually.`);
        }

        abortRef.current = null;
        setGeneratingSubtype(null);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Package size={24} className="text-indigo-600" />
                    <h2 className="text-xl font-bold text-neutral-900">Core Artifacts</h2>
                </div>
                <div className="flex items-center gap-2">
                    {staleCount > 0 && (
                        <button
                            onClick={handleRefreshStale}
                            disabled={!!generatingSubtype || !structuredPRD}
                            className="flex items-center gap-2 px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition text-sm font-medium disabled:opacity-50"
                        >
                            {generatingSubtype === 'bundle' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                            {generatingSubtype === 'bundle' ? 'Refreshing...' : `Refresh ${staleCount} Stale`}
                        </button>
                    )}
                    <button
                        onClick={handleGenerateBundle}
                        disabled={!!generatingSubtype || !structuredPRD}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
                    >
                        {generatingSubtype === 'bundle' ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <Sparkles size={16} />
                        )}
                        {generatingSubtype === 'bundle'
                            ? `${bundleDoneCount} of ${TOTAL_CORE_ARTIFACTS} complete`
                            : 'Generate All'}
                    </button>
                    {generatingSubtype && (
                        <button
                            onClick={handleStop}
                            className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition text-sm font-medium"
                            title="Stop generation"
                        >
                            <StopCircle size={14} />
                            Stop
                        </button>
                    )}
                </div>
            </div>

            {!structuredPRD && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                    Mark your PRD as Final to generate core artifacts.
                </div>
            )}

            {error && (
                <ErrorBanner
                    title="Generation failed"
                    message={error}
                    onDismiss={() => setError(null)}
                />
            )}

            {/* Bundle / stale refresh progress */}
            {generatingSubtype === 'bundle' && (() => {
                // Derive real progress from bundleStatus. Only artifacts that
                // we actually queued for this run (bundleStatus has an entry)
                // count toward the total — works for both the full bundle and
                // the "Refresh N Stale" path.
                const tracked = (Object.keys(bundleStatus) as CoreArtifactSubtype[])
                    .map(subtype => getArtifactMeta(subtype));
                const total = tracked.length;
                const done = tracked.filter(m => bundleStatus[m.subtype] === 'done');
                const active = tracked.filter(m => bundleStatus[m.subtype] === 'generating');
                // Give in-flight artifacts partial credit so the bar advances
                // smoothly within a layer instead of only at layer boundaries.
                const progressPct = total === 0
                    ? 0
                    : Math.min(100, ((done.length + active.length * 0.5) / total) * 100);
                const statusLabel = active.length > 0
                    ? `Generating ${active.map(m => m.title).join(', ')} — ${done.length} of ${total} complete`
                    : done.length === total && total > 0
                        ? `Finalizing… ${done.length} of ${total} complete`
                        : `Preparing next dependency layer… ${done.length} of ${total} complete`;
                return (
                    <GenerationProgress
                        stages={staleCount > 0 ? STALE_REFRESH_STAGES : BUNDLE_GENERATION_STAGES}
                        variant="systematic"
                        title={staleCount > 0 ? 'Refreshing Stale Artifacts' : 'Generating Artifact Bundle'}
                        subtitle={`Dependency-aware pipeline · up to ${MAX_PARALLEL_PER_LAYER} in parallel per layer`}
                        progress={progressPct}
                        statusLabel={statusLabel}
                    />
                );
            })()}

            {/* Artifact Grid */}
            <div className="space-y-3">
                {CORE_ARTIFACTS_DISPLAY.map(meta => {
                    const existing = getExistingArtifact(meta.subtype);
                    const versions = existing ? getArtifactVersions(projectId, existing.id) : [];
                    const preferredVersion = versions.find(v => v.isPreferred);
                    const staleness = existing ? getArtifactStaleness(projectId, existing.id) : null;
                    const isExpanded = expandedId === existing?.id;
                    const isGenerating = generatingSubtype === meta.subtype || generatingSubtype === 'bundle';
                    const artifactBundleStatus = bundleStatus[meta.subtype];

                    const statusDotClass = artifactBundleStatus === 'generating'
                        ? 'text-sky-500 animate-spin'
                        : artifactBundleStatus === 'done'
                        ? 'text-green-500'
                        : artifactBundleStatus === 'error'
                        ? 'text-red-500'
                        : existing ? 'text-green-400' : 'text-neutral-300';

                    return (
                        <div key={meta.subtype} className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between p-4">
                                <button
                                    onClick={() => existing && setExpandedId(isExpanded ? null : existing.id)}
                                    className="flex items-center gap-3 min-w-0 text-left flex-1"
                                    disabled={!existing}
                                >
                                    {artifactBundleStatus === 'generating' ? (
                                        <Loader2 size={12} className={statusDotClass} />
                                    ) : artifactBundleStatus === 'done' ? (
                                        <CheckCircle2 size={12} className={statusDotClass} />
                                    ) : artifactBundleStatus === 'error' ? (
                                        <XCircle size={12} className={statusDotClass} />
                                    ) : (
                                        <div className={`w-2 h-2 rounded-full shrink-0 ${existing ? 'bg-green-400' : 'bg-neutral-300'}`} />
                                    )}
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-neutral-800">{meta.title}</span>
                                            {staleness && <StalenessBadge staleness={staleness} />}
                                            {validationWarnings[meta.subtype] && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setWarningsOpen(prev => ({ ...prev, [meta.subtype]: !prev[meta.subtype] }));
                                                    }}
                                                    className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5 flex items-center gap-1 hover:bg-amber-100 transition"
                                                    aria-label="Show validation warnings"
                                                    aria-expanded={!!warningsOpen[meta.subtype]}
                                                >
                                                    <AlertTriangle size={12} />
                                                    {validationWarnings[meta.subtype].length} {validationWarnings[meta.subtype].length === 1 ? 'issue' : 'issues'}
                                                </button>
                                            )}
                                            {versions.length > 0 && (
                                                <span className="text-xs text-neutral-400">v{versions.length}</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-neutral-500 mt-0.5">{meta.description}</p>
                                    </div>
                                </button>
                                <button
                                    onClick={() => handleGenerateOne(meta.subtype)}
                                    disabled={isGenerating || !structuredPRD}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition shrink-0 disabled:opacity-50"
                                >
                                    {generatingSubtype === meta.subtype ? (
                                        <Loader2 size={12} className="animate-spin" />
                                    ) : existing ? (
                                        <RefreshCcw size={12} />
                                    ) : (
                                        <Plus size={12} />
                                    )}
                                    {generatingSubtype === meta.subtype
                                        ? 'Working...'
                                        : existing ? 'Regenerate' : 'Generate'}
                                </button>
                            </div>

                            {/* Inline validation warnings panel (toggled by the N issue(s) badge) */}
                            {warningsOpen[meta.subtype] && validationWarnings[meta.subtype] && (
                                <div className="border-t border-neutral-100 bg-amber-50/60 px-4 py-3">
                                    <div className="text-xs font-semibold text-amber-800 mb-1 flex items-center gap-1.5">
                                        <AlertTriangle size={12} />
                                        Quality warnings for {meta.title}
                                    </div>
                                    <ul className="text-xs text-amber-800 list-disc pl-5 space-y-1">
                                        {validationWarnings[meta.subtype].map((w, i) => (
                                            <li key={i}>{w}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Per-artifact generation progress */}
                            {generatingSubtype === meta.subtype && (
                                <div className="border-t border-neutral-100 p-4">
                                    <GenerationProgress
                                        stages={getArtifactStages(meta.subtype)}

                                        variant="systematic"
                                        inline
                                    />
                                </div>
                            )}

                            {isExpanded && preferredVersion && (
                                <div className="border-t border-neutral-100 p-4 space-y-3">
                                    <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-5 prose prose-sm prose-neutral max-w-none overflow-auto max-h-[500px]">
                                        <ArtifactContentRenderer subtype={meta.subtype} content={preferredVersion.content} />
                                    </div>

                                    <div className="flex items-center gap-2 flex-wrap">
                                        <button
                                            onClick={() => setFeedbackVersionId(preferredVersion.id)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-md transition"
                                        >
                                            Extract Feedback
                                        </button>
                                        <button
                                            onClick={() => setRefineSubtype(refineSubtype === meta.subtype ? null : meta.subtype)}
                                            disabled={isGenerating}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md transition disabled:opacity-50"
                                        >
                                            Refine
                                        </button>

                                        {versions.length > 1 && (
                                            <span className="text-xs text-neutral-400 ml-auto">
                                                {versions.length} versions available
                                            </span>
                                        )}
                                    </div>

                                    {refineSubtype === meta.subtype && (
                                        <div className="flex gap-2 items-start">
                                            <input
                                                type="text"
                                                value={refineInstruction}
                                                onChange={e => setRefineInstruction(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter' && refineInstruction.trim()) handleRefine(meta.subtype); }}
                                                placeholder="e.g. Add error states to each screen, make the data model more detailed..."
                                                className="flex-1 px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                                autoFocus
                                            />
                                            <button
                                                onClick={() => handleRefine(meta.subtype)}
                                                disabled={!refineInstruction.trim() || isGenerating}
                                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 shrink-0"
                                            >
                                                Apply
                                            </button>
                                        </div>
                                    )}

                                    <div className="text-xs text-neutral-400 pt-2 border-t border-neutral-100">
                                        Generated from PRD {preferredVersion.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId || 'unknown'}
                                        {' · '}v{preferredVersion.versionNumber}
                                        {' · '}{new Date(preferredVersion.createdAt).toLocaleString()}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {feedbackVersionId && (
                <FeedbackModal
                    projectId={projectId}
                    sourceArtifactVersionId={feedbackVersionId}
                    onClose={() => setFeedbackVersionId(null)}
                />
            )}
        </div>
    );
}
