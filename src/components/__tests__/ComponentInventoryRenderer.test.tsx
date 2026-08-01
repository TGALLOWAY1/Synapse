import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentInventoryRenderer } from '../renderers/ComponentInventoryRenderer';
import { structuredArtifactToMarkdown } from '../../lib/services/coreArtifactService';
import type { ComponentJoinScreen } from '../../lib/componentExperience';
import type { ComponentInventoryContent } from '../../types';

// W4 (docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md): component_inventory used to
// have no renderer at all — it fed every mockup and could not be inspected. The
// renderer had to land BEFORE the artifact was unhidden, so these tests cover
// what a reviewer must be able to see: props, accessibility, screen
// back-references, the advisory contradictions, and graceful legacy fallback.

const inventory: ComponentInventoryContent = {
    categories: [{
        name: 'Data Display',
        components: [{
            name: 'CaseListTable',
            purpose: 'Sortable table of open cases.',
            complexity: 'complex',
            usedIn: ['Case Triage', 'Nowhere Screen'],
            props: [
                { name: 'rows', type: 'Case[]', required: true, description: 'Cases to render.' },
                { name: 'onSort', type: 'function' },
            ],
            accessibility: { keyboard: true, screenReader: true, aria: ['aria-sort'] },
            notes: 'Virtualize above 200 rows.',
        }],
    }, {
        name: 'Actions',
        components: [{
            name: 'AssignOwnerButton',
            purpose: 'Assigns a case owner.',
            complexity: 'simple',
        }],
    }],
};

const markdown = structuredArtifactToMarkdown('component_inventory', inventory);

const screens: ComponentJoinScreen[] = [
    { id: 'case-triage', slug: 'case-triage', name: 'Case Triage', citedComponents: ['CaseListTable', 'GhostWidget'] },
];

describe('ComponentInventoryRenderer', () => {
    it('renders component names, categories, props and accessibility', () => {
        render(<ComponentInventoryRenderer content={markdown} />);

        expect(screen.getByText('CaseListTable')).toBeTruthy();
        expect(screen.getByText('AssignOwnerButton')).toBeTruthy();
        expect(screen.getByText('Data Display')).toBeTruthy();
        expect(screen.getByText('Sortable table of open cases.')).toBeTruthy();
        expect(screen.getByText('rows')).toBeTruthy();
        expect(screen.getAllByText('required').length).toBeGreaterThan(0);
        expect(screen.getByText('Keyboard')).toBeTruthy();
        expect(screen.getByText('aria-sort')).toBeTruthy();
        expect(screen.getByText('Virtualize above 200 rows.')).toBeTruthy();
    });

    it('shows "Not specified" instead of inventing an accessibility contract', () => {
        // AssignOwnerButton has no accessibility block and no props — legacy
        // artifacts look exactly like this and must still render.
        render(<ComponentInventoryRenderer content={markdown} />);
        expect(screen.getByText(/no recorded accessibility contract/i)).toBeTruthy();
        expect(screen.getAllByText('Not specified.').length).toBeGreaterThan(0);
    });

    it('shows which screens reference each component and navigates by slug', () => {
        const onNavigateToScreen = vi.fn();
        render(
            <ComponentInventoryRenderer
                content={markdown}
                screens={screens}
                onNavigateToScreen={onNavigateToScreen}
            />,
        );

        const chip = screen.getByRole('button', { name: /Case Triage/ });
        chip.click();
        expect(onNavigateToScreen).toHaveBeenCalledWith('case-triage');
    });

    it('labels a usedIn name that matches no screen instead of dropping it', () => {
        render(<ComponentInventoryRenderer content={markdown} screens={screens} />);
        expect(screen.getByText(/Nowhere Screen · no matching screen/)).toBeTruthy();
    });

    it('surfaces a screen citing a missing component as an advisory review note', () => {
        render(<ComponentInventoryRenderer content={markdown} screens={screens} />);
        // Review-severity advisories open the panel by default.
        expect(screen.getByText(/1 screen reference may benefit from review/)).toBeTruthy();
        expect(screen.getByText(/GhostWidget/)).toBeTruthy();
        expect(screen.getByText(/advisory only/i)).toBeTruthy();
    });

    it('labels screen references as derived rather than as a stored link', () => {
        render(<ComponentInventoryRenderer content={markdown} screens={screens} />);
        expect(screen.getAllByText(/derived/i).length).toBeGreaterThan(0);
        expect(screen.getByText(/there is no stored link/i)).toBeTruthy();
    });

    it('renders no back-reference claims when no screens are supplied', () => {
        render(<ComponentInventoryRenderer content={markdown} />);
        // Without a screen inventory there is no evidence — fall back to the
        // component's own raw usedIn names, never "not referenced".
        expect(screen.queryByText(/No screen references this component/)).toBeNull();
        expect(screen.getByText('Case Triage')).toBeTruthy();
    });

    it('falls back to plain markdown for content that is not a component inventory', () => {
        const legacy = '# Notes\n\nJust some free-form prose about components.';
        const { container } = render(<ComponentInventoryRenderer content={legacy} />);
        expect(container.textContent).toContain('Just some free-form prose about components.');
        // No structured header means the bespoke layout did not claim the content.
        expect(screen.queryByText('Reusable components')).toBeNull();
    });
});
