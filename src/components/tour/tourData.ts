import {
    Workflow,
    AppWindow,
    Database,
    Terminal,
    Palette,
    FileText,
    Layers,
    Code2,
    type LucideIcon,
} from 'lucide-react';

/**
 * All demo content for the tour lives here — there is no backend and no live
 * generation. Components render this data and fake the timing client-side.
 */

/* ── Screen 1 — Start with an idea ─────────────────────────────────────── */

export const IDEA_SEED = {
    label: 'Your idea',
    prompt: 'Build an app that helps musicians finish songs.',
};

export interface PrdSectionPreview {
    id: string;
    heading: string;
    /** Number of skeleton lines to draw under the heading. */
    lines: number;
}

export const IDEA_PRD_SECTIONS: PrdSectionPreview[] = [
    { id: 'vision', heading: '1. Product Vision', lines: 2 },
    { id: 'users', heading: '2. Target Users', lines: 2 },
    { id: 'problems', heading: '3. Core Problems', lines: 2 },
    { id: 'features', heading: '4. Key Features', lines: 2 },
];

/* ── Screen 2 — AI builds the spec section by section ──────────────────── */

export interface SpecStep {
    id: string;
    label: string;
    /** Fake "thinking" time before the step flips to done, in ms. */
    durationMs: number;
    /** Whether this step is written by multiple models concurrently. */
    concurrent?: boolean;
}

export const SPEC_STEPS: SpecStep[] = [
    { id: 'thesis', label: 'Product Thesis', durationMs: 1100 },
    { id: 'users', label: 'Users & Personas', durationMs: 1300 },
    { id: 'problems', label: 'Core Problems', durationMs: 1000 },
    { id: 'solutions', label: 'Solutions & Features', durationMs: 1600, concurrent: true },
    { id: 'architecture', label: 'Architecture', durationMs: 1200 },
    { id: 'metrics', label: 'Metrics', durationMs: 1000 },
    { id: 'risks', label: 'Risks', durationMs: 1100 },
    { id: 'goals', label: 'Goals & Outcomes', durationMs: 900 },
];

/* ── Screen 3 — Refine specific parts ──────────────────────────────────── */

export const REFINE_ACTIONS = ['Clarify', 'Expand', 'Specify', 'Alternative', 'Replace'] as const;
export type RefineAction = (typeof REFINE_ACTIONS)[number];

export interface RefineScript {
    /** What the user asks for (their chat bubble). */
    request: string;
    /** The assistant's framing line. */
    reply: string;
    /** The refined replacement text applied to the PRD. */
    refined: string;
}

export const REFINE_DEMO = {
    sectionHeading: '3. Target Audience',
    /** The pre-highlighted span the menu acts on. */
    original:
        'Independent musicians, producers, and songwriters who want to finish more songs.',
    scripts: {
        Clarify: {
            request: 'Clarify who exactly this is for.',
            reply: 'Here is a sharper definition of the audience.',
            refined:
                'Independent musicians (solo artists, bedroom producers, and songwriters) who release without a label and routinely leave songs unfinished.',
        },
        Expand: {
            request: 'Expand this to include more detail about user types and their goals.',
            reply: 'Here is an expanded version with detailed user segments, behaviours, and goals.',
            refined:
                'Independent musicians, producers, and songwriters — from hobbyists capturing voice memos to self-releasing pros — who want to turn unfinished ideas into released tracks, collaborate remotely, and build a consistent output habit.',
        },
        Specify: {
            request: 'Specify the primary segment and platform.',
            reply: 'Here is a more specific, prioritised version.',
            refined:
                'Primarily mobile-first bedroom producers aged 18–34 on iOS who write 5+ song ideas a month but finish fewer than one.',
        },
        Alternative: {
            request: 'Suggest an alternative framing for this audience.',
            reply: 'Here is an alternative framing centred on outcomes.',
            refined:
                'Creators who already make music but struggle to ship — the "90% done" crowd who need structure and accountability more than new instruments.',
        },
        Replace: {
            request: 'Replace this with a concise one-liner.',
            reply: 'Here is a tighter replacement.',
            refined: 'Independent music creators who want to finish and release more songs.',
        },
    } satisfies Record<RefineAction, RefineScript>,
};

/* ── Screen 4 — Decision Center (the Challenge stage) ──────────────────── */

