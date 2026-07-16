import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImplementationPlanRenderer } from '../renderers/ImplementationPlanRenderer';
import type { StructuredImplementationPlan } from '../../types';

// jsdom lacks the async clipboard API; the copy buttons fall back to
// execCommand, which jsdom also stubs. Provide a spyable writeText.
beforeEach(() => {
    Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    Element.prototype.scrollIntoView = vi.fn();
});

function fencePlan(plan: StructuredImplementationPlan): string {
    return `# Implementation Plan\n\n\`\`\`json synapse-plan\n${JSON.stringify(plan)}\n\`\`\``;
}

const NATIVE_PLAN: StructuredImplementationPlan = {
    overview: { summary: 'Build in thin slices.' },
    summary: {
        buildStrategy: 'Walking skeleton first.',
        stackSummary: ['React + Vite'],
        criticalPath: ['Project Setup', 'Core Loop'],
    },
    milestones: [
        {
            id: 'm_setup',
            name: 'Project Setup',
            goal: 'Scaffold the app.',
            priority: 'critical',
            estimatedEffort: '2 days',
            linkedArtifacts: { screens: ['Landing Page'], dataModels: ['User'] },
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
                { id: 'qg1', title: 'Lint passes clean', category: 'testing', required: true },
            ],
            validationCommands: ['npm run lint'],
            definitionOfDone: ['CI green on main'],
        },
        {
            id: 'm_core',
            name: 'Core Loop',
            goal: 'Deliver the main flow.',
            tasks: [],
        },
    ],
    globalQualityGates: [
        { id: 'g1', title: 'All P0 screens implemented', category: 'functional', required: true },
    ],
    architecture: ['SPA with serverless API'],
    risks: [{ description: 'API rate limits', mitigation: 'Cache responses' }],
};

const LEGACY_MARKDOWN = `# Implementation Plan

### Milestone 1: Foundation (Week 1)
**Goal:** Set up the project.
**Key Deliverables:**
- [ ] Initialize repository
`;

const LEGACY_PROMPT_PACK = `### 1. Implement the foundation repository setup
**Category:** UI Implementation
**Prompt:**
\`\`\`
# Task
Set up the repository foundation and initialize the project.
\`\`\`
**Expected Output:** A working scaffold.
`;

