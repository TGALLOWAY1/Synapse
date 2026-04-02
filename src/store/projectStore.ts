import { create } from 'zustand';
import { persist, type StorageValue } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';

// Debounced localStorage storage adapter
function createDebouncedStorage<S>(delayMs: number = 500) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pendingValue: string | null = null;
    let pendingName: string | null = null;

    // Flush pending writes synchronously (used on page unload to prevent data loss)
    function flush() {
        if (pendingValue !== null && pendingName !== null) {
            if (timeoutId) clearTimeout(timeoutId);
            localStorage.setItem(pendingName, pendingValue);
            pendingValue = null;
            pendingName = null;
            timeoutId = null;
        }
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', flush);
    }

    return {
        getItem: (name: string): StorageValue<S> | null => {
            const raw = localStorage.getItem(name);
            if (raw === null) return null;
            try {
                return JSON.parse(raw) as StorageValue<S>;
            } catch {
                return null;
            }
        },
        setItem: (name: string, value: StorageValue<S>): void => {
            const serialized = JSON.stringify(value);
            pendingValue = serialized;
            pendingName = name;
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                const startTime = performance.now();
                localStorage.setItem(pendingName!, pendingValue!);
                const durationMs = performance.now() - startTime;
                console.log(`[STORE] persist: ${durationMs.toFixed(0)}ms (${(pendingValue!.length / 1024).toFixed(1)}KB)`);
                pendingValue = null;
                pendingName = null;
                timeoutId = null;
            }, delayMs);
        },
        removeItem: (name: string): void => {
            if (timeoutId) clearTimeout(timeoutId);
            pendingValue = null;
            pendingName = null;
            localStorage.removeItem(name);
        },
    };
}
import type {
    Project, SpineVersion, HistoryEvent, Branch, StructuredPRD,
    DevPlan, Milestone, AgentPrompt, PipelineStage,
    Artifact, ArtifactVersion, ArtifactType, CoreArtifactSubtype,
    SourceRef, FeedbackItem, FeedbackType, FeedbackStatus, StalenessState
} from '../types';

interface ProjectState {
    projects: Record<string, Project>;
    spineVersions: Record<string, SpineVersion[]>;
    historyEvents: Record<string, HistoryEvent[]>;
    branches: Record<string, Branch[]>;
    devPlans: Record<string, DevPlan[]>;
    agentPrompts: Record<string, AgentPrompt[]>;

    // Artifact system
    artifacts: Record<string, Artifact[]>;
    artifactVersions: Record<string, ArtifactVersion[]>;
    feedbackItems: Record<string, FeedbackItem[]>;

    // Existing actions
    createProject: (name: string, promptText: string) => { projectId: string, spineId: string };
    updateSpineText: (projectId: string, spineId: string, text: string) => void;
    regenerateSpine: (projectId: string) => { newSpineId: string };
    markSpineFinal: (projectId: string, spineId: string, isFinal: boolean) => void;
    createBranch: (projectId: string, spineVersionId: string, anchorText: string, initialIntent: string) => { branchId: string };
    addBranchMessage: (projectId: string, branchId: string, role: 'user' | 'assistant', content: string) => void;
    mergeBranch: (projectId: string, branchId: string, newSpineText: string) => { newSpineId: string };
    deleteProject: (projectId: string) => void;
    deleteBranch: (projectId: string, branchId: string) => void;
    getProject: (projectId: string) => Project | undefined;
    getSpineVersions: (projectId: string) => SpineVersion[];
    getLatestSpine: (projectId: string) => SpineVersion | undefined;
    getHistoryEvents: (projectId: string) => HistoryEvent[];
    getBranchesForSpine: (projectId: string, spineVersionId: string) => Branch[];

    // Pipeline stage
    setProjectStage: (projectId: string, stage: PipelineStage) => void;

    // Structured PRD
    updateStructuredPRD: (projectId: string, spineId: string, structuredPRD: StructuredPRD) => void;
    updateSpineStructuredPRD: (projectId: string, spineId: string, structuredPRD: StructuredPRD, responseText: string) => void;

