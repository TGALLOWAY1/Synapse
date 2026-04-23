// Navigation stages
export type PipelineStage = 'prd' | 'mockups' | 'artifacts' | 'history';

export type ProjectPlatform = 'app' | 'web';

export type Project = {
    id: string;
    name: string;
    createdAt: number;
    currentStage?: PipelineStage;
    platform?: ProjectPlatform;
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
    priority?: 'must' | 'should' | 'could';
    acceptanceCriteria?: string[];
    dependencies?: string[]; // feature IDs
};

export type StructuredPRD = {
    vision: string;
    targetUsers: string[];
    coreProblem: string;
    features: Feature[];
    architecture: string;
    risks: string[];
    nonFunctionalRequirements?: string[];
    constraints?: string[];
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
    generationError?: {
        message: string;
        category: string;
        timestamp: number;
    };
};

// --- Structured Artifact Content Types ---

export interface ScreenItem {
    name: string;
    purpose: string;
    components: string[];
    navigationFrom?: string[];
    navigationTo?: string[];
    priority: 'core' | 'secondary' | 'supporting';
    featureRefs?: string[];
}

export interface ScreenInventoryContent {
    groups: { name: string; screens: ScreenItem[] }[];
}

export interface DataField {
    name: string;
    type: string;
    required: boolean;
    description: string;
}

export interface DataRelationship {
    type: 'has_many' | 'belongs_to' | 'has_one' | 'many_to_many';
    target: string;
    description?: string;
}

export interface DataEntity {
    name: string;
    description: string;
    fields: DataField[];
    relationships: DataRelationship[];
    indexes?: string[];
    constraints?: string[];
}

export interface DataModelContent {
    entities: DataEntity[];
    apiEndpoints?: { method: string; path: string; description: string; entity: string }[];
}

export interface ComponentItem {
    name: string;
    purpose: string;
    props?: { name: string; type: string; description?: string }[];
    usedIn?: string[];
    complexity: 'simple' | 'moderate' | 'complex';
    notes?: string;
}

export interface ComponentInventoryContent {
    categories: { name: string; components: ComponentItem[] }[];
}

// --- Artifact System ---

export type ArtifactType = 'prd' | 'mockup' | 'prompt' | 'core_artifact';

export type CoreArtifactSubtype =
    | 'screen_inventory'
    | 'user_flows'
    | 'component_inventory'
    | 'implementation_plan'
    | 'data_model'
    | 'prompt_pack'
    | 'design_system';

export type StalenessState = 'current' | 'possibly_outdated' | 'outdated';

export type SourceRef = {
    id: string;
    sourceArtifactId: string;
    sourceArtifactVersionId: string;
    sourceType: ArtifactType | 'spine';
    anchorInfo?: string;
};

export type Artifact = {
    id: string;
    projectId: string;
    type: ArtifactType;
    subtype?: CoreArtifactSubtype;
    title: string;
    status: 'draft' | 'active' | 'archived';
    currentVersionId: string | null;
    createdAt: number;
    updatedAt: number;
};

export type ArtifactVersion = {
    id: string;
    artifactId: string;
    versionNumber: number;
    parentVersionId: string | null;
    content: string;
    metadata: Record<string, unknown>;
    sourceRefs: SourceRef[];
    generationPrompt: string;
    isPreferred: boolean;
    createdAt: number;
};

// Feedback types
export type FeedbackType =
    | 'feature_addition'
    | 'workflow_refinement'
    | 'ia_navigation'
    | 'missing_state'
    | 'visual_system'
    | 'ambiguous_requirement'
    | 'implementation_consideration'
    | 'naming_wording';

export type FeedbackStatus = 'open' | 'accepted' | 'rejected' | 'incorporated';

export type FeedbackItem = {
    id: string;
    projectId: string;
    sourceArtifactVersionId: string;
    type: FeedbackType;
    title: string;
    description: string;
    status: FeedbackStatus;
    targetArtifactType: ArtifactType;
    createdAt: number;
    updatedAt: number;
};

// Mockup generation settings
export type MockupPlatform = 'mobile' | 'desktop' | 'responsive';
export type MockupFidelity = 'low' | 'mid' | 'high';
export type MockupScope = 'single_screen' | 'multi_screen' | 'key_workflow';

export type MockupSettings = {
    platform: MockupPlatform;
    fidelity: MockupFidelity;
    style?: string;
    scope: MockupScope;
    selectedSections?: string[];
};

// Rendered HTML/Tailwind mockup payload (stored as JSON string in
// ArtifactVersion.content; distinguished by metadata.format === 'mockup_html_v1').
export type MockupScreen = {
    id: string;       // stable per-screen id (uuid, assigned client-side)
    name: string;     // screen title, e.g. "Editor Dashboard"
    purpose: string;  // one-sentence rationale grounded in the PRD
    html: string;     // static body fragment — no <html>/<head>/<script>
    notes?: string;   // optional assumptions / callouts
};

