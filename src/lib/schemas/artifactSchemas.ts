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
                                            description: { type: "STRING", description: "User-visible behavior of this state." },
                                            type: {
                                                type: "STRING",
                                                enum: ["default", "loading", "empty", "error", "success", "disabled", "permission", "responsive", "other"],
                                            },
                                            trigger: { type: "STRING", description: "The concrete condition that puts the screen into this state." },
                                            systemBehavior: { type: "STRING", description: "What the system does in this state (vs. what the user sees)." },
                                            recoveryPath: { type: "STRING", description: "How the user recovers or proceeds from this state, when relevant." },
                                            required: { type: "BOOLEAN", description: "True when the screen cannot ship without this state." },
                                            needsMockup: { type: "BOOLEAN", description: "True when this state warrants its own mockup variant." },
                                            acceptanceCriteria: { type: "ARRAY", items: { type: "STRING" } },
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
                                riskDetails: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            description: { type: "STRING" },
                                            severity: { type: "STRING", enum: ["low", "medium", "high"] },
                                            proposedHandling: { type: "STRING", description: "How the product should handle or mitigate this risk." },
                                        },
                                        required: ["description"],
                                    },
                                },
                                acceptanceCriteria: {
                                    type: "ARRAY",
                                    description: "Checkable screen-level acceptance criteria grounded in the PRD. Omit rather than invent.",
                                    items: { type: "STRING" },
                                },
                                handoff: {
                                    type: "OBJECT",
                                    description: "Practical developer-handoff fields. Only include what the PRD supports; omit uncertain fields.",
                                    properties: {
                                        route: { type: "STRING", description: "Route or route hint, e.g. /submissions/:id" },
                                        routeParams: { type: "ARRAY", items: { type: "STRING" } },
                                        primaryComponents: { type: "ARRAY", items: { type: "STRING" } },
                                        stateVariables: { type: "ARRAY", items: { type: "STRING" } },
                                        events: {
                                            type: "ARRAY",
                                            items: {
                                                type: "OBJECT",
                                                properties: {
                                                    name: { type: "STRING" },
                                                    trigger: { type: "STRING" },
                                                    effect: { type: "STRING" },
                                                },
                                                required: ["name"],
                                            },
                                        },
                                        dataDependencies: { type: "ARRAY", items: { type: "STRING" } },
                                        apiDependencies: { type: "ARRAY", items: { type: "STRING" } },
                                        accessibilityNotes: { type: "ARRAY", items: { type: "STRING" } },
                                        responsiveNotes: { type: "ARRAY", items: { type: "STRING" } },
                                    },
                                },
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
                    featureRefs: {
                        type: "ARRAY",
                        description: "Canonical PRD feature ids (and/or names) this entity supports, drawn from the Canonical Feature Glossary. Do not invent ids.",
                        items: { type: "STRING" },
                    },
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

