// Data Model graph — pure, testable model that turns a parsed data-model
// artifact into an entity-relationship graph (nodes + directional, cardinality-
// labelled edges), derives lightweight entity categories for optional grouping,
// and computes a deterministic layered layout for the ER-style diagram.
//
// It consumes the output of `parseDataModelMarkdown` (both the JSON→markdown and
// the legacy-markdown paths flow through that parser), so a single code path
// serves every artifact shape. Relationships are recovered from the parser's
// `RELATIONSHIP` callouts — the same text the converter emits from the schema's
// typed `DataRelationship[]` — so cardinality is a faithful derivation of the
// schema's relationship `type`, never invented.
//
// This module must stay free of store/React/LLM imports so it is trivially
// unit-testable (mirrors artifactDependencyGraph.ts / screenExperience.ts).

import type { ParsedDataModel, ParsedEntity, ParsedCalloutKind } from './services/dataModelMarkdown';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RelationshipCardinality = '1 → 1' | '1 → many' | 'many → 1' | 'many → many';

/**
 * Soft, derived grouping bucket for an entity. The data-model schema has no
 * explicit domain/category field, so these are inferred from conservative,
 * schema-backed signals (userFacing / mutability / integration-shaped fields)
 * — deliberately simple to avoid brittle name-guessing.
 */
export type EntityCategory = 'core' | 'user_config' | 'generated' | 'system' | 'external';

/** Coarse field-type family used to colour type chips in the field tables. */
export type FieldTypeKind =
    | 'id'         // UUID / primary keys
    | 'reference'  // *_id foreign keys
    | 'text'       // string / text
    | 'number'     // int / float / decimal / numeric
    | 'boolean'
    | 'datetime'   // timestamp / date / time
    | 'json'       // json / jsonb / object / array — structured, not a plain string
    | 'enum'
    | 'other';

export interface DataModelNode {
    /** Slug of the entity name — stable graph identity. */
    id: string;
    name: string;
    description: string;
    category: EntityCategory;
    userFacing?: boolean;
    /** Normalised for display, e.g. "mostly immutable". */
    mutability?: string;
    hasPII: boolean;
    indexed: boolean;
    fieldCount: number;
    /** Distinct relationship count for this entity (callout count). */
    relationshipCount: number;
    constraintCount: number;
    privacyCount: number;
    indexCount: number;
}

export interface DataModelEdge {
    id: string;
    fromId: string;
    toId: string;
    /** Human verb, e.g. "has many", "belongs to". */
    verb: string;
    /** Present only when derivable from the schema relationship type. */
    cardinality?: RelationshipCardinality;
    description?: string;
    /** 'both' → many-to-many (arrowheads at both ends). */
    arrow: 'forward' | 'both';
}

/** A relationship whose target is not a known entity (drawn as a node note). */
export interface UnresolvedRelationship {
    fromId: string;
    targetName: string;
    verb: string;
    cardinality?: RelationshipCardinality;
    description?: string;
}

export interface DataModelGraph {
    nodes: DataModelNode[];
    edges: DataModelEdge[];
    unresolved: UnresolvedRelationship[];
    /** Self-references (entity → itself), surfaced as a badge rather than an edge. */
    selfRefs: UnresolvedRelationship[];
    /** Distinct relationship count across the whole model (deduped). */
    relationshipCount: number;
}

export interface DataModelSummary {
    entityCount: number;
    relationshipCount: number;
    fieldCount: number;
    constraintCount: number;
    indexCount: number;
    /** Entities carrying at least one privacy rule / PII-flagged field group. */
    piiEntityCount: number;
    apiEndpointCount: number;
}

export interface DataModelAnalysis {
    graph: DataModelGraph;
    summary: DataModelSummary;
}

// ---------------------------------------------------------------------------
// Slugs / anchors
// ---------------------------------------------------------------------------