/**
 * Demo content for the Decision Center screen. Mirrors the real Challenge
 * stage (`src/components/review/DecisionCenter.tsx` inside `ReviewWorkspace`):
 * a queue of planning records split into "Needs attention" vs "Resolved &
 * history", suggested options with a visually-distinct (preselected)
 * recommendation, an explicit user verdict, and a plan-alignment impact
 * preview that is applied through a version-safe write. Keep the vocabulary in
 * sync with the live component if it changes.
 */

export interface DecisionOptionDemo {
    id: string;
    label: string;
    description: string;
    /** Short "benefit · cost" style tradeoff line. */
    tradeoffs: string;
}

export interface DecisionProposalDemo {
    id: string;
    targetLabel: string;
    section: string;
    current: string;
    proposed: string;
    reason: string;
}

export const DECISION_DEMO = {
    /** Tab strip mirrors the live Challenge workspace tabs. */
    challengeTabs: ['Review findings', 'Decision Center', 'Review history'],
    decision: {
        id: 'collab-model',
        conditionLabel: 'Needs a decision',
        title: 'How should collaboration work at launch?',
        statement:
            'The spec references "working with collaborators" but never commits to a collaboration model.',
        whyItMatters:
            'This choice shapes the data model, the sync architecture, and the size of the first release.',
        source: 'Adversarial review · Scope specialist',
        nextAction: 'Record the product choice that should govern the plan.',
        recommendedId: 'async',
        recommendationRationale:
            'Async feedback delivers the core value (finishing songs together) without the real-time infrastructure cost, and it can be upgraded later.',
        options: [
            {
                id: 'async',
                label: 'Async comments on shared tracks',
                description: 'Collaborators leave time-stamped comments and version notes on a shared mix.',
                tradeoffs: 'Ships fast · No live presence',
            },
            {
                id: 'realtime',
                label: 'Real-time co-editing sessions',
                description: 'Two musicians edit the same arrangement live, like a shared document.',
                tradeoffs: 'Strongest demo · Heavy sync infrastructure',
            },
        ] satisfies DecisionOptionDemo[],
        preview: {
            before: 'Collaboration is mentioned as a goal but no feature, entity, or milestone commits to a model.',
            after: 'Async comments on shared tracks becomes a v1 feature with a Comment entity and a milestone.',
            affectedSections: ['4. Key Features', '5. Architecture'],
            affectedOutputs: ['Data Model', 'Implementation Plan'],
            proposals: [
                {
                    id: 'features',
                    targetLabel: 'PRD · Key Features',
                    section: '4. Key Features',
                    current: '"Collaboration tools for working with other musicians."',
                    proposed: '"Async collaboration: time-stamped comments and version notes on shared tracks."',
                    reason: 'The feature list must name the chosen model so downstream outputs stop guessing.',
                },
                {
                    id: 'data-model',
                    targetLabel: 'Data Model',
                    section: 'Entities',
                    current: 'No entity stores collaborator feedback.',
                    proposed: 'Add a Comment entity (author, track, timestamp, body) linked to Song.',
                    reason: 'Async comments need a home in the schema before the Build stage.',
                },
            ] satisfies DecisionProposalDemo[],
        },
    },
    assumption: {
        id: 'pay-before-finish',
        conditionLabel: 'Needs validation',
        title: 'Musicians will pay before finishing their first song',
        statement:
            'The monetization plan assumes users subscribe during onboarding, before the product has proven it can get a song finished.',
        whyItMatters:
            'If payment comes after the first finished song instead, the pricing page, onboarding flow, and revenue model all change.',
        source: 'Imported from PRD · Risks',
        nextAction:
            'Decide whether to test this assumption, correct it, or explicitly proceed with the uncertainty.',
        acceptedNote:
            'Accepted for planning · not validated. The uncertainty stays visible on the record instead of silently becoming a fact.',
    },
    resolved: {
        id: 'platform',
        conditionLabel: 'Answer recorded',
        title: 'Which platform ships first?',
        resolution: 'Mobile-first on iOS; desktop web follows once capture-to-finish is proven.',
        rationale: 'Bedroom producers capture ideas on their phones — meet them there first.',
        source: 'Preflight clarification',
        history: [
            { label: 'Confirmed by you', when: 'Yesterday, 4:12 PM' },
            { label: 'Impact preview applied to plan', when: 'Yesterday, 4:15 PM' },
        ],
    },
};

