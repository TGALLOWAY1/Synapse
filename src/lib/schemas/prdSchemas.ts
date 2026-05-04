// Premium PRD Gemini JSON-mode schemas. The legacy required fields are
// preserved at the top level so older callers and downstream artifact code
// keep working; the new "premium" sections (productThesis, jtbd, principles,
// userLoops, uxPages, featureSystems, richDataModel, stateMachines, roles,
// architectureFlows, risksDetailed, mvpScope, successMetrics, assumptions)
// are all optional. Pass A asks for them but the schema does not force them,
// because Gemini JSON mode struggles when too many deep arrays are required.

const featureItemSchema = {
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
        // Premium additions
        system: { type: "STRING" },
        successCriteria: { type: "ARRAY", items: { type: "STRING" } },
        edgeCases: { type: "ARRAY", items: { type: "STRING" } },
        failureModes: { type: "ARRAY", items: { type: "STRING" } },
        uiAcceptanceCriteria: { type: "ARRAY", items: { type: "STRING" } },
        analyticsEvents: { type: "ARRAY", items: { type: "STRING" } },
        tier: { type: "STRING", enum: ["mvp", "v1", "later"] },
    },
    required: ["id", "name", "description", "userValue", "complexity", "priority", "acceptanceCriteria"],
};

const productThesisSchema = {
    type: "OBJECT",
    properties: {
        whyExist: { type: "STRING" },
        whyNow: { type: "STRING" },
        differentiation: { type: "STRING" },
        intentionalTradeoffs: { type: "ARRAY", items: { type: "STRING" } },
        nonGoals: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["whyExist", "differentiation"],
};

const jtbdItemSchema = {
    type: "OBJECT",
    properties: {
        segment: { type: "STRING" },
        motivation: { type: "STRING" },
        painPoints: { type: "ARRAY", items: { type: "STRING" } },
        job: { type: "STRING" },
        successMoment: { type: "STRING" },
    },
    required: ["segment", "motivation", "job", "successMoment"],
};

const principleItemSchema = {
    type: "OBJECT",
    properties: {
        name: { type: "STRING" },
        description: { type: "STRING" },
    },
    required: ["name", "description"],
};

const userLoopItemSchema = {
    type: "OBJECT",
    properties: {
        name: { type: "STRING" },
        trigger: { type: "STRING" },
        action: { type: "STRING" },
        systemResponse: { type: "STRING" },
        reward: { type: "STRING" },
        retentionMechanic: { type: "STRING" },
    },
    required: ["name", "trigger", "action", "systemResponse", "reward", "retentionMechanic"],
};

const uxPageItemSchema = {
    type: "OBJECT",
    properties: {
        id: { type: "STRING" },
        name: { type: "STRING" },
        purpose: { type: "STRING" },
        primaryUser: { type: "STRING" },
        components: { type: "ARRAY", items: { type: "STRING" } },
        interactions: { type: "ARRAY", items: { type: "STRING" } },
        emptyState: { type: "STRING" },
        loadingState: { type: "STRING" },
        errorState: { type: "STRING" },
        responsiveNotes: { type: "STRING" },
    },
    required: ["id", "name", "purpose", "components", "interactions"],
};

const featureSystemItemSchema = {
    type: "OBJECT",
    properties: {
        id: { type: "STRING" },
        name: { type: "STRING" },
        purpose: { type: "STRING" },
        featureIds: { type: "ARRAY", items: { type: "STRING" } },
        endToEndBehavior: { type: "STRING" },
        dependencies: { type: "ARRAY", items: { type: "STRING" } },
        edgeCases: { type: "ARRAY", items: { type: "STRING" } },
        mvpVsLater: { type: "STRING" },
    },
    required: ["id", "name", "purpose", "featureIds"],
};

const prdFieldSchema = {
    type: "OBJECT",
    properties: {
        name: { type: "STRING" },
        type: { type: "STRING" },
        required: { type: "BOOLEAN" },
        notes: { type: "STRING" },
    },
    required: ["name", "type"],
};

const prdEntitySchema = {
    type: "OBJECT",
    properties: {
        name: { type: "STRING" },
        description: { type: "STRING" },
        fields: { type: "ARRAY", items: prdFieldSchema },
        relationships: { type: "ARRAY", items: { type: "STRING" } },
        constraints: { type: "ARRAY", items: { type: "STRING" } },
        examples: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["name", "description", "fields"],
};

const richDataModelSchema = {
    type: "OBJECT",
    properties: {
        entities: { type: "ARRAY", items: prdEntitySchema },
    },
    required: ["entities"],
};

const machineStateSchema = {
    type: "OBJECT",
    properties: {
        name: { type: "STRING" },
        trigger: { type: "STRING" },
        nextStates: { type: "ARRAY", items: { type: "STRING" } },
        userVisible: { type: "STRING" },
        systemBehavior: { type: "STRING" },
    },
    required: ["name"],
};

const stateMachineSchema = {
    type: "OBJECT",
    properties: {
        entity: { type: "STRING" },
        states: { type: "ARRAY", items: machineStateSchema },
    },
    required: ["entity", "states"],
};

const rolePermissionSchema = {
    type: "OBJECT",
    properties: {
        role: { type: "STRING" },
        allowed: { type: "ARRAY", items: { type: "STRING" } },
        restricted: { type: "ARRAY", items: { type: "STRING" } },
        dataVisibility: { type: "STRING" },
        notes: { type: "STRING" },
    },
    required: ["role", "allowed"],
};

const archFlowSchema = {
    type: "OBJECT",
    properties: {
        name: { type: "STRING" },
        steps: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["name", "steps"],
};

const riskDetailedSchema = {
    type: "OBJECT",
    properties: {
        risk: { type: "STRING" },
        likelihood: { type: "STRING", enum: ["low", "med", "high"] },
        impact: { type: "STRING" },
        mitigation: { type: "STRING" },
        owner: { type: "STRING" },
    },
    required: ["risk", "likelihood", "impact", "mitigation"],
};

const mvpScopeSchema = {
    type: "OBJECT",
    properties: {
        mvp: { type: "ARRAY", items: { type: "STRING" } },
        v1: { type: "ARRAY", items: { type: "STRING" } },
        later: { type: "ARRAY", items: { type: "STRING" } },
        rationale: { type: "STRING" },
    },
    required: ["mvp", "v1", "later"],
};

const successMetricSchema = {
    type: "OBJECT",
    properties: {
        name: { type: "STRING" },
        target: { type: "STRING" },
        instrumentation: { type: "STRING" },
    },
    required: ["name"],
};

const assumptionSchema = {
    type: "OBJECT",
    properties: {
        id: { type: "STRING" },
        statement: { type: "STRING" },
        confidence: { type: "STRING", enum: ["low", "med", "high"] },
    },
    required: ["id", "statement", "confidence"],
};

export const structuredPRDSchema = {
    type: "OBJECT",
    properties: {
        vision: { type: "STRING" },
        targetUsers: { type: "ARRAY", items: { type: "STRING" } },
        coreProblem: { type: "STRING" },
        features: { type: "ARRAY", items: featureItemSchema },
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
        // --- Premium additions (all optional at the top level so legacy
        // pipelines still validate). ---
        productName: { type: "STRING" },
        productCategory: { type: "STRING" },
        executiveSummary: { type: "STRING" },
        productThesis: productThesisSchema,
        jtbd: { type: "ARRAY", items: jtbdItemSchema },
        principles: { type: "ARRAY", items: principleItemSchema },
        userLoops: { type: "ARRAY", items: userLoopItemSchema },
        uxPages: { type: "ARRAY", items: uxPageItemSchema },
        featureSystems: { type: "ARRAY", items: featureSystemItemSchema },
        richDataModel: richDataModelSchema,
        stateMachines: { type: "ARRAY", items: stateMachineSchema },
        roles: { type: "ARRAY", items: rolePermissionSchema },
        architectureFlows: { type: "ARRAY", items: archFlowSchema },
        risksDetailed: { type: "ARRAY", items: riskDetailedSchema },
        mvpScope: mvpScopeSchema,
        successMetrics: { type: "ARRAY", items: successMetricSchema },
        assumptions: { type: "ARRAY", items: assumptionSchema },
    },
    required: ["vision", "targetUsers", "coreProblem", "features", "architecture", "risks", "nonFunctionalRequirements", "constraints", "domainEntities", "primaryActions"],
};

// ─── Per-section schemas for the progressive PRD pipeline ─────────────────
// Each schema covers exactly the StructuredPRD fields its section produces.
// Required lists are intentionally lenient (mirror structuredPRDSchema pattern).

export const productBasicsSchema = {
    type: "OBJECT",
    properties: {
        productName: { type: "STRING" },
        productCategory: { type: "STRING" },
        executiveSummary: { type: "STRING" },
        vision: { type: "STRING" },
        targetUsers: { type: "ARRAY", items: { type: "STRING" } },
        coreProblem: { type: "STRING" },
    },
    required: ["vision", "targetUsers", "coreProblem"],
};

export const productThesisSliceSchema = {
    type: "OBJECT",
    properties: {
        productThesis: productThesisSchema,
        principles: { type: "ARRAY", items: principleItemSchema },
        jtbd: { type: "ARRAY", items: jtbdItemSchema },
    },
    required: ["productThesis"],
};

export const groundingSliceSchema = {
    type: "OBJECT",
    properties: {
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
    required: ["domainEntities", "primaryActions"],
};

export const featuresSliceSchema = {
    type: "OBJECT",
    properties: {
        features: { type: "ARRAY", items: featureItemSchema },
        featureSystems: { type: "ARRAY", items: featureSystemItemSchema },
    },
    required: ["features"],
};

export const dataModelSliceSchema = {
    type: "OBJECT",
    properties: {
        richDataModel: richDataModelSchema,
        stateMachines: { type: "ARRAY", items: stateMachineSchema },
    },
    required: ["richDataModel"],
};

export const uxSliceSchema = {
    type: "OBJECT",
    properties: {
        userLoops: { type: "ARRAY", items: userLoopItemSchema },
        uxPages: { type: "ARRAY", items: uxPageItemSchema },
        roles: { type: "ARRAY", items: rolePermissionSchema },
    },
    required: ["userLoops"],
};

export const architectureSliceSchema = {
    type: "OBJECT",
    properties: {
        architecture: { type: "STRING" },
        architectureFlows: { type: "ARRAY", items: archFlowSchema },
        nonFunctionalRequirements: { type: "ARRAY", items: { type: "STRING" } },
        constraints: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["architecture"],
};

export const qualityRisksSliceSchema = {
    type: "OBJECT",
    properties: {
        risks: { type: "ARRAY", items: { type: "STRING" } },
        risksDetailed: { type: "ARRAY", items: riskDetailedSchema },
        assumptions: { type: "ARRAY", items: assumptionSchema },
    },
    required: ["risks"],
};

export const metricsScopeSliceSchema = {
    type: "OBJECT",
    properties: {
        mvpScope: mvpScopeSchema,
        successMetrics: { type: "ARRAY", items: successMetricSchema },
    },
    required: ["successMetrics"],
};

const implementationPlanPhaseSchema = {
    type: "OBJECT",
    properties: {
        name: { type: "STRING" },
        goals: { type: "ARRAY", items: { type: "STRING" } },
        featureIds: { type: "ARRAY", items: { type: "STRING" } },
        estimatedWeeks: { type: "NUMBER" },
    },
    required: ["name", "goals"],
};

export const implementationPlanSliceSchema = {
    type: "OBJECT",
    properties: {
        implementationPlan: {
            type: "OBJECT",
            properties: {
                phases: { type: "ARRAY", items: implementationPlanPhaseSchema },
                techStack: { type: "ARRAY", items: { type: "STRING" } },
                teamNotes: { type: "STRING" },
            },
            required: ["phases"],
        },
    },
    required: ["implementationPlan"],
};

export type SectionId =
    | 'product_basics'
    | 'product_thesis'
    | 'grounding'
    | 'features'
    | 'data_model'
    | 'ux_loops'
    | 'architecture'
    | 'quality_risks'
    | 'metrics_scope'
    | 'implementation_plan';

export const SECTION_SCHEMAS: Record<SectionId, object> = {
    product_basics: productBasicsSchema,
    product_thesis: productThesisSliceSchema,
    grounding: groundingSliceSchema,
    features: featuresSliceSchema,
    data_model: dataModelSliceSchema,
    ux_loops: uxSliceSchema,
    architecture: architectureSliceSchema,
    quality_risks: qualityRisksSliceSchema,
    metrics_scope: metricsScopeSliceSchema,
    implementation_plan: implementationPlanSliceSchema,
};