export type MockupPayload = {
    version: 'mockup_html_v1';
    title: string;              // overall title, e.g. "Editor Workspace Concept"
    summary: string;            // 1–2 sentence product framing
    screens: MockupScreen[];    // always >= 1
};

export const MOCKUP_HTML_V1 = 'mockup_html_v1' as const;

// --- Mockup Layout Spec (Phase A deterministic generation) ---
//
// The layout-spec engine narrows the model's generation surface from "any
// Tailwind HTML string" to a closed vocabulary of shells, sections and
// actions. Slot *content* (titles, labels, row text) is still model-generated
// and PRD-grounded; everything structural comes from vetted templates in
// src/components/mockups/templates/ via mockupLayoutRenderer. See the plan in
// docs/ for why and how.

export type MockupShellType = 'sidebar_topbar' | 'topbar_only' | 'mobile_tab_shell';
export type MockupShellPlatform = 'desktop' | 'mobile' | 'responsive';
export type MockupShellAccent = 'indigo';

export type MockupSectionRole = 'primary' | 'support' | 'utility';
export type MockupSectionComponent =
    | 'stat_grid'
    | 'data_table'
    | 'activity_feed'
    | 'filters_bar'
    | 'detail_panel'
    | 'empty_state';

export type MockupActionKind = 'primary_cta' | 'secondary_cta' | 'input' | 'select' | 'tab';

export interface MockupLayoutShell {
    type: MockupShellType;
    platform: MockupShellPlatform;
    accent: MockupShellAccent;
    productName: string;        // short product/brand label for the shell chrome
    navLabels: string[];        // 3–6 sidebar/tab items, PRD-derived
}

export interface MockupLayoutStatRow {
    label: string;              // PRD entity or metric name
    value: string;              // realistic number / status string
    delta?: string;             // optional "+12%" style chip
}

export interface MockupLayoutTableRow {
    cells: string[];            // matches columns[] length
}

export interface MockupLayoutActivityEntry {
    actor: string;              // persona or entity name
    verb: string;               // "updated", "flagged", "assigned"
    target: string;             // PRD entity
    when: string;               // relative time string, e.g. "2m ago"
}

export interface MockupLayoutFilter {
    label: string;
    options: string[];          // 2–5 realistic values
}

export interface MockupLayoutDetailField {
    label: string;              // PRD field name
    value: string;              // realistic value
}

export interface MockupLayoutEmptyState {
    heading: string;
    body: string;
    primaryActionLabel?: string;
}

// Discriminated-union payload for each section's slot data. The renderer picks
// a template based on `component` and expects the matching `data` shape.
export type MockupLayoutSectionData =
    | { component: 'stat_grid'; data: { rows: MockupLayoutStatRow[] } }
    | { component: 'data_table'; data: { columns: string[]; rows: MockupLayoutTableRow[] } }
    | { component: 'activity_feed'; data: { entries: MockupLayoutActivityEntry[] } }
    | { component: 'filters_bar'; data: { filters: MockupLayoutFilter[] } }
    | { component: 'detail_panel'; data: { fields: MockupLayoutDetailField[] } }
    | { component: 'empty_state'; data: MockupLayoutEmptyState };

export type MockupLayoutSection = MockupLayoutSectionData & {
    role: MockupSectionRole;
    heading: string;            // PRD-grounded section title
};

export interface MockupLayoutAction {
    kind: MockupActionKind;
    label: string;              // PRD-grounded verb phrase
}

export interface MockupLayoutScreen {
    id: string;
    name: string;
    purpose: string;
    shell: MockupLayoutShell;
    sections: MockupLayoutSection[];   // >= 2 per screen
    actions: MockupLayoutAction[];     // >= 1 per screen (the header CTA)
}

export interface MockupLayoutSpec {
    version: 'mockup_layout_spec_v1';
    tokenSet: 'token_set_v1';
    title: string;
    summary: string;
    screens: MockupLayoutScreen[];
}

export const MOCKUP_LAYOUT_SPEC_V1 = 'mockup_layout_spec_v1' as const;
export const MOCKUP_TOKEN_SET_V1 = 'token_set_v1' as const;

// Prompt artifact settings
export type PromptTarget =
    | 'mockup'
    | 'coding'
    | 'ux_critique'
    | 'implementation'
    | 'user_flow'
    | 'testing'
    | 'launch_copy';

// History event types (expanded)
export type HistoryEventType =
    | 'Init'
    | 'Regenerated'
    | 'Consolidated'
    | 'ArtifactGenerated'
    | 'ArtifactRegenerated'
    | 'FeedbackCreated'
    | 'FeedbackApplied'
    | 'GenerationFailed';

export type HistoryEvent = {
    id: string;
    projectId: string;
    spineVersionId?: string;
    artifactId?: string;
    artifactVersionId?: string;
    type: HistoryEventType;
    description: string;
    diff?: {
        matchMode?: "exact" | "word";
        matchCount?: number;
        matches: { before: string; after: string }[];
        sampleText?: string;
    };
    createdAt: number;
};