export function slugifyEntity(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/** Anchor id for an entity detail card (kept stable for scroll/outline links). */
export function entityAnchorId(name: string): string {
    return `data-model-entity-${slugifyEntity(name)}`;
}

// ---------------------------------------------------------------------------
// Relationship-callout parsing
// ---------------------------------------------------------------------------

const KNOWN_VERBS = ['many to many', 'has many', 'has one', 'belongs to'] as const;

const VERB_TO_CARDINALITY: Record<string, RelationshipCardinality> = {
    'has many': '1 → many',
    'has one': '1 → 1',
    'belongs to': 'many → 1',
    'many to many': 'many → many',
};

export interface ParsedRelationshipCallout {
    verb: string;
    target: string;
    cardinality?: RelationshipCardinality;
    description?: string;
}

/**
 * Parse a `RELATIONSHIP` callout's text back into a structured relationship.
 * Handles both the converter shape (`"has many → Post (comments)"`) and the
 * legacy inline shape (`"has many Visit (via foreign key \`patient_id\`)"`).
 */
export function parseRelationshipCallout(raw: string): ParsedRelationshipCallout | null {
    let text = raw.trim();
    if (!text) return null;

    // Pull a trailing "(description)" off the end, if present.
    let description: string | undefined;
    const descMatch = text.match(/\(([^)]*)\)\s*$/);
    if (descMatch) {
        description = descMatch[1].trim() || undefined;
        text = text.slice(0, descMatch.index).trim();
    }

    let verbPart = '';
    let target = '';

    const arrowIdx = text.search(/->|→/);
    if (arrowIdx >= 0) {
        verbPart = text.slice(0, arrowIdx).trim();
        target = text.replace(/^[\s\S]*?(->|→)/, '').trim();
    } else {
        // No arrow: match a known verb prefix, remainder is the target.
        const lower = text.toLowerCase();
        const verb = KNOWN_VERBS.find(v => lower.startsWith(v));
        if (verb) {
            verbPart = verb;
            target = text.slice(verb.length).trim();
        } else {
            // Freeform legacy text: treat the whole thing as the target.
            verbPart = 'references';
            target = text;
        }
    }

    target = cleanTarget(target);
    if (!target) return null;

    const verb = verbPart.toLowerCase().replace(/\s+/g, ' ').trim() || 'references';
    return { verb, target, cardinality: VERB_TO_CARDINALITY[verb], description };
}

