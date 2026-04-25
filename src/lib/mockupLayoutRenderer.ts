import { v4 as uuidv4 } from 'uuid';
import type {
    MockupLayoutAction,
    MockupLayoutActivityEntry,
    MockupLayoutDetailField,
    MockupLayoutEmptyState,
    MockupLayoutFilter,
    MockupLayoutScreen,
    MockupLayoutSection,
    MockupLayoutShell,
    MockupLayoutSpec,
    MockupLayoutStatRow,
    MockupLayoutTableRow,
    MockupPayload,
    MockupScreen,
} from '../types';
import { MOCKUP_LAYOUT_SPEC_V1, MOCKUP_TOKEN_SET_V1 } from '../types';
import { renderShell } from '../components/mockups/templates/shells';

// The renderer is the deterministic half of the Phase A pipeline. Given a
// valid MockupLayoutSpec, it produces a MockupPayload that downstream
// components (MockupViewer, buildMockupSrcDoc) already know how to render.
//
// Design rules:
// - Parse raw model JSON defensively. Gemini's JSON mode enforces schema
//   shape but not semantic completeness (e.g. a stat_grid with no rows).
// - Drop individual bad screens/sections rather than throwing on first issue.
// - If every screen is unusable, throw; the caller will decide whether to
//   retry or fall back.

export class MockupSpecParseError extends Error {
    warnings: string[];
    constructor(message: string, warnings: string[] = []) {
        super(message);
        this.name = 'MockupSpecParseError';
        this.warnings = warnings;
    }
}

export interface SpecParseResult {
    payload: MockupPayload;
    spec: MockupLayoutSpec;
    warnings: string[];
}

// ---- parsing helpers ----

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const asStringArray = (value: unknown, min: number, max: number): string[] | null => {
    if (!Array.isArray(value)) return null;
    const items = value.filter(isNonEmptyString).map(s => s.trim());
    if (items.length < min) return null;
    return items.slice(0, max);
};

const ALLOWED_SHELL_TYPES = ['sidebar_topbar', 'topbar_only', 'mobile_tab_shell'] as const;
const ALLOWED_PLATFORMS = ['desktop', 'mobile', 'responsive'] as const;
const ALLOWED_ROLES = ['primary', 'support', 'utility'] as const;
const ALLOWED_COMPONENTS = ['stat_grid', 'data_table', 'activity_feed', 'filters_bar', 'detail_panel', 'empty_state'] as const;
const ALLOWED_ACTION_KINDS = ['primary_cta', 'secondary_cta', 'input', 'select', 'tab'] as const;

const parseShell = (raw: unknown, fallbackProduct: string): MockupLayoutShell | null => {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const type = (ALLOWED_SHELL_TYPES as readonly string[]).includes(obj.type as string)
        ? (obj.type as MockupLayoutShell['type'])
        : 'sidebar_topbar';
    const platform = (ALLOWED_PLATFORMS as readonly string[]).includes(obj.platform as string)
        ? (obj.platform as MockupLayoutShell['platform'])
        : 'desktop';
    const navLabels = asStringArray(obj.navLabels, 3, 6)
        ?? ['Overview', 'Activity', 'Settings'];
    const productName = isNonEmptyString(obj.productName) ? obj.productName.trim() : fallbackProduct;
    return { type, platform, accent: 'indigo', productName, navLabels };
};

const parseStatRows = (raw: unknown): MockupLayoutStatRow[] | null => {
    if (!Array.isArray(raw)) return null;
    const rows = raw
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map(r => ({
            label: isNonEmptyString(r.label) ? r.label.trim() : '',
            value: isNonEmptyString(r.value) ? r.value.trim() : '',
            delta: isNonEmptyString(r.delta) ? r.delta.trim() : undefined,
        }))
        .filter(r => r.label && r.value);
    return rows.length >= 2 ? rows.slice(0, 6) : null;
};