// Design System token contract. Mirrors `DesignTokens` in src/types/index.ts.
// Returned via Gemini JSON mode for the `design_system` core artifact subtype
// so downstream mockup pipelines have a reliable, machine-usable contract
// rather than parsing hex codes out of free-form markdown.
//
// Token names use dot-paths (e.g. "brand.primary", "heading.lg",
// "button.primary") so namespaces stay readable. `rules` is a short list of
// usage instructions the model carries forward into mockup generation
// (e.g. "Use brand.primary only for primary actions.").
export const designSystemTokensSchema = {
    type: "OBJECT",
    properties: {
        version: { type: "INTEGER" },
        colors: {
            type: "OBJECT",
            description: "Map of dot-pathed color names (e.g. 'brand.primary', 'surface.card', 'state.success') to #RRGGBB hex values.",
            properties: {
                "brand.primary": { type: "STRING" },
                "brand.secondary": { type: "STRING" },
                "text.primary": { type: "STRING" },
                "text.secondary": { type: "STRING" },
                "surface.app": { type: "STRING" },
                "surface.card": { type: "STRING" },
                "border.subtle": { type: "STRING" },
                "state.success": { type: "STRING" },
                "state.warning": { type: "STRING" },
                "state.error": { type: "STRING" },
                "state.info": { type: "STRING" },
            },
            required: [
                "brand.primary",
                "text.primary",
                "surface.app",
                "surface.card",
            ],
        },
        typography: {
            type: "OBJECT",
            description: "Map of dot-pathed type roles (e.g. 'heading.xl', 'body.md') to type tokens.",
            properties: {
                "heading.xl": {
                    type: "OBJECT",
                    properties: {
                        font: { type: "STRING" },
                        size: { type: "INTEGER" },
                        weight: { type: "INTEGER" },
                        lineHeight: { type: "NUMBER" },
                        letterSpacing: { type: "NUMBER" },
                    },
                    required: ["font", "size", "weight", "lineHeight"],
                },
                "heading.lg": {
                    type: "OBJECT",
                    properties: {
                        font: { type: "STRING" },
                        size: { type: "INTEGER" },
                        weight: { type: "INTEGER" },
                        lineHeight: { type: "NUMBER" },
                        letterSpacing: { type: "NUMBER" },
                    },
                    required: ["font", "size", "weight", "lineHeight"],
                },
                "heading.md": {
                    type: "OBJECT",
                    properties: {
                        font: { type: "STRING" },
                        size: { type: "INTEGER" },
                        weight: { type: "INTEGER" },
                        lineHeight: { type: "NUMBER" },
                        letterSpacing: { type: "NUMBER" },
                    },
                    required: ["font", "size", "weight", "lineHeight"],
                },
                "body.md": {
                    type: "OBJECT",
                    properties: {
                        font: { type: "STRING" },
                        size: { type: "INTEGER" },
                        weight: { type: "INTEGER" },
                        lineHeight: { type: "NUMBER" },
                        letterSpacing: { type: "NUMBER" },
                    },
                    required: ["font", "size", "weight", "lineHeight"],
                },
                "body.sm": {
                    type: "OBJECT",
                    properties: {
                        font: { type: "STRING" },
                        size: { type: "INTEGER" },
                        weight: { type: "INTEGER" },
                        lineHeight: { type: "NUMBER" },
                        letterSpacing: { type: "NUMBER" },
                    },
                    required: ["font", "size", "weight", "lineHeight"],
                },
            },
            required: ["heading.lg", "heading.md", "body.md"],
        },
        spacing: {
            type: "OBJECT",
            description: "Spacing scale in px. Use stable named slots: xs, sm, md, lg, xl.",
            properties: {
                xs: { type: "INTEGER" },
                sm: { type: "INTEGER" },
                md: { type: "INTEGER" },
                lg: { type: "INTEGER" },
                xl: { type: "INTEGER" },
            },
            required: ["xs", "sm", "md", "lg"],
        },
        radius: {
            type: "OBJECT",
            description: "Border-radius scale in px. Use stable named slots: sm, md, lg.",
            properties: {
                sm: { type: "INTEGER" },
                md: { type: "INTEGER" },
                lg: { type: "INTEGER" },
            },
            required: ["sm", "md"],
        },
        components: {
            type: "OBJECT",
            description: "Component recipes. Each value references token paths (e.g. 'brand.primary', 'lg', 'sm md').",
            properties: {
                "button.primary": {
                    type: "OBJECT",
                    properties: {
                        background: { type: "STRING" },
                        text: { type: "STRING" },
                        border: { type: "STRING" },
                        radius: { type: "STRING" },
                        padding: { type: "STRING" },
                        notes: { type: "STRING" },
                    },
                },
                "button.secondary": {
                    type: "OBJECT",
                    properties: {
                        background: { type: "STRING" },
                        text: { type: "STRING" },
                        border: { type: "STRING" },
                        radius: { type: "STRING" },
                        padding: { type: "STRING" },
                        notes: { type: "STRING" },
                    },
                },
                "card.default": {
                    type: "OBJECT",
                    properties: {
                        background: { type: "STRING" },
                        text: { type: "STRING" },
                        border: { type: "STRING" },
                        radius: { type: "STRING" },
                        padding: { type: "STRING" },
                        notes: { type: "STRING" },
                    },
                },
                "input.default": {
                    type: "OBJECT",
                    properties: {
                        background: { type: "STRING" },
                        text: { type: "STRING" },
                        border: { type: "STRING" },
                        radius: { type: "STRING" },
                        padding: { type: "STRING" },
                        notes: { type: "STRING" },
                    },
                },
            },
            required: ["button.primary", "card.default"],
        },
        rules: {
            type: "ARRAY",
            description: "5–8 short usage rules in imperative voice (e.g. 'Use brand.primary only for primary actions.').",
            items: { type: "STRING" },
        },
    },
    required: ["colors", "typography", "spacing", "radius", "components", "rules"],
};

