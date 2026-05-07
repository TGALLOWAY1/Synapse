// Gemini JSON mode schemas for structured artifact output

export const screenInventorySchema = {
    type: "OBJECT",
    properties: {
        groups: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    name: { type: "STRING" },
                    screens: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                name: { type: "STRING" },
                                purpose: { type: "STRING" },
                                components: { type: "ARRAY", items: { type: "STRING" } },
                                navigationFrom: { type: "ARRAY", items: { type: "STRING" } },
                                navigationTo: { type: "ARRAY", items: { type: "STRING" } },
                                priority: { type: "STRING", enum: ["core", "secondary", "supporting"] },
                                featureRefs: { type: "ARRAY", items: { type: "STRING" } },
                            },
                            required: ["name", "purpose", "components", "priority"],
                        },
                    },
                },
                required: ["name", "screens"],
            },
        },
    },
    required: ["groups"],
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