const parseTableData = (raw: Record<string, unknown>): { columns: string[]; rows: MockupLayoutTableRow[] } | null => {
    const columns = asStringArray(raw.columns, 2, 6);
    if (!columns) return null;
    const tableRowsRaw = raw.tableRows;
    if (!Array.isArray(tableRowsRaw)) return null;
    const rows = tableRowsRaw
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map(r => {
            const cells = asStringArray(r.cells, 1, columns.length);
            return cells ? { cells: cells.slice(0, columns.length) } : null;
        })
        .filter((r): r is MockupLayoutTableRow => r !== null);
    return rows.length >= 1 ? { columns, rows: rows.slice(0, 8) } : null;
};

const parseActivityEntries = (raw: unknown): MockupLayoutActivityEntry[] | null => {
    if (!Array.isArray(raw)) return null;
    const entries = raw
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map(e => ({
            actor: isNonEmptyString(e.actor) ? e.actor.trim() : '',
            verb: isNonEmptyString(e.verb) ? e.verb.trim() : '',
            target: isNonEmptyString(e.target) ? e.target.trim() : '',
            when: isNonEmptyString(e.when) ? e.when.trim() : '',
        }))
        .filter(e => e.actor && e.verb && e.target && e.when);
    return entries.length >= 2 ? entries.slice(0, 6) : null;
};

const parseFilters = (raw: unknown): MockupLayoutFilter[] | null => {
    if (!Array.isArray(raw)) return null;
    const filters = raw
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map(f => {
            const label = isNonEmptyString(f.label) ? f.label.trim() : '';
            const options = asStringArray(f.options, 2, 5);
            return label && options ? { label, options } : null;
        })
        .filter((f): f is MockupLayoutFilter => f !== null);
    return filters.length >= 1 ? filters.slice(0, 4) : null;
};

const parseDetailFields = (raw: unknown): MockupLayoutDetailField[] | null => {
    if (!Array.isArray(raw)) return null;
    const fields = raw
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map(f => ({
            label: isNonEmptyString(f.label) ? f.label.trim() : '',
            value: isNonEmptyString(f.value) ? f.value.trim() : '',
        }))
        .filter(f => f.label && f.value);
    return fields.length >= 2 ? fields.slice(0, 8) : null;
};

const parseEmptyState = (raw: Record<string, unknown>): MockupLayoutEmptyState | null => {
    const heading = isNonEmptyString(raw.heading) ? raw.heading.trim() : '';
    const body = isNonEmptyString(raw.body) ? raw.body.trim() : '';
    if (!heading || !body) return null;
    const primaryActionLabel = isNonEmptyString(raw.primaryActionLabel)
        ? raw.primaryActionLabel.trim()
        : undefined;
    return { heading, body, primaryActionLabel };
};

const parseSection = (raw: unknown): MockupLayoutSection | null => {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const role = (ALLOWED_ROLES as readonly string[]).includes(obj.role as string)
        ? (obj.role as MockupLayoutSection['role'])
        : 'support';
    const component = (ALLOWED_COMPONENTS as readonly string[]).includes(obj.component as string)
        ? (obj.component as MockupLayoutSection['component'])
        : null;
    const heading = isNonEmptyString(obj.heading) ? obj.heading.trim() : '';
    if (!component || !heading) return null;
    const data = (obj.data && typeof obj.data === 'object') ? obj.data as Record<string, unknown> : {};

    switch (component) {
        case 'stat_grid': {
            const rows = parseStatRows(data.rows);
            return rows ? { role, heading, component, data: { rows } } : null;
        }
        case 'data_table': {
            const table = parseTableData(data);
            return table ? { role, heading, component, data: table } : null;
        }
        case 'activity_feed': {
            const entries = parseActivityEntries(data.entries);
            return entries ? { role, heading, component, data: { entries } } : null;
        }
        case 'filters_bar': {
            const filters = parseFilters(data.filters);
            return filters ? { role, heading, component, data: { filters } } : null;
        }
        case 'detail_panel': {
            const fields = parseDetailFields(data.fields);
            return fields ? { role, heading, component, data: { fields } } : null;
        }
        case 'empty_state': {
            const empty = parseEmptyState(data);
            return empty ? { role, heading, component, data: empty } : null;
        }
    }
};

