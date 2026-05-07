// Gemini JSON mode schemas for structured artifact output

export const screenInventorySchema = {
    type: "OBJECT",
    properties: {
        sections: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING" },
                    description: { type: "STRING" },
                    flowSummary: { type: "STRING" },
                    screens: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                id: { type: "STRING" },
                                name: { type: "STRING" },
                                type: { type: "STRING", enum: ["screen", "modal", "overlay", "system-state"] },
                                priority: { type: "STRING", enum: ["P0", "P1", "P2", "P3"] },
                                purpose: { type: "STRING" },
                                userIntent: { type: "STRING" },
                                states: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            name: { type: "STRING" },
                                            description: { type: "STRING" },
                                            trigger: { type: "STRING" },
                                            recoveryPath: { type: "STRING" },
                                        },
                                        required: ["name", "description"],
                                    },
                                },
                                entryPoints: { type: "ARRAY", items: { type: "STRING" } },
                                exitPaths: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            label: { type: "STRING" },
                                            target: { type: "STRING" },
                                            condition: { type: "STRING" },
                                        },
                                        required: ["label", "target"],
                                    },
                                },
                                coreUIElements: { type: "ARRAY", items: { type: "STRING" } },
                                outputData: { type: "ARRAY", items: { type: "STRING" } },
                                risks: { type: "ARRAY", items: { type: "STRING" } },
                                featureRefs: { type: "ARRAY", items: { type: "STRING" } },
                            },
                            required: ["name", "purpose", "priority"],
                        },
                    },
                },
                required: ["title", "screens"],
            },
        },
    },
    required: ["sections"],
};

const FIELD_GROUP_NAMES = [
    "Key Product Fields",
    "Relationships",
    "System Metadata",
    "API / Integration",
    "Privacy / Safety",
];

export const dataModelSchema = {
    type: "OBJECT",
    properties: {
        overview: {
            type: "OBJECT",
            properties: {
                summary: { type: "STRING" },
                dataFlow: { type: "STRING" },
                productOutcome: { type: "STRING" },
            },
            required: ["summary", "dataFlow", "productOutcome"],
        },
        entities: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    name: { type: "STRING" },
                    description: { type: "STRING" },
                    purpose: { type: "STRING" },
                    userFacing: { type: "BOOLEAN" },
                    mutability: { type: "STRING", enum: ["immutable", "mostly_immutable", "mutable"] },
                    fields: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                name: { type: "STRING" },
                                type: { type: "STRING" },
                                required: { type: "BOOLEAN" },
                                description: { type: "STRING" },
                            },
                            required: ["name", "type", "required", "description"],
                        },
                    },
                    fieldGroups: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                name: { type: "STRING", enum: FIELD_GROUP_NAMES },
                                fieldNames: { type: "ARRAY", items: { type: "STRING" } },
                            },
                            required: ["name", "fieldNames"],
                        },
                    },
                    relationships: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                type: { type: "STRING", enum: ["has_many", "belongs_to", "has_one", "many_to_many"] },
                                target: { type: "STRING" },
                                description: { type: "STRING" },
                            },
                            required: ["type", "target"],
                        },
                    },
                    indexes: { type: "ARRAY", items: { type: "STRING" } },
                    constraints: { type: "ARRAY", items: { type: "STRING" } },
                    privacyRules: { type: "ARRAY", items: { type: "STRING" } },
                    exampleRecord: { type: "STRING" },
                },
                required: ["name", "description", "fields", "relationships"],
            },
        },
        apiEndpoints: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    method: { type: "STRING" },
                    path: { type: "STRING" },
                    description: { type: "STRING" },
                    entity: { type: "STRING" },
                },
                required: ["method", "path", "description", "entity"],
            },
        },
        productMapping: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    field: { type: "STRING" },
                    uiBehavior: { type: "STRING" },
                },
                required: ["field", "uiBehavior"],
            },
        },
    },
    required: ["entities", "apiEndpoints"],
};

export const implementationPlanSchema = {
    type: "OBJECT",
    properties: {
        overview: {
            type: "OBJECT",
            properties: {
                summary: { type: "STRING" },
                criticalPath: { type: "STRING" },
                teamSize: { type: "STRING" },
            },
        },
        milestones: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    id: { type: "STRING" },
                    name: { type: "STRING" },
                    timeframe: { type: "STRING" },
                    goal: { type: "STRING" },
                    tasks: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                id: { type: "STRING" },
                                title: { type: "STRING" },
                                description: { type: "STRING" },
                                status: {
                                    type: "STRING",
                                    enum: ["todo", "in_progress", "done", "blocked"],
                                },
                                dependencies: { type: "ARRAY", items: { type: "STRING" } },
                                linkedArtifacts: {
                                    type: "OBJECT",
                                    properties: {
                                        prd: { type: "ARRAY", items: { type: "STRING" } },
                                        dataModel: { type: "ARRAY", items: { type: "STRING" } },
                                        mockups: { type: "ARRAY", items: { type: "STRING" } },
                                    },
                                },
                            },
                            required: ["id", "title", "status"],
                        },
                    },
                },
                required: ["id", "name", "tasks"],
            },
        },
        architecture: { type: "ARRAY", items: { type: "STRING" } },
        risks: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    description: { type: "STRING" },
                    mitigation: { type: "STRING" },
                },
                required: ["description"],
            },
        },
        definitionOfDone: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["milestones"],
};

export const componentInventorySchema = {
    type: "OBJECT",
    properties: {
        categories: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    name: { type: "STRING" },
                    components: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                name: { type: "STRING" },
                                purpose: { type: "STRING" },
                                props: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            name: { type: "STRING" },
                                            type: { type: "STRING" },
                                            description: { type: "STRING" },
                                        },
                                        required: ["name", "type"],
                                    },
                                },
                                usedIn: { type: "ARRAY", items: { type: "STRING" } },
                                complexity: { type: "STRING", enum: ["simple", "moderate", "complex"] },
                                notes: { type: "STRING" },
                            },
                            required: ["name", "purpose", "complexity"],
                        },
                    },
                },
                required: ["name", "components"],
            },
        },
    },
    required: ["categories"],
};
