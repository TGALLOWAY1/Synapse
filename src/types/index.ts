export type PipelineStage = 'prd' | 'devplan' | 'prompts';

export type Project = {
    id: string;
    name: string;
    createdAt: number;
    currentStage?: PipelineStage;
};

export type BranchMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
};

export type Branch = {
    id: string;
    projectId: string;
    spineVersionId: string;
    anchorText: string;
    status: 'active' | 'resolved' | 'rejected' | 'merged';
    createdAt: number;
    messages: BranchMessage[];
};
// Structured PRD types
export type Feature = {
    id: string;
    name: string;
    description: string;
    userValue: string;
    complexity: 'low' | 'medium' | 'high';
};

export type StructuredPRD = {
    vision: string;
    targetUsers: string[];
    coreProblem: string;
    features: Feature[];
    architecture: string;
    risks: string[];
};

export type SpineVersion = {
    id: string; // e.g. "v1", "v2"
    projectId: string;
    promptText: string;
    responseText: string;
    createdAt: number;
    isLatest: boolean;
    isFinal: boolean;
    structuredPRD?: StructuredPRD;
};

// Dev Plan types
export type DevTask = {
    id: string;
    name: string;
    description: string;
    status: 'pending' | 'in-progress' | 'done';
};

export type Milestone = {
    id: string;
    name: string;
    description: string;
    tasks: DevTask[];
    order: number;
};

export type DevPlan = {
    id: string;
    projectId: string;
    spineVersionId: string;
    milestones: Milestone[];
    createdAt: number;
    isLatest: boolean;
};

// Agent Prompt types
export type AgentTarget = 'cursor' | 'codex' | 'claude' | 'copilot';

export type AgentPrompt = {
    id: string;
    projectId: string;
    devPlanId: string;
    milestoneId: string;
    taskId?: string;
    target: AgentTarget;
    branchName: string;
    objective: string;
    tasks: string[];
    constraints: string[];
    verificationSteps: string[];
    rawPromptText: string;
    createdAt: number;
};

export type HistoryEvent = {
    id: string;
    projectId: string;
    spineVersionId: string;
    type: "Init" | "Regenerated" | "Consolidated";
    description: string;
    diff?: {
        matchMode?: "exact" | "word";
        matchCount?: number;
        matches: { before: string, after: string }[];
        sampleText?: string;
    };
    createdAt: number;
};
