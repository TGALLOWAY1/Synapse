import type {
    ArtifactVersion,
    MockupFidelity,
    MockupPayload,
    MockupPlatform,
    MockupScope,
    MockupScreen,
    MockupSettings,
} from '../types';
import { MOCKUP_HTML_V1 } from '../types';

export const DEFAULT_MOCKUP_SETTINGS: MockupSettings = {
    platform: 'desktop',
    fidelity: 'mid',
    scope: 'key_workflow',
};

/** Extract a MockupPayload from an ArtifactVersion. Returns null for legacy
 *  markdown versions or unparseable content. Validates field types so
 *  corrupted localStorage data doesn't crash downstream renderers. */
export function tryParsePayload(version: ArtifactVersion): MockupPayload | null {
    const format = (version.metadata as { format?: string } | undefined)?.format;
    if (format !== MOCKUP_HTML_V1) return null;
    try {
        const parsed = JSON.parse(version.content);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!Array.isArray(parsed.screens) || parsed.screens.length === 0) return null;

        const validScreens = parsed.screens.filter(
            (s: unknown): s is MockupScreen =>
                !!s &&
                typeof s === 'object' &&
                typeof (s as Record<string, unknown>).id === 'string' &&
                typeof (s as Record<string, unknown>).name === 'string' &&
                typeof (s as Record<string, unknown>).html === 'string' &&
                ((s as Record<string, unknown>).html as string).trim().length > 0,
        );
        if (validScreens.length === 0) return null;

        return {
            version: 'mockup_html_v1',
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
