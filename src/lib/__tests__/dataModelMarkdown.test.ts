import { describe, it, expect } from 'vitest';
import {
    dataModelToMarkdown,
    parseDataModelMarkdown,
    applyFieldGroupHeuristic,
    buildRelationshipTree,
} from '../services/dataModelMarkdown';
import type { DataModelContent, DataEntity } from '../../types';

const fullModel: DataModelContent = {
    overview: {
        summary: 'User input creates a MoodSnapshot which seeds a ResonancePlaylist.',
        dataFlow: 'User input → MoodSnapshot → ResonancePlaylist → Swipe feedback updates targets.',
        productOutcome: 'Users see a personalized playlist that adapts to their feedback over time.',
    },
    entities: [
        {
            name: 'MoodSnapshot',
            description: 'Captures a single emotional state.',
            purpose: 'Acts as the seed for playlist generation.',
            userFacing: true,
            mutability: 'mostly_immutable',
            fields: [
                { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                { name: 'joy_score', type: 'Float', required: true, description: 'Joy intensity 0-1' },
                { name: 'energy_level', type: 'Float', required: true, description: 'Energy intensity 0-1' },
                { name: 'user_id', type: 'UUID', required: true, description: 'Owning user' },
                { name: 'created_at', type: 'Timestamp', required: true, description: 'Creation time' },
                { name: 'raw_input', type: 'String', required: false, description: 'Sensitive PII free-text' },
            ],
            fieldGroups: [
                { name: 'Key Product Fields', fieldNames: ['joy_score', 'energy_level'] },
                { name: 'Relationships', fieldNames: ['user_id'] },
                { name: 'System Metadata', fieldNames: ['id', 'created_at'] },
                { name: 'Privacy / Safety', fieldNames: ['raw_input'] },
            ],
            relationships: [
                { type: 'belongs_to', target: 'User' },
                { type: 'has_many', target: 'ResonancePlaylist', description: 'Playlists derived from this snapshot' },
            ],
            indexes: ['idx_user_id_created_at on (user_id, created_at)'],
            constraints: ['joy_score + sadness_score must approximate 1.0'],
            privacyRules: ['raw_input must be null when source = FACE_SCAN'],
            exampleRecord:
                '{"joy_score": 0.7, "energy_level": 0.6, "vibe_title": "Warm Sunset Drift"}',
        },
        {
            name: 'ResonancePlaylist',
            description: 'Adaptive playlist of recommended tracks.',
            purpose: 'Holds dynamic playlist state that evolves with user feedback.',
            userFacing: true,
            mutability: 'mutable',
            fields: [
                { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                { name: 'mood_snapshot_id', type: 'UUID', required: true, description: 'Source snapshot' },
                { name: 'target_valence', type: 'Float', required: true, description: 'Target valence' },
            ],
            relationships: [{ type: 'belongs_to', target: 'MoodSnapshot' }],
        },
        {
            name: 'User',
            description: 'Account holder.',
            purpose: 'Owns snapshots and playlists.',
            userFacing: true,
            mutability: 'mutable',
            fields: [
                { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                { name: 'email', type: 'String', required: true, description: 'Login email' },
            ],
            relationships: [{ type: 'has_many', target: 'MoodSnapshot' }],
        },
    ],
    apiEndpoints: [
        { method: 'POST', path: '/api/snapshots', description: 'Create a snapshot', entity: 'MoodSnapshot' },
        { method: 'GET', path: '/api/playlists/:id', description: 'Fetch a playlist', entity: 'ResonancePlaylist' },
    ],
    productMapping: [
        { field: 'vibe_title', uiBehavior: 'Appears as the generated playlist name' },
        { field: 'energy_level', uiBehavior: 'Affects track intensity' },
    ],
};

describe('dataModelToMarkdown', () => {
    it('emits all required sections for a fully populated model', () => {
        const md = dataModelToMarkdown(fullModel);

        expect(md).toContain('# Data Model');
        expect(md).toContain('## How This Data Model Works');
        expect(md).toContain('## Relationship Flow');
        expect(md).toContain('## MoodSnapshot');
        expect(md).toContain('## ResonancePlaylist');
        expect(md).toContain('## User');
        expect(md).toContain('## API Endpoints');
        expect(md).toContain('## How This Appears in the Product');
    });

    it('emits all four callout marker kinds when source data is present', () => {
        const md = dataModelToMarkdown(fullModel);
        expect(md).toContain('[!CONSTRAINT]');
        expect(md).toContain('[!PRIVACY]');
        expect(md).toContain('[!INDEX]');
        expect(md).toContain('[!RELATIONSHIP]');
    });

    it('preserves the validation-required substrings', () => {
        const md = dataModelToMarkdown(fullModel);
        // artifactValidation.ts EXPECTED_HEADERS.data_model
        expect(md).toContain('Field');
        expect(md).toContain('Type');
        expect(md).toContain('Required');
        expect(md).toContain('Relationships');
        // artifactOrchestration.ts cross-artifact check (lowercased)
        expect(md.toLowerCase()).toContain('api endpoints');
    });

    it('emits a fenced JSON example record when present', () => {
        const md = dataModelToMarkdown(fullModel);
        expect(md).toContain('```json');
        expect(md).toContain('"vibe_title"');
    });

    it('handles a minimal model (no overview, no fieldGroups, no privacy) and still passes validation strings', () => {
        const minimal: DataModelContent = {
            entities: [
                {
                    name: 'Foo',
                    description: 'A thing.',
                    fields: [
                        { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                        { name: 'name', type: 'String', required: true, description: 'Name' },
                    ],
                    relationships: [],
                },
            ],
            apiEndpoints: [
                { method: 'GET', path: '/api/foo', description: 'List foos', entity: 'Foo' },
            ],
        };
        const md = dataModelToMarkdown(minimal);
        expect(md).toContain('## Foo');
        expect(md).toContain('Field');
        expect(md).toContain('Type');
        expect(md).toContain('Required');
        // Relationships substring still appears via the column header check
        expect(md.toLowerCase()).toContain('api endpoints');
        expect(md.length).toBeGreaterThan(200);
    });

    it('skips empty optional sections', () => {
        const minimal: DataModelContent = {
            entities: [
                { name: 'Foo', description: 'A.', fields: [{ name: 'id', type: 'UUID', required: true, description: 'pk' }], relationships: [] },
            ],
            apiEndpoints: [],
        };
        const md = dataModelToMarkdown(minimal);
        expect(md).not.toContain('## How This Data Model Works');
        expect(md).not.toContain('## How This Appears in the Product');
        expect(md).not.toContain('## API Endpoints');
    });
});

describe('parseDataModelMarkdown', () => {
    it('round-trips a fully populated model', () => {
        const md = dataModelToMarkdown(fullModel);
        const parsed = parseDataModelMarkdown(md);

        expect(parsed).not.toBeNull();
        expect(parsed!.overview?.summary).toContain('MoodSnapshot');
        expect(parsed!.overview?.dataFlow).toContain('ResonancePlaylist');
        expect(parsed!.overview?.productOutcome).toContain('personalized');
        expect(parsed!.relationshipFlow).toBeTruthy();
        expect(parsed!.relationshipFlow).toContain('User');
        expect(parsed!.relationshipFlow).toContain('MoodSnapshot');

        const names = parsed!.entities.map(e => e.name);
        expect(names).toEqual(['MoodSnapshot', 'ResonancePlaylist', 'User']);

        const moodSnapshot = parsed!.entities[0];
        expect(moodSnapshot.userFacing).toBe(true);
        expect(moodSnapshot.mutability?.replace(/\s/g, '_')).toBe('mostly_immutable');
        expect(moodSnapshot.purpose).toContain('seed');
        expect(moodSnapshot.fieldGroups.length).toBeGreaterThanOrEqual(3);
        expect(moodSnapshot.exampleRecord).toContain('vibe_title');

        const calloutKinds = moodSnapshot.callouts.map(c => c.kind);
        expect(calloutKinds).toContain('CONSTRAINT');
        expect(calloutKinds).toContain('PRIVACY');
        expect(calloutKinds).toContain('INDEX');
        expect(calloutKinds).toContain('RELATIONSHIP');

        expect(parsed!.apiEndpoints).toHaveLength(2);
        expect(parsed!.apiEndpoints[0]).toMatchObject({
            method: 'POST',
            path: '/api/snapshots',
            entity: 'MoodSnapshot',
        });

        expect(parsed!.productMapping).toHaveLength(2);
        expect(parsed!.productMapping[0]).toMatchObject({
            field: 'vibe_title',
            uiBehavior: 'Appears as the generated playlist name',
        });
    });

    it('parses legacy markdown shape (no groups, no callouts) into entities + endpoints', () => {
        const legacy = `# Data Model

## Patient
A patient record.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Full name |

**Relationships:**
- has many Visit (via foreign key \`patient_id\`)

**Indexes:** idx_name
**Constraints:** name must be non-empty

## API Endpoints

| Method | Path | Description | Entity |
|--------|------|-------------|--------|
| GET | /api/patients | List patients | Patient |
`;
        const parsed = parseDataModelMarkdown(legacy);
        expect(parsed).not.toBeNull();
        expect(parsed!.entities).toHaveLength(1);
        expect(parsed!.entities[0].name).toBe('Patient');
        expect(parsed!.entities[0].fieldGroups[0].fields.map(f => f.name)).toEqual(['id', 'name']);

        const kinds = parsed!.entities[0].callouts.map(c => c.kind);
        expect(kinds).toContain('RELATIONSHIP');
        expect(kinds).toContain('INDEX');
        expect(kinds).toContain('CONSTRAINT');

        expect(parsed!.apiEndpoints).toHaveLength(1);
        expect(parsed!.apiEndpoints[0].method).toBe('GET');
    });

    it('returns null on empty or non-data-model content', () => {
        expect(parseDataModelMarkdown('')).toBeNull();
        expect(parseDataModelMarkdown('Just some prose with no structure.')).toBeNull();
    });
});

describe('applyFieldGroupHeuristic', () => {
    const entity: DataEntity = {
        name: 'Order',
        description: '',
        fields: [
            { name: 'id', type: 'UUID', required: true, description: 'pk' },
            { name: 'created_at', type: 'Timestamp', required: true, description: 'created' },
            { name: 'user_id', type: 'UUID', required: true, description: 'owning user' },
            { name: 'external_id', type: 'String', required: false, description: 'unrelated id' },
            { name: 'password_hash', type: 'String', required: true, description: 'hashed password' },
            { name: 'webhook_url', type: 'String', required: false, description: 'integration webhook' },
            { name: 'total_cents', type: 'Integer', required: true, description: 'order total' },
            { name: 'notes', type: 'String', required: false, description: 'PII free-form notes' },
        ],
        relationships: [],
    };

    it('classifies fields by name and description rules', () => {
        const groups = applyFieldGroupHeuristic(entity, ['Order', 'User']);
        const flat: Record<string, string> = {};
        for (const g of groups) for (const fn of g.fieldNames) flat[fn] = g.name;

        expect(flat['id']).toBe('System Metadata');
        expect(flat['created_at']).toBe('System Metadata');
        expect(flat['user_id']).toBe('Relationships');
        expect(flat['external_id']).toBe('Key Product Fields'); // not demoted to Relationships
        expect(flat['password_hash']).toBe('Privacy / Safety');
        expect(flat['webhook_url']).toBe('API / Integration');
        expect(flat['total_cents']).toBe('Key Product Fields');
        expect(flat['notes']).toBe('Privacy / Safety'); // matches "PII" in description
    });
});

describe('buildRelationshipTree', () => {
    it('produces an indented tree from a simple parent-child graph', () => {
        const tree = buildRelationshipTree([
            { name: 'User', description: '', fields: [], relationships: [{ type: 'has_many', target: 'Order' }] },
            { name: 'Order', description: '', fields: [], relationships: [{ type: 'has_many', target: 'LineItem' }] },
            { name: 'LineItem', description: '', fields: [], relationships: [] },
        ]);
        const lines = tree.split('\n');
        expect(lines[0]).toBe('User');
        expect(lines[1].trim()).toBe('→ Order');
        expect(lines[2].trim()).toBe('→ LineItem');
    });

    it('handles cyclic graphs without infinite recursion', () => {
        const tree = buildRelationshipTree([
            { name: 'A', description: '', fields: [], relationships: [{ type: 'has_many', target: 'B' }] },
            { name: 'B', description: '', fields: [], relationships: [{ type: 'has_many', target: 'A' }] },
        ]);
        expect(tree).toContain('A');
        expect(tree).toContain('B');
        expect(tree).toContain('see above');
    });

    it('returns empty string when there are no entities', () => {
        expect(buildRelationshipTree([])).toBe('');
    });
});
