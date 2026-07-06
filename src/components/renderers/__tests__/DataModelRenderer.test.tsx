import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { DataModelRenderer } from '../DataModelRenderer';
import type { DataModelContent } from '../../../types';

// jsdom doesn't implement scrollIntoView; the outline/graph interactions call it.
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

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

function renderModel(content: DataModelContent, props: Partial<{ prdVersionLabel: string; staleness: 'current' | 'possibly_outdated' | 'outdated' }> = {}) {
    return render(<DataModelRenderer content={JSON.stringify(content)} {...props} />);
}

describe('DataModelRenderer — overview header', () => {
    it('renders a Data Model overview with entity/relationship counts', () => {
        const { getByLabelText } = renderModel(twoEntityModel);
        const overview = getByLabelText('Data model overview');
        expect(overview).toHaveTextContent('Data Model');
        expect(overview).toHaveTextContent('Entities');
        // Singular label when there is exactly one deduped relationship.
        expect(overview).toHaveTextContent('Relationship');
        // 2 entities stat tile value.
        expect(within(overview).getByText('2')).toBeInTheDocument();
    });

    it('shows optional PRD provenance and staleness when provided', () => {
        const { getByLabelText } = renderModel(twoEntityModel, {
            prdVersionLabel: 'Version 3',
            staleness: 'possibly_outdated',
        });
        const overview = getByLabelText('Data model overview');
        expect(overview).toHaveTextContent('From PRD Version 3');
        expect(overview).toHaveTextContent('May be outdated');
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
