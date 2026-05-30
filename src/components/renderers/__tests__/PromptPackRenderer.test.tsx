import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PromptPackRenderer } from '../PromptPackRenderer';

// Two-prompt pack exercising the parser: title, target tool/reason (now
// intentionally NOT rendered), category, and a fenced prompt body.
const CONTENT = `Intro preamble line.

### 1. Geofence Configuration View
**Target Tool:** Cursor
**Reason:** Cursor applies multi-file code changes directly.
**Category:** UI Implementation
\`\`\`
# Task
Implement the Geofence Configuration screen.
\`\`\`

### 2. Playback State Dashboard
**Target Tool:** ChatGPT
**Category:** State Management
\`\`\`
# Task
Build the playback dashboard.
\`\`\`
`;

describe('PromptPackRenderer', () => {
    it('renders the first prompt full-width without the target-tool callout', () => {
        render(<PromptPackRenderer content={CONTENT} />);

        // Selected prompt title + body show.
        expect(screen.getByRole('heading', { name: 'Geofence Configuration View' })).toBeInTheDocument();
        expect(screen.getByText(/Implement the Geofence Configuration screen/)).toBeInTheDocument();

        // Category chip survives.
        const main = document.querySelector('.flex-1') as HTMLElement;
        expect(within(main).getByText('UI Implementation')).toBeInTheDocument();

        // The useless tool callout is gone.
        expect(screen.queryByText('Cursor')).not.toBeInTheDocument();
        expect(screen.queryByText(/Why this target/i)).not.toBeInTheDocument();
    });

    it('lists every prompt in the sidebar and switches the visible prompt on select', () => {
        render(<PromptPackRenderer content={CONTENT} />);

        // Desktop rail header.
        const rail = screen.getByRole('complementary', { name: 'Prompt navigation' });
        expect(within(rail).getByText('Prompts')).toBeInTheDocument();

        // Both prompts are reachable from the rail.
        expect(within(rail).getByRole('button', { name: /Geofence Configuration View/ })).toBeInTheDocument();
        const second = within(rail).getByRole('button', { name: /Playback State Dashboard/ });
        fireEvent.click(second);

        expect(screen.getByRole('heading', { name: 'Playback State Dashboard' })).toBeInTheDocument();
        expect(screen.getByText(/Build the playback dashboard/)).toBeInTheDocument();
    });

    it('falls back to raw markdown when there are no prompt headings', () => {
        const { container } = render(<PromptPackRenderer content={'# Just markdown\n\nNo prompts here.'} />);
        expect(container.querySelector('h1')).toHaveTextContent('Just markdown');
    });
});