function cleanTarget(raw: string): string {
    return raw
        .replace(/`/g, '')
        .replace(/^(the|a|an)\s+/i, '')
        .replace(/[.,;:]+$/, '')
        .trim();
}

// ---------------------------------------------------------------------------
// Field-type classification
// ---------------------------------------------------------------------------

export function classifyFieldType(rawType: string, fieldName = ''): FieldTypeKind {
    const type = rawType.toLowerCase().trim();
    const name = fieldName.toLowerCase();

    if (/\b(uuid|guid)\b/.test(type) || name === 'id') return 'id';
    if (name.endsWith('_id') || name === 'ref' || /foreign key/.test(type)) return 'reference';
    if (/\b(json|jsonb|object|array|map|record|struct)\b/.test(type) || type.endsWith('[]')) return 'json';
    if (/\b(bool|boolean)\b/.test(type)) return 'boolean';
    if (/\b(timestamp|datetime|date|time|instant)\b/.test(type)) return 'datetime';
    if (/\b(int|integer|float|double|decimal|numeric|number|bigint|smallint|money|currency)\b/.test(type))
        return 'number';
    if (/\b(enum)\b/.test(type) || type.includes('|')) return 'enum';
    if (/\b(string|text|varchar|char|uri|url|email)\b/.test(type)) return 'text';
    return 'other';
}

/** True when a field type denotes structured/object content, not a plain scalar. */
export function isStructuredFieldType(rawType: string, fieldName = ''): boolean {
    return classifyFieldType(rawType, fieldName) === 'json';
}

// ---------------------------------------------------------------------------
// Category derivation
// ---------------------------------------------------------------------------

const INTEGRATION_TOKENS = [
    'webhook', 'integration', 'external', 'third_party', 'third-party', 'oauth',
    'api key', 'api_key', 'apikey', 'sync', 'connector', 'provider',
];
const CONFIG_TOKENS = ['setting', 'preference', 'config', 'profile', 'account'];

function isImmutable(mutability?: string): boolean {
    const m = (mutability || '').toLowerCase();
    return m.includes('immutable');
}

function hasIntegrationSignal(entity: ParsedEntity): boolean {
    if (entity.fieldGroups.some(g => g.name === 'API / Integration')) return true;
    const haystack = `${entity.name} ${entity.description}`.toLowerCase();
    return INTEGRATION_TOKENS.some(t => haystack.includes(t));
}

/**
 * Derive a conservative category for an entity. Order matters: the strongest,
 * most explicit signal wins. Falls back to 'core' so nothing is force-fit into
 * a speculative bucket.
 */
export function deriveEntityCategory(entity: ParsedEntity): EntityCategory {
    if (hasIntegrationSignal(entity)) return 'external';
    if (entity.userFacing === false) return 'system';
    if (isImmutable(entity.mutability)) return 'generated';

    // userFacing is true|undefined here (the `=== false` case returned above).
    const name = entity.name.toLowerCase();
    if (CONFIG_TOKENS.some(t => name.includes(t))) return 'user_config';

    return 'core';
}

// ---------------------------------------------------------------------------
// Node / entity attribute derivation
// ---------------------------------------------------------------------------

function countCallouts(entity: ParsedEntity, kind: ParsedCalloutKind): number {
    return entity.callouts.filter(c => c.kind === kind).length;
}

function entityFieldCount(entity: ParsedEntity): number {
    return entity.fieldGroups.reduce((sum, g) => sum + g.fields.length, 0);
}

function entityHasPII(entity: ParsedEntity): boolean {
    return countCallouts(entity, 'PRIVACY') > 0
        || entity.fieldGroups.some(g => g.name === 'Privacy / Safety' && g.fields.length > 0);
}

/** Normalise a mutability value for display ("mostly_immutable" → "mostly immutable"). */
export function normalizeMutability(mutability?: string): string | undefined {
    if (!mutability) return undefined;
    return mutability.replace(/_/g, ' ').trim() || undefined;
}

/**
 * Field names an entity indexes, derived from its `INDEX` callouts (word-level
 * match). Conservative: only exact field-name tokens count, so an index over
 * `(user_id, created_at)` marks both without false positives.
 */
export function indexedFieldNames(entity: ParsedEntity): Set<string> {
    const indexed = new Set<string>();
    const indexTexts = entity.callouts.filter(c => c.kind === 'INDEX').map(c => c.text.toLowerCase());
    if (indexTexts.length === 0) return indexed;
    for (const group of entity.fieldGroups) {
        for (const field of group.fields) {
            const token = field.name.toLowerCase();
            const re = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(token)}([^a-z0-9_]|$)`);
            if (indexTexts.some(t => re.test(t))) indexed.add(field.name);
        }
    }
    return indexed;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildNode(entity: ParsedEntity): DataModelNode {
    return {
        id: slugifyEntity(entity.name),
        name: entity.name,
        description: entity.description,
        category: deriveEntityCategory(entity),
        userFacing: entity.userFacing,
        mutability: normalizeMutability(entity.mutability),
        hasPII: entityHasPII(entity),
        indexed: countCallouts(entity, 'INDEX') > 0,
        fieldCount: entityFieldCount(entity),
        relationshipCount: countCallouts(entity, 'RELATIONSHIP'),
        constraintCount: countCallouts(entity, 'CONSTRAINT'),
        privacyCount: countCallouts(entity, 'PRIVACY'),
        indexCount: countCallouts(entity, 'INDEX'),
    };
}

// ---------------------------------------------------------------------------
// Graph assembly (with reciprocal-edge dedup)
// ---------------------------------------------------------------------------

type RawKind = 'container' | 'belongs' | 'many' | 'other';

