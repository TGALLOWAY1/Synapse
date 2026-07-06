import type {
    DataEntity,
    DataField,
    DataModelContent,
    FieldGroup,
    FieldGroupName,
} from '../../types';
import { TRACEABILITY_SECTION_HEADING } from '../artifactTraceabilityRepair';

const GROUP_ORDER: FieldGroupName[] = [
    'Key Product Fields',
    'Relationships',
    'System Metadata',
    'API / Integration',
    'Privacy / Safety',
];

const VALID_GROUP_NAMES = new Set<string>(GROUP_ORDER);

const TOP_SECTION_HEADINGS = new Set([
    'How This Data Model Works',
    'Relationship Flow',
    'API Endpoints',
    'How This Appears in the Product',
    'Data Model',
    // Appended by automatic traceability repair (artifactTraceabilityRepair.ts).
    // It is metadata, not a data entity — skip it here so it never renders as a
    // bogus 0-field entity in the outline/card view.
    TRACEABILITY_SECTION_HEADING,
]);

const CALLOUT_RE = /^>\s*\[!(CONSTRAINT|PRIVACY|INDEX|RELATIONSHIP)\]\s*(.*)$/i;

export type ParsedCalloutKind = 'CONSTRAINT' | 'PRIVACY' | 'INDEX' | 'RELATIONSHIP';

export interface ParsedCallout {
    kind: ParsedCalloutKind;
    text: string;
}

export interface ParsedFieldGroup {
    name: FieldGroupName;
    fields: DataField[];
}

export interface ParsedEntity {
    name: string;
    description: string;
    purpose?: string;
    userFacing?: boolean;
    mutability?: string;
    fieldGroups: ParsedFieldGroup[];
    callouts: ParsedCallout[];
    exampleRecord?: string;
    /** Heuristic was used because the source data didn't supply explicit groups. */
    groupsAutoDetected: boolean;
}

export interface ParsedApiEndpoint {
    method: string;
    path: string;
    description: string;
    entity?: string;
}

export interface ParsedProductMapping {
    field: string;
    uiBehavior: string;
}

export interface ParsedDataModel {
    overview?: {
        summary: string;
        dataFlow: string;
        productOutcome: string;
    };
    relationshipFlow?: string;
    entities: ParsedEntity[];
    apiEndpoints: ParsedApiEndpoint[];
    productMapping: ParsedProductMapping[];
}

// ---------------------------------------------------------------------------
// Field-group heuristic
// ---------------------------------------------------------------------------

const SYSTEM_NAMES = new Set(['id', 'created_by', 'updated_by', 'version', 'schema_version']);
const PRIVACY_NAME_TOKENS = ['password', 'secret', 'token', 'ssn'];
const PRIVACY_DESC_TOKENS = ['pii', 'personal', 'private', 'encrypted', 'gdpr', 'redact', 'sensitive'];
const INTEGRATION_NAME_TOKENS = ['webhook', 'api_key', 'external', 'third_party'];
const INTEGRATION_DESC_TOKENS = ['payload', 'response'];

export function applyFieldGroupHeuristic(entity: DataEntity, allEntityNames: string[]): FieldGroup[] {
    const buckets: Record<FieldGroupName, string[]> = {
        'Key Product Fields': [],
        'Relationships': [],
        'System Metadata': [],
        'API / Integration': [],
        'Privacy / Safety': [],
    };

    const otherEntities = new Set(
        allEntityNames.filter(n => n.toLowerCase() !== entity.name.toLowerCase()).map(n => n.toLowerCase()),
    );

    for (const f of entity.fields) {
        const name = f.name.toLowerCase();
        const desc = (f.description || '').toLowerCase();
        const type = (f.type || '').toLowerCase();

        if (SYSTEM_NAMES.has(name) || name.endsWith('_at')) {
            buckets['System Metadata'].push(f.name);
            continue;
        }

        // `*_id` is decisive: matches an entity → Relationships, otherwise stays
        // in Key Product Fields (don't let downstream heuristics demote orphan IDs).
        if (name.endsWith('_id')) {
            const stem = name.slice(0, -3);
            const stemMatchesEntity = otherEntities.has(stem) || otherEntities.has(stem.replace(/s$/, ''));
            buckets[stemMatchesEntity ? 'Relationships' : 'Key Product Fields'].push(f.name);
            continue;
        }

        const isPrivacy =
            PRIVACY_NAME_TOKENS.some(t => name.includes(t)) ||
            PRIVACY_DESC_TOKENS.some(t => desc.includes(t));
        if (isPrivacy) {
            buckets['Privacy / Safety'].push(f.name);
            continue;
        }

        const isIntegration =
            INTEGRATION_NAME_TOKENS.some(t => name.includes(t)) ||
            ((type === 'json' || type === 'jsonb') && INTEGRATION_DESC_TOKENS.some(t => desc.includes(t)));
        if (isIntegration) {
            buckets['API / Integration'].push(f.name);
            continue;
        }

        buckets['Key Product Fields'].push(f.name);
    }

    return GROUP_ORDER
        .filter(n => buckets[n].length > 0)
        .map(n => ({ name: n, fieldNames: buckets[n] }));
}

