import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Artifact, ArtifactVersion, ArtifactType, CoreArtifactSubtype, SourceRef, HistoryEvent, VersionProvenance } from '../../types';
import type { ProjectState } from '../types';
import { trackActivity } from '../../lib/recruiterApi';

export type ArtifactSlice = {
    artifacts: Record<string, Artifact[]>;
    artifactVersions: Record<string, ArtifactVersion[]>;
    createArtifact: ProjectState['createArtifact'];
    updateArtifact: ProjectState['updateArtifact'];
    deleteArtifact: ProjectState['deleteArtifact'];
    getArtifacts: ProjectState['getArtifacts'];
    getArtifact: ProjectState['getArtifact'];
    createArtifactVersion: ProjectState['createArtifactVersion'];
    setPreferredVersion: ProjectState['setPreferredVersion'];
    revertArtifactToVersion: ProjectState['revertArtifactToVersion'];
    markArtifactCurrentForSpine: ProjectState['markArtifactCurrentForSpine'];
    getArtifactVersions: ProjectState['getArtifactVersions'];
    getPreferredVersion: ProjectState['getPreferredVersion'];
    getLatestArtifactVersion: ProjectState['getLatestArtifactVersion'];
    updateArtifactVersionMetadata: ProjectState['updateArtifactVersionMetadata'];
};

