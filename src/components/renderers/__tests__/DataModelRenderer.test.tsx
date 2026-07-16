import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { DataModelRenderer } from '../DataModelRenderer';
import type { DataModelContent } from '../../../types';

// jsdom doesn't implement scrollIntoView; the outline/graph interactions call it.
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

/** Stub `window.matchMedia` so `useIsMobile()` reports the given viewport. */
function stubViewport(isMobile: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: isMobile,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

const twoEntityModel: DataModelContent = {
    entities: [
        {
            name: 'User',
            description: 'Account holder.',
            userFacing: true,
            mutability: 'mutable',
            fields: [
                { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                { name: 'email', type: 'String', required: true, description: 'Login email' },
            ],
            relationships: [{ type: 'has_many', target: 'Order' }],
        },
        {
            name: 'Order',
            description: 'A purchase.',
            userFacing: true,
            mutability: 'mutable',
            fields: [
                { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                { name: 'total_cents', type: 'Integer', required: true, description: 'Order total' },
            ],
            relationships: [{ type: 'belongs_to', target: 'User' }],
        },
    ],
    apiEndpoints: [],
};

function renderModel(content: DataModelContent, props: Partial<{
    staleness: 'current' | 'possibly_outdated' | 'outdated';
    initialEntityName: string;
}> = {}) {
    return render(<DataModelRenderer content={JSON.stringify(content)} {...props} />);
}

const modelWithApi: DataModelContent = {
    entities: twoEntityModel.entities,
    apiEndpoints: [
        { method: 'GET', path: '/users', description: 'List users', entity: 'User' },
        { method: 'POST', path: '/users', description: 'Create user', entity: 'User' },
        { method: 'GET', path: '/orders', description: 'List orders', entity: 'Order' },
        { method: 'POST', path: '/orders', description: 'Create order', entity: 'Order' },
        { method: 'DELETE', path: '/orders/:id', description: 'Delete order', entity: 'Order' },
    ],
};

describe('DataModelRenderer — overview header', () => {
    it('renders the database icon and title on a single header row', () => {
        const { getByLabelText } = renderModel(twoEntityModel);
        const overview = getByLabelText('Data model overview');
        // Title renders as an <h2> heading next to the icon.
        expect(within(overview).getByRole('heading', { name: 'Data Model' })).toBeInTheDocument();
    });

    it('does not repeat PRD provenance or a count subtitle inside the card', () => {
        // Provenance ("From PRD Version N") lives at the page level, not the card.
        const { getByLabelText } = renderModel(modelWithApi, { staleness: 'current' });
        const overview = getByLabelText('Data model overview');
        expect(overview).not.toHaveTextContent('From PRD');
        // The old "6 entities · 5 API endpoints" subtitle is gone — the entity
        // count now only appears as a metric tile value, not a subtitle string.
        expect(within(overview).queryByText(/\d+ entities/)).toBeNull();
        expect(within(overview).queryByText(/API endpoints/)).toBeNull(); // lowercase subtitle form
    });

    it('keeps the freshness ("Current") pill when staleness is provided', () => {
        const { getByLabelText } = renderModel(twoEntityModel, { staleness: 'current' });
        const overview = getByLabelText('Data model overview');
        expect(overview).toHaveTextContent('Current');
    });

    it('renders six metric cards, including a real API-endpoint count', () => {
        const { getByLabelText } = renderModel(modelWithApi);
        const overview = getByLabelText('Data model overview');
        const metrics = within(overview).getByRole('list', { name: 'Data model metrics' });
        expect(within(metrics).getAllByRole('listitem')).toHaveLength(6);
        // API Endpoints is a first-class tile driven by the artifact's real count.
        expect(within(metrics).getByText('API Endpoints')).toBeInTheDocument();
        expect(within(metrics).getByText('5')).toBeInTheDocument();
        // The other five metric labels are all present too.
        expect(within(metrics).getByText('Entities')).toBeInTheDocument();
        expect(within(metrics).getByText('Relationship')).toBeInTheDocument();
        expect(within(metrics).getByText('Constraints')).toBeInTheDocument();
        expect(within(metrics).getByText('Indexes')).toBeInTheDocument();
        expect(within(metrics).getByText('Entities with PII')).toBeInTheDocument();
    });
});

describe('DataModelRenderer — ER diagram', () => {
    it('renders directional edges with verb + cardinality labels', () => {
        const { getByText } = renderModel(twoEntityModel);
        expect(getByText('Entity relationships')).toBeInTheDocument();
        expect(getByText('has many')).toBeInTheDocument();
        expect(getByText('1 → many')).toBeInTheDocument();
    });

    it('shows an empty state when there are no relationships', () => {
        const standalone: DataModelContent = {
            entities: [
                { name: 'Setting', description: 'A config value.', userFacing: true, fields: [{ name: 'id', type: 'UUID', required: true, description: 'pk' }], relationships: [] },
                { name: 'Flag', description: 'A toggle.', userFacing: true, fields: [{ name: 'id', type: 'UUID', required: true, description: 'pk' }], relationships: [] },
            ],
            apiEndpoints: [],
        };
        const { getByText } = renderModel(standalone);
        expect(getByText(/No relationships are defined/i)).toBeInTheDocument();
    });
});

describe('DataModelRenderer — collapsible entity cards', () => {
    it('collapses multi-entity cards by default and expands on click', () => {
        const { container, queryByText, getByText } = renderModel(twoEntityModel);
        // total_cents lives only inside the (collapsed) Order card body.
        expect(queryByText('total_cents')).toBeNull();

        const orderCard = container.querySelector('#data-model-entity-order');
        expect(orderCard).toBeTruthy();
        const header = orderCard!.querySelector('button');
        fireEvent.click(header!);

        expect(getByText('total_cents')).toBeInTheDocument();
    });

    it('expands a single-entity model by default', () => {
        const single: DataModelContent = {
            entities: [{
                name: 'Session',
                description: 'A login session.',
                userFacing: false,
                fields: [
                    { name: 'id', type: 'UUID', required: true, description: 'pk' },
                    { name: 'token', type: 'String', required: true, description: 'Sensitive session token' },
                ],
                relationships: [],
            }],
            apiEndpoints: [],
        };
        const { getByText } = renderModel(single);
        // Field from the expanded body is visible without interaction.
        expect(getByText('token')).toBeInTheDocument();
    });

    it('opens and scrolls to an exact update-plan entity target', () => {
        const scroll = vi.mocked(Element.prototype.scrollIntoView);
        scroll.mockClear();
        const { getByText } = renderModel(twoEntityModel, { initialEntityName: 'Order' });

        expect(getByText('total_cents')).toBeInTheDocument();
        expect(scroll).toHaveBeenCalled();
    });
});

describe('DataModelRenderer — inspector rows + categories', () => {
    it('renders relationship / constraint / privacy inspector rows when expanded', () => {
        const model: DataModelContent = {
            entities: [{
                name: 'MoodSnapshot',
                description: 'Captures a mood.',
                userFacing: true,
                mutability: 'mostly_immutable',
                fields: [{ name: 'joy_score', type: 'Float', required: true, description: 'Joy 0-1' }],
                relationships: [{ type: 'has_many', target: 'Playlist', description: 'derived' }],
                constraints: ['joy_score must be between 0 and 1'],
                privacyRules: ['raw_input must be redacted'],
                indexes: ['idx_joy on (joy_score)'],
            }],
            apiEndpoints: [],
        };
        const { getByText, container } = renderModel(model);
        // Single entity → expanded, inspector sections present.
        expect(getByText('Relationships')).toBeInTheDocument();
        expect(getByText('joy_score must be between 0 and 1')).toBeInTheDocument();
        expect(getByText('raw_input must be redacted')).toBeInTheDocument();
        // Category badge derived (mostly_immutable + user-facing → Generated Outputs).
        expect(container).toHaveTextContent('Generated Outputs');
    });

    it('offers a group-by-category control for larger, mixed-category models', () => {
        const model: DataModelContent = {
            entities: [
                { name: 'User', description: '', userFacing: true, mutability: 'mutable', fields: [{ name: 'id', type: 'UUID', required: true, description: '' }], relationships: [] },
                { name: 'AuditLog', description: '', userFacing: false, fields: [{ name: 'id', type: 'UUID', required: true, description: '' }], relationships: [] },
                { name: 'Receipt', description: '', userFacing: true, mutability: 'immutable', fields: [{ name: 'id', type: 'UUID', required: true, description: '' }], relationships: [] },
                { name: 'WebhookDelivery', description: '', userFacing: true, fields: [{ name: 'id', type: 'UUID', required: true, description: '' }], relationships: [] },
            ],
            apiEndpoints: [],
        };
        const { getByRole } = renderModel(model);
        expect(getByRole('button', { name: /Group by category/i })).toBeInTheDocument();
    });
});

// A mixed-category model that groups by default (>= 4 entities, >= 2 categories).
const groupedModel: DataModelContent = {
    entities: [
        {
            name: 'KnowledgeNode',
            description: 'A structured, hierarchical concept.',
            userFacing: true,
            mutability: 'mutable',
            fields: [
                { name: 'id', type: 'UUID', required: true, description: 'pk' },
                { name: 'title', type: 'String', required: true, description: 'Concept title' },
            ],
            relationships: [{ type: 'has_many', target: 'Flashcard' }],
            indexes: ['idx_title on (title)'],
        },
        {
            name: 'Flashcard',
            description: 'An active recall study card.',
            userFacing: true,
            mutability: 'mutable',
            fields: [{ name: 'id', type: 'UUID', required: true, description: 'pk' }],
            relationships: [{ type: 'belongs_to', target: 'KnowledgeNode' }],
        },
        {
            // mostly_immutable + user-facing → Generated Outputs; carries PII.
            name: 'InfographicSource',
            description: 'Represents the uploaded visual asset.',
            userFacing: true,
            mutability: 'mostly_immutable',
            fields: [{ name: 'id', type: 'UUID', required: true, description: 'pk' }],
            relationships: [],
            privacyRules: ['uploaded_image must be access-controlled'],
            indexes: ['idx_source on (id)'],
        },
        {
            name: 'AuditLog',
            description: 'System event log.',
            userFacing: false,
            fields: [{ name: 'id', type: 'UUID', required: true, description: 'pk' }],
            relationships: [],
        },
    ],
    apiEndpoints: [],
};

/** The Entities list section (excludes the ER diagram, which also shows category badges). */
function entitiesSection(getByRole: ReturnType<typeof renderModel>['getByRole']): HTMLElement {
    const section = getByRole('button', { name: /Group by category/i }).closest('section');
    if (!section) throw new Error('entities section not found');
    return section as HTMLElement;
}

describe('DataModelRenderer — grouped category headers (no redundant label)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('shows each category name once — in the group header, not repeated as plain text', () => {
        const result = renderModel(groupedModel);
        const section = entitiesSection(result.getByRole);
        // Grouped by default: the header pill is the only "Core Product Data" in
        // the list — the old duplicate plain-text label is gone and cards omit it.
        expect(within(section).getAllByText('Core Product Data')).toHaveLength(1);
    });

    it('does not repeat the category chip inside entity cards in grouped mode', () => {
        const { container } = renderModel(groupedModel);
        const card = container.querySelector('#data-model-entity-knowledgenode') as HTMLElement;
        expect(card).toBeTruthy();
        expect(within(card).queryByText('Core Product Data')).toBeNull();
    });

    it('restores the per-card category chip when grouping is turned off', () => {
        const result = renderModel(groupedModel);
        fireEvent.click(result.getByRole('button', { name: /Group by category/i }));

        const section = entitiesSection(result.getByRole);
        // Ungrouped: no group header, so each of the two Core entities shows its
        // own chip to preserve context.
        expect(within(section).getAllByText('Core Product Data')).toHaveLength(2);

        const card = result.container.querySelector('#data-model-entity-knowledgenode') as HTMLElement;
        expect(within(card).getByText('Core Product Data')).toBeInTheDocument();
    });
});