function expandFieldGroups(entity: DataEntity, allEntityNames: string[]): { groups: ParsedFieldGroup[]; auto: boolean } {
    const provided = entity.fieldGroups?.filter(g => VALID_GROUP_NAMES.has(g.name) && g.fieldNames?.length > 0);
    const fieldsByName = new Map(entity.fields.map(f => [f.name, f]));

    if (provided && provided.length > 0) {
        const seen = new Set<string>();
        const groups: ParsedFieldGroup[] = provided.map(g => ({
            name: g.name,
            fields: g.fieldNames
                .map(name => {
                    seen.add(name);
                    return fieldsByName.get(name);
                })
                .filter((f): f is DataField => Boolean(f)),
        }));
        // Stash any fields the LLM forgot to assign into Key Product Fields.
        const missing = entity.fields.filter(f => !seen.has(f.name));
        if (missing.length > 0) {
            const existing = groups.find(g => g.name === 'Key Product Fields');
            if (existing) existing.fields.push(...missing);
            else groups.unshift({ name: 'Key Product Fields', fields: missing });
        }
        return { groups: groups.filter(g => g.fields.length > 0), auto: false };
    }

    const heuristic = applyFieldGroupHeuristic(entity, allEntityNames);
    const groups: ParsedFieldGroup[] = heuristic.map(g => ({
        name: g.name,
        fields: g.fieldNames.map(name => fieldsByName.get(name)).filter((f): f is DataField => Boolean(f)),
    }));
    return { groups: groups.filter(g => g.fields.length > 0), auto: true };
}

// ---------------------------------------------------------------------------
// ASCII relationship tree
// ---------------------------------------------------------------------------