/* ── Screen 5 — Version everything ─────────────────────────────────────── */

export interface VersionEntry {
    id: string; // 'v1'..'v4'
    title: string;
    date: string;
    summary: string;
    additions: number;
    changes: number;
    removals: number;
    /** Sample diff lines shown when this version is selected / compared. */
    diff: { type: 'add' | 'change' | 'remove'; text: string }[];
}

/** Newest first — matches the timeline reading order in the mockup. */
export const VERSIONS: VersionEntry[] = [
    {
        id: 'v4',
        title: 'Consolidated Strategy',
        date: 'Today, 10:42 AM',
        summary: 'Consolidated positioning and updated metrics based on feedback.',
        additions: 18,
        changes: 7,
        removals: 3,
        diff: [
            { type: 'add', text: 'Added activation metric: first finished song < 7 days.' },
            { type: 'change', text: 'Repositioned around "finish & release", not "record".' },
            { type: 'remove', text: 'Dropped the standalone mastering module.' },
        ],
    },
    {
        id: 'v3',
        title: 'New Monetization Strategy',
        date: 'Yesterday, 4:28 PM',
        summary: 'Added subscription tiers and updated pricing approach.',
        additions: 12,
        changes: 5,
        removals: 2,
        diff: [
            { type: 'add', text: 'Added Pro tier with unlimited project history.' },
            { type: 'change', text: 'Moved collaboration behind the paid tier.' },
            { type: 'remove', text: 'Removed one-time purchase option.' },
        ],
    },
    {
        id: 'v2',
        title: 'Expanded User Personas',
        date: 'May 14, 2:11 PM',
        summary: 'Added detailed user segments and creator workflows.',
        additions: 20,
        changes: 9,
        removals: 1,
        diff: [
            { type: 'add', text: 'Added "bedroom producer" and "touring songwriter" personas.' },
            { type: 'change', text: 'Reframed the core problem around unfinished ideas.' },
            { type: 'remove', text: 'Cut the vague "all musicians" segment.' },
        ],
    },
    {
        id: 'v1',
        title: 'Initial Version',
        date: 'May 12, 11:03 AM',
        summary: 'Initial PRD generated from your idea.',
        additions: 0,
        changes: 0,
        removals: 0,
        diff: [{ type: 'add', text: 'First PRD generated from your one-line idea.' }],
    },
];

/* ── Screens 6 & 7 — Assets + connected workspace ──────────────────────── */

export type AssetPreviewKind = 'flow' | 'screens' | 'table' | 'grid' | 'roadmap' | 'palette' | 'prompt';

/**
 * Sidebar groups shown on the workspace Assets page. These mirror
 * `ARTIFACT_GROUPS` in `ArtifactWorkspace.tsx` (minus the PRD row, which is the
 * hub these assets are generated *from*, not a generated asset itself). Keep the
 * ids, titles, order, and icons in sync if the workspace grouping changes.
 */
export type AssetGroupId = 'foundation' | 'experience' | 'architecture' | 'development';

export interface AssetGroup {
    id: AssetGroupId;
    title: string;
    icon: LucideIcon;
}

export const TOUR_ASSET_GROUPS: AssetGroup[] = [
    { id: 'foundation', title: 'Project Foundation', icon: FileText },
    { id: 'experience', title: 'Experience', icon: Layers },
    { id: 'architecture', title: 'Architecture', icon: Database },
    { id: 'development', title: 'Development', icon: Code2 },
];

export interface TourAsset {
    id: string;
    /** Which Assets-page sidebar group this artifact lives under. */
    group: AssetGroupId;
    name: string;
    tagline: string;
    icon: LucideIcon;
    /** Tailwind classes for the icon tile (text + subtle bg). */
    accent: string;
    previewKind: AssetPreviewKind;
    /** Demo lines/labels rendered inside the preview drawer. */
    preview: string[];
}

/**
 * The assets Synapse generates from a finalized PRD, in the same order and
 * grouping the workspace Assets page shows them. This list is deliberately
 * limited to artifacts that are actually surfaced to the user — the hidden
 * `component_inventory` (mockups consume it but it has no sidebar row) and the
 * retired standalone `prompt_pack` (folded into the Implementation Plan) are
 * intentionally omitted so the tour matches the real product. Mockups aren't a
 * standalone row either: they live inside the consolidated **Screens** view
 * under Experience, alongside **User Flows**.
 */
