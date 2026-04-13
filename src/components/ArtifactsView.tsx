import { useState } from 'react';
import { Package, Plus, RefreshCcw, Sparkles, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
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
import { STALE_REFRESH_STAGES, getArtifactStages } from './generationStages';
import type { StructuredPRD, CoreArtifactSubtype } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { CORE_ARTIFACT_PIPELINE, getArtifactMeta } from '../lib/coreArtifactPipeline';

interface ArtifactsViewProps {
    projectId: string;
    spineVersionId: string;
    prdContent: string;
    structuredPRD?: StructuredPRD;
}

const CORE_ARTIFACTS = CORE_ARTIFACT_PIPELINE;

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

    const coreArtifacts = getArtifacts(projectId, 'core_artifact');

    const bundleDoneCount = Object.values(bundleStatus).filter(s => s === 'done').length;

    // Count stale artifacts
    const staleCount = CORE_ARTIFACTS.reduce((count, meta) => {
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
        try {
            const meta = CORE_ARTIFACTS.find(a => a.subtype === subtype)!;
            const content = await generateCoreArtifact(subtype, prdContent, structuredPRD);

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
            const err = normalizeError(e);
            console.error('[Artifact generation failed]', err.raw);
            setError(userMessage(err));
        } finally {
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
        try {
            const content = await refineCoreArtifact(
                subtype,
                preferredVersion.content,
                refineInstruction.trim(),
                prdContent,
                structuredPRD,
            );

            const meta = CORE_ARTIFACTS.find(a => a.subtype === subtype)!;
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
            const err = normalizeError(e);
            console.error('[Artifact refinement failed]', err.raw);
            setError(userMessage(err));
        } finally {
            setGeneratingSubtype(null);
        }
    };

    const handleRefreshStale = async () => {
        if (!structuredPRD) return;
        setError(null);
        setGeneratingSubtype('bundle');

        const staleArtifacts = CORE_ARTIFACTS.filter(meta => {
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
            const content = await generateCoreArtifact(meta.subtype, prdContent, structuredPRD);

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
        const failedCount = results.filter(r => r.status === 'rejected').length;

        results.forEach((r, i) => {
            if (r.status === 'rejected') {
                console.error('[Stale artifact refresh failed]', r.reason);
                setBundleStatus(prev => ({ ...prev, [staleArtifacts[i].subtype]: 'error' }));
            }
        });

        if (failedCount > 0) {
            const succeeded = results.length - failedCount;
            setError(`${failedCount} artifact(s) could not be refreshed.${succeeded > 0 ? ` ${succeeded} updated successfully.` : ''} You can retry the failed items individually.`);
        }
        setGeneratingSubtype(null);
    };

    const handleGenerateBundle = async () => {
        if (!structuredPRD) return;
        setError(null);
        setGeneratingSubtype('bundle');

        // Initialize all statuses to pending
        const initialStatus = {} as Record<CoreArtifactSubtype, ArtifactGenStatus>;
        CORE_ARTIFACTS.forEach(meta => { initialStatus[meta.subtype] = 'pending'; });
        setBundleStatus(initialStatus);
        const generatedArtifacts: Partial<Record<CoreArtifactSubtype, string>> = {};
        let failedCount = 0;

        for (const meta of CORE_ARTIFACTS) {
            try {
                setBundleStatus(prev => ({ ...prev, [meta.subtype]: 'generating' }));
                const startTime = performance.now();
                const content = await generateCoreArtifact(meta.subtype, prdContent, structuredPRD, { generatedArtifacts });
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
            } catch (reason) {
                failedCount += 1;
                console.error('[Bundle artifact generation failed]', reason);
                setBundleStatus(prev => ({ ...prev, [meta.subtype]: 'error' }));
            }
        }

        if (failedCount > 0) {
            const succeeded = CORE_ARTIFACTS.length - failedCount;
            setError(`${failedCount} of ${CORE_ARTIFACTS.length} artifact(s) could not be generated.${succeeded > 0 ? ` ${succeeded} completed successfully.` : ''} You can retry the failed items individually.`);
        }

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
                            ? `${bundleDoneCount} of ${CORE_ARTIFACTS.length} complete`
                            : 'Generate All'}
                    </button>
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
            {generatingSubtype === 'bundle' && (
                <GenerationProgress
                    stages={staleCount > 0 ? STALE_REFRESH_STAGES : [
                        { label: 'Preparing artifact pipeline...', minDuration: 2000 },
                        { label: `Generating artifacts (${bundleDoneCount} of ${CORE_ARTIFACTS.length} complete)...`, minDuration: 3000 },
                        { label: 'Structuring outputs...', minDuration: 4000 },
                        { label: 'Validating artifact quality...', minDuration: 5000 },
                    ]}

                    variant="systematic"
                    title={staleCount > 0 ? 'Refreshing Stale Artifacts' : 'Generating Artifact Bundle'}
                    subtitle={`Processing ${staleCount > 0 ? staleCount : CORE_ARTIFACTS.length} artifacts with concurrency controls`}
                />
            )}

            {/* Artifact Grid */}
            <div className="space-y-3">
                {CORE_ARTIFACTS.map(meta => {
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
                                                <span className="text-xs text-amber-600 flex items-center gap-1" title={validationWarnings[meta.subtype].join('\n')}>
                                                    <AlertTriangle size={12} />
                                                </span>
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