export function buildRelationshipTree(entities: DataEntity[]): string {
    if (entities.length === 0) return '';

    const byName = new Map(entities.map(e => [e.name, e]));
    const inbound = new Map<string, number>();
    for (const e of entities) inbound.set(e.name, 0);
    for (const e of entities) {
        for (const r of e.relationships) {
            if (r.type === 'has_many' || r.type === 'has_one') {
                if (byName.has(r.target)) inbound.set(r.target, (inbound.get(r.target) ?? 0) + 1);
            } else if (r.type === 'belongs_to') {
                inbound.set(e.name, (inbound.get(e.name) ?? 0) + 1);
            }
        }
    }

    const roots = entities.filter(e => (inbound.get(e.name) ?? 0) === 0);
    const startNodes = roots.length > 0 ? roots : [entities[0]];
    const lines: string[] = [];
    const visited = new Set<string>();

    const walk = (name: string, depth: number) => {
        const indent = '  '.repeat(depth);
        const prefix = depth === 0 ? '' : '→ ';
        if (visited.has(name)) {
            lines.push(`${indent}${prefix}${name} (see above)`);
            return;
        }
        visited.add(name);
        lines.push(`${indent}${prefix}${name}`);
        const entity = byName.get(name);
        if (!entity) return;
        const children = entity.relationships
            .filter(r => (r.type === 'has_many' || r.type === 'has_one') && byName.has(r.target));
        for (const c of children) {
            walk(c.target, depth + 1);
        }
    };

    for (const r of startNodes) walk(r.name, 0);

    for (const e of entities) {
        if (!visited.has(e.name)) walk(e.name, 0);
    }

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Converter: DataModelContent -> markdown
// ---------------------------------------------------------------------------

function formatBool(b: boolean | undefined): string {
    return b ? 'User-facing' : 'Internal';
}

function formatMutability(m: string | undefined): string | undefined {
    if (!m) return undefined;
    return m.replace(/_/g, ' ');
}

export function dataModelToMarkdown(model: DataModelContent): string {
    const lines: string[] = ['# Data Model', ''];

    if (model.overview) {
        lines.push('## How This Data Model Works');
        lines.push('');
        lines.push(model.overview.summary.trim());
        lines.push('');
        lines.push(`**Data flow:** ${model.overview.dataFlow.trim()}`);
        lines.push('');
        lines.push(`**Product outcome:** ${model.overview.productOutcome.trim()}`);
        lines.push('');
    }

    const tree = buildRelationshipTree(model.entities);
    if (tree) {
        lines.push('## Relationship Flow');
        lines.push('');
        lines.push('```text');
        lines.push(tree);
        lines.push('```');
        lines.push('');
    }

    const allEntityNames = model.entities.map(e => e.name);
    for (const entity of model.entities) {
        lines.push(`## ${entity.name}`);
        lines.push('');
        if (entity.description) {
            lines.push(entity.description.trim());
            lines.push('');
        }
        if (entity.purpose) {
            lines.push(`**Purpose:** ${entity.purpose.trim()}`);
        }
        if (entity.userFacing !== undefined) {
            lines.push(`**Visibility:** ${formatBool(entity.userFacing)}`);
        }
        const mut = formatMutability(entity.mutability);
        if (mut) {
            lines.push(`**Mutability:** ${mut}`);
        }
        if (entity.featureRefs?.length) {
            lines.push(`**Related Features:** ${entity.featureRefs.join(', ')}`);
        }
        if (entity.purpose || entity.userFacing !== undefined || mut || entity.featureRefs?.length) {
            lines.push('');
        }

        const { groups } = expandFieldGroups(entity, allEntityNames);
        if (groups.length > 0) {
            for (const group of groups) {
                lines.push(`**${group.name}**`);
                lines.push('');
                lines.push('| Field | Type | Required | Description |');
                lines.push('|-------|------|----------|-------------|');
                for (const f of group.fields) {
                    const desc = (f.description || '').replace(/\|/g, '\\|');
                    lines.push(`| ${f.name} | ${f.type} | ${f.required ? 'Yes' : 'No'} | ${desc} |`);
                }
                lines.push('');
            }
        } else if (entity.fields.length > 0) {
            // Defensive: no groups assignable; still emit a flat table to satisfy
            // the EXPECTED_HEADERS validation (Fields/Type/Required) and stay readable.
            lines.push('**Fields**');
            lines.push('');
            lines.push('| Field | Type | Required | Description |');
            lines.push('|-------|------|----------|-------------|');
            for (const f of entity.fields) {
                const desc = (f.description || '').replace(/\|/g, '\\|');
                lines.push(`| ${f.name} | ${f.type} | ${f.required ? 'Yes' : 'No'} | ${desc} |`);
            }
            lines.push('');
        }

        if (entity.relationships?.length) {
            for (const r of entity.relationships) {
                const desc = r.description ? ` (${r.description.trim()})` : '';
                lines.push(`> [!RELATIONSHIP] ${r.type.replace(/_/g, ' ')} → ${r.target}${desc}`);
            }
            lines.push('');
        }

        if (entity.indexes?.length) {
            for (const idx of entity.indexes) {
                lines.push(`> [!INDEX] ${idx.trim()}`);
            }
            lines.push('');
        }

        if (entity.constraints?.length) {
            for (const c of entity.constraints) {
                lines.push(`> [!CONSTRAINT] ${c.trim()}`);
            }
            lines.push('');
        }

        if (entity.privacyRules?.length) {
            for (const p of entity.privacyRules) {
                lines.push(`> [!PRIVACY] ${p.trim()}`);
            }
            lines.push('');
        }

        if (entity.exampleRecord) {
            const pretty = prettyJson(entity.exampleRecord);
            lines.push('**Example record**');
            lines.push('');
            lines.push('```json');
            lines.push(pretty);
            lines.push('```');
            lines.push('');
        }
    }

    if (model.productMapping?.length) {
        lines.push('## How This Appears in the Product');
        lines.push('');
        lines.push('| Field | UI behavior |');
        lines.push('|-------|-------------|');
        for (const m of model.productMapping) {
            const ui = (m.uiBehavior || '').replace(/\|/g, '\\|');
            lines.push(`| \`${m.field}\` | ${ui} |`);
        }
        lines.push('');
    }

    if (model.apiEndpoints?.length) {
        lines.push('## API Endpoints');
        lines.push('');
        lines.push('| Method | Path | Description | Entity |');
        lines.push('|--------|------|-------------|--------|');
        for (const ep of model.apiEndpoints) {
            const desc = (ep.description || '').replace(/\|/g, '\\|');
            lines.push(`| ${ep.method} | ${ep.path} | ${desc} | ${ep.entity} |`);
        }
        lines.push('');
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function prettyJson(raw: string): string {
    const trimmed = raw.trim();
    try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
        return trimmed;
    }
}

// ---------------------------------------------------------------------------
// Parser: markdown -> ParsedDataModel
// ---------------------------------------------------------------------------

interface RawSection {
    heading: string;
    /** Heading level: 1 for `#`, 2 for `##`, etc. */
    level: number;
    body: string[];
}

function splitTopSections(markdown: string): RawSection[] {
    const lines = markdown.split('\n');
    const sections: RawSection[] = [];
    let current: RawSection | null = null;

    for (const line of lines) {
        const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (m && m[1].length <= 2) {
            if (current) sections.push(current);
            current = { heading: m[2].trim(), level: m[1].length, body: [] };
            continue;
        }
        if (current) current.body.push(line);
    }
    if (current) sections.push(current);
    return sections;
}

function parseFieldsTable(lines: string[]): DataField[] {
    const fields: DataField[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const isHeader = /^\s*\|.*Field.*\|.*Type.*\|.*Required.*\|.*Description.*\|\s*$/i.test(line);
        if (isHeader && i + 1 < lines.length && /^\s*\|?\s*[-:|\s]+$/.test(lines[i + 1])) {
            i += 2;
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
                const cells = lines[i]
                    .trim()
                    .replace(/^\|/, '')
                    .replace(/\|$/, '')
                    .split(/(?<!\\)\|/)
                    .map(c => c.replace(/\\\|/g, '|').trim());
                if (cells.length >= 4) {
                    const required = /^(yes|true|y|✓|✔)$/i.test(cells[2]);
                    fields.push({
                        name: cells[0],
                        type: cells[1],
                        required,
                        description: cells[3],
                    });
                }
                i += 1;
            }
            continue;
        }
        i += 1;
    }
    return fields;
}

function parseEntitySection(name: string, body: string[]): ParsedEntity {
    let description = '';
    let purpose: string | undefined;
    let userFacing: boolean | undefined;
    let mutability: string | undefined;
    const callouts: ParsedCallout[] = [];
    const groups: ParsedFieldGroup[] = [];
    let exampleRecord: string | undefined;

    // First pass: collect callouts and the example record fenced block,
    // strip them from the body so subsequent parsing is clean.
    const cleaned: string[] = [];
    let inExampleFence = false;
    let exampleLines: string[] = [];
    let inOtherFence = false;
    let lastWasExampleHeader = false;

    for (const raw of body) {
        const line = raw;

        // Track fenced blocks
        if (/^\s*```/.test(line)) {
            if (inExampleFence) {
                inExampleFence = false;
                exampleRecord = exampleLines.join('\n').trim();
                exampleLines = [];
                continue;
            }
            if (inOtherFence) {
                inOtherFence = false;
                cleaned.push(line);
                continue;
            }
            // Fence opens. If preceded by an "example record" label, treat as example.
            if (lastWasExampleHeader && /^\s*```(json|text|)\s*$/i.test(line)) {
                inExampleFence = true;
                continue;
            }
            inOtherFence = true;
            cleaned.push(line);
            continue;
        }
        if (inExampleFence) {
            exampleLines.push(line);
            continue;
        }
        if (inOtherFence) {
            cleaned.push(line);
            continue;
        }

        const calloutMatch = line.match(CALLOUT_RE);
        if (calloutMatch) {
            const kind = calloutMatch[1].toUpperCase() as ParsedCalloutKind;
            callouts.push({ kind, text: calloutMatch[2].trim() });
            continue;
        }

        // Detect "example record" header to know that the next fenced block is the example.
        const isExampleHeader = /^\*\*Example record\*\*\s*$/i.test(line.trim());
        if (isExampleHeader) {
            lastWasExampleHeader = true;
            continue;
        }
        if (line.trim() !== '') lastWasExampleHeader = false;

        cleaned.push(line);
    }

    // Second pass: walk cleaned body to extract description, metadata lines,
    // and field groups (each delimited by a `**GroupName**` line followed by a table).
    let i = 0;
    const descParts: string[] = [];

    // Capture description until the first `**...:**` line, fence, group label, or table.
    while (i < cleaned.length) {
        const line = cleaned[i];
        const trimmed = line.trim();
        if (
            /^\*\*Purpose:\*\*/i.test(trimmed) ||
            /^\*\*Visibility:\*\*/i.test(trimmed) ||
            /^\*\*Mutability:\*\*/i.test(trimmed) ||
            /^\*\*[^*]+\*\*\s*$/.test(trimmed) ||
            /^\|/.test(trimmed)
        ) {
            break;
        }
        descParts.push(line);
        i += 1;
    }
    description = descParts.join('\n').trim();

    // Walk remaining: pick up purpose/visibility/mutability and field groups.
    let currentGroup: { name: FieldGroupName; lines: string[] } | null = null;

    const flushGroup = () => {
        if (currentGroup) {
            const fields = parseFieldsTable(currentGroup.lines);
            if (fields.length > 0) {
                groups.push({ name: currentGroup.name, fields });
            }
            currentGroup = null;
        }
    };

    while (i < cleaned.length) {
        const line = cleaned[i];
        const trimmed = line.trim();

        const purposeM = trimmed.match(/^\*\*Purpose:\*\*\s*(.*)$/i);
        if (purposeM) {
            purpose = purposeM[1].trim();
            i += 1;
            continue;
        }
        const visibilityM = trimmed.match(/^\*\*Visibility:\*\*\s*(.*)$/i);
        if (visibilityM) {
            const v = visibilityM[1].trim().toLowerCase();
            userFacing = v.startsWith('user');
            i += 1;
            continue;
        }
        const mutabilityM = trimmed.match(/^\*\*Mutability:\*\*\s*(.*)$/i);
        if (mutabilityM) {
            mutability = mutabilityM[1].trim();
            i += 1;
            continue;
        }

        // Legacy `**Relationships:**` block — must check before generic group
        // header matcher because `**Relationships:**` (with trailing colon) would
        // otherwise be captured as a group label.
        if (/^\*\*Relationships:\*\*\s*$/i.test(trimmed)) {
            flushGroup();
            i += 1;
            while (i < cleaned.length && /^\s*-\s+/.test(cleaned[i])) {
                callouts.push({ kind: 'RELATIONSHIP', text: cleaned[i].replace(/^\s*-\s+/, '').trim() });
                i += 1;
            }
            continue;
        }
        // Legacy: `**Indexes:** ...`
        const indexInlineM = trimmed.match(/^\*\*Indexes:\*\*\s*(.+)$/i);
        if (indexInlineM) {
            flushGroup();
            for (const idx of indexInlineM[1].split(',')) {
                const t = idx.trim();
                if (t) callouts.push({ kind: 'INDEX', text: t });
            }
            i += 1;
            continue;
        }
        // Legacy: `**Constraints:** ...`
        const constraintInlineM = trimmed.match(/^\*\*Constraints:\*\*\s*(.+)$/i);
        if (constraintInlineM) {
            flushGroup();
            for (const c of constraintInlineM[1].split(',')) {
                const t = c.trim();
                if (t) callouts.push({ kind: 'CONSTRAINT', text: t });
            }
            i += 1;
            continue;
        }

        // Group header? `**Key Product Fields**`, etc. The legacy patterns
        // above (with trailing colons) have already been consumed.
        const groupM = trimmed.match(/^\*\*([^*]+)\*\*\s*$/);
        if (groupM) {
            flushGroup();
            const label = groupM[1].trim();
            if (VALID_GROUP_NAMES.has(label)) {
                currentGroup = { name: label as FieldGroupName, lines: [] };
            } else if (label === 'Fields') {
                // Legacy or fallback bucket — render as Key Product Fields.
                currentGroup = { name: 'Key Product Fields', lines: [] };
            } else {
                currentGroup = null;
            }
            i += 1;
            continue;
        }

        if (currentGroup) {
            currentGroup.lines.push(line);
        }
        i += 1;
    }
    flushGroup();

    // If no groups parsed but we still see field-row lines in the cleaned body (legacy shape),
    // parse them into a default Key Product Fields group.
    if (groups.length === 0) {
        const fallbackFields = parseFieldsTable(cleaned);
        if (fallbackFields.length > 0) {
            groups.push({ name: 'Key Product Fields', fields: fallbackFields });
        }
    }

    return {
        name,
        description,
        purpose,
        userFacing,
        mutability,
        fieldGroups: groups,
        callouts,
        exampleRecord,
        groupsAutoDetected: false,
    };
}

