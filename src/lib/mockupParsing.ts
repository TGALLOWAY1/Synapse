import type {
    ArtifactVersion,
    MockupFidelity,
    MockupPayload,
    MockupPlatform,
    MockupScope,
    MockupScreen,
    MockupSettings,
    ScreenPriority,
    ScreenType,
} from '../types';
import { MOCKUP_HTML_V1, MOCKUP_SPEC_V1 } from '../types';

export const DEFAULT_MOCKUP_SETTINGS: MockupSettings = {
    platform: 'desktop',
    fidelity: 'mid',
    scope: 'key_workflow',
};

const VALID_PRIORITIES: ReadonlySet<string> = new Set(['P0', 'P1', 'P2', 'P3']);
const VALID_TYPES: ReadonlySet<string> = new Set(['screen', 'modal', 'overlay', 'system-state']);

const stringArray = (raw: unknown): string[] | undefined => {
    if (!Array.isArray(raw)) return undefined;
    const out = raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
    return out.length > 0 ? out : undefined;
};

const coerceScreen = (raw: unknown): MockupScreen | null => {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    const id = typeof s.id === 'string' && s.id.length > 0 ? s.id : null;
    const name = typeof s.name === 'string' && s.name.length > 0 ? s.name : null;
    if (!id || !name) return null;
    return {
        id,
        name,
        purpose: typeof s.purpose === 'string' ? s.purpose : '',
        userIntent: typeof s.userIntent === 'string' ? s.userIntent : undefined,
        priority: typeof s.priority === 'string' && VALID_PRIORITIES.has(s.priority)
            ? (s.priority as ScreenPriority)
            : undefined,
        type: typeof s.type === 'string' && VALID_TYPES.has(s.type)
            ? (s.type as ScreenType)
            : undefined,
        coreUIElements: stringArray(s.coreUIElements),
        componentRefs: stringArray(s.componentRefs),
        notes: typeof s.notes === 'string' ? s.notes : undefined,
        sourceScreenId: typeof s.sourceScreenId === 'string' && s.sourceScreenId.length > 0
            ? s.sourceScreenId
            : undefined,
    };
};

/** Extract a MockupPayload from an ArtifactVersion. Accepts both the
 *  current `mockup_spec_v1` shape and the legacy `mockup_html_v1` shape
 *  (the legacy `html` field is dropped on read). Returns null for
 *  unparseable content. */
export function tryParsePayload(version: ArtifactVersion): MockupPayload | null {
    const format = (version.metadata as { format?: string } | undefined)?.format;
    if (format !== MOCKUP_SPEC_V1 && format !== MOCKUP_HTML_V1) return null;
    try {
        const parsed = JSON.parse(version.content);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!Array.isArray(parsed.screens) || parsed.screens.length === 0) return null;

        const validScreens = parsed.screens
            .map((s: unknown) => coerceScreen(s))
            .filter((s: MockupScreen | null): s is MockupScreen => s !== null);
        if (validScreens.length === 0) return null;

        return {
            version: 'mockup_spec_v1',
            title: typeof parsed.title === 'string' ? parsed.title : 'Mockup concept',
            summary: typeof parsed.summary === 'string' ? parsed.summary : '',
            screens: validScreens,
        };
    } catch {
        return null;
    }
}

/** Safely extract MockupSettings from version metadata, falling back to
 *  sensible defaults so a corrupted metadata blob never crashes the UI. */
export function extractMockupSettings(version: ArtifactVersion): MockupSettings {
    const raw = (version.metadata as Record<string, unknown> | undefined)?.settings;
    if (!raw || typeof raw !== 'object') return DEFAULT_MOCKUP_SETTINGS;
    const s = raw as Record<string, unknown>;
    return {
        platform: (typeof s.platform === 'string' && ['mobile', 'desktop', 'responsive'].includes(s.platform)
            ? s.platform : 'desktop') as MockupPlatform,
        fidelity: (typeof s.fidelity === 'string' && ['low', 'mid', 'high'].includes(s.fidelity)
            ? s.fidelity : 'mid') as MockupFidelity,
        scope: (typeof s.scope === 'string' && ['single_screen', 'multi_screen', 'key_workflow'].includes(s.scope)
            ? s.scope : 'key_workflow') as MockupScope,
        style: typeof s.style === 'string' ? s.style : undefined,
        safeMode: s.safeMode === true ? true : undefined,
    };
}
