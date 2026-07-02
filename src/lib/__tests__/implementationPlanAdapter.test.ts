import { describe, expect, it } from 'vitest';
import {
    buildConsolidatedPlan,
    collectAllPromptPacks,
    consolidatedPlanToMarkdown,
    promptPackToClipboardText,
} from '../services/implementationPlanAdapter';
import type { StructuredImplementationPlan } from '../../types';

function fencePlan(plan: StructuredImplementationPlan): string {
    return `# Implementation Plan\n\nSome preamble.\n\n\`\`\`json synapse-plan\n${JSON.stringify(plan, null, 2)}\n\`\`\``;
}

const NATIVE_PLAN: StructuredImplementationPlan = {
    overview: { summary: 'Build in thin slices.', criticalPath: 'Setup → Core loop', teamSize: 'Solo dev' },
    summary: {
        buildStrategy: 'Ship a walking skeleton first, then layer features.',
        stackSummary: ['React + Vite', 'Supabase'],
        criticalPath: ['m_setup', 'm_core'],
        estimatedEffort: '4 weeks',
    },
    milestones: [
        {
            id: 'm_setup',
            name: 'Project Setup',
            goal: 'Scaffold the app.',
            objective: 'Stand up a deployable skeleton with CI.',
            priority: 'critical',
            estimatedEffort: '2 days',
            dependencies: [],
            linkedArtifacts: { screens: ['Landing'], dataModels: ['User'] },
            tasks: [{ id: 't1', title: 'Initialize Vite app', status: 'todo' }],
            promptPacks: [
                {
                    id: 'pp_setup',
                    title: 'Scaffold the project',
                    purpose: 'Create the initial repo structure.',
                    prompt: '# Prompt: Scaffold\n## Goal\nSet up Vite.',
                    acceptanceCriteria: ['App boots locally'],
                    recommendedCommitMessage: 'chore: scaffold project',
                },
            ],
            qualityGates: [
                { id: 'qg1', title: 'Lint passes', category: 'testing', required: true },
            ],
            validationCommands: ['npm run lint'],
            definitionOfDone: ['CI green on main'],
        },
        {
            id: 'm_core',
            name: 'Core Loop',
            goal: 'Deliver the main flow.',
            dependencies: ['m_setup'],
            tasks: [{ id: 't2', title: 'Build capture screen', status: 'todo' }],
            promptPacks: [
                {
                    id: 'pp_core',
                    title: 'Implement capture flow',
                    purpose: 'Build the capture screen.',
                    prompt: '# Prompt: Capture\n## Goal\nBuild it.',
                    acceptanceCriteria: ['Capture works'],
                },
            ],
        },
    ],
    globalQualityGates: [
        { id: 'g1', title: 'All P0 screens implemented', category: 'functional', required: true },
    ],
    architecture: ['SPA with serverless API'],
    risks: [{ description: 'Third-party API rate limits', mitigation: 'Cache responses' }],
    definitionOfDone: ['App deployed'],
};

const LEGACY_STRUCTURED: StructuredImplementationPlan = {
    overview: { summary: 'Legacy overview.', criticalPath: 'M1 → M2', teamSize: '2 devs' },
    milestones: [
        {
            id: 'm_auth',
            name: 'Authentication and Accounts',
            goal: 'Users can sign up and log in.',
            tasks: [
                { id: 't1', title: 'Build login screen', status: 'todo', linkedArtifacts: { mockups: ['Login'], dataModel: ['User'] } },
                { id: 't2', title: 'Add session management', status: 'todo' },
            ],
        },
        {
            id: 'm_dash',
            name: 'Dashboard Experience',
            goal: 'Users see their data at a glance.',
            tasks: [{ id: 't3', title: 'Build dashboard screen', status: 'todo' }],
        },
    ],
    architecture: ['Next.js frontend', 'Postgres database'],
    risks: [{ description: 'OAuth provider outages' }],
    definitionOfDone: ['All tests pass', 'Accessibility audit complete'],
};

const LEGACY_PROMPT_PACK = `# Prompt Pack

Ready-to-use prompts.

### 1. Implement the authentication login screen
**Category:** UI Implementation
**Prompt:**
\`\`\`
# Task
Build the login screen.

## Features In Scope
- f1 — Login
  - Purpose: Let users authenticate.

## Requirements
- Email/password form validates input
- Errors render inline
\`\`\`
**Expected Output:** A working login screen.

### 2. Write haiku poetry about databases
**Category:** Content
**Prompt:**
\`\`\`
# Task
Write copy.
\`\`\`
**Expected Output:** Marketing copy.
`;

