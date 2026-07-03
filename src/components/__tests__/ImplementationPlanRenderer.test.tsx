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
    ],
    globalQualityGates: [
        { id: 'g1', title: 'All P0 screens implemented', category: 'functional', required: true },
    ],
    architecture: ['SPA with serverless API'],
    risks: [{ description: 'API rate limits' }],
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
    it('renders the tabbed consolidated view for a native plan', () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        // Tabs
        expect(screen.getByRole('button', { name: /^Overview$/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Milestones/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Prompt Packs/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Quality Gates/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Traceability/ })).toBeInTheDocument();
        // Overview content
        expect(screen.getByText('Ready to build')).toBeInTheDocument();
        expect(screen.getByText('Walking skeleton first.')).toBeInTheDocument();
        expect(screen.getByText('React + Vite')).toBeInTheDocument();
        expect(screen.getByText(/Project Setup → Core Loop/)).toBeInTheDocument();
    });

    it('shows milestone detail with tasks, gates, validation commands, and DoD', () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        fireEvent.click(screen.getByRole('button', { name: /Milestones/ }));
        // First milestone is expanded by default.
        expect(screen.getByText('Initialize Vite app')).toBeInTheDocument();
        expect(screen.getByText('Lint passes clean')).toBeInTheDocument();
        expect(screen.getByText(/npm run lint/)).toBeInTheDocument();
        expect(screen.getByText('CI green on main')).toBeInTheDocument();
        expect(screen.getByText(/Landing Page/)).toBeInTheDocument();
    });

    it('copies the prompt pack body via the clipboard', async () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        fireEvent.click(screen.getByRole('button', { name: /Prompt Packs/ }));
        const copyButtons = screen.getAllByRole('button', { name: /Copy Prompt/ });
        fireEvent.click(copyButtons[0]);
        await vi.waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenCalled();
        });
        const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
        expect(copied).toContain('# Prompt: Scaffold');
        expect(copied).toContain('chore: scaffold project');
    });

    it('groups quality gates by category with global/milestone attribution', () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        fireEvent.click(screen.getByRole('button', { name: /Quality Gates/ }));
        expect(screen.getByText('All P0 screens implemented')).toBeInTheDocument();
        expect(screen.getByText('Global gate')).toBeInTheDocument();
        expect(screen.getByText('Milestone: Project Setup')).toBeInTheDocument();
    });

    it('renders traceability rows from milestone links', () => {
        render(<ImplementationPlanRenderer content={fencePlan(NATIVE_PLAN)} />);
        fireEvent.click(screen.getByRole('button', { name: /Traceability/ }));
        // Desktop table + mobile cards both render (visibility is CSS-only in
        // jsdom), so the milestone title appears at least once.
        expect(screen.getAllByText('Project Setup').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Landing Page/).length).toBeGreaterThan(0);
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
        fireEvent.click(screen.getByRole('button', { name: /Prompt Packs/ }));
        expect(screen.getByText('Implement the foundation repository setup')).toBeInTheDocument();
    });

    it('falls back to plain markdown when content has no milestones or fence', () => {
        render(<ImplementationPlanRenderer content={'Just some prose about the build.'} />);
        expect(screen.getByText(/Just some prose/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Traceability/ })).not.toBeInTheDocument();
    });

    it('does not crash on malformed fence JSON', () => {
        const malformed = '# Plan\n\n```json synapse-plan\n{ not valid json\n```\n';
        render(<ImplementationPlanRenderer content={malformed} />);
        // Falls through to plain markdown rendering of the body.
        expect(screen.queryByRole('button', { name: /Traceability/ })).not.toBeInTheDocument();
    });
});