interface RawEdge {
    fromId: string;
    toId: string;
    verb: string;
    cardinality?: RelationshipCardinality;
    description?: string;
    kind: RawKind;
}

function classifyVerb(verb: string): RawKind {
    if (verb === 'has many' || verb === 'has one') return 'container';
    if (verb === 'belongs to') return 'belongs';
    if (verb === 'many to many') return 'many';
    return 'other';
}

/** Resolve a relationship target name to a known node id (tolerates plural/singular). */
export function resolveEntityId(targetName: string, nodeIds: Set<string>): string | undefined {
    const slug = slugifyEntity(targetName);
    if (nodeIds.has(slug)) return slug;
    const singular = slug.replace(/s$/, '');
    if (nodeIds.has(singular)) return singular;
    const plural = `${slug}s`;
    if (nodeIds.has(plural)) return plural;
    return undefined;
}

export function buildDataModelGraph(parsed: ParsedDataModel): DataModelGraph {
    const nodes = parsed.entities.map(buildNode);
    const nodeIds = new Set(nodes.map(n => n.id));

    const rawEdges: RawEdge[] = [];
    const unresolved: UnresolvedRelationship[] = [];
    const selfRefs: UnresolvedRelationship[] = [];

    parsed.entities.forEach(entity => {
        const fromId = slugifyEntity(entity.name);
        for (const callout of entity.callouts) {
            if (callout.kind !== 'RELATIONSHIP') continue;
            const rel = parseRelationshipCallout(callout.text);
            if (!rel) continue;
            const toId = resolveEntityId(rel.target, nodeIds);
            if (!toId) {
                unresolved.push({ fromId, targetName: rel.target, verb: rel.verb, cardinality: rel.cardinality, description: rel.description });
                continue;
            }
            if (toId === fromId) {
                selfRefs.push({ fromId, targetName: rel.target, verb: rel.verb, cardinality: rel.cardinality, description: rel.description });
                continue;
            }
            rawEdges.push({
                fromId,
                toId,
                verb: rel.verb,
                cardinality: rel.cardinality,
                description: rel.description,
                kind: classifyVerb(rel.verb),
            });
        }
    });

    const edges = dedupeEdges(rawEdges);
    const relationshipCount = edges.length + unresolved.length + selfRefs.length;

    return { nodes, edges, unresolved, selfRefs, relationshipCount };
}

/**
 * Collapse reciprocal relationships into a single directed, labelled edge.
 * A `has many` A→B and its mirror `belongs to` B→A describe one relationship;
 * we keep the container (parent→child) direction so the diagram reads top-down.
 */
function dedupeEdges(rawEdges: RawEdge[]): DataModelEdge[] {
    const groups = new Map<string, RawEdge[]>();
    for (const e of rawEdges) {
        const key = [e.fromId, e.toId].sort().join('::');
        const list = groups.get(key) ?? [];
        list.push(e);
        groups.set(key, list);
    }

    const edges: DataModelEdge[] = [];
    for (const [key, group] of groups) {
        const many = group.find(e => e.kind === 'many');
        const container = group.find(e => e.kind === 'container');
        const chosen = many ?? container ?? group[0];
        edges.push({
            id: `edge-${key}`,
            fromId: chosen.fromId,
            toId: chosen.toId,
            verb: chosen.verb,
            cardinality: chosen.cardinality,
            description: chosen.description,
            arrow: chosen.kind === 'many' ? 'both' : 'forward',
        });
    }
    // Deterministic order: by source id then target id.
    edges.sort((a, b) => (a.fromId.localeCompare(b.fromId)) || a.toId.localeCompare(b.toId));
    return edges;
}

// ---------------------------------------------------------------------------
// Layout (deterministic — no DOM measurement; mirrors artifactDependencyGraph)
// ---------------------------------------------------------------------------

export interface DataModelLayout {
    rows: string[][];
}

/**
 * Group nodes into rows by longest-path depth over the (deduped) edges, then
 * order each row by the barycenter of its parents to reduce edge crossings.
 * When there are no edges the caller renders a plain grid instead, so this is
 * only meaningful for the edged case.
 */
