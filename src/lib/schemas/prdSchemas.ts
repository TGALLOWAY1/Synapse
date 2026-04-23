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
        // Phase B grounding fields. Required at generation so every new
        // project has concrete nouns/verbs for the mockup spec engine to
        // reuse. (Existing projects in localStorage may lack them; the
        // mockup service treats them as optional at read time.)
        domainEntities: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    name: { type: "STRING" },
                    description: { type: "STRING" },
                    exampleValues: { type: "ARRAY", items: { type: "STRING" } },
                },
                required: ["name"],
            },
        },
        primaryActions: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    verb: { type: "STRING" },
                    target: { type: "STRING" },
                },
                required: ["verb", "target"],
            },
        },
    },
    required: ["vision", "targetUsers", "coreProblem", "features", "architecture", "risks", "nonFunctionalRequirements", "constraints", "domainEntities", "primaryActions"],
};