    // Dev Plan (legacy — kept for backward compat)
    createDevPlan: (projectId: string, spineVersionId: string, milestones: Milestone[]) => { devPlanId: string };
    deleteDevPlan: (projectId: string, devPlanId: string) => void;
    getDevPlans: (projectId: string) => DevPlan[];
    getLatestDevPlan: (projectId: string) => DevPlan | undefined;

    // Agent Prompts (legacy — kept for backward compat)
    createAgentPrompt: (projectId: string, prompt: Omit<AgentPrompt, 'id' | 'createdAt'>) => { promptId: string };
    deleteAgentPrompt: (projectId: string, promptId: string) => void;
    getAgentPrompts: (projectId: string, milestoneId?: string) => AgentPrompt[];

    // --- Artifact System Actions ---
    createArtifact: (projectId: string, type: ArtifactType, title: string, subtype?: CoreArtifactSubtype) => { artifactId: string };
    updateArtifact: (projectId: string, artifactId: string, updates: Partial<Pick<Artifact, 'title' | 'status'>>) => void;
    deleteArtifact: (projectId: string, artifactId: string) => void;
    getArtifacts: (projectId: string, type?: ArtifactType) => Artifact[];
    getArtifact: (projectId: string, artifactId: string) => Artifact | undefined;

    // ArtifactVersion actions
    createArtifactVersion: (
        projectId: string,
        artifactId: string,
        content: string,
        metadata: Record<string, unknown>,
        sourceRefs: SourceRef[],
        generationPrompt: string,
        parentVersionId?: string | null
    ) => { versionId: string };
    setPreferredVersion: (projectId: string, artifactId: string, versionId: string) => void;
    getArtifactVersions: (projectId: string, artifactId: string) => ArtifactVersion[];
    getPreferredVersion: (projectId: string, artifactId: string) => ArtifactVersion | undefined;
    getLatestArtifactVersion: (projectId: string, artifactId: string) => ArtifactVersion | undefined;

    // Feedback actions
    createFeedbackItem: (
        projectId: string,
        sourceArtifactVersionId: string,
        type: FeedbackType,
        title: string,
        description: string,
        targetArtifactType: ArtifactType
    ) => { feedbackId: string };
    updateFeedbackStatus: (projectId: string, feedbackId: string, status: FeedbackStatus) => void;
    getFeedbackItems: (projectId: string, status?: FeedbackStatus) => FeedbackItem[];

    // Staleness
    getArtifactStaleness: (projectId: string, artifactId: string) => StalenessState;
}

