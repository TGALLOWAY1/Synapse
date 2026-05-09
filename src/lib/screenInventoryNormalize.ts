// Read-side normalization for the Screen Inventory artifact.
//
// Storage history:
//   - Pre-upgrade: structured JSON or markdown with `groups[].screens[]`,
//     priority enum 'core' | 'secondary' | 'supporting',
//     navigation as `navigationFrom` / `navigationTo` arrays,
//     UI elements as `components`.
//   - Post-upgrade: structured JSON with `sections[].screens[]`,
//     priority 'P0'..'P3', states/entryPoints/exitPaths/userIntent/etc.
//
// `parseScreenInventory()` accepts a raw JSON string (artifact content)
// and returns the normalized post-upgrade shape, or `null` if the input
// isn't structured screen-inventory JSON. Markdown content returns null
// so callers fall through to ReactMarkdown.

import type {
    ExitPath,
    LegacyScreenPriority,
    ScreenInventoryContent,
    ScreenInventorySection,
    ScreenItem,
    ScreenPriority,
    ScreenState,
    ScreenType,
} from '../types';

const LEGACY_PRIORITY_MAP: Record<LegacyScreenPriority, ScreenPriority> = {
    core: 'P0',
    secondary: 'P1',
    supporting: 'P2',
};

const VALID_PRIORITIES: ReadonlySet<string> = new Set(['P0', 'P1', 'P2', 'P3']);
const VALID_TYPES: ReadonlySet<string> = new Set(['screen', 'modal', 'overlay', 'system-state']);

export function parseScreenInventory(content: string): ScreenInventoryContent | null {
    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch {
        return null;
    }
    return normalizeScreenInventory(raw);
}

export function normalizeScreenInventory(raw: unknown): ScreenInventoryContent | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;

    if (Array.isArray(obj.sections)) {
        const sections = obj.sections
            .map(normalizeSection)
            .filter((s): s is ScreenInventorySection => s !== null);
        if (sections.length === 0) return null;
        return { sections };
    }

    if (Array.isArray(obj.groups)) {
        const sections = obj.groups
            .map(group => {
                if (!group || typeof group !== 'object') return null;
                const g = group as Record<string, unknown>;
                const title = typeof g.name === 'string' ? g.name : null;
                if (!title || !Array.isArray(g.screens)) return null;
                return normalizeSection({ title, screens: g.screens });
            })
            .filter((s): s is ScreenInventorySection => s !== null);
        if (sections.length === 0) return null;
        return { sections };
    }

    return null;
}

function normalizeSection(raw: unknown): ScreenInventorySection | null {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    const title = typeof s.title === 'string'
        ? s.title
        : typeof s.name === 'string' ? s.name : null;
    if (!title || !Array.isArray(s.screens)) return null;
    const screens = s.screens
        .map(normalizeScreen)
        .filter((sc): sc is ScreenItem => sc !== null);
    return {
        title,
        description: typeof s.description === 'string' ? s.description : undefined,
        flowSummary: typeof s.flowSummary === 'string' ? s.flowSummary : undefined,
        screens,
    };
}

function normalizeScreen(raw: unknown): ScreenItem | null {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    const name = typeof s.name === 'string' ? s.name : null;
    const purpose = typeof s.purpose === 'string' ? s.purpose : '';
    if (!name) return null;

    const priority = normalizePriority(s.priority);
    const type = typeof s.type === 'string' && VALID_TYPES.has(s.type)
        ? (s.type as ScreenType)
        : undefined;

    const components = stringArray(s.coreUIElements) ?? stringArray(s.components);
    const entryPoints = stringArray(s.entryPoints) ?? stringArray(s.navigationFrom);
    const exitPaths = normalizeExitPaths(s.exitPaths)
        ?? legacyNavigationToExits(s.navigationTo);

    return {
        id: typeof s.id === 'string' ? s.id : undefined,
        name,
        type,
        priority,
        purpose,
        userIntent: typeof s.userIntent === 'string' ? s.userIntent : undefined,
        states: normalizeStates(s.states),
        entryPoints,
        exitPaths,
        coreUIElements: components,
        components: stringArray(s.components),
        outputData: stringArray(s.outputData),
        risks: stringArray(s.risks),
        featureRefs: stringArray(s.featureRefs),
        navigationFrom: stringArray(s.navigationFrom),
        navigationTo: stringArray(s.navigationTo),
    };
}