export const TOUR_ASSETS: TourAsset[] = [
    {
        id: 'design_system',
        group: 'foundation',
        name: 'Design System',
        tagline: 'Colors, typography & components',
        icon: Palette,
        accent: 'text-pink-300 bg-pink-500/10',
        previewKind: 'palette',
        preview: ['Indigo / primary', 'Neutral / surface', 'Emerald / success', 'Display / heading', 'Body / text'],
    },
    {
        id: 'user_flows',
        group: 'experience',
        name: 'User Flows',
        tagline: 'Flow diagrams & journeys',
        icon: Workflow,
        accent: 'text-sky-300 bg-sky-500/10',
        previewKind: 'flow',
        preview: ['Open app', 'Start a song idea', 'Record / import', 'Arrange sections', 'Export & release'],
    },
    {
        // The consolidated, screen-centric Experience view: each screen gets an
        // Overview / Flow / Mockups tab. This is where UI mockups live in the
        // real product — there's no standalone "UI Mockups" sidebar row.
        id: 'screens',
        group: 'experience',
        name: 'Screens',
        tagline: 'Screen-by-screen: overview, flow & mockups',
        icon: AppWindow,
        accent: 'text-indigo-300 bg-indigo-500/10',
        previewKind: 'screens',
        preview: ['Home', 'Song editor', 'Arrangement view', 'Collaboration', 'Library'],
    },
    {
        id: 'data_model',
        group: 'architecture',
        name: 'Data Model',
        tagline: 'Entities & relationships',
        icon: Database,
        accent: 'text-emerald-300 bg-emerald-500/10',
        previewKind: 'table',
        preview: ['User', 'Song', 'Track', 'Section', 'Collaborator'],
    },
    {
        // Consolidated Development artifact: milestones now carry their own
        // prompt packs and quality gates (the old standalone Prompt Pack card
        // folded into this one).
        id: 'implementation_plan',
        group: 'development',
        name: 'Implementation Plan',
        tagline: 'Milestones, prompt packs & quality gates',
        icon: Terminal,
        accent: 'text-amber-300 bg-amber-500/10',
        previewKind: 'roadmap',
        preview: [
            'M1 — Capture & projects · 2 prompt packs',
            'M2 — Arrangement · 2 prompt packs',
            'M3 — Collaboration · 1 prompt pack',
            'M4 — Export & launch · quality gates',
        ],
    },
];

/* ── Screen 7 — connected workspace chrome ─────────────────────────────── */

export const TOUR_PROJECT = {
    name: 'Melody Studio',
    prdVersion: 'v4',
    updated: 'Updated 2h ago',
    summary: 'Consolidated strategy with updated user personas and monetization.',
};

/**
 * The workspace's planning progression, mirroring the production
 * `PipelineStageBar` (src/components/PipelineStageBar.tsx): Plan → Challenge →
 * Build → History. (In the live app the Build tab reads "Explore" until the
 * plan is committed; the tour shows the committed state.) Keep these labels in
 * sync if the stage bar changes.
 */
export const WORKSPACE_NAV = [
    'Plan',
    'Challenge',
    'Build',
    'History',
];

export interface ActivityEntry {
    id: string;
    version: string;
    when: string;
    title: string;
    detail: string;
    /** e.g. "5 artifacts updated"; empty for the initial version. */
    impact: string;
}

export const RECENT_ACTIVITY: ActivityEntry[] = [
    {
        id: 'a4',
        version: 'v4',
        when: '2h ago',
        title: 'Consolidated Strategy',
        detail: 'Added pricing strategy and refined user personas',
        impact: '5 artifacts updated',
    },
    {
        id: 'a3',
        version: 'v3',
        when: 'Yesterday',
        title: 'New Monetization Strategy',
        detail: 'Updated subscription tiers and pricing approach',
        impact: '3 artifacts updated',
    },
    {
        id: 'a2',
        version: 'v2',
        when: 'May 14',
        title: 'Expanded User Personas',
        detail: 'Added detailed user segments and workflows',
        impact: '4 artifacts updated',
    },
    {
        id: 'a1',
        version: 'v1',
        when: 'May 12',
        title: 'Initial Version',
        detail: 'PRD generated from your initial idea',
        impact: '',
    },
];
