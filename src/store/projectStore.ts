import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { Project, SpineVersion } from '../types';

interface ProjectState {
    projects: Record<string, Project>;
    spineVersions: Record<string, SpineVersion[]>; // projectId -> SpineVersion[]
    createProject: (name: string, promptText: string) => { projectId: string, spineId: string };
    getProject: (projectId: string) => Project | undefined;
    getSpineVersions: (projectId: string) => SpineVersion[];
    getLatestSpine: (projectId: string) => SpineVersion | undefined;
}

export const useProjectStore = create<ProjectState>()(
    persist(
        (set, get) => ({
            projects: {},
            spineVersions: {},

            createProject: (name: string, promptText: string) => {
                const projectId = uuidv4();
                const newProject: Project = {
                    id: projectId,
                    name,
                    createdAt: Date.now(),
                };

                const initialSpine: SpineVersion = {
                    id: 'v1',
                    projectId,
                    promptText,
                    responseText: 'Generating PRD... (Draft content will appear here)',
                    createdAt: Date.now(),
                    isLatest: true,
                    isFinal: false,
                };

                set((state) => ({
                    projects: { ...state.projects, [projectId]: newProject },
                    spineVersions: { ...state.spineVersions, [projectId]: [initialSpine] },
                }));

                return { projectId, spineId: initialSpine.id };
            },

            getProject: (projectId: string) => {
                return get().projects[projectId];
            },

            getSpineVersions: (projectId: string) => {
                return get().spineVersions[projectId] || [];
            },

            getLatestSpine: (projectId: string) => {
                const versions = get().spineVersions[projectId] || [];
                return versions.find(v => v.isLatest);
            }
        }),
        {
            name: 'synapse-projects-storage',
        }
    )
);