function normalizePriority(raw: unknown): ScreenPriority {
    if (typeof raw !== 'string') return 'P1';
    if (VALID_PRIORITIES.has(raw)) return raw as ScreenPriority;
    if (raw in LEGACY_PRIORITY_MAP) {
        return LEGACY_PRIORITY_MAP[raw as LegacyScreenPriority];
    }
    return 'P1';
}

function normalizeStates(raw: unknown): ScreenState[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const states = raw
        .map((item): ScreenState | null => {
            if (!item || typeof item !== 'object') return null;
            const st = item as Record<string, unknown>;
            const name = typeof st.name === 'string' ? st.name : null;
            const description = typeof st.description === 'string' ? st.description : '';
            if (!name) return null;
            const out: ScreenState = { name, description };
            if (typeof st.trigger === 'string') out.trigger = st.trigger;
            if (typeof st.recoveryPath === 'string') out.recoveryPath = st.recoveryPath;
            return out;
        })
        .filter((s): s is ScreenState => s !== null);
    return states.length > 0 ? states : undefined;
}

function normalizeExitPaths(raw: unknown): ExitPath[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const paths = raw
        .map((item): ExitPath | null => {
            if (!item || typeof item !== 'object') return null;
            const e = item as Record<string, unknown>;
            const label = typeof e.label === 'string' ? e.label : null;
            const target = typeof e.target === 'string' ? e.target : null;
            if (!label || !target) return null;
            const out: ExitPath = { label, target };
            if (typeof e.condition === 'string') out.condition = e.condition;
            return out;
        })
        .filter((p): p is ExitPath => p !== null);
    return paths.length > 0 ? paths : undefined;
}

function legacyNavigationToExits(raw: unknown): ExitPath[] | undefined {
    const targets = stringArray(raw);
    if (!targets || targets.length === 0) return undefined;
    return targets.map(t => ({ label: t, target: t }));
}

function stringArray(raw: unknown): string[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const result = raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
    return result.length > 0 ? result : undefined;
}

// Render a normalized inventory back to markdown — used by export and by
// the dependency-context feeder so downstream artifacts keep reading
// human-readable input.
export function screenInventoryToMarkdown(inv: ScreenInventoryContent): string {
    const lines: string[] = ['# Screen Inventory\n'];
    inv.sections.forEach((section, idx) => {
        lines.push(`## ${idx + 1}. ${section.title}`);
        if (section.description) lines.push(section.description);
        if (section.flowSummary) lines.push(`_Flow: ${section.flowSummary}_`);
        lines.push('');
        for (const screen of section.screens) {
            const typeBit = screen.type ? ` _(${screen.type})_` : '';
            lines.push(`### ${screen.name} — ${screen.priority}${typeBit}`);
            lines.push(`**Purpose:** ${screen.purpose}`);
            if (screen.userIntent) lines.push(`**User intent:** ${screen.userIntent}`);
            if (screen.states?.length) {
                lines.push('**States:**');
                for (const st of screen.states) {
                    const trig = st.trigger ? ` _(trigger: ${st.trigger})_` : '';
                    lines.push(`- ${st.name}: ${st.description}${trig}`);
                }
            }
            if (screen.entryPoints?.length) {
                lines.push(`**Entry points:** ${screen.entryPoints.join(' · ')}`);
            }
            if (screen.exitPaths?.length) {
                lines.push('**Exit paths:**');
                for (const p of screen.exitPaths) {
                    const cond = p.condition ? ` _(when ${p.condition})_` : '';
                    lines.push(`- ${p.label} → ${p.target}${cond}`);
                }
            }
            const ui = screen.coreUIElements ?? screen.components;
            if (ui?.length) lines.push(`**Core UI elements:** ${ui.join(', ')}`);
            if (screen.outputData?.length) {
                lines.push(`**Output data:** ${screen.outputData.join(', ')}`);
            }
            if (screen.risks?.length) {
                lines.push('**Risks / edge cases:**');
                for (const r of screen.risks) lines.push(`- ${r}`);
            }
            if (screen.featureRefs?.length) {
                lines.push(`**Feature refs:** ${screen.featureRefs.join(', ')}`);
            }
            lines.push('');
        }
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