export const createArtifactSlice: StateCreator<ProjectState, [], [], ArtifactSlice> = (set, get) => ({
    artifacts: {},
    artifactVersions: {},

    createArtifact: (projectId: string, type: ArtifactType, title: string, subtype?: CoreArtifactSubtype) => {
        const artifactId = uuidv4();
        const now = Date.now();
        const newArtifact: Artifact = {
            id: artifactId,
            projectId,
            type,
            subtype,
            title,
            status: 'draft',
            currentVersionId: null,
            createdAt: now,
            updatedAt: now,
        };

        set((state) => ({
            artifacts: {
                ...state.artifacts,
                [projectId]: [...(state.artifacts[projectId] || []), newArtifact]
            }
        }));

        return { artifactId };
    },

    updateArtifact: (projectId: string, artifactId: string, updates: Partial<Pick<Artifact, 'title' | 'status'>>) => {
        set((state) => {
            const projectArtifacts = state.artifacts[projectId] || [];
            const updatedArtifacts = projectArtifacts.map(a =>
                a.id === artifactId ? { ...a, ...updates, updatedAt: Date.now() } : a
            );
            return {
                artifacts: { ...state.artifacts, [projectId]: updatedArtifacts }
            };
        });
    },

    deleteArtifact: (projectId: string, artifactId: string) => {
        set((state) => ({
            artifacts: {
                ...state.artifacts,
                [projectId]: (state.artifacts[projectId] || []).filter(a => a.id !== artifactId)
            },
            artifactVersions: {
                ...state.artifactVersions,
                [projectId]: (state.artifactVersions[projectId] || []).filter(v => v.artifactId !== artifactId)
            },
        }));
    },

    getArtifacts: (projectId: string, type?: ArtifactType) => {
        const artifacts = get().artifacts[projectId] || [];
        if (type) return artifacts.filter(a => a.type === type);
        return artifacts;
    },

    getArtifact: (projectId: string, artifactId: string) => {
        const artifacts = get().artifacts[projectId] || [];
        return artifacts.find(a => a.id === artifactId);
    },

    createArtifactVersion: (
        projectId: string,
        artifactId: string,
        content: string,
        metadata: Record<string, unknown>,
        sourceRefs: SourceRef[],
        generationPrompt: string,
        parentVersionId?: string | null,
        provenance?: VersionProvenance,
    ) => {
        const versionId = uuidv4();
        const now = Date.now();
        const historyEventId = uuidv4();

        // All reads happen inside the set() updater against the fresh `state`
        // so concurrent createArtifactVersion calls (the 7 core artifacts
        // generate in parallel) cannot clobber each other's version arrays via
        // a stale get() snapshot taken before set() ran.
        let activityType = 'unknown';
        set((state) => {
            const allVersions = state.artifactVersions[projectId] || [];
            const versionNumber = allVersions.filter(v => v.artifactId === artifactId).length + 1;

            // Unmark previous preferred versions for this artifact.
            const updatedVersions = allVersions.map(v =>
                v.artifactId === artifactId ? { ...v, isPreferred: false } : v
            );

            const newVersion: ArtifactVersion = {
                id: versionId,
                artifactId,
                versionNumber,
                parentVersionId: parentVersionId ?? null,
                content,
                metadata,
                sourceRefs,
                generationPrompt,
                isPreferred: true,
                createdAt: now,
                // Default attribution: first version = generation, later ones =
                // regeneration. Callers with richer context can override.
                provenance: provenance ?? {
                    changeSource: versionNumber === 1 ? 'ai_generation' : 'ai_regeneration',
                },
            };

            const projectArtifacts = state.artifacts[projectId] || [];
            const updatedArtifacts = projectArtifacts.map(a =>
                a.id === artifactId ? { ...a, currentVersionId: versionId, status: 'active' as const, updatedAt: now } : a
            );

            const artifact = projectArtifacts.find(a => a.id === artifactId);
            activityType = artifact?.type || 'unknown';
            const historyEvent: HistoryEvent = {
                id: historyEventId,
                projectId,
                artifactId,
                artifactVersionId: versionId,
                type: versionNumber === 1 ? "ArtifactGenerated" : "ArtifactRegenerated",
                description: `${artifact?.title || 'Artifact'} v${versionNumber} generated`,
                createdAt: now,
            };

            return {
                artifactVersions: {
                    ...state.artifactVersions,
                    [projectId]: [...updatedVersions, newVersion]
                },
                artifacts: {
                    ...state.artifacts,
                    [projectId]: updatedArtifacts
                },
                historyEvents: {
                    ...state.historyEvents,
                    [projectId]: [...(state.historyEvents[projectId] || []), historyEvent]
                },
            };
        });
        void trackActivity('generated_artifact', {
            projectId,
            artifactId,
            versionId,
            type: activityType,
        });

        return { versionId };
    },

    // Versioning: user-facing "Restore" appends a CLONED version rather than
    // only re-pointing isPreferred (setPreferredVersion), so versionNumber keeps
    // incrementing and the timeline shows the revert as its own honest event.
    // All reads happen inside set() against the fresh `state` (concurrency rule).
    revertArtifactToVersion: (projectId: string, artifactId: string, sourceVersionId: string) => {
        const allVersions = get().artifactVersions[projectId] || [];
        const source = allVersions.find(v => v.id === sourceVersionId && v.artifactId === artifactId);
        if (!source) throw new Error('No artifact version to restore');

        const versionId = uuidv4();
        const now = Date.now();
        const historyEventId = uuidv4();

        set((state) => {
            const versions = state.artifactVersions[projectId] || [];
            const src = versions.find(v => v.id === sourceVersionId && v.artifactId === artifactId);
            if (!src) return state;

            const projectArtifacts = state.artifacts[projectId] || [];
            const artifact = projectArtifacts.find(a => a.id === artifactId);
            // Parent = the version currently preferred for this artifact.
            const currentPreferred = versions.find(v => v.artifactId === artifactId && v.isPreferred);
            const versionNumber = versions.filter(v => v.artifactId === artifactId).length + 1;

            const updatedVersions = versions.map(v =>
                v.artifactId === artifactId ? { ...v, isPreferred: false } : v
            );

            const newVersion: ArtifactVersion = {
                id: versionId,
                artifactId,
                versionNumber,
                parentVersionId: currentPreferred?.id ?? null,
                content: src.content,
                metadata: src.metadata,
                sourceRefs: src.sourceRefs,
                generationPrompt: src.generationPrompt,
                isPreferred: true,
                createdAt: now,
                provenance: {
                    changeSource: 'revert',
                    revertedFromVersionId: sourceVersionId,
                    editSummary: `Restored from version ${src.versionNumber}`,
                },
            };

            const updatedArtifacts = projectArtifacts.map(a =>
                a.id === artifactId ? { ...a, currentVersionId: versionId, status: 'active' as const, updatedAt: now } : a
            );

            const historyEvent: HistoryEvent = {
                id: historyEventId,
                projectId,
                artifactId,
                artifactVersionId: versionId,
                type: 'Reverted',
                description: `${artifact?.title || 'Artifact'} restored from v${src.versionNumber}`,
                createdAt: now,
            };

            return {
                artifactVersions: { ...state.artifactVersions, [projectId]: [...updatedVersions, newVersion] },
                artifacts: { ...state.artifacts, [projectId]: updatedArtifacts },
                historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), historyEvent] },
            };
        });

        return { versionId };
    },

    // Versioning: "Mark as up to date" — the user asserts this artifact is
    // still current for a NEWER spine despite not being regenerated (e.g. a
    // typo-level PRD edit). Appends a CLONED version (same content, honest
    // history) whose sourceRefs are REBASED onto the current state: the spine
    // ref points at the given spine version, and every core_artifact ref is
    // re-pointed at that dependency's current preferred version (refreshing a
    // recorded design tokensHash anchor) — rewriting only the spine ref would
    // leave the graph reporting dependency_changed. All reads inside set()
    // (concurrency rule).
    markArtifactCurrentForSpine: (projectId: string, artifactId: string, spineVersionId: string) => {
        const preferred = (get().artifactVersions[projectId] || [])
            .find(v => v.artifactId === artifactId && v.isPreferred);
        if (!preferred) throw new Error('No preferred artifact version to mark current');

        const versionId = uuidv4();
        const now = Date.now();
        const historyEventId = uuidv4();

        set((state) => {
            const versions = state.artifactVersions[projectId] || [];
            const src = versions.find(v => v.artifactId === artifactId && v.isPreferred);
            if (!src) return state;

            const projectArtifacts = state.artifacts[projectId] || [];
            const artifact = projectArtifacts.find(a => a.id === artifactId);
            const versionNumber = versions.filter(v => v.artifactId === artifactId).length + 1;

            // Rebase every ref. Spine ref → the confirmed spine version (added
            // if the legacy version had none); dependency refs → each source
            // artifact's CURRENT preferred version.
            let sawSpineRef = false;
            const rebasedRefs: SourceRef[] = src.sourceRefs.map((ref) => {
                if (ref.sourceType === 'spine') {
                    sawSpineRef = true;
                    return { ...ref, id: uuidv4(), sourceArtifactVersionId: spineVersionId };
                }
                const depPreferred = versions.find(
                    v => v.artifactId === ref.sourceArtifactId && v.isPreferred,
                );
                if (!depPreferred) return { ...ref, id: uuidv4() };
                const tokensHash = depPreferred.metadata?.tokensHash;
                return {
                    ...ref,
                    id: uuidv4(),
                    sourceArtifactVersionId: depPreferred.id,
                    // A recorded design tokensHash anchor is refreshed to the
                    // dependency's current hash — the user is asserting
                    // currency against today's design direction.
                    ...(ref.anchorInfo !== undefined && typeof tokensHash === 'string'
                        ? { anchorInfo: tokensHash }
                        : {}),
                };
            });
            if (!sawSpineRef) {
                rebasedRefs.unshift({
                    id: uuidv4(),
                    sourceArtifactId: projectId,
                    sourceArtifactVersionId: spineVersionId,
                    sourceType: 'spine',
                });
            }

            const spineIdx = (state.spineVersions[projectId] || []).findIndex(s => s.id === spineVersionId);
            const spineLabel = spineIdx >= 0 ? `PRD Version ${spineIdx + 1}` : 'the current PRD';

            const updatedVersions = versions.map(v =>
                v.artifactId === artifactId ? { ...v, isPreferred: false } : v
            );

            const newVersion: ArtifactVersion = {
                id: versionId,
                artifactId,
                versionNumber,
                parentVersionId: src.id,
                content: src.content,
                metadata: src.metadata,
                sourceRefs: rebasedRefs,
                generationPrompt: src.generationPrompt,
                isPreferred: true,
                createdAt: now,
                provenance: {
                    changeSource: 'marked_current',
                    editSummary: `Confirmed current for ${spineLabel}`,
                },
            };

            const updatedArtifacts = projectArtifacts.map(a =>
                a.id === artifactId ? { ...a, currentVersionId: versionId, status: 'active' as const, updatedAt: now } : a
            );

            const historyEvent: HistoryEvent = {
                id: historyEventId,
                projectId,
                artifactId,
                artifactVersionId: versionId,
                type: 'MarkedCurrent',
                description: `${artifact?.title || 'Artifact'} confirmed current for ${spineLabel}`,
                createdAt: now,
            };

            return {
                artifactVersions: { ...state.artifactVersions, [projectId]: [...updatedVersions, newVersion] },
                artifacts: { ...state.artifacts, [projectId]: updatedArtifacts },
                historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), historyEvent] },
            };
        });

        return { versionId };
    },

    setPreferredVersion: (projectId: string, artifactId: string, versionId: string) => {
        set((state) => {
            const allVersions = state.artifactVersions[projectId] || [];
            const updatedVersions = allVersions.map(v => {
                if (v.artifactId === artifactId) {
                    return { ...v, isPreferred: v.id === versionId };
                }
                return v;
            });

            const projectArtifacts = state.artifacts[projectId] || [];
            const updatedArtifacts = projectArtifacts.map(a =>
                a.id === artifactId ? { ...a, currentVersionId: versionId, updatedAt: Date.now() } : a
            );

            return {
                artifactVersions: { ...state.artifactVersions, [projectId]: updatedVersions },
                artifacts: { ...state.artifacts, [projectId]: updatedArtifacts },
            };
        });
    },

    getArtifactVersions: (projectId: string, artifactId: string) => {
        const allVersions = get().artifactVersions[projectId] || [];
        return allVersions.filter(v => v.artifactId === artifactId);
    },

    getPreferredVersion: (projectId: string, artifactId: string) => {
        const versions = get().artifactVersions[projectId] || [];
        return versions.find(v => v.artifactId === artifactId && v.isPreferred);
    },

    getLatestArtifactVersion: (projectId: string, artifactId: string) => {
        const versions = (get().artifactVersions[projectId] || [])
            .filter(v => v.artifactId === artifactId);
        if (versions.length === 0) return undefined;
        return versions.reduce((latest, v) => v.versionNumber > latest.versionNumber ? v : latest);
    },

    updateArtifactVersionMetadata: (
        projectId: string,
        artifactId: string,
        versionId: string,
        patch: Record<string, unknown>,
        opts?: { historyDescription?: string },
    ) => {
        set((state) => {
            const allVersions = state.artifactVersions[projectId] || [];
            const updatedVersions = allVersions.map(v =>
                v.id === versionId && v.artifactId === artifactId
                    ? { ...v, metadata: { ...v.metadata, ...patch } }
                    : v
            );
            const projectArtifacts = state.artifacts[projectId] || [];
            const now = Date.now();
            const updatedArtifacts = projectArtifacts.map(a =>
                a.id === artifactId ? { ...a, updatedAt: now } : a
            );
            // User-authored overlay edits (screenEdits/promptEdits) pass a
            // description so the audit timeline records them; plain metadata
            // patches (relink/dismiss/extraScreens plumbing) stay silent.
            const historyEvents = opts?.historyDescription
                ? {
                    historyEvents: {
                        ...state.historyEvents,
                        [projectId]: [
                            ...(state.historyEvents[projectId] || []),
                            {
                                id: uuidv4(),
                                projectId,
                                artifactId,
                                artifactVersionId: versionId,
                                type: 'Edited' as const,
                                description: opts.historyDescription,
                                createdAt: now,
                            },
                        ],
                    },
                }
                : {};
            return {
                artifactVersions: { ...state.artifactVersions, [projectId]: updatedVersions },
                artifacts: { ...state.artifacts, [projectId]: updatedArtifacts },
                ...historyEvents,
            };
        });
    },
});