export function computeDataModelLayout(graph: DataModelGraph): DataModelLayout {
    const parentsOf = new Map<string, string[]>();
    for (const node of graph.nodes) parentsOf.set(node.id, []);
    for (const edge of graph.edges) {
        parentsOf.get(edge.toId)?.push(edge.fromId);
    }

    const depth = new Map<string, number>();
    const resolve = (id: string, trail: Set<string> = new Set()): number => {
        const known = depth.get(id);
        if (known !== undefined) return known;
        if (trail.has(id)) return 0; // cycle guard (2-cycles are common in ER graphs)
        trail.add(id);
        const parents = parentsOf.get(id) ?? [];
        const d = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(p => resolve(p, trail)));
        depth.set(id, d);
        return d;
    };
    for (const node of graph.nodes) resolve(node.id);

    const maxDepth = Math.max(0, ...Array.from(depth.values()));
    const rows: string[][] = [];
    for (let d = 0; d <= maxDepth; d++) {
        rows.push(graph.nodes.filter(n => depth.get(n.id) === d).map(n => n.id));
    }

    // Barycenter pass — order each row by the mean column of its parents.
    const col = new Map<string, number>();
    rows[0]?.forEach((id, i) => col.set(id, i));
    for (let r = 1; r < rows.length; r++) {
        const scored = rows[r].map((id, i) => {
            const parents = (parentsOf.get(id) ?? []).filter(p => col.has(p));
            const score = parents.length > 0
                ? parents.reduce((sum, p) => sum + (col.get(p) ?? 0), 0) / parents.length
                : i;
            return { id, i, score };
        });
        scored.sort((a, b) => (a.score - b.score) || (a.i - b.i));
        rows[r] = scored.map(s => s.id);
        rows[r].forEach((id, i) => col.set(id, i));
    }

    return { rows };
}

// ---------------------------------------------------------------------------
// Edge-label placement (collision-aware — pure, so it's unit-testable)
// ---------------------------------------------------------------------------

/** Axis-aligned rectangle in canvas space (top-left origin). */
export interface Rect { x: number; y: number; w: number; h: number }

/** A relationship-label's natural anchor (its edge midpoint) + estimated size. */
export interface EdgeLabelInput {
    id: string;
    /** Natural center x (edge midpoint). */
    cx: number;
    /** Natural center y (edge midpoint). */
    cy: number;
    w: number;
    h: number;
}

export interface EdgeLabelPlacement {
    id: string;
    /** Resolved center x. */
    x: number;
    /** Resolved center y. */
    y: number;
    /** True when nudged off its natural anchor to avoid a collision. */
    moved: boolean;
}

export interface PlaceEdgeLabelsOptions {
    /** Minimum clear gap kept between a label and any card. */
    margin?: number;
    /** Search step (px) and how many rings out to look before giving up. */
    step?: number;
    maxRings?: number;
}

function rectsOverlap(a: Rect, b: Rect, margin: number): boolean {
    return (
        a.x - margin < b.x + b.w &&
        a.x + a.w + margin > b.x &&
        a.y - margin < b.y + b.h &&
        a.y + a.h + margin > b.y
    );
}