describe('ImplementationPlanRenderer (consolidated view)', () => {
    it('renders the header and tabbed consolidated view for a native plan', () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        // Tabs
        expect(screen.getByRole('button', { name: /^Build Brief$/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Roadmap/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Prompts/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Validation/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Coverage/ })).toBeInTheDocument();
        // Header: readiness, scope counts, primary CTA.
        expect(screen.getByText('Ready to build')).toBeInTheDocument();
        expect(screen.getByText(/2 milestones · 1 task · 1 prompt pack · 2 quality gates/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Copy next prompt/ })).toBeInTheDocument();
        // Overview content: strategy, stack, risks with handling.
        expect(screen.getByText('Walking skeleton first.')).toBeInTheDocument();
        expect(screen.getByText('React + Vite')).toBeInTheDocument();
        expect(screen.getByText('API rate limits')).toBeInTheDocument();
        expect(screen.getByText(/Cache responses/)).toBeInTheDocument();
        // Critical path resolves milestone names into clickable steps.
        expect(screen.getAllByText('Project Setup').length).toBeGreaterThan(0);
    });

    it('shows milestone detail with tasks, gates, validation commands, and Done when', () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        fireEvent.click(screen.getByRole('button', { name: /Roadmap/ }));
        // First milestone is expanded by default.
        expect(screen.getByText('Initialize Vite app')).toBeInTheDocument();
        // Appears on the gate card and in the prompt pack's "Validated by" line.
        expect(screen.getAllByText('Lint passes clean').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/npm run lint/).length).toBeGreaterThan(0);
        expect(screen.getByText('Done when')).toBeInTheDocument();
        expect(screen.getByText('CI green on main')).toBeInTheDocument();
        expect(screen.getByText(/Landing Page/)).toBeInTheDocument();
        // Plan tasks are labeled as planned until converted.
        expect(screen.getByText(/Planned steps — use Convert to tasks/)).toBeInTheDocument();
    });

    it('opens the exact milestone selected from a downstream update plan', () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} initialMilestoneId="m_setup" />);
        expect(screen.getByText('Initialize Vite app')).toBeInTheDocument();
        expect(screen.getByText('Done when')).toBeInTheDocument();
    });

    it('copies the prompt pack body via the clipboard', async () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        fireEvent.click(screen.getByRole('button', { name: /Prompts/ }));
        const copyButtons = screen.getAllByRole('button', { name: /Copy Prompt/ });
        fireEvent.click(copyButtons[0]);
        await vi.waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenCalled();
        });
        const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
        expect(copied).toContain('# Prompt: Scaffold');
        expect(copied).toContain('chore: scaffold project');
    });

    it('marks every pack copied after "Copy all prompt packs" so next-prompt advances', async () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        fireEvent.click(screen.getByRole('button', { name: /Prompts/ }));
        fireEvent.click(screen.getAllByRole('button', { name: /Copy all prompt packs/ })[0]);
        await vi.waitFor(() => {
            // The only pack is now copied → the header CTA flips off "next".
            expect(screen.getByText(/All prompt packs copied/)).toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: /Copy next prompt/ })).not.toBeInTheDocument();
    });

    it('shows gates as Not run by default — no assumed passes', () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        fireEvent.click(screen.getByRole('button', { name: /Validation/ }));
        expect(screen.getByText('All P0 screens implemented')).toBeInTheDocument();
        expect(screen.getByText('Plan-wide gate')).toBeInTheDocument();
        // Milestone attribution + "Blocks" chip both carry the milestone label.
        expect(screen.getAllByText(/M1 · Project Setup/).length).toBeGreaterThan(0);
        // Every gate defaults to Not run (status selects, one per gate).
        const statusSelects = screen.getAllByRole('combobox');
        expect(statusSelects).toHaveLength(2);
        statusSelects.forEach(s => expect(s).toHaveValue('not_run'));
        // Summary reflects honest counts.
        expect(screen.getByText('2 Not run')).toBeInTheDocument();
    });

    it('records a gate outcome via the status select (session fallback)', () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        fireEvent.click(screen.getByRole('button', { name: /Validation/ }));
        const select = screen.getAllByRole('combobox')[0];
        fireEvent.change(select, { target: { value: 'passed' } });
        expect(screen.getByText('1 Passed')).toBeInTheDocument();
    });

    it('renders the coverage matrix with explicit cell states', () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        fireEvent.click(screen.getByRole('button', { name: /Coverage/ }));
        // Desktop table + mobile cards both render (visibility is CSS-only in
        // jsdom), so covered items appear at least once.
        expect(screen.getAllByText(/Landing Page/).length).toBeGreaterThan(0);
        // The second milestone has no links → explicit gap chips, no dashes.
        expect(screen.getAllByText('None linked').length).toBeGreaterThan(0);
        // Components are never linked in this plan → honest Not tracked.
        expect(screen.getAllByText('Not tracked').length).toBeGreaterThan(0);
        // Change impact panel scopes upstream changes.
        expect(screen.getByText(/Change Impact/)).toBeInTheDocument();
        expect(screen.getAllByText(/PRD changes/).length).toBeGreaterThan(0);
    });

    it('adapts a legacy markdown plan + legacy prompt_pack into the consolidated view', () => {
        render(
            <ImplementationPlanRenderer
                content={LEGACY_MARKDOWN}
                promptPackContent={LEGACY_PROMPT_PACK}
            />,
        );
        // Legacy adaptation is flagged for review, never blocked.
        expect(screen.getByText('Needs review')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Prompts/ }));
        // Appears in the recommended-order list and on the pack card.
        expect(screen.getAllByText('Implement the foundation repository setup').length).toBeGreaterThan(0);
    });

    it('falls back to plain markdown when content has no milestones or fence', () => {
        render(<ImplementationPlanRenderer content={'Just some prose about the build.'} />);
        expect(screen.getByText(/Just some prose/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Coverage/ })).not.toBeInTheDocument();
    });

    it('keeps Convert to Tasks reachable on the legacy fallback path', () => {
        const onConvert = vi.fn();
        render(
            <ImplementationPlanRenderer
                content={'Just some prose about the build.'}
                onConvertToTasks={onConvert}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Convert to Tasks/ }));
        expect(onConvert).toHaveBeenCalled();
    });

    it('does not crash on malformed fence JSON', () => {
        const malformed = '# Plan\n\n```json synapse-plan\n{ not valid json\n```\n';
        render(<ImplementationPlanRenderer content={malformed} />);
        // Falls through to plain markdown rendering of the body.
        expect(screen.queryByRole('button', { name: /Coverage/ })).not.toBeInTheDocument();
    });
});
