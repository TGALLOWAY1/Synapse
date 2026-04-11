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
