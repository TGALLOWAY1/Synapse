import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
    SpineVersion, HistoryEvent, StructuredPRD,
    QualityScores, GenerationMeta, SpineSafetyReview,
    PreflightSession,
} from '../../types';
import type { ProjectState, SpineGenerationMetaInput } from '../types';
import { buildCanonicalPrdSpine } from '../../lib/canonicalPrdSpine';

export type SpineSlice = {
    spineVersions: Record<string, SpineVersion[]>;
    updateSpineText: ProjectState['updateSpineText'];
    regenerateSpine: ProjectState['regenerateSpine'];
    markSpineFinal: ProjectState['markSpineFinal'];
    getSpineVersions: ProjectState['getSpineVersions'];
    getLatestSpine: ProjectState['getLatestSpine'];
    updateStructuredPRD: ProjectState['updateStructuredPRD'];
    updateSpineStructuredPRD: ProjectState['updateSpineStructuredPRD'];
    editSpineStructuredPRD: ProjectState['editSpineStructuredPRD'];
    revertSpineToVersion: ProjectState['revertSpineToVersion'];
    updateSpineQualityScores: ProjectState['updateSpineQualityScores'];
    updateProjectProductMetadata: ProjectState['updateProjectProductMetadata'];
    markSpineGenerationStarted: ProjectState['markSpineGenerationStarted'];
    setSpineError: ProjectState['setSpineError'];
    setSpineSafetyReview: ProjectState['setSpineSafetyReview'];
    initPreflightSession: ProjectState['initPreflightSession'];
    setPreflightQuestions: ProjectState['setPreflightQuestions'];
    setPreflightAnswer: ProjectState['setPreflightAnswer'];
    setPreflightIndex: ProjectState['setPreflightIndex'];
    setPreflightSummary: ProjectState['setPreflightSummary'];
    completePreflightSession: ProjectState['completePreflightSession'];
    setPreflightError: ProjectState['setPreflightError'];
};

// Update a single spine's preflight session in place. No-op when the spine has
// no session yet (except init, which seeds one). Keeps the verbose
// map-over-spines pattern used throughout this slice.
const patchPreflight = (
    spines: SpineVersion[],
    spineId: string,
    patch: (prev: PreflightSession) => PreflightSession,
): SpineVersion[] =>
    spines.map((s) => {
        if (s.id !== spineId || !s.preflightSession) return s;
        return { ...s, preflightSession: patch(s.preflightSession) };
    });