describe('DataModelRenderer — mobile entity-card chip density', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('caps chips on a collapsed mobile card and keeps Contains PII visible', () => {
        stubViewport(true);
        const { container } = renderModel(groupedModel);
        const card = container.querySelector('#data-model-entity-infographicsource') as HTMLElement;
        expect(card).toBeTruthy();

        // PII stays prominent; lower-priority chips collapse into "+N more".
        expect(within(card).getByText('Contains PII')).toBeInTheDocument();
        expect(within(card).getByText('+2 more')).toBeInTheDocument();
        expect(within(card).queryByText('mostly immutable')).toBeNull();
        // The "Indexed" attribute chip is hidden (the lowercase "indexes" count
        // label is a different string and unaffected).
        expect(within(card).queryByText('Indexed')).toBeNull();
    });

    it('drops the low-value "No PII" chip on a collapsed mobile card', () => {
        stubViewport(true);
        const { container } = renderModel(groupedModel);
        // KnowledgeNode: User-facing + mutable + Indexed = 3 chips, No PII dropped.
        const card = container.querySelector('#data-model-entity-knowledgenode') as HTMLElement;
        expect(within(card).queryByText('No PII')).toBeNull();
        expect(within(card).queryByText('+1 more')).toBeNull();
        expect(within(card).getByText('User-facing')).toBeInTheDocument();
        expect(within(card).getByText('Indexed')).toBeInTheDocument();
    });

    it('shows every chip on desktop (no "+N more" truncation)', () => {
        stubViewport(false);
        const { container } = renderModel(groupedModel);
        const card = container.querySelector('#data-model-entity-infographicsource') as HTMLElement;
        expect(within(card).getByText('Contains PII')).toBeInTheDocument();
        expect(within(card).getByText('mostly immutable')).toBeInTheDocument();
        expect(within(card).getByText('Indexed')).toBeInTheDocument();
        expect(within(card).queryByText(/\+\d+ more/)).toBeNull();
    });

    it('aligns the entity title so long names truncate without pushing the chevron', () => {
        const { container } = renderModel(groupedModel);
        const title = within(container.querySelector('#data-model-entity-knowledgenode') as HTMLElement)
            .getByText('KnowledgeNode');
        expect(title.className).toContain('truncate');
        expect(title.className).toContain('min-w-0');
    });
});
