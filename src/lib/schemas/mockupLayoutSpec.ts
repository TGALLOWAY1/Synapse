// Gemini JSON-mode schema for the Phase A layout-spec mockup engine.
//
// Mirrors MockupLayoutSpec in src/types/index.ts. The client-side `id` field
// on each screen is assigned after parsing and is intentionally not part of
// the model's output schema.
//
// NOTE: Gemini's responseSchema dialect uses uppercase TYPE tokens and does
// not support oneOf/allOf/anyOf at time of writing. The per-section `data`
// shape is therefore expressed as a single object with every possible field
// declared optional; the renderer validates discriminator-appropriate fields
// at runtime (see src/lib/mockupLayoutRenderer.ts).

const SHELL_SCHEMA = {
    type: 'OBJECT',
    properties: {
        type: { type: 'STRING', enum: ['sidebar_topbar', 'topbar_only', 'mobile_tab_shell'] },
        platform: { type: 'STRING', enum: ['desktop', 'mobile', 'responsive'] },
        accent: { type: 'STRING', enum: ['indigo'] },
        productName: { type: 'STRING' },
        navLabels: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 3, maxItems: 6 },
    },
    required: ['type', 'platform', 'accent', 'productName', 'navLabels'],
    propertyOrdering: ['type', 'platform', 'accent', 'productName', 'navLabels'],
};

const STAT_ROW_SCHEMA = {
    type: 'OBJECT',
    properties: {
        label: { type: 'STRING' },
        value: { type: 'STRING' },
        delta: { type: 'STRING' },
    },
    required: ['label', 'value'],
    propertyOrdering: ['label', 'value', 'delta'],
};

const TABLE_ROW_SCHEMA = {
    type: 'OBJECT',
    properties: {
        cells: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 1, maxItems: 6 },
    },
    required: ['cells'],
    propertyOrdering: ['cells'],
};

const ACTIVITY_ENTRY_SCHEMA = {
    type: 'OBJECT',
    properties: {
        actor: { type: 'STRING' },
        verb: { type: 'STRING' },
        target: { type: 'STRING' },
        when: { type: 'STRING' },
    },
    required: ['actor', 'verb', 'target', 'when'],
    propertyOrdering: ['actor', 'verb', 'target', 'when'],
};

const FILTER_SCHEMA = {
    type: 'OBJECT',
    properties: {
        label: { type: 'STRING' },
        options: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 2, maxItems: 5 },
    },
    required: ['label', 'options'],
    propertyOrdering: ['label', 'options'],
};

const DETAIL_FIELD_SCHEMA = {
    type: 'OBJECT',
    properties: {
        label: { type: 'STRING' },
        value: { type: 'STRING' },
    },
    required: ['label', 'value'],
    propertyOrdering: ['label', 'value'],
};

// Flat union of every slot-data field across component types. The renderer
// picks the discriminator-appropriate fields based on `section.component`.
const SECTION_DATA_SCHEMA = {
    type: 'OBJECT',
    properties: {
        // stat_grid
        rows: { type: 'ARRAY', items: STAT_ROW_SCHEMA, minItems: 2, maxItems: 6 },
        // data_table
        columns: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 2, maxItems: 6 },
        tableRows: { type: 'ARRAY', items: TABLE_ROW_SCHEMA, minItems: 1, maxItems: 8 },
        // activity_feed
        entries: { type: 'ARRAY', items: ACTIVITY_ENTRY_SCHEMA, minItems: 2, maxItems: 6 },
        // filters_bar
        filters: { type: 'ARRAY', items: FILTER_SCHEMA, minItems: 1, maxItems: 4 },
        // detail_panel
        fields: { type: 'ARRAY', items: DETAIL_FIELD_SCHEMA, minItems: 2, maxItems: 8 },
        // empty_state
        heading: { type: 'STRING' },
        body: { type: 'STRING' },
        primaryActionLabel: { type: 'STRING' },
    },
    propertyOrdering: [
        'rows',
        'columns',
        'tableRows',
        'entries',
        'filters',
        'fields',
        'heading',
        'body',
        'primaryActionLabel',
    ],
};

const SECTION_SCHEMA = {
    type: 'OBJECT',
    properties: {
        role: { type: 'STRING', enum: ['primary', 'support', 'utility'] },
        heading: { type: 'STRING' },
        component: {
            type: 'STRING',
            enum: ['stat_grid', 'data_table', 'activity_feed', 'filters_bar', 'detail_panel', 'empty_state'],
        },
        data: SECTION_DATA_SCHEMA,
    },
    required: ['role', 'heading', 'component', 'data'],
    propertyOrdering: ['role', 'heading', 'component', 'data'],
};

const ACTION_SCHEMA = {
    type: 'OBJECT',
    properties: {
        kind: { type: 'STRING', enum: ['primary_cta', 'secondary_cta', 'input', 'select', 'tab'] },
        label: { type: 'STRING' },
    },
    required: ['kind', 'label'],
    propertyOrdering: ['kind', 'label'],
};

const SCREEN_SCHEMA = {
    type: 'OBJECT',
    properties: {
        name: { type: 'STRING' },
        purpose: { type: 'STRING' },
        shell: SHELL_SCHEMA,
        sections: { type: 'ARRAY', items: SECTION_SCHEMA, minItems: 2, maxItems: 4 },
        actions: { type: 'ARRAY', items: ACTION_SCHEMA, minItems: 1, maxItems: 4 },
    },
    required: ['name', 'purpose', 'shell', 'sections', 'actions'],
    propertyOrdering: ['name', 'purpose', 'shell', 'sections', 'actions'],
};

export const mockupLayoutSpecSchema = {
    type: 'OBJECT',
    properties: {
        version: { type: 'STRING', enum: ['mockup_layout_spec_v1'] },
        tokenSet: { type: 'STRING', enum: ['token_set_v1'] },
        title: { type: 'STRING' },
        summary: { type: 'STRING' },
        screens: { type: 'ARRAY', items: SCREEN_SCHEMA, minItems: 1, maxItems: 5 },
    },
    required: ['version', 'tokenSet', 'title', 'summary', 'screens'],
    propertyOrdering: ['version', 'tokenSet', 'title', 'summary', 'screens'],
};