// Consolidated Implementation Plan sub-schemas. Prompt packs and quality
// gates are milestone-centered; the plan drives the Development section of
// the assets workspace directly.
const implementationQualityGateSchema = {
    type: "OBJECT",
    properties: {
        id: { type: "STRING" },
        title: { type: "STRING" },
        description: { type: "STRING" },
        category: {
            type: "STRING",
            enum: [
                "design_fidelity",
                "functional",
                "data_integrity",
                "integration",
                "accessibility",
                "performance",
                "testing",
                "regression",
            ],
        },
        required: { type: "BOOLEAN" },
    },
    required: ["id", "title", "category", "required"],
};

const implementationPromptPackSchema = {
    type: "OBJECT",
    properties: {
        id: { type: "STRING" },
        title: { type: "STRING" },
        purpose: { type: "STRING" },
        prompt: { type: "STRING" },
        scope: {
            type: "OBJECT",
            properties: {
                include: { type: "ARRAY", items: { type: "STRING" } },
                exclude: { type: "ARRAY", items: { type: "STRING" } },
            },
        },
        acceptanceCriteria: { type: "ARRAY", items: { type: "STRING" } },
        recommendedCommitMessage: { type: "STRING" },
    },
    required: ["id", "title", "purpose", "prompt", "acceptanceCriteria"],
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
        summary: {
            type: "OBJECT",
            properties: {
                buildStrategy: { type: "STRING" },
                stackSummary: { type: "ARRAY", items: { type: "STRING" } },
                criticalPath: { type: "ARRAY", items: { type: "STRING" } },
                estimatedEffort: { type: "STRING" },
                teamAssumption: { type: "STRING" },
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
                    objective: { type: "STRING" },
                    priority: {
                        type: "STRING",
                        enum: ["critical", "high", "medium", "low"],
                    },
                    estimatedEffort: { type: "STRING" },
                    dependencies: { type: "ARRAY", items: { type: "STRING" } },
                    linkedArtifacts: {
                        type: "OBJECT",
                        properties: {
                            screens: { type: "ARRAY", items: { type: "STRING" } },
                            dataModels: { type: "ARRAY", items: { type: "STRING" } },
                            components: { type: "ARRAY", items: { type: "STRING" } },
                            userFlows: { type: "ARRAY", items: { type: "STRING" } },
                            risks: { type: "ARRAY", items: { type: "STRING" } },
                            apis: { type: "ARRAY", items: { type: "STRING" } },
                        },
                    },
                    promptPacks: { type: "ARRAY", items: implementationPromptPackSchema },
                    qualityGates: { type: "ARRAY", items: implementationQualityGateSchema },
                    validationCommands: { type: "ARRAY", items: { type: "STRING" } },
                    definitionOfDone: { type: "ARRAY", items: { type: "STRING" } },
                    tasks: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                id: { type: "STRING" },
                                title: { type: "STRING" },
                                description: { type: "STRING" },
                                // Generation-time enum. A generated plan is a plan,
                                // not an execution record, so only "todo" is valid
                                // here (the prompt demands it; the schema now
                                // enforces it). Execution statuses live on
                                // ProjectTask in tasksSlice — legacy persisted
                                // artifacts with other values still parse because
                                // this schema constrains generation only.
                                status: {
                                    type: "STRING",
                                    enum: ["todo"],
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
        globalQualityGates: { type: "ARRAY", items: implementationQualityGateSchema },
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
                                            required: { type: "BOOLEAN" },
                                            description: { type: "STRING" },
                                        },
                                        required: ["name", "type"],
                                    },
                                },
                                usedIn: { type: "ARRAY", items: { type: "STRING" } },
                                complexity: { type: "STRING", enum: ["simple", "moderate", "complex"] },
                                notes: { type: "STRING" },
                                previewType: {
                                    type: "STRING",
                                    enum: ["accordion", "input", "toggle", "button", "custom"],
                                },
                                accessibility: {
                                    type: "OBJECT",
                                    properties: {
                                        keyboard: { type: "BOOLEAN" },
                                        focusManagement: { type: "BOOLEAN" },
                                        screenReader: { type: "BOOLEAN" },
                                        aria: { type: "ARRAY", items: { type: "STRING" } },
                                        notes: { type: "STRING" },
                                    },
                                },
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
