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
    ScreenHandoffEvent,
    ScreenHandoffSpec,
    ScreenInventoryContent,
    ScreenInventorySection,
    ScreenItem,
    ScreenPriority,
    ScreenRiskDetail,
    ScreenState,
    ScreenStateType,
    ScreenType,
} from '../types';
import { slugifyScreenName } from './screenInventoryImageStore';

const LEGACY_PRIORITY_MAP: Record<LegacyScreenPriority, ScreenPriority> = {
    core: 'P0',
    secondary: 'P1',
    supporting: 'P2',
};

const VALID_PRIORITIES: ReadonlySet<string> = new Set(['P0', 'P1', 'P2', 'P3']);
const VALID_TYPES: ReadonlySet<string> = new Set(['screen', 'modal', 'overlay', 'system-state']);
const VALID_STATE_TYPES: ReadonlySet<string> = new Set([
    'default', 'loading', 'empty', 'error', 'success', 'disabled', 'permission', 'responsive', 'other',
]);
const VALID_RISK_SEVERITIES: ReadonlySet<string> = new Set(['low', 'medium', 'high']);

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
        return { sections: assignStableScreenIds(sections) };
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
        return { sections: assignStableScreenIds(sections) };
    }

    return null;
}

/**
 * Stamp a stable, unique `id` onto every screen (the canonical screen
 * identity for cross-artifact joins — see src/lib/screenExperience.ts).
 * Derivation is deterministic from the stored content, so legacy artifacts
 * with no ids resolve to the SAME ids on every read without regeneration,
 * and newly generated artifacts persist them (generation re-serializes the
 * normalized shape). Precedence per screen:
 *   1. an existing non-empty `id` from the content (model-emitted or a
 *      previously persisted derived id),
 *   2. the slug of the screen name (the join key images already use),
 *   3. the literal 'screen' fallback slugify provides.
 * Duplicates (either duplicate content ids or same-name screens) get a
 * deterministic `-2`, `-3`… suffix in document order. Never derived from a
 * user-facing rename — display-name edits are an overlay and do not touch
 * the stored content this reads.
 */
