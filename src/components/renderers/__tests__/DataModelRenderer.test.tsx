import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { DataModelRenderer } from '../DataModelRenderer';
import { dataModelMemberAnchorId } from '../dataModel/dataModelNavigation';
import { dataModelToMarkdown, parseDataModelMarkdown } from '../../../lib/services/dataModelMarkdown';
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
    staleness: 'up_to_date' | 'needs_update' | 'update_recommended';
    initialEntityName: string;
    initialMemberName: string;
    initialMemberAspect: 'field' | 'relationship' | 'constraint' | 'data_expectation';
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
        const { getByLabelText } = renderModel(modelWithApi, { staleness: 'up_to_date' });
        const overview = getByLabelText('Data model overview');
        expect(overview).not.toHaveTextContent('From PRD');
        // The old "6 entities · 5 API endpoints" subtitle is gone — the entity
        // count now only appears as a metric tile value, not a subtitle string.
        expect(within(overview).queryByText(/\d+ entities/)).toBeNull();
        expect(within(overview).queryByText(/API endpoints/)).toBeNull(); // lowercase subtitle form
    });

    it('keeps the freshness ("Up to date") pill when status is provided', () => {
        const { getByLabelText } = renderModel(twoEntityModel, { staleness: 'up_to_date' });
        const overview = getByLabelText('Data model overview');
        expect(overview).toHaveTextContent('Up to date');
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

    it('focuses and visibly identifies an exact structured field target', () => {
        const { container } = renderModel(twoEntityModel, {
            initialEntityName: 'Order', initialMemberAspect: 'field', initialMemberName: 'total_cents',
        });

        const row = container.querySelector(`#${dataModelMemberAnchorId('Order', 'field', 'total_cents')}`);
        expect(row).toHaveAttribute('aria-current', 'true');
        expect(row).toHaveClass('bg-indigo-50', 'focus:ring-2');
        expect(row).toHaveFocus();
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it.each([
        ['relationship', 'RELATIONSHIP'],
        ['constraint', 'CONSTRAINT'],
        ['data_expectation', 'PRIVACY'],
    ] as const)('focuses the exact %s row only when its stable member identity exists', (aspect, calloutKind) => {
        const model: DataModelContent = {
            entities: [{
                name: 'Workspace', description: 'A workspace.', fields: [{ name: 'id', type: 'UUID', required: true, description: 'Primary key' }],
                relationships: [{ type: 'belongs_to', target: 'User', description: 'Owned by one user' }],
                constraints: ['A workspace name must be unique'],
                privacyRules: ['Workspace notes must be encrypted'],
            }], apiEndpoints: [],
        };
        const parsed = parseDataModelMarkdown(dataModelToMarkdown(model));
        const member = parsed?.entities[0].callouts.find(callout => callout.kind === calloutKind)?.text;
        expect(member).toBeTruthy();
        const { container } = renderModel(model, {
            initialEntityName: 'Workspace', initialMemberAspect: aspect, initialMemberName: member!,
        });

        const row = container.querySelector(`#${dataModelMemberAnchorId('Workspace', aspect, member!)}`);
        expect(row).toHaveAttribute('aria-current', 'true');
        expect(row).toHaveFocus();
        expect(row).toHaveClass('min-w-0');
        expect(row?.querySelector('p')).toHaveClass('break-words');
    });

    it('falls back conservatively to the entity when a legacy member identity is ambiguous', () => {
        const { container } = renderModel(twoEntityModel, {
            initialEntityName: 'Order', initialMemberAspect: 'field', initialMemberName: 'total',
        });

        const entity = container.querySelector('#data-model-entity-order');
        expect(entity).toHaveAttribute('aria-current', 'true');
        expect(entity).toHaveFocus();
        expect(container.querySelector(`#${dataModelMemberAnchorId('Order', 'field', 'total')}`)).toBeNull();
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
    return getByRole('region', { name: 'Entities' });
}

describe('DataModelRenderer — grouped category headers (no redundant label)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('shows each category name once — in the group header, not repeated as plain text', () => {
        const result = renderModel(groupedModel);
        const section = entitiesSection(result.getByRole);
        // Multi-category models always group: the header band is the only
        // "Core Product Data" in the list, and cards omit the redundant chip.
        expect(within(section).getAllByText('Core Product Data')).toHaveLength(1);
    });

    it('does not repeat the category chip inside entity cards in grouped mode', () => {
        const { container } = renderModel(groupedModel);
        const card = container.querySelector('#data-model-entity-knowledgenode') as HTMLElement;
        expect(card).toBeTruthy();
        expect(within(card).queryByText('Core Product Data')).toBeNull();
    });

    it('shows the per-card category chip for a single-category (ungrouped) model', () => {
        // twoEntityModel is all one category → no band, so each card shows its chip.
        const result = renderModel(twoEntityModel);
        const section = entitiesSection(result.getByRole);
        expect(within(section).getAllByText('Core Product Data')).toHaveLength(2);
    });
});

describe('DataModelRenderer — metadata footer pluralization', () => {
    const pluralModel: DataModelContent = {
        entities: [
            {
                name: 'Alpha',
                description: 'Singular metadata everywhere.',
                userFacing: true,
                mutability: 'mutable',
                fields: [{ name: 'id', type: 'UUID', required: true, description: 'pk' }],
                relationships: [{ type: 'has_many', target: 'Beta' }],
                constraints: ['id must be unique'],
                indexes: ['idx_alpha on (id)'],
                privacyRules: ['id must be redacted'],
            },
            {
                name: 'Beta',
                description: 'Plural fields.',
                userFacing: true,
                mutability: 'mutable',
                fields: [
                    { name: 'id', type: 'UUID', required: true, description: 'pk' },
                    { name: 'label', type: 'String', required: false, description: 'label' },
                ],
                relationships: [{ type: 'belongs_to', target: 'Alpha' }],
            },
        ],
        apiEndpoints: [],
    };

    it('uses singular labels for counts of one', () => {
        const { container } = renderModel(pluralModel);
        const alpha = container.querySelector('#data-model-entity-alpha') as HTMLElement;
        expect(within(alpha).getByText('1 field')).toBeInTheDocument();
        expect(within(alpha).getByText('1 relationship')).toBeInTheDocument();
        expect(within(alpha).getByText('1 constraint')).toBeInTheDocument();
        expect(within(alpha).getByText('1 privacy rule')).toBeInTheDocument();
        expect(within(alpha).getByText('1 index')).toBeInTheDocument();
    });

    it('uses plural labels for counts greater than one', () => {
        const { container } = renderModel(pluralModel);
        const beta = container.querySelector('#data-model-entity-beta') as HTMLElement;
        expect(within(beta).getByText('2 fields')).toBeInTheDocument();
    });
});

describe('DataModelRenderer — category header band', () => {
    it('renders each category once with its entity count', () => {
        const result = renderModel(groupedModel);
        const section = entitiesSection(result.getByRole);
        // Core Product Data holds KnowledgeNode + Flashcard → count of 2.
        const coreHeader = within(section).getByText('Core Product Data').closest('div');
        expect(coreHeader).toBeTruthy();
        expect(within(coreHeader as HTMLElement).getByText('2')).toBeInTheDocument();
    });
});

describe('DataModelRenderer — missing optional metadata', () => {
    it('omits status chips and count chips that have no data, without crashing', () => {
        const sparse: DataModelContent = {
            entities: [
                { name: 'Bare', description: 'Only fields.', fields: [{ name: 'id', type: 'UUID', required: true, description: 'pk' }], relationships: [] },
                { name: 'Bare2', description: 'Also bare.', fields: [{ name: 'id', type: 'UUID', required: true, description: 'pk' }], relationships: [] },
            ],
            apiEndpoints: [],
        };
        const { container } = renderModel(sparse);
        const card = container.querySelector('#data-model-entity-bare') as HTMLElement;
        expect(card).toBeTruthy();
        // No mutability / user-facing data → no such chips; no relationships/etc. → no count chips.
        expect(within(card).queryByText('Mutable')).toBeNull();
        expect(within(card).queryByText('User-facing')).toBeNull();
        expect(within(card).queryByText(/relationship/)).toBeNull();
        expect(within(card).queryByText(/constraint/)).toBeNull();
        // The single "1 field" count still renders.
        expect(within(card).getByText('1 field')).toBeInTheDocument();
    });
});

describe('DataModelRenderer — selected/expanded card styling', () => {
    it('applies a subtle accent border to the expanded entity', () => {
        const { container } = renderModel(twoEntityModel);
        const orderCard = container.querySelector('#data-model-entity-order') as HTMLElement;
        expect(orderCard.className).not.toContain('border-indigo-300');

        fireEvent.click(orderCard.querySelector('button')!);
        expect(orderCard.className).toContain('border-indigo-300');
    });
});

describe('DataModelRenderer — mobile entity-card chip density', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps the high-value semantic chips and never shows a redundant "Indexed" chip', () => {
        stubViewport(true);
        const { container } = renderModel(groupedModel);
        const card = container.querySelector('#data-model-entity-infographicsource') as HTMLElement;
        expect(card).toBeTruthy();

        // The three meaningful statuses show; PII leads. "Indexed" is never a
        // status chip (it duplicates the "indexes" footer count).
        expect(within(card).getByText('Contains PII')).toBeInTheDocument();
        expect(within(card).getByText('User-facing')).toBeInTheDocument();
        expect(within(card).getByText('mostly immutable')).toBeInTheDocument();
        expect(within(card).queryByText('Indexed')).toBeNull();
    });

    it('drops the low-value "No PII" chip on a collapsed mobile card', () => {
        stubViewport(true);
        const { container } = renderModel(groupedModel);
        // KnowledgeNode: user-facing + mutable, no PII → "No PII" is dropped on mobile.
        const card = container.querySelector('#data-model-entity-knowledgenode') as HTMLElement;
        expect(within(card).queryByText('No PII')).toBeNull();
        expect(within(card).getByText('User-facing')).toBeInTheDocument();
        expect(within(card).getByText('mutable')).toBeInTheDocument();
        expect(within(card).queryByText('Indexed')).toBeNull();
    });

    it('shows the "No PII" chip on desktop for an entity without PII', () => {
        stubViewport(false);
        const { container } = renderModel(groupedModel);
        // AuditLog: System entity, no PII → "No PII" is visible on desktop.
        const card = container.querySelector('#data-model-entity-auditlog') as HTMLElement;
        expect(within(card).getByText('System')).toBeInTheDocument();
        expect(within(card).getByText('No PII')).toBeInTheDocument();
        expect(within(card).queryByText('Indexed')).toBeNull();
    });

    it('aligns the entity title so long names truncate without pushing the chevron', () => {
        const { container } = renderModel(groupedModel);
        const title = within(container.querySelector('#data-model-entity-knowledgenode') as HTMLElement)
            .getByText('KnowledgeNode');
        expect(title.className).toContain('truncate');
        expect(title.className).toContain('min-w-0');
    });
});
