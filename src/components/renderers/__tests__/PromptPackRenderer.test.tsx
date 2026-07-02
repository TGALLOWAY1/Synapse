import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PromptPackRenderer } from '../PromptPackRenderer';

// Two-prompt pack exercising the parser: title, category, a fenced prompt
// body, and the trailing Expected Output summary. Prompts are agent-agnostic —
// no target-tool / recommendation context is parsed or shown.
const CONTENT = `Intro preamble line.

### 1. Geofence Configuration View
**Category:** UI Implementation
\`\`\`
# Task
Implement the Geofence Configuration screen.

## Features In Scope
- f1 — Geofence editor
- f2 — Radius slider
\`\`\`
**Expected Output:** A working geofence configuration screen.

### 2. Playback State Dashboard
**Category:** State Management
\`\`\`
# Task
Build the playback dashboard.
\`\`\`
`;

describe('PromptPackRenderer', () => {
    it('renders every prompt in a document with the collapsible nav on top', () => {
        render(<PromptPackRenderer content={CONTENT} />);

        // Both prompt cards are rendered (document layout — not one-at-a-time).
        expect(screen.getByRole('heading', { name: 'Geofence Configuration View' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Playback State Dashboard' })).toBeInTheDocument();
        expect(screen.getByText(/Implement the Geofence Configuration screen/)).toBeInTheDocument();
        expect(screen.getByText(/Build the playback dashboard/)).toBeInTheDocument();

        // Collapsible navigator header: "Prompts (2)" with a row per prompt.
        const nav = screen.getByRole('button', { name: /Prompts/ });
        expect(within(nav).getByText('(2)')).toBeInTheDocument();
    });

    it('surfaces only the Expected Output supporting context', () => {
        render(<PromptPackRenderer content={CONTENT} />);

        expect(screen.getByText('Expected Output')).toBeInTheDocument();
        expect(screen.getByText(/A working geofence configuration screen/)).toBeInTheDocument();

        // Agent-agnostic: no target-tool / intent / dependency context is shown.
        expect(screen.queryByText('User Intent')).not.toBeInTheDocument();
        expect(screen.queryByText('Dependencies')).not.toBeInTheDocument();
        expect(screen.queryByText('Key Implementation Areas')).not.toBeInTheDocument();
    });

    it('only exposes Copy Prompt by default and Edit when editing is enabled', () => {
        const { rerender } = render(<PromptPackRenderer content={CONTENT} />);
        // Read-only: copy only, no Edit.
        expect(screen.getAllByRole('button', { name: /Copy Prompt/ }).length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: /^Edit$/ })).not.toBeInTheDocument();

        rerender(<PromptPackRenderer content={CONTENT} onUpdateEdits={() => {}} />);
        expect(screen.getAllByRole('button', { name: /^Edit$/ }).length).toBeGreaterThan(0);
    });

    it('shows the generated date and the safe-to-regenerate callout', () => {
        render(<PromptPackRenderer content={CONTENT} generatedAt={Date.parse('2026-06-28T12:00:00Z')} versionNumber={2} />);
        expect(screen.getAllByText(/Generated Jun 2[78], 2026/).length).toBeGreaterThan(0);
        expect(screen.getByText(/Safe to regenerate/)).toBeInTheDocument();
        expect(screen.getByText(/creates Version 3/)).toBeInTheDocument();
    });

    it('falls back to raw markdown when there are no prompt headings', () => {
        const { container } = render(<PromptPackRenderer content={'# Just markdown\n\nNo prompts here.'} />);
        expect(container.querySelector('h1')).toHaveTextContent('Just markdown');
    });
});