describe('buildConsolidatedPlan', () => {
    it('returns null when there is nothing to consolidate', () => {
        expect(buildConsolidatedPlan({})).toBeNull();
        expect(buildConsolidatedPlan({ planContent: '', promptPackContent: '  ' })).toBeNull();
    });

    it('passes a native consolidated plan through', () => {
        const plan = buildConsolidatedPlan({ planContent: fencePlan(NATIVE_PLAN) });
        expect(plan).not.toBeNull();
        expect(plan!.sources).toEqual({ plan: 'structured', promptPacks: 'native' });
        expect(plan!.readiness.status).toBe('ready');
        expect(plan!.milestones).toHaveLength(2);
        expect(plan!.milestones[0].promptPacks?.[0].id).toBe('pp_setup');
        expect(plan!.summary.buildStrategy).toBe('Ship a walking skeleton first, then layer features.');
        expect(plan!.globalQualityGates.map(g => g.id)).toEqual(['g1']);
        // Traceability derives from milestone + task links.
        expect(plan!.traceability[0]).toMatchObject({
            milestoneId: 'm_setup',
            screens: ['Landing'],
            dataModels: ['User'],
            promptPackIds: ['pp_setup'],
            qualityGateIds: ['qg1'],
        });
        // Risks surface as readiness warnings.
        expect(plan!.readiness.warnings.some(w => w.includes('rate limits'))).toBe(true);
    });

    it('adapts legacy structured plan + prompt_pack, attaching by best-effort match', () => {
        const plan = buildConsolidatedPlan({
            planContent: fencePlan(LEGACY_STRUCTURED),
            promptPackContent: LEGACY_PROMPT_PACK,
        });
        expect(plan).not.toBeNull();
        expect(plan!.sources).toEqual({ plan: 'structured', promptPacks: 'legacy_prompt_pack' });
        expect(plan!.readiness.status).toBe('needs_review');

        // The auth-themed prompt attaches to the auth milestone…
        const auth = plan!.milestones.find(m => m.id === 'm_auth')!;
        expect(auth.promptPacks).toHaveLength(1);
        expect(auth.promptPacks![0].title).toContain('authentication');
        // …its Requirements become acceptance criteria and scope carries features.
        expect(auth.promptPacks![0].acceptanceCriteria).toContain('Email/password form validates input');
        expect(auth.promptPacks![0].scope?.include.length).toBeGreaterThan(0);

        // The unrelated prompt lands in Unassigned.
        expect(plan!.unassignedPromptPacks).toHaveLength(1);
        expect(plan!.unassignedPromptPacks[0].title).toContain('haiku');

        // Legacy plan-wide DoD becomes global quality gates with categories.
        expect(plan!.globalQualityGates).toHaveLength(2);
        expect(plan!.globalQualityGates[0].category).toBe('testing');
        expect(plan!.globalQualityGates[1].category).toBe('accessibility');

        // Legacy architecture feeds the stack summary; overview feeds strategy.
        expect(plan!.summary.stackSummary).toEqual(['Next.js frontend', 'Postgres database']);
        expect(plan!.summary.buildStrategy).toBe('Legacy overview.');
        expect(plan!.summary.criticalPath).toEqual(['M1 → M2']);

        // Task-level links roll up into traceability.
        expect(plan!.traceability[0].screens).toEqual(['Login']);
        expect(plan!.traceability[0].dataModels).toEqual(['User']);
    });

    it('handles a legacy markdown-only plan (no JSON fence)', () => {
        const markdown = `# Implementation Plan

### Milestone 1: Foundation (Week 1)
**Goal:** Set up the project.
**Key Deliverables:**
- [ ] Initialize repository
- [x] Choose hosting
**Dependencies:** None
**Definition of Done:** CI runs on every push

### Milestone 2: Core Features (Week 2-3)
**Goal:** Build the main flow.
**Key Deliverables:**
- [ ] Build home screen
**Risks:** Scope creep

---
## Critical Path Summary
Foundation then core.`;
        const plan = buildConsolidatedPlan({ planContent: markdown });
        expect(plan).not.toBeNull();
        expect(plan!.sources.plan).toBe('legacy_markdown');
        expect(plan!.milestones).toHaveLength(2);
        expect(plan!.milestones[0].tasks).toHaveLength(2);
        expect(plan!.milestones[0].tasks[1].status).toBe('done');
        expect(plan!.milestones[0].definitionOfDone).toEqual(['CI runs on every push']);
        expect(plan!.readiness.warnings.some(w => w.includes('Scope creep'))).toBe(true);
        expect(plan!.readiness.missingInputs).toContain('Prompt packs');
    });

    it('renders prompt packs alone when no plan exists', () => {
        const plan = buildConsolidatedPlan({ promptPackContent: LEGACY_PROMPT_PACK });
        expect(plan).not.toBeNull();
        expect(plan!.sources).toEqual({ plan: 'none', promptPacks: 'legacy_prompt_pack' });
        expect(plan!.readiness.status).toBe('blocked');
        expect(plan!.milestones).toHaveLength(0);
        expect(plan!.unassignedPromptPacks).toHaveLength(2);
    });

    it('tolerates malformed plan content without throwing', () => {
        const plan = buildConsolidatedPlan({ planContent: 'just some prose\nno milestones here' });
        expect(plan).toBeNull();
    });
});

describe('copy/export helpers', () => {
    it('collects all prompt packs in milestone order then unassigned', () => {
        const plan = buildConsolidatedPlan({
            planContent: fencePlan(LEGACY_STRUCTURED),
            promptPackContent: LEGACY_PROMPT_PACK,
        })!;
        const packs = collectAllPromptPacks(plan);
        expect(packs.map(p => p.id)).toEqual(['legacy-prompt-1', 'legacy-prompt-2']);
    });

    it('appends acceptance criteria and commit guidance to clipboard text when missing from the prompt', () => {
        const text = promptPackToClipboardText({
            id: 'p1',
            title: 'T',
            purpose: 'P',
            prompt: '# Task\nDo the thing.',
            acceptanceCriteria: ['Thing done'],
            recommendedCommitMessage: 'feat: do the thing',
        });
        expect(text).toContain('## Acceptance Criteria');
        expect(text).toContain('- Thing done');
        expect(text).toContain('feat: do the thing');
    });

    it('renders the consolidated plan as markdown with milestones, packs, and gates', () => {
        const plan = buildConsolidatedPlan({ planContent: fencePlan(NATIVE_PLAN) })!;
        const md = consolidatedPlanToMarkdown(plan);
        expect(md).toContain('## Milestone 1: Project Setup');
        expect(md).toContain('### Prompt Pack: Scaffold the project');
        expect(md).toContain('npm run lint');
        expect(md).toContain('## Global Quality Gates');
        expect(md).toContain('## Risks');
    });
});