const parseAction = (raw: unknown): MockupLayoutAction | null => {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const kind = (ALLOWED_ACTION_KINDS as readonly string[]).includes(obj.kind as string)
        ? (obj.kind as MockupLayoutAction['kind'])
        : null;
    const label = isNonEmptyString(obj.label) ? obj.label.trim().slice(0, 48) : '';
    if (!kind || !label) return null;
    return { kind, label };
};

const parseScreen = (raw: unknown, fallbackProduct: string, warnings: string[], idx: number): MockupLayoutScreen | null => {
    if (!raw || typeof raw !== 'object') {
        warnings.push(`Screen ${idx + 1}: skipped — not an object.`);
        return null;
    }
    const obj = raw as Record<string, unknown>;
    const name = isNonEmptyString(obj.name) ? obj.name.trim() : '';
    const purpose = isNonEmptyString(obj.purpose) ? obj.purpose.trim() : '';
    if (!name) {
        warnings.push(`Screen ${idx + 1}: skipped — missing name.`);
        return null;
    }
    const shell = parseShell(obj.shell, fallbackProduct);
    if (!shell) {
        warnings.push(`Screen ${idx + 1} ("${name}"): skipped — invalid shell.`);
        return null;
    }
    const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];
    const sections = sectionsRaw
        .map(parseSection)
        .filter((s): s is MockupLayoutSection => s !== null);
    if (sections.length < 2) {
        warnings.push(`Screen ${idx + 1} ("${name}"): skipped — fewer than 2 valid sections (${sections.length}).`);
        return null;
    }
    const actionsRaw = Array.isArray(obj.actions) ? obj.actions : [];
    const actions = actionsRaw
        .map(parseAction)
        .filter((a): a is MockupLayoutAction => a !== null)
        .slice(0, 4);
    if (actions.length === 0) {
        warnings.push(`Screen ${idx + 1} ("${name}"): skipped — no valid actions.`);
        return null;
    }
    return {
        id: uuidv4(),
        name,
        purpose,
        shell,
        sections: sections.slice(0, 4),
        actions,
    };
};

// ---- public API ----

export const parseLayoutSpec = (raw: string, fallbackProduct: string): SpecParseResult => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new MockupSpecParseError(
            `Mockup layout spec returned invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new MockupSpecParseError('Mockup layout spec returned a non-object response.');
    }
    const obj = parsed as Record<string, unknown>;
    const screensRaw = Array.isArray(obj.screens) ? obj.screens : [];
    if (screensRaw.length === 0) {
        throw new MockupSpecParseError('Mockup layout spec returned no screens.');
    }

    const warnings: string[] = [];
    const screens = screensRaw
        .map((s, i) => parseScreen(s, fallbackProduct, warnings, i))
        .filter((s): s is MockupLayoutScreen => s !== null);

    if (screens.length === 0) {
        throw new MockupSpecParseError(
            `Layout spec had ${screensRaw.length} screen(s) but none were usable. ${warnings.join(' ')}`,
            warnings,
        );
    }

    const title = isNonEmptyString(obj.title) ? obj.title.trim() : 'Mockup concept';
    const summary = isNonEmptyString(obj.summary) ? obj.summary.trim() : '';

    const spec: MockupLayoutSpec = {
        version: MOCKUP_LAYOUT_SPEC_V1,
        tokenSet: MOCKUP_TOKEN_SET_V1,
        title,
        summary,
        screens,
    };

    const renderedScreens: MockupScreen[] = screens.map(screen => ({
        id: screen.id,
        name: screen.name,
        purpose: screen.purpose,
        html: renderShell(screen),
    }));

    return {
        spec,
        payload: {
            version: 'mockup_html_v1',
            title,
            summary,
            screens: renderedScreens,
        },
        warnings,
    };
};

// Helper for tests and for the harness: render a known-good spec directly.
export const renderLayoutSpec = (spec: MockupLayoutSpec): MockupPayload => ({
    version: 'mockup_html_v1',
    title: spec.title,
    summary: spec.summary,
    screens: spec.screens.map(screen => ({
        id: screen.id,
        name: screen.name,
        purpose: screen.purpose,
        html: renderShell(screen),
    })),
});
