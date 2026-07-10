import { describe, it, expect } from 'vitest';
import { dataModelToMarkdown, parseDataModelMarkdown } from '../services/dataModelMarkdown';
import type { ParsedEntity } from '../services/dataModelMarkdown';
import type { DataModelContent } from '../../types';
import {
    analyzeDataModel,
    buildDataModelGraph,
    classifyFieldType,
    computeDataModelLayout,
    deriveEntityCategory,
    entityAnchorId,
    indexedFieldNames,
    isStructuredFieldType,
    normalizeMutability,
    parseRelationshipCallout,
    placeEdgeLabels,
    slugifyEntity,
    type Rect,
} from '../dataModelGraph';

// A realistic model exercised end-to-end through the converter + parser so the
// graph is built from the same shape the renderer sees.
const model: DataModelContent = {
    overview: {
        summary: 'User input creates a MoodSnapshot which seeds a ResonancePlaylist.',
        dataFlow: 'User → MoodSnapshot → ResonancePlaylist.',
        productOutcome: 'A personalized, adaptive playlist.',
    },
    entities: [
        {
            name: 'MoodSnapshot',
            description: 'Captures a single emotional state.',
            purpose: 'Seed for playlist generation.',
            userFacing: true,
            mutability: 'mostly_immutable',
            fields: [
                { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                { name: 'joy_score', type: 'Float', required: true, description: 'Joy 0-1' },
                { name: 'user_id', type: 'UUID', required: true, description: 'Owning user' },
                { name: 'created_at', type: 'Timestamp', required: true, description: 'Creation time' },
                { name: 'raw_input', type: 'String', required: false, description: 'Sensitive PII free-text' },
            ],
            relationships: [
                { type: 'belongs_to', target: 'User' },
                { type: 'has_many', target: 'ResonancePlaylist', description: 'Derived playlists' },
            ],
            indexes: ['idx_user_id_created_at on (user_id, created_at)'],
            constraints: ['joy_score must be between 0 and 1'],
            privacyRules: ['raw_input must be null when source = FACE_SCAN'],
        },
        {
            name: 'ResonancePlaylist',
            description: 'Adaptive playlist of tracks.',
            userFacing: true,
            mutability: 'mutable',
            fields: [
                { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                { name: 'mood_snapshot_id', type: 'UUID', required: true, description: 'Source snapshot' },
            ],
            relationships: [{ type: 'belongs_to', target: 'MoodSnapshot' }],
        },
        {
            name: 'User',
            description: 'Account holder.',
            userFacing: true,
            mutability: 'mutable',
            fields: [{ name: 'id', type: 'UUID', required: true, description: 'Primary key' }],
            relationships: [{ type: 'has_many', target: 'MoodSnapshot' }],
        },
    ],
    apiEndpoints: [
        { method: 'POST', path: '/api/snapshots', description: 'Create', entity: 'MoodSnapshot' },
    ],
};

function parse(content: DataModelContent) {
    const parsed = parseDataModelMarkdown(dataModelToMarkdown(content));
    if (!parsed) throw new Error('expected parseable model');
    return parsed;
}

describe('parseRelationshipCallout', () => {
    it('parses the converter shape with an arrow + description', () => {
        const rel = parseRelationshipCallout('has many → ResonancePlaylist (Derived playlists)');
        expect(rel).toEqual({
            verb: 'has many',
            target: 'ResonancePlaylist',
            cardinality: '1 → many',
            description: 'Derived playlists',
        });
    });

    it('parses belongs to → target with many → 1 cardinality', () => {
        const rel = parseRelationshipCallout('belongs to → User');
        expect(rel?.verb).toBe('belongs to');
        expect(rel?.target).toBe('User');
        expect(rel?.cardinality).toBe('many → 1');
    });

    it('parses legacy inline shape without an arrow and strips backtick notes', () => {
        const rel = parseRelationshipCallout('has many Visit (via foreign key `patient_id`)');
        expect(rel?.verb).toBe('has many');
        expect(rel?.target).toBe('Visit');
        expect(rel?.cardinality).toBe('1 → many');
        expect(rel?.description).toContain('patient_id');
    });

    it('maps many to many to a symmetric cardinality', () => {
        const rel = parseRelationshipCallout('many to many → Tag');
        expect(rel?.cardinality).toBe('many → many');
    });

    it('degrades to a references verb with no cardinality for freeform text', () => {
        const rel = parseRelationshipCallout('associated with Session');
        expect(rel?.verb).toBe('references');
        expect(rel?.cardinality).toBeUndefined();
    });

    it('returns null on empty text', () => {
        expect(parseRelationshipCallout('   ')).toBeNull();
    });
});

describe('classifyFieldType / isStructuredFieldType', () => {
    it('classifies scalar and structured types', () => {
        expect(classifyFieldType('UUID', 'id')).toBe('id');
        expect(classifyFieldType('String', 'user_id')).toBe('reference');
        expect(classifyFieldType('jsonb', 'settings')).toBe('json');
        expect(classifyFieldType('Object', 'payload')).toBe('json');
        expect(classifyFieldType('Boolean', 'active')).toBe('boolean');
        expect(classifyFieldType('Timestamp', 'created_at')).toBe('datetime');
        expect(classifyFieldType('Float', 'joy_score')).toBe('number');
        expect(classifyFieldType('String', 'email')).toBe('text');
    });

    it('flags json/object types as structured', () => {
        expect(isStructuredFieldType('json', 'meta')).toBe(true);
        expect(isStructuredFieldType('String', 'title')).toBe(false);
    });
});

describe('deriveEntityCategory', () => {
    const base: ParsedEntity = {
        name: 'Thing', description: '', fieldGroups: [], callouts: [], groupsAutoDetected: false,
    };

    it('flags integration-shaped entities as external', () => {
        expect(deriveEntityCategory({ ...base, name: 'WebhookDelivery', userFacing: true })).toBe('external');
        expect(deriveEntityCategory({
            ...base,
            fieldGroups: [{ name: 'API / Integration', fields: [{ name: 'webhook_url', type: 'String', required: false, description: '' }] }],
        })).toBe('external');
    });

    it('treats non-user-facing entities as system metadata', () => {
        expect(deriveEntityCategory({ ...base, name: 'AuditLog', userFacing: false })).toBe('system');
    });

    it('treats immutable user-facing entities as generated outputs', () => {
        expect(deriveEntityCategory({ ...base, name: 'Receipt', userFacing: true, mutability: 'immutable' })).toBe('generated');
    });

    it('recognizes clearly-named config entities', () => {
        expect(deriveEntityCategory({ ...base, name: 'UserPreference', userFacing: true, mutability: 'mutable' })).toBe('user_config');
    });

    it('defaults to core product data', () => {
        expect(deriveEntityCategory({ ...base, name: 'Order', userFacing: true, mutability: 'mutable' })).toBe('core');
    });
});

describe('buildDataModelGraph', () => {
    it('builds nodes with derived attributes and counts', () => {
        const graph = buildDataModelGraph(parse(model));
        const snapshot = graph.nodes.find(n => n.name === 'MoodSnapshot');
        expect(snapshot).toBeTruthy();
        expect(snapshot!.id).toBe('moodsnapshot');
        expect(snapshot!.fieldCount).toBe(5);
        expect(snapshot!.constraintCount).toBe(1);
        expect(snapshot!.privacyCount).toBe(1);
        expect(snapshot!.indexCount).toBe(1);
        expect(snapshot!.hasPII).toBe(true);
        expect(snapshot!.indexed).toBe(true);
        expect(snapshot!.category).toBe('generated'); // user-facing + mostly_immutable
    });

    it('dedupes reciprocal relationships to one parent→child edge', () => {
        const graph = buildDataModelGraph(parse(model));
        // User has_many MoodSnapshot <-> MoodSnapshot belongs_to User → one edge.
        const userSnapshot = graph.edges.filter(
            e => (e.fromId === 'user' && e.toId === 'moodsnapshot') || (e.fromId === 'moodsnapshot' && e.toId === 'user'),
        );
        expect(userSnapshot).toHaveLength(1);
        expect(userSnapshot[0].fromId).toBe('user');
        expect(userSnapshot[0].toId).toBe('moodsnapshot');
        expect(userSnapshot[0].verb).toBe('has many');
        expect(userSnapshot[0].arrow).toBe('forward');
        // MoodSnapshot has_many ResonancePlaylist <-> ResonancePlaylist belongs_to MoodSnapshot.
        expect(graph.edges).toHaveLength(2);
        expect(graph.relationshipCount).toBe(2);
    });

    it('routes many-to-many to a double-headed edge', () => {
        const mm: DataModelContent = {
            entities: [
                { name: 'Post', description: '', userFacing: true, fields: [{ name: 'id', type: 'UUID', required: true, description: '' }], relationships: [{ type: 'many_to_many', target: 'Tag' }] },
                { name: 'Tag', description: '', userFacing: true, fields: [{ name: 'id', type: 'UUID', required: true, description: '' }], relationships: [{ type: 'many_to_many', target: 'Post' }] },
            ],
            apiEndpoints: [],
        };
        const graph = buildDataModelGraph(parse(mm));
        expect(graph.edges).toHaveLength(1);
        expect(graph.edges[0].arrow).toBe('both');
        expect(graph.edges[0].cardinality).toBe('many → many');
    });

    it('tracks unresolved targets as node notes, not edges', () => {
        const content: DataModelContent = {
            entities: [
                { name: 'Patient', description: 'A record.', userFacing: true, fields: [{ name: 'id', type: 'UUID', required: true, description: '' }], relationships: [{ type: 'has_many', target: 'Visit' }] },
            ],
            apiEndpoints: [],
        };
        const graph = buildDataModelGraph(parse(content));
        expect(graph.edges).toHaveLength(0);
        expect(graph.unresolved).toHaveLength(1);
        expect(graph.unresolved[0].targetName).toBe('Visit');
        expect(graph.relationshipCount).toBe(1);
    });

    it('separates self-references from drawn edges', () => {
        const content: DataModelContent = {
            entities: [
                { name: 'Category', description: '', userFacing: true, fields: [{ name: 'id', type: 'UUID', required: true, description: '' }], relationships: [{ type: 'belongs_to', target: 'Category' }] },
            ],
            apiEndpoints: [],
        };
        const graph = buildDataModelGraph(parse(content));
        expect(graph.edges).toHaveLength(0);
        expect(graph.selfRefs).toHaveLength(1);
    });
});

describe('computeDataModelLayout', () => {
    it('layers nodes by dependency depth', () => {
        const graph = buildDataModelGraph(parse(model));
        const layout = computeDataModelLayout(graph);
        // User (root) → MoodSnapshot → ResonancePlaylist.
        expect(layout.rows[0]).toEqual(['user']);
        expect(layout.rows[1]).toEqual(['moodsnapshot']);
        expect(layout.rows[2]).toEqual(['resonanceplaylist']);
    });

    it('does not infinitely recurse on cyclic graphs', () => {
        const cyclic: DataModelContent = {
            entities: [
                { name: 'A', description: '', userFacing: true, fields: [], relationships: [{ type: 'has_many', target: 'B' }] },
                { name: 'B', description: '', userFacing: true, fields: [], relationships: [{ type: 'has_many', target: 'A' }] },
            ],
            apiEndpoints: [],
        };
        const graph = buildDataModelGraph(parse(cyclic));
        const layout = computeDataModelLayout(graph);
        const flat = layout.rows.flat();
        expect(flat).toContain('a');
        expect(flat).toContain('b');
    });
});

describe('indexedFieldNames', () => {
    it('marks fields referenced by an index callout', () => {
        const parsed = parse(model);
        const snapshot = parsed.entities.find(e => e.name === 'MoodSnapshot')!;
        const indexed = indexedFieldNames(snapshot);
        expect(indexed.has('user_id')).toBe(true);
        expect(indexed.has('created_at')).toBe(true);
        expect(indexed.has('joy_score')).toBe(false);
    });
});

describe('analyzeDataModel', () => {
    it('summarizes counts across the model', () => {
        const { summary } = analyzeDataModel(parse(model));
        expect(summary.entityCount).toBe(3);
        expect(summary.relationshipCount).toBe(2);
        expect(summary.constraintCount).toBe(1);
        expect(summary.indexCount).toBe(1);
        expect(summary.piiEntityCount).toBe(1);
        expect(summary.apiEndpointCount).toBe(1);
        expect(summary.fieldCount).toBeGreaterThanOrEqual(8);
    });
});

describe('helpers', () => {
    it('slugifies and anchors entity names', () => {
        expect(slugifyEntity('Mood Snapshot!')).toBe('mood-snapshot');
        expect(entityAnchorId('Mood Snapshot')).toBe('data-model-entity-mood-snapshot');
    });

    it('normalizes mutability for display', () => {
        expect(normalizeMutability('mostly_immutable')).toBe('mostly immutable');
        expect(normalizeMutability(undefined)).toBeUndefined();
    });
});

describe('placeEdgeLabels — collision-aware relationship-label placement', () => {
    // A label placement's box, given its resolved centre + size.
    const boxOf = (p: { x: number; y: number }, w: number, h: number): Rect => ({
        x: p.x - w / 2, y: p.y - h / 2, w, h,
    });
    const overlaps = (a: Rect, b: Rect): boolean =>
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    it('leaves a non-colliding label on its natural edge-midpoint anchor', () => {
        const [p] = placeEdgeLabels(
            [{ id: 'e', cx: 300, cy: 300, w: 60, h: 30 }],
            [{ x: 0, y: 0, w: 100, h: 60 }],
            { width: 600, height: 600 },
        );
        expect(p.moved).toBe(false);
        expect(p.x).toBe(300);
        expect(p.y).toBe(300);
    });

    it('moves a label off any entity card it would overlap', () => {
        const card: Rect = { x: 0, y: 0, w: 200, h: 140 };
        const [p] = placeEdgeLabels(
            [{ id: 'e', cx: 100, cy: 70, w: 60, h: 30 }], // anchor inside the card
            [card],
            { width: 600, height: 600 },
        );
        expect(p.moved).toBe(true);
        expect(overlaps(boxOf(p, 60, 30), card)).toBe(false);
    });

    it('clears the same-row (horizontal-edge) label off both connected cards', () => {
        // Two cards side-by-side with a 40px gap and a reserved label lane above
        // and below (mirrors EntityGraph geometry). The natural anchor sits on the
        // cards' shared vertical centre — the configuration that used to overlap.
        const w = 70, h = 34;
        const a: Rect = { x: 0, y: 92, w: 224, h: 140 };
        const b: Rect = { x: 264, y: 92, w: 224, h: 140 };
        const [p] = placeEdgeLabels(
            [{ id: 'e', cx: 244, cy: 162, w, h }],
            [a, b],
            { width: 488, height: 324 },
        );
        expect(p.moved).toBe(true);
        expect(overlaps(boxOf(p, w, h), a)).toBe(false);
        expect(overlaps(boxOf(p, w, h), b)).toBe(false);
    });

    it('does not stack two labels sharing the same anchor', () => {
        const w = 60, h = 30;
        const [pa, pb] = placeEdgeLabels(
            [
                { id: 'a', cx: 100, cy: 100, w, h },
                { id: 'b', cx: 100, cy: 100, w, h },
            ],
            [],
            { width: 600, height: 600 },
        );
        expect(overlaps(boxOf(pa, w, h), boxOf(pb, w, h))).toBe(false);
    });

    it('keeps every label fully inside the canvas', () => {
        const w = 60, h = 30;
        const [p] = placeEdgeLabels(
            [{ id: 'e', cx: 4, cy: 4, w, h }], // anchor pinned to the top-left corner
            [],
            { width: 600, height: 600 },
        );
        const box = boxOf(p, w, h);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(600);
        expect(box.y + box.h).toBeLessThanOrEqual(600);
    });
});