export const useProjectStore = create<ProjectState>()(
    persist(
        (set, get) => ({
            projects: {},
            spineVersions: {},
            historyEvents: {},
            branches: {},
            devPlans: {},
            agentPrompts: {},
            artifacts: {},
            artifactVersions: {},
            feedbackItems: {},

            createProject: (name: string, promptText: string) => {
                const projectId = uuidv4();
                const now = Date.now();
                const newProject: Project = {
                    id: projectId,
                    name,
                    createdAt: now,
                };

                const initialSpine: SpineVersion = {
                    id: 'v1',
                    projectId,
                    promptText,
                    responseText: 'Generating PRD...',
                    createdAt: now,
                    isLatest: true,
                    isFinal: false,
                };

                const initEvent: HistoryEvent = {
                    id: uuidv4(),
                    projectId,
                    spineVersionId: initialSpine.id,
                    type: "Init",
                    description: "Spine v1 created",
                    createdAt: now,
                };

                set((state) => ({
                    projects: { ...state.projects, [projectId]: newProject },
                    spineVersions: { ...state.spineVersions, [projectId]: [initialSpine] },
                    historyEvents: { ...state.historyEvents, [projectId]: [initEvent] },
                }));

                return { projectId, spineId: initialSpine.id };
            },

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
                const state = get();
                const currentVersions = state.spineVersions[projectId] || [];
                const latest = currentVersions.find(v => v.isLatest);

                if (!latest) throw new Error("No spine to regenerate");

                const nextVersionNum = currentVersions.length + 1;
                const mappedOld = currentVersions.map(v => ({ ...v, isLatest: false }));

                const now = Date.now();
                const newSpine: SpineVersion = {
                    id: `v${nextVersionNum}`,
                    projectId,
                    promptText: latest.promptText,
                    responseText: 'Generating PRD...',
                    createdAt: now,
                    isLatest: true,
                    isFinal: false,
                };

                const regenEvent: HistoryEvent = {
                    id: uuidv4(),
                    projectId,
                    spineVersionId: newSpine.id,
                    type: "Regenerated",
                    description: "Regenerated spine",
                    createdAt: now,
                };

                set((state) => ({
                    spineVersions: { ...state.spineVersions, [projectId]: [...mappedOld, newSpine] },
                    historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), regenEvent] },
                }));

                return { newSpineId: newSpine.id };
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
            },

            getHistoryEvents: (projectId: string) => {
                return get().historyEvents[projectId] || [];
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

            createBranch: (projectId: string, spineVersionId: string, anchorText: string, initialIntent: string) => {
                const branchId = uuidv4();
                const now = Date.now();
                const newBranch: Branch = {
                    id: branchId,
                    projectId,
                    spineVersionId,
                    anchorText,
                    status: 'active',
                    createdAt: now,
                    messages: [
                        { id: uuidv4(), role: 'user', content: initialIntent, createdAt: now }
                    ]
                };

                set((state) => {
                    const projectBranches = state.branches[projectId] || [];
                    return {
                        branches: {
                            ...state.branches,
                            [projectId]: [...projectBranches, newBranch]
                        }
                    };
                });
                return { branchId };
            },

            addBranchMessage: (projectId: string, branchId: string, role: 'user' | 'assistant', content: string) => {
                set((state) => {
                    const projectBranches = state.branches[projectId] || [];
                    const updatedBranches = projectBranches.map(b => {
                        if (b.id === branchId) {
                            return {
                                ...b,
                                messages: [...b.messages, { id: uuidv4(), role, content, createdAt: Date.now() }]
                            };
                        }
                        return b;
                    });
                    return {
                        branches: {
                            ...state.branches,
                            [projectId]: updatedBranches
                        }
                    };
                });
            },

            mergeBranch: (projectId: string, branchId: string, newSpineText: string) => {
                const state = get();
                const projectBranches = state.branches[projectId] || [];
                const branch = projectBranches.find(b => b.id === branchId);

                if (!branch) throw new Error("Branch not found");

                const currentVersions = state.spineVersions[projectId] || [];
                const oldSpine = currentVersions.find(v => v.id === branch.spineVersionId);
                if (!oldSpine) throw new Error("Spine not found");

                // Mark branch as merged
                const updatedBranches = projectBranches.map(b =>
                    b.id === branchId ? { ...b, status: 'merged' as const } : b
                );

                // Create new Spine Version
                const nextVersionNum = currentVersions.length + 1;
                const mappedOld = currentVersions.map(v => ({ ...v, isLatest: false }));

                const now = Date.now();
                const newSpine: SpineVersion = {
                    id: `v${nextVersionNum}`,
                    projectId,
                    promptText: oldSpine.promptText, // inherit prompt
                    responseText: newSpineText,
                    createdAt: now,
                    isLatest: true,
                    isFinal: false,
                };

                // Add History Event
                const mergeEvent: HistoryEvent = {
                    id: uuidv4(),
                    projectId,
                    spineVersionId: newSpine.id,
                    type: "Consolidated",
                    description: `Merged branch for "${branch.anchorText.substring(0, 30)}..."`,
                    createdAt: now,
                    diff: {
                        matches: [{
                            before: branch.anchorText,
                            after: "(Consolidated changes)"
                        }]
                    }
                };

                set((state) => ({
                    branches: { ...state.branches, [projectId]: updatedBranches },
                    spineVersions: { ...state.spineVersions, [projectId]: [...mappedOld, newSpine] },
                    historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), mergeEvent] },
                }));

                return { newSpineId: newSpine.id };
            },

            deleteProject: (projectId: string) => {
                set((state) => {
                    const newProjects = { ...state.projects };
                    delete newProjects[projectId];
                    const newSpines = { ...state.spineVersions };
                    delete newSpines[projectId];
                    const newHistory = { ...state.historyEvents };
                    delete newHistory[projectId];
                    const newBranches = { ...state.branches };
                    delete newBranches[projectId];
                    const newDevPlans = { ...state.devPlans };
                    delete newDevPlans[projectId];
                    const newAgentPrompts = { ...state.agentPrompts };
                    delete newAgentPrompts[projectId];
                    const newArtifacts = { ...state.artifacts };
                    delete newArtifacts[projectId];
                    const newArtifactVersions = { ...state.artifactVersions };
                    delete newArtifactVersions[projectId];
                    const newFeedbackItems = { ...state.feedbackItems };
                    delete newFeedbackItems[projectId];
                    return {
                        projects: newProjects,
                        spineVersions: newSpines,
                        historyEvents: newHistory,
                        branches: newBranches,
                        devPlans: newDevPlans,
                        agentPrompts: newAgentPrompts,
                        artifacts: newArtifacts,
                        artifactVersions: newArtifactVersions,
                        feedbackItems: newFeedbackItems,
                    };
                });
            },

            deleteBranch: (projectId: string, branchId: string) => {
                set((state) => {
                    const projectBranches = state.branches[projectId] || [];
                    return {
                        branches: {
                            ...state.branches,
                            [projectId]: projectBranches.filter(b => b.id !== branchId)
                        }
                    };
                });
            },

            getBranchesForSpine: (projectId: string, spineVersionId: string) => {
                const projectBranches = get().branches[projectId] || [];
                return projectBranches.filter(b => b.spineVersionId === spineVersionId);
            },

            // Pipeline stage
            setProjectStage: (projectId: string, stage: PipelineStage) => {
                set((state) => ({
                    projects: {
                        ...state.projects,
                        [projectId]: { ...state.projects[projectId], currentStage: stage }
                    }
                }));
            },

            // Structured PRD
            updateStructuredPRD: (projectId: string, spineId: string, structuredPRD: StructuredPRD) => {
                set((state) => {
                    const projectSpines = state.spineVersions[projectId] || [];
                    const updatedSpines = projectSpines.map(s =>
                        s.id === spineId ? { ...s, structuredPRD } : s
                    );
                    return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
                });
            },

            updateSpineStructuredPRD: (projectId: string, spineId: string, structuredPRD: StructuredPRD, responseText: string) => {
                set((state) => {
                    const projectSpines = state.spineVersions[projectId] || [];
                    const updatedSpines = projectSpines.map(s =>
                        s.id === spineId ? { ...s, structuredPRD, responseText } : s
                    );
                    return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
                });
            },

            // Dev Plan (legacy)
            createDevPlan: (projectId: string, spineVersionId: string, milestones: Milestone[]) => {
                const devPlanId = uuidv4();
                const now = Date.now();
                const existing = get().devPlans[projectId] || [];
                const mappedOld = existing.map(d => ({ ...d, isLatest: false }));
                const newPlan: DevPlan = {
                    id: devPlanId,
                    projectId,
                    spineVersionId,
                    milestones,
                    createdAt: now,
                    isLatest: true,
                };
                set((state) => ({
                    devPlans: { ...state.devPlans, [projectId]: [...mappedOld, newPlan] }
                }));
                return { devPlanId };
            },

            deleteDevPlan: (projectId: string, devPlanId: string) => {
                set((state) => ({
                    devPlans: {
                        ...state.devPlans,
                        [projectId]: (state.devPlans[projectId] || []).filter(d => d.id !== devPlanId)
                    }
                }));
            },

            getDevPlans: (projectId: string) => {
                return get().devPlans[projectId] || [];
            },

            getLatestDevPlan: (projectId: string) => {
                const plans = get().devPlans[projectId] || [];
                return plans.find(p => p.isLatest);
            },

            // Agent Prompts (legacy)
            createAgentPrompt: (projectId: string, prompt: Omit<AgentPrompt, 'id' | 'createdAt'>) => {
                const promptId = uuidv4();
                const newPrompt: AgentPrompt = {
                    ...prompt,
                    id: promptId,
                    createdAt: Date.now(),
                };
                set((state) => ({
                    agentPrompts: {
                        ...state.agentPrompts,
                        [projectId]: [...(state.agentPrompts[projectId] || []), newPrompt]
                    }
                }));
                return { promptId };
            },

            deleteAgentPrompt: (projectId: string, promptId: string) => {
                set((state) => ({
                    agentPrompts: {
                        ...state.agentPrompts,
                        [projectId]: (state.agentPrompts[projectId] || []).filter(p => p.id !== promptId)
                    }
                }));
            },

            getAgentPrompts: (projectId: string, milestoneId?: string) => {
                const prompts = get().agentPrompts[projectId] || [];
                if (milestoneId) return prompts.filter(p => p.milestoneId === milestoneId);
                return prompts;
            },

            // --- Artifact System ---

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

            // ArtifactVersion actions
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

            // Feedback actions
            createFeedbackItem: (
                projectId: string,
                sourceArtifactVersionId: string,
                type: FeedbackType,
                title: string,
                description: string,
                targetArtifactType: ArtifactType
            ) => {
                const feedbackId = uuidv4();
                const now = Date.now();
                const newFeedback: FeedbackItem = {
                    id: feedbackId,
                    projectId,
                    sourceArtifactVersionId,
                    type,
                    title,
                    description,
                    status: 'open',
                    targetArtifactType,
                    createdAt: now,
                    updatedAt: now,
                };

                // Create history event
                const historyEvent: HistoryEvent = {
                    id: uuidv4(),
                    projectId,
                    type: "FeedbackCreated",
                    description: `Feedback: "${title}"`,
                    createdAt: now,
                };

                set((state) => ({
                    feedbackItems: {
                        ...state.feedbackItems,
                        [projectId]: [...(state.feedbackItems[projectId] || []), newFeedback]
                    },
                    historyEvents: {
                        ...state.historyEvents,
                        [projectId]: [...(state.historyEvents[projectId] || []), historyEvent]
                    },
                }));

                return { feedbackId };
            },

            updateFeedbackStatus: (projectId: string, feedbackId: string, status: FeedbackStatus) => {
                set((state) => {
                    const items = state.feedbackItems[projectId] || [];
                    const updatedItems = items.map(f =>
                        f.id === feedbackId ? { ...f, status, updatedAt: Date.now() } : f
                    );

                    const updates: Record<string, unknown> = {
                        feedbackItems: { ...state.feedbackItems, [projectId]: updatedItems }
                    };

                    // Add history event if incorporated
                    if (status === 'incorporated') {
                        const feedback = items.find(f => f.id === feedbackId);
                        const historyEvent: HistoryEvent = {
                            id: uuidv4(),
                            projectId,
                            type: "FeedbackApplied",
                            description: `Feedback applied: "${feedback?.title || ''}"`,
                            createdAt: Date.now(),
                        };
                        updates.historyEvents = {
                            ...state.historyEvents,
                            [projectId]: [...(state.historyEvents[projectId] || []), historyEvent]
                        };
                    }

                    return updates as Partial<ProjectState>;
                });
            },

            getFeedbackItems: (projectId: string, status?: FeedbackStatus) => {
                const items = get().feedbackItems[projectId] || [];
                if (status) return items.filter(f => f.status === status);
                return items;
            },

            // Staleness detection
            getArtifactStaleness: (projectId: string, artifactId: string): StalenessState => {
                const state = get();
                const artifact = (state.artifacts[projectId] || []).find(a => a.id === artifactId);
                if (!artifact || !artifact.currentVersionId) return 'outdated';

                const preferredVersion = (state.artifactVersions[projectId] || [])
                    .find(v => v.id === artifact.currentVersionId);
                if (!preferredVersion) return 'outdated';

                // Find the source spine version reference
                const spineRef = preferredVersion.sourceRefs.find(r => r.sourceType === 'spine');
                if (!spineRef) return 'possibly_outdated';

                // Compare against latest spine
                const latestSpine = (state.spineVersions[projectId] || []).find(v => v.isLatest);
                if (!latestSpine) return 'possibly_outdated';

                if (spineRef.sourceArtifactVersionId === latestSpine.id) return 'current';

                return 'possibly_outdated';
            },

        }),
        {
            name: 'synapse-projects-storage',
            storage: createDebouncedStorage(500),
            onRehydrateStorage: () => {
                return (state) => {
                    if (!state) return;
                    // Migrate legacy currentStage values
                    for (const projectId of Object.keys(state.projects)) {
                        const project = state.projects[projectId];
                        const stage = project.currentStage as string | undefined;
                        if (stage === 'devplan' || stage === 'prompts') {
                            state.projects[projectId] = { ...project, currentStage: 'artifacts' };
                        }
                    }
                };
            },
        }
    )
);
