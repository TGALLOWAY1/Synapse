import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScreenComponentsSection } from '../experience/ScreenComponentsSection';
import { structuredArtifactToMarkdown } from '../../lib/services/coreArtifactService';
import type { ComponentJoinScreen } from '../../lib/componentExperience';
import type { ComponentInventoryContent } from '../../types';

// W4: the Components section is the ONLY surface where the component_inventory
// slot's status and Retry are reachable (the artifact has no sidebar row). That
// affordance is what makes it legitimate for the slot to gate `assetsReady` and
// to auto-resume — so "an errored component slot is user-visible and retryable"
// is a load-bearing property, not cosmetics.

const inventory: ComponentInventoryContent = {
    categories: [{
        name: 'Data Display',
        components: [{
            name: 'CaseListTable',
            purpose: 'Sortable table of open cases.',
            complexity: 'complex',
            usedIn: ['Case Triage'],
        }],
    }],
};

const markdown = structuredArtifactToMarkdown('component_inventory', inventory);
const screens: ComponentJoinScreen[] = [
    { id: 'case-triage', slug: 'case-triage', name: 'Case Triage', citedComponents: ['CaseListTable'] },
];

describe('ScreenComponentsSection', () => {
    it('renders nothing when the inventory was never generated and nothing is in flight', () => {
        const { container } = render(
            <ScreenComponentsSection screens={screens} status="idle" />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('summarizes the inventory in a collapsed header', () => {
        render(<ScreenComponentsSection content={markdown} screens={screens} status="done" />);
        expect(screen.getByText('Components')).toBeTruthy();
        expect(screen.getByText(/1 component · 1 referenced by a screen/)).toBeTruthy();
        // Collapsed by default — the screens stay the focus.
        expect(screen.queryByText('CaseListTable')).toBeNull();
    });

    it('expands to the structured renderer', () => {
        render(<ScreenComponentsSection content={markdown} screens={screens} status="done" />);
        fireEvent.click(screen.getByRole('button', { name: /Components/ }));
        expect(screen.getByText('CaseListTable')).toBeTruthy();
    });

    it('surfaces an errored slot and offers Retry', () => {
        const onRetry = vi.fn();
        render(
            <ScreenComponentsSection
                screens={screens}
                status="error"
                errorMessage="Gemini quota exhausted"
                onRetry={onRetry}
            />,
        );
        expect(screen.getByText(/Component inventory generation failed/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Components/ }));
        expect(screen.getByText('Gemini quota exhausted')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows the failure without a Retry action when the project cannot generate', () => {
        // Demo / keyless projects: honest status, no dead button.
        render(<ScreenComponentsSection screens={screens} status="error" />);
        expect(screen.getByText(/Component inventory generation failed/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Components/ }));
        expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    });

    it('shows an in-flight slot even before any content exists', () => {
        render(<ScreenComponentsSection screens={screens} status="generating" />);
        expect(screen.getByText(/Generating the component inventory/)).toBeTruthy();
    });
});