function clamp(v: number, lo: number, hi: number): number {
    if (hi < lo) return lo;
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Collision-aware placement for relationship-edge labels so the pills never
 * overlap entity cards (the "graph looks broken" bug on narrow screens).
 *
 * Each label starts on its edge midpoint. Between-row edges already sit in the
 * clear vertical gap between layout rows, so their labels don't move. Same-row
 * (horizontal) edges — the overlap-prone case, where the label lands on the
 * cards' vertical centre inside a gap far narrower than the label — get lifted
 * into an adjacent clear lane. The search is deterministic (fixed direction
 * ring, vertical moves preferred so labels drop into row gaps), every candidate
 * is clamped inside the canvas, and already-placed labels are treated as soft
 * obstacles so two labels don't stack either. Pure: no DOM, no measurement.
 */
export function placeEdgeLabels(
    labels: EdgeLabelInput[],
    cards: Rect[],
    canvas: { width: number; height: number },
    options: PlaceEdgeLabelsOptions = {},
): EdgeLabelPlacement[] {
    const margin = options.margin ?? 6;
    const step = options.step ?? 14;
    const maxRings = options.maxRings ?? 12;

    const boxAt = (cx: number, cy: number, w: number, h: number): Rect => ({
        x: cx - w / 2, y: cy - h / 2, w, h,
    });
    // Keep the whole label box on-canvas by clamping its centre.
    const clampCenter = (cx: number, cy: number, w: number, h: number) => ({
        x: clamp(cx, w / 2, canvas.width - w / 2),
        y: clamp(cy, h / 2, canvas.height - h / 2),
    });

    const placed: Rect[] = [];
    const isClear = (box: Rect): boolean =>
        !cards.some(c => rectsOverlap(box, c, margin)) &&
        // Labels crowd each other less than they crowd cards — lighter margin.
        !placed.some(p => rectsOverlap(box, p, margin / 2));

    // Vertical moves first (drop into row gaps), then horizontal, then diagonals.
    const directions: Array<[number, number]> = [
        [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];

    const result: EdgeLabelPlacement[] = [];
    for (const label of labels) {
        const natural = clampCenter(label.cx, label.cy, label.w, label.h);
        let chosen = natural;

        if (!isClear(boxAt(natural.x, natural.y, label.w, label.h))) {
            let found: { x: number; y: number } | null = null;
            for (let ring = 1; ring <= maxRings && !found; ring++) {
                for (const [dx, dy] of directions) {
                    const c = clampCenter(
                        label.cx + dx * step * ring,
                        label.cy + dy * step * ring,
                        label.w, label.h,
                    );
                    if (isClear(boxAt(c.x, c.y, label.w, label.h))) {
                        found = c;
                        break;
                    }
                }
            }
            // Best effort: if nothing is fully clear, keep the clamped anchor.
            if (found) chosen = found;
        }

        placed.push(boxAt(chosen.x, chosen.y, label.w, label.h));
        result.push({
            id: label.id,
            x: chosen.x,
            y: chosen.y,
            moved: chosen.x !== label.cx || chosen.y !== label.cy,
        });
    }
    return result;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function summarizeDataModel(parsed: ParsedDataModel, graph: DataModelGraph): DataModelSummary {
    let fieldCount = 0;
    let constraintCount = 0;
    let indexCount = 0;
    let piiEntityCount = 0;
    for (const entity of parsed.entities) {
        fieldCount += entityFieldCount(entity);
        constraintCount += countCallouts(entity, 'CONSTRAINT');
        indexCount += countCallouts(entity, 'INDEX');
        if (entityHasPII(entity)) piiEntityCount += 1;
    }
    return {
        entityCount: parsed.entities.length,
        relationshipCount: graph.relationshipCount,
        fieldCount,
        constraintCount,
        indexCount,
        piiEntityCount,
        apiEndpointCount: parsed.apiEndpoints.length,
    };
}

/** Single entry point: build the graph and summary in one pass. */
export function analyzeDataModel(parsed: ParsedDataModel): DataModelAnalysis {
    const graph = buildDataModelGraph(parsed);
    const summary = summarizeDataModel(parsed, graph);
    return { graph, summary };
}

// ---------------------------------------------------------------------------
// Display metadata for categories (labels only — colours live in the renderer)
// ---------------------------------------------------------------------------

export const ENTITY_CATEGORY_LABEL: Record<EntityCategory, string> = {
    core: 'Core Product Data',
    user_config: 'User Configuration',
    generated: 'Generated Outputs',
    system: 'System Metadata',
    external: 'External Integrations',
};

/** Category display order for grouped views. */
export const ENTITY_CATEGORY_ORDER: EntityCategory[] = [
    'core', 'user_config', 'generated', 'system', 'external',
];