export const createSpineSlice: StateCreator<ProjectState, [], [], SpineSlice> = (set, get) => ({
    spineVersions: {},

    updateSpineText: (projectId: string, spineId: string, text: string) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const updatedSpines = projectSpines.map(s =>
                s.id === spineId ? { ...s, responseText: text } : s
            );
            return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
        });
    },

    regenerateSpine: (projectId: string) => {
        // Validate against a snapshot, but perform the array derivations inside
        // the set() updater against the fresh `state` so a concurrent spine
        // mutation cannot be clobbered by a stale snapshot.
        const latest = (get().spineVersions[projectId] || []).find(v => v.isLatest);
        if (!latest) throw new Error("No spine to regenerate");

        const now = Date.now();
        const historyEventId = uuidv4();
        // UUID, not `v${length + 1}`: a length-derived id collides with an
        // existing spine if two appends race or versions are ever pruned,
        // silently turning the append into an overwrite. Display labels are
        // derived from array position, never from the id.
        const newSpineId = uuidv4();

        set((state) => {
            const currentVersions = state.spineVersions[projectId] || [];
            const mappedOld = currentVersions.map(v => ({ ...v, isLatest: false }));

            const newSpine: SpineVersion = {
                id: newSpineId,
                projectId,
                promptText: latest.promptText,
                responseText: 'Generating PRD...',
                createdAt: now,
                isLatest: true,
                isFinal: false,
                provenance: { changeSource: 'ai_regeneration' },
            };

            const regenEvent: HistoryEvent = {
                id: historyEventId,
                projectId,
                spineVersionId: newSpineId,
                type: "Regenerated",
                description: "Regenerated spine",
                createdAt: now,
            };

            return {
                spineVersions: { ...state.spineVersions, [projectId]: [...mappedOld, newSpine] },
                historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), regenEvent] },
            };
        });

        return { newSpineId };
    },

    getSpineVersions: (projectId: string) => {
        return get().spineVersions[projectId] || [];
    },

    getLatestSpine: (projectId: string) => {
        const versions = get().spineVersions[projectId] || [];
        return versions.find(v => v.isLatest);
    },

    markSpineFinal: (projectId: string, spineId: string, isFinal: boolean) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const updatedSpines = projectSpines.map(s =>
                s.id === spineId ? { ...s, isFinal } : s
            );
            return {
                spineVersions: {
                    ...state.spineVersions,
                    [projectId]: updatedSpines
                }
            };
        });
    },

    // --- Preflight clarification --------------------------------------------
    initPreflightSession: (projectId, spineId, mode, originalIdea) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const updatedSpines = projectSpines.map((s) =>
                s.id === spineId
                    ? {
                        ...s,
                        preflightSession: {
                            mode,
                            originalIdea,
                            questions: [],
                            currentQuestionIndex: 0,
                            status: 'awaiting_questions' as const,
                            completed: false,
                        },
                    }
                    : s,
            );
            return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
        });
    },

    setPreflightQuestions: (projectId, spineId, questions, usedFallback) => {
        set((state) => ({
            spineVersions: {
                ...state.spineVersions,
                [projectId]: patchPreflight(state.spineVersions[projectId] || [], spineId, (prev) => ({
                    ...prev,
                    questions,
                    usedFallback: usedFallback ?? false,
                    status: 'answering',
                    error: undefined,
                })),
            },
        }));
    },

    setPreflightAnswer: (projectId, spineId, questionId, answer, skipped) => {
        set((state) => ({
            spineVersions: {
                ...state.spineVersions,
                [projectId]: patchPreflight(state.spineVersions[projectId] || [], spineId, (prev) => ({
                    ...prev,
                    questions: prev.questions.map((q) =>
                        q.id === questionId ? { ...q, answer, skipped } : q,
                    ),
                })),
            },
        }));
    },

    setPreflightIndex: (projectId, spineId, index) => {
        set((state) => ({
            spineVersions: {
                ...state.spineVersions,
                [projectId]: patchPreflight(state.spineVersions[projectId] || [], spineId, (prev) => {
                    // Returning to the questions from the summary re-enters answering.
                    const reentering = prev.status === 'summary' && index < prev.questions.length;
                    return {
                        ...prev,
                        currentQuestionIndex: Math.max(0, index),
                        status: reentering ? 'answering' : prev.status,
                        // Re-entering invalidates the prior summary; it will be
                        // regenerated from the edited answers, never shown stale.
                        ...(reentering
                            ? { summary: undefined, assumptions: undefined, unknowns: undefined }
                            : {}),
                    };
                }),
            },
        }));
    },

    setPreflightSummary: (projectId, spineId, { summary, assumptions, unknowns }) => {
        set((state) => ({
            spineVersions: {
                ...state.spineVersions,
                [projectId]: patchPreflight(state.spineVersions[projectId] || [], spineId, (prev) => ({
                    ...prev,
                    summary,
                    assumptions,
                    unknowns,
                    status: 'summary',
                })),
            },
        }));
    },

    completePreflightSession: (projectId, spineId) => {
        set((state) => ({
            spineVersions: {
                ...state.spineVersions,
                [projectId]: patchPreflight(state.spineVersions[projectId] || [], spineId, (prev) => ({
                    ...prev,
                    completed: true,
                    status: 'completed',
                })),
            },
        }));
    },

    setPreflightError: (projectId, spineId, message) => {
        set((state) => ({
            spineVersions: {
                ...state.spineVersions,
                [projectId]: patchPreflight(state.spineVersions[projectId] || [], spineId, (prev) => ({
                    ...prev,
                    error: message ?? undefined,
                })),
            },
        }));
    },

    updateStructuredPRD: (projectId: string, spineId: string, structuredPRD: StructuredPRD) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const updatedSpines = projectSpines.map(s =>
                s.id === spineId ? { ...s, structuredPRD } : s
            );
            return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
        });
    },

    updateSpineStructuredPRD: (
        projectId: string,
        spineId: string,
        structuredPRD: StructuredPRD,
        responseText: string,
        meta?: SpineGenerationMetaInput,
    ) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const updatedSpines = projectSpines.map(s => {
                if (s.id !== spineId) return s;
                const next: SpineVersion = { ...s, structuredPRD, responseText };
                if (meta?.sourcePrompt !== undefined) next.sourcePrompt = meta.sourcePrompt;
                if (meta?.qualityScores !== undefined) next.qualityScores = meta.qualityScores;
                if (meta?.generationMeta !== undefined) next.generationMeta = meta.generationMeta;
                if (meta?.model !== undefined) next.model = meta.model;
                if (meta?.prdVersion !== undefined) next.prdVersion = meta.prdVersion;
                // generationMeta only arrives with the final onResult — partial
                // (onPartial) updates leave the run marked as still running.
                if (meta?.generationMeta !== undefined) {
                    next.generationPhase = 'complete';
                    // Attribution: a settling run whose spine carries no
                    // provenance yet is the initial generation (regenerate /
                    // merge stamp theirs at creation and are preserved here).
                    if (!next.provenance) {
                        next.provenance = { changeSource: 'ai_generation' };
                    }
                    // Attach the canonical PRD spine on final settle only. It is
                    // rebuilt deterministically at artifact-generation time too,
                    // so this persisted copy is a diagnostic/diffing convenience
                    // and never the sole source of truth. Best-effort — a build
                    // failure must never block a usable PRD.
                    try {
                        const project = state.projects[projectId];
                        next.canonicalSpine = buildCanonicalPrdSpine(structuredPRD, {
                            projectName: project?.productName || project?.name,
                            platform: project?.platform,
                            designSystemPreset: project?.designSystemPreset,
                            safetyReview: next.safetyReview,
                            sourceSpineVersionId: next.id,
                            sourcePrdVersion: meta.prdVersion ?? meta.generationMeta.schemaVersion,
                        });
                    } catch {
                        // Leave canonicalSpine unset; lazy rebuild covers it.
                    }
                }
                return next;
            });
            return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
        });
    },

    // Versioning: an edit must NOT overwrite the current spine in place. Clone
    // the source version, apply the edited PRD, and append it as the new
    // isLatest — old content is preserved and retrievable. Used by every inline
    // PRD edit and by single-section retry. Reads happen inside set() against
    // the fresh `state` (concurrency rule); the new id is a UUID and display
    // labels derive from array position, never the id.
    editSpineStructuredPRD: (projectId, spineId, nextStructuredPRD, opts) => {
        // Validate against a snapshot; do array derivations inside set().
        const source = (get().spineVersions[projectId] || []).find(s => s.id === spineId);
        if (!source) throw new Error('No spine version to edit');

        const now = Date.now();
        const newSpineId = uuidv4();
        const historyEventId = uuidv4();
        const changeSource = opts?.changeSource ?? 'user_edit';
        const editSummary = opts?.editSummary ?? 'Edited PRD';

        set((state) => {
            const currentVersions = state.spineVersions[projectId] || [];
            const src = currentVersions.find(s => s.id === spineId);
            if (!src) return state;

            const mappedOld = currentVersions.map(v => ({ ...v, isLatest: false }));

            // Clone the source spine fully so generation metadata carries
            // forward, then apply the edit + provenance.
            const newSpine: SpineVersion = {
                ...src,
                id: newSpineId,
                createdAt: now,
                isLatest: true,
                isFinal: false,
                structuredPRD: nextStructuredPRD,
                responseText: opts?.responseText ?? src.responseText,
                // A user edit / retry is a settled state, never an in-flight run.
                generationPhase: 'complete',
                // A historical edit must not inherit a stale error/safety stub.
                generationError: undefined,
                provenance: { changeSource, editSummary },
            };
            // Optional generation-meta overrides (e.g. updated failedSections).
            if (opts?.meta?.sourcePrompt !== undefined) newSpine.sourcePrompt = opts.meta.sourcePrompt;
            if (opts?.meta?.qualityScores !== undefined) newSpine.qualityScores = opts.meta.qualityScores;
            if (opts?.meta?.generationMeta !== undefined) newSpine.generationMeta = opts.meta.generationMeta;
            if (opts?.meta?.model !== undefined) newSpine.model = opts.meta.model;
            if (opts?.meta?.prdVersion !== undefined) newSpine.prdVersion = opts.meta.prdVersion;

            const editEvent: HistoryEvent = {
                id: historyEventId,
                projectId,
                spineVersionId: newSpineId,
                type: 'Edited',
                description: editSummary,
                createdAt: now,
            };

            return {
                spineVersions: { ...state.spineVersions, [projectId]: [...mappedOld, newSpine] },
                historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), editEvent] },
            };
        });

        return { newSpineId };
    },

    // Versioning: restore a historical spine by appending a NEW latest version
    // cloning its content. The source version is never mutated or deleted, so
    // all history before the revert is preserved.
    revertSpineToVersion: (projectId, sourceSpineId) => {
        const versions = get().spineVersions[projectId] || [];
        const sourceIdx = versions.findIndex(s => s.id === sourceSpineId);
        if (sourceIdx < 0) throw new Error('No spine version to restore');
        // Positional "Version N" label (matches the rest of the workspace).
        const sourceLabel = `Version ${sourceIdx + 1}`;

        const now = Date.now();
        const newSpineId = uuidv4();
        const historyEventId = uuidv4();

        set((state) => {
            const currentVersions = state.spineVersions[projectId] || [];
            const src = currentVersions.find(s => s.id === sourceSpineId);
            if (!src) return state;

            const mappedOld = currentVersions.map(v => ({ ...v, isLatest: false }));

            const newSpine: SpineVersion = {
                ...src,
                id: newSpineId,
                createdAt: now,
                isLatest: true,
                isFinal: false,
                generationPhase: 'complete',
                generationError: undefined,
                provenance: {
                    changeSource: 'revert',
                    revertedFromVersionId: sourceSpineId,
                    editSummary: `Restored from ${sourceLabel}`,
                },
            };

            const revertEvent: HistoryEvent = {
                id: historyEventId,
                projectId,
                spineVersionId: newSpineId,
                type: 'Reverted',
                description: `Restored PRD from ${sourceLabel}`,
                createdAt: now,
            };

            return {
                spineVersions: { ...state.spineVersions, [projectId]: [...mappedOld, newSpine] },
                historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), revertEvent] },
            };
        });

        return { newSpineId };
    },

    updateSpineQualityScores: (
        projectId: string,
        spineId: string,
        scores: QualityScores,
        generationMeta?: GenerationMeta,
    ) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const updatedSpines = projectSpines.map(s => {
                if (s.id !== spineId) return s;
                return {
                    ...s,
                    qualityScores: scores,
                    ...(generationMeta ? { generationMeta } : {}),
                };
            });
            return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
        });
    },

    updateProjectProductMetadata: (
        projectId: string,
        meta: { productName?: string; productCategory?: string },
    ) => {
        set((state) => {
            const project = state.projects[projectId];
            if (!project) return state;
            const next = { ...project };
            if (meta.productName !== undefined) next.productName = meta.productName;
            if (meta.productCategory !== undefined) next.productCategory = meta.productCategory;
            return { projects: { ...state.projects, [projectId]: next } };
        });
    },

    markSpineGenerationStarted: (projectId: string, spineId: string) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const updatedSpines = projectSpines.map(s =>
                s.id === spineId ? { ...s, generationPhase: 'running' as const } : s
            );
            return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
        });
    },

    setSpineSafetyReview: (
        projectId: string,
        spineId: string,
        review: SpineSafetyReview,
        responseText?: string,
    ) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const spine = projectSpines.find(s => s.id === spineId);
            if (!spine) return state;

            const blocked = review.status === 'blocked';
            const updatedSpines = projectSpines.map(s =>
                s.id === spineId
                    ? {
                        ...s,
                        safetyReview: review,
                        // A blocked spine can never be final and must not retain
                        // a half-built PRD or the "Generating…" placeholder. The
                        // run has settled, so it also stops counting as running.
                        ...(blocked ? { isFinal: false, structuredPRD: undefined, generationPhase: 'complete' as const } : {}),
                        ...(responseText !== undefined ? { responseText } : {}),
                    }
                    : s
            );

            const historyEvents = { ...state.historyEvents };
            if (blocked) {
                const events = historyEvents[projectId] || [];
                historyEvents[projectId] = [
                    ...events,
                    {
                        id: uuidv4(),
                        projectId,
                        spineVersionId: spineId,
                        type: 'GenerationFailed' as const,
                        description: 'Blocked by Synapse safety review',
                        createdAt: review.reviewedAt,
                    },
                ];
            }

            return {
                spineVersions: { ...state.spineVersions, [projectId]: updatedSpines },
                historyEvents,
            };
        });
    },

    setSpineError: (projectId: string, spineId: string, error: { message: string; category: string; timestamp: number; raw?: string } | null) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const spine = projectSpines.find(s => s.id === spineId);
            if (!spine) return state;

            const updatedSpines = projectSpines.map(s =>
                s.id === spineId
                    ? {
                        ...s,
                        generationError: error ?? undefined,
                        // Clear placeholder so isPRDGenerating stops being true
                        responseText: error && s.responseText === 'Generating PRD...' ? '' : s.responseText,
                        // An error settles the run; clearing an error re-arms nothing.
                        ...(error ? { generationPhase: 'complete' as const } : {}),
                    }
                    : s
            );

            const historyEvents = { ...state.historyEvents };
            if (error) {
                const events = historyEvents[projectId] || [];
                historyEvents[projectId] = [
                    ...events,
                    {
                        id: uuidv4(),
                        projectId,
                        spineVersionId: spineId,
                        type: 'GenerationFailed' as const,
                        description: `Generation failed: ${error.message}`,
                        createdAt: error.timestamp,
                    },
                ];
            }

            return {
                spineVersions: { ...state.spineVersions, [projectId]: updatedSpines },
                historyEvents,
            };
        });
    },
});