export function assignStableScreenIds(sections: ScreenInventorySection[]): ScreenInventorySection[] {
    const used = new Set<string>();
    for (const section of sections) {
        for (const screen of section.screens) {
            const fromContent = typeof screen.id === 'string' ? screen.id.trim() : '';
            const base = fromContent || slugifyScreenName(screen.name);
            let candidate = base;
            let n = 2;
            while (used.has(candidate)) {
                candidate = `${base}-${n}`;
                n += 1;
            }
            used.add(candidate);
            screen.id = candidate;
        }
    }
    return sections;
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

    // Phase 2 structured risks. When present, the legacy plain-string list is
    // derived from the descriptions so every existing consumer keeps working.
    const riskDetails = normalizeRiskDetails(s.riskDetails);
    const risks = stringArray(s.risks)
        ?? (riskDetails ? riskDetails.map(r => r.description) : undefined);

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
        risks,
        featureRefs: stringArray(s.featureRefs),
        riskDetails,
        acceptanceCriteria: stringArray(s.acceptanceCriteria),
        handoff: normalizeHandoff(s.handoff),
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
            // Phase 2 state-contract fields (optional).
            if (typeof st.type === 'string' && VALID_STATE_TYPES.has(st.type)) {
                out.type = st.type as ScreenStateType;
            }
            if (typeof st.systemBehavior === 'string' && st.systemBehavior) {
                out.systemBehavior = st.systemBehavior;
            }
            if (typeof st.required === 'boolean') out.required = st.required;
            if (typeof st.needsMockup === 'boolean') out.needsMockup = st.needsMockup;
            const criteria = stringArray(st.acceptanceCriteria);
            if (criteria) out.acceptanceCriteria = criteria;
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

function normalizeRiskDetails(raw: unknown): ScreenRiskDetail[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const details = raw
        .map((item): ScreenRiskDetail | null => {
            if (!item || typeof item !== 'object') return null;
            const r = item as Record<string, unknown>;
            const description = typeof r.description === 'string' && r.description
                ? r.description
                : null;
            if (!description) return null;
            const out: ScreenRiskDetail = { description };
            if (typeof r.severity === 'string' && VALID_RISK_SEVERITIES.has(r.severity)) {
                out.severity = r.severity as ScreenRiskDetail['severity'];
            }
            if (typeof r.proposedHandling === 'string' && r.proposedHandling) {
                out.proposedHandling = r.proposedHandling;
            }
            return out;
        })
        .filter((r): r is ScreenRiskDetail => r !== null);
    return details.length > 0 ? details : undefined;
}

function normalizeHandoff(raw: unknown): ScreenHandoffSpec | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const h = raw as Record<string, unknown>;
    const out: ScreenHandoffSpec = {};
    if (typeof h.route === 'string' && h.route.trim()) out.route = h.route.trim();
    const routeParams = stringArray(h.routeParams);
    if (routeParams) out.routeParams = routeParams;
    const primaryComponents = stringArray(h.primaryComponents);
    if (primaryComponents) out.primaryComponents = primaryComponents;
    const stateVariables = stringArray(h.stateVariables);
    if (stateVariables) out.stateVariables = stateVariables;
    if (Array.isArray(h.events)) {
        const events = h.events
            .map((item): ScreenHandoffEvent | null => {
                if (!item || typeof item !== 'object') return null;
                const e = item as Record<string, unknown>;
                if (typeof e.name !== 'string' || !e.name) return null;
                const ev: ScreenHandoffEvent = { name: e.name };
                if (typeof e.trigger === 'string' && e.trigger) ev.trigger = e.trigger;
                if (typeof e.effect === 'string' && e.effect) ev.effect = e.effect;
                return ev;
            })
            .filter((e): e is ScreenHandoffEvent => e !== null);
        if (events.length > 0) out.events = events;
    }
    const dataDependencies = stringArray(h.dataDependencies);
    if (dataDependencies) out.dataDependencies = dataDependencies;
    const apiDependencies = stringArray(h.apiDependencies);
    if (apiDependencies) out.apiDependencies = apiDependencies;
    const accessibilityNotes = stringArray(h.accessibilityNotes);
    if (accessibilityNotes) out.accessibilityNotes = accessibilityNotes;
    const responsiveNotes = stringArray(h.responsiveNotes);
    if (responsiveNotes) out.responsiveNotes = responsiveNotes;
    return Object.keys(out).length > 0 ? out : undefined;
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
                    const bits: string[] = [];
                    if (st.type) bits.push(st.type);
                    if (st.required) bits.push('required');
                    if (st.needsMockup) bits.push('needs mockup');
                    const tag = bits.length ? ` [${bits.join(', ')}]` : '';
                    const trig = st.trigger ? ` _(trigger: ${st.trigger})_` : '';
                    lines.push(`- ${st.name}${tag}: ${st.description}${trig}`);
                    if (st.systemBehavior) lines.push(`  - System: ${st.systemBehavior}`);
                    if (st.recoveryPath) lines.push(`  - Recovery: ${st.recoveryPath}`);
                    for (const c of st.acceptanceCriteria ?? []) {
                        lines.push(`  - Accept: ${c}`);
                    }
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
            if (screen.riskDetails?.length) {
                lines.push('**Risks / edge cases:**');
                for (const r of screen.riskDetails) {
                    const sev = r.severity ? ` _(severity: ${r.severity})_` : '';
                    lines.push(`- ${r.description}${sev}`);
                    if (r.proposedHandling) lines.push(`  - Handling: ${r.proposedHandling}`);
                }
            } else if (screen.risks?.length) {
                lines.push('**Risks / edge cases:**');
                for (const r of screen.risks) lines.push(`- ${r}`);
            }
            if (screen.acceptanceCriteria?.length) {
                lines.push('**Acceptance criteria:**');
                for (const c of screen.acceptanceCriteria) lines.push(`- ${c}`);
            }
            if (screen.handoff) {
                const h = screen.handoff;
                lines.push('**Developer handoff:**');
                if (h.route) {
                    const params = h.routeParams?.length ? ` (params: ${h.routeParams.join(', ')})` : '';
                    lines.push(`- Route: ${h.route}${params}`);
                }
                if (h.primaryComponents?.length) lines.push(`- Components: ${h.primaryComponents.join(', ')}`);
                if (h.stateVariables?.length) lines.push(`- State: ${h.stateVariables.join(', ')}`);
                if (h.events?.length) {
                    lines.push(`- Events: ${h.events.map(e => e.name).join(', ')}`);
                }
                if (h.dataDependencies?.length) lines.push(`- Data dependencies: ${h.dataDependencies.join(', ')}`);
                if (h.apiDependencies?.length) lines.push(`- API dependencies: ${h.apiDependencies.join(', ')}`);
                if (h.accessibilityNotes?.length) {
                    lines.push('- Accessibility:');
                    for (const a of h.accessibilityNotes) lines.push(`  - ${a}`);
                }
                if (h.responsiveNotes?.length) {
                    lines.push('- Responsive:');
                    for (const rNote of h.responsiveNotes) lines.push(`  - ${rNote}`);
                }
            }
            if (screen.featureRefs?.length) {
                lines.push(`**Feature refs:** ${screen.featureRefs.join(', ')}`);
            }
            lines.push('');
        }
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
