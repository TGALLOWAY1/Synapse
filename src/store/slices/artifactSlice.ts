import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Artifact, ArtifactVersion, ArtifactType, CoreArtifactSubtype, SourceRef, HistoryEvent } from '../../types';
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
    getArtifactVersions: ProjectState['getArtifactVersions'];
    getPreferredVersion: ProjectState['getPreferredVersion'];
    getLatestArtifactVersion: ProjectState['getLatestArtifactVersion'];
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
        parentVersionId?: string | null
    ) => {
        const versionId = uuidv4();
        const now = Date.now();

        // Determine version number
        const existingVersions = (get().artifactVersions[projectId] || [])
            .filter(v => v.artifactId === artifactId);
        const versionNumber = existingVersions.length + 1;

        // Unmark previous preferred versions
        const allVersions = get().artifactVersions[projectId] || [];
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
        };

        // Update artifact's currentVersionId
        const projectArtifacts = get().artifacts[projectId] || [];
        const updatedArtifacts = projectArtifacts.map(a =>
            a.id === artifactId ? { ...a, currentVersionId: versionId, status: 'active' as const, updatedAt: now } : a
        );

        // Create history event
        const artifact = projectArtifacts.find(a => a.id === artifactId);
        const historyEvent: HistoryEvent = {
            id: uuidv4(),
            projectId,
            artifactId,
            artifactVersionId: versionId,
            type: versionNumber === 1 ? "ArtifactGenerated" : "ArtifactRegenerated",
            description: `${artifact?.title || 'Artifact'} v${versionNumber} generated`,
            createdAt: now,
        };

        set((state) => ({
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
        }));
        void trackActivity('generated_artifact', {
            projectId,
            artifactId,
            versionId,
            type: artifact?.type || 'unknown',
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
});