function parseRelationshipFlow(body: string[]): string | undefined {
    let inFence = false;
    const lines: string[] = [];
    for (const line of body) {
        if (/^\s*```/.test(line)) {
            if (!inFence) {
                inFence = true;
                continue;
            }
            return lines.join('\n').trim() || undefined;
        }
        if (inFence) lines.push(line);
    }
    return lines.join('\n').trim() || undefined;
}

function parseOverview(body: string[]): ParsedDataModel['overview'] | undefined {
    let summary = '';
    let dataFlow = '';
    let productOutcome = '';
    const summaryLines: string[] = [];
    let captureSummary = true;

    for (const raw of body) {
        const line = raw.trim();
        const dfM = line.match(/^\*\*Data flow:\*\*\s*(.*)$/i);
        if (dfM) {
            captureSummary = false;
            dataFlow = dfM[1].trim();
            continue;
        }
        const poM = line.match(/^\*\*Product outcome:\*\*\s*(.*)$/i);
        if (poM) {
            captureSummary = false;
            productOutcome = poM[1].trim();
            continue;
        }
        if (captureSummary) summaryLines.push(raw);
    }
    summary = summaryLines.join('\n').trim();
    if (!summary && !dataFlow && !productOutcome) return undefined;
    return { summary, dataFlow, productOutcome };
}

function parseApiEndpointsTable(body: string[]): ParsedApiEndpoint[] {
    const out: ParsedApiEndpoint[] = [];
    let i = 0;
    while (i < body.length) {
        const line = body[i];
        const isHeader = /^\s*\|.*Method.*\|.*Path.*\|.*Description.*\|/i.test(line);
        if (isHeader && i + 1 < body.length && /^\s*\|?\s*[-:|\s]+$/.test(body[i + 1])) {
            i += 2;
            while (i < body.length && /^\s*\|.*\|\s*$/.test(body[i])) {
                const cells = body[i]
                    .trim()
                    .replace(/^\|/, '')
                    .replace(/\|$/, '')
                    .split(/(?<!\\)\|/)
                    .map(c => c.replace(/\\\|/g, '|').trim());
                if (cells.length >= 3) {
                    out.push({
                        method: cells[0],
                        path: cells[1],
                        description: cells[2],
                        entity: cells[3],
                    });
                }
                i += 1;
            }
            continue;
        }
        i += 1;
    }
    return out;
}

function parseProductMappingTable(body: string[]): ParsedProductMapping[] {
    const out: ParsedProductMapping[] = [];
    let i = 0;
    while (i < body.length) {
        const line = body[i];
        const isHeader = /^\s*\|.*Field.*\|.*UI behavior.*\|/i.test(line);
        if (isHeader && i + 1 < body.length && /^\s*\|?\s*[-:|\s]+$/.test(body[i + 1])) {
            i += 2;
            while (i < body.length && /^\s*\|.*\|\s*$/.test(body[i])) {
                const cells = body[i]
                    .trim()
                    .replace(/^\|/, '')
                    .replace(/\|$/, '')
                    .split(/(?<!\\)\|/)
                    .map(c => c.replace(/\\\|/g, '|').trim());
                if (cells.length >= 2) {
                    out.push({
                        field: cells[0].replace(/^`|`$/g, ''),
                        uiBehavior: cells[1],
                    });
                }
                i += 1;
            }
            continue;
        }
        i += 1;
    }
    return out;
}

export function parseDataModelMarkdown(markdown: string): ParsedDataModel | null {
    if (!markdown || !markdown.trim()) return null;

    const sections = splitTopSections(markdown);
    if (sections.length === 0) return null;

    const result: ParsedDataModel = {
        entities: [],
        apiEndpoints: [],
        productMapping: [],
    };

    for (const section of sections) {
        if (section.level === 1) {
            // top heading (`# Data Model`) — skip
            continue;
        }
        const heading = section.heading;
        if (heading === 'How This Data Model Works') {
            result.overview = parseOverview(section.body);
            continue;
        }
        if (heading === 'Relationship Flow') {
            result.relationshipFlow = parseRelationshipFlow(section.body);
            continue;
        }
        if (heading === 'API Endpoints') {
            result.apiEndpoints = parseApiEndpointsTable(section.body);
            continue;
        }
        if (heading === 'How This Appears in the Product') {
            result.productMapping = parseProductMappingTable(section.body);
            continue;
        }
        if (TOP_SECTION_HEADINGS.has(heading)) {
            continue;
        }
        result.entities.push(parseEntitySection(heading, section.body));
    }

    if (result.entities.length === 0 && !result.overview && result.apiEndpoints.length === 0) {
        return null;
    }
    return result;
}
