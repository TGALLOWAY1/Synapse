import type { AgentTarget } from '../../types';

export const structuredPRDSchema = {
    type: "OBJECT",
    properties: {
        vision: { type: "STRING" },
        targetUsers: { type: "ARRAY", items: { type: "STRING" } },
        coreProblem: { type: "STRING" },
        features: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    id: { type: "STRING" },
                    name: { type: "STRING" },
                    description: { type: "STRING" },
                    userValue: { type: "STRING" },
                    complexity: { type: "STRING", enum: ["low", "medium", "high"] },
                    priority: { type: "STRING", enum: ["must", "should", "could"] },
                    acceptanceCriteria: { type: "ARRAY", items: { type: "STRING" } },
                    dependencies: { type: "ARRAY", items: { type: "STRING" } },
                },
                required: ["id", "name", "description", "userValue", "complexity", "priority", "acceptanceCriteria"],
            }
        },
        architecture: { type: "STRING" },
        risks: { type: "ARRAY", items: { type: "STRING" } },
        nonFunctionalRequirements: { type: "ARRAY", items: { type: "STRING" } },
        constraints: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["vision", "targetUsers", "coreProblem", "features", "architecture", "risks", "nonFunctionalRequirements", "constraints"],
};

export const devPlanSchema = {
    type: "OBJECT",
    properties: {
        milestones: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    id: { type: "STRING" },
                    name: { type: "STRING" },
                    description: { type: "STRING" },
                    order: { type: "INTEGER" },
                    tasks: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                id: { type: "STRING" },
                                name: { type: "STRING" },
                                description: { type: "STRING" },
                                status: { type: "STRING", enum: ["pending", "in-progress", "done"] },
                            },
                            required: ["id", "name", "description", "status"],
                        }
                    },
                },
                required: ["id", "name", "description", "order", "tasks"],
            }
        }
    },
    required: ["milestones"],
};

export const agentPromptSchema = {
    type: "OBJECT",
    properties: {
        branchName: { type: "STRING" },
        objective: { type: "STRING" },
        tasks: { type: "ARRAY", items: { type: "STRING" } },
        constraints: { type: "ARRAY", items: { type: "STRING" } },
        verificationSteps: { type: "ARRAY", items: { type: "STRING" } },
        rawPromptText: { type: "STRING" },
    },
    required: ["branchName", "objective", "tasks", "constraints", "verificationSteps", "rawPromptText"],
};

export const targetLabels: Record<AgentTarget, string> = {
    cursor: 'Cursor',
    codex: 'Codex',
    claude: 'Claude Code',
    copilot: 'GitHub Copilot',
};
