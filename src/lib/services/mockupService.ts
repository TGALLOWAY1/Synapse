import { v4 as uuidv4 } from 'uuid';
import type {
    ComponentInventoryContent,
    MockupPayload,
    MockupScope,
    MockupScreen,
    MockupSettings,
    ScreenInventoryContent,
    ScreenItem,
    ScreenPriority,
    StructuredPRD,
} from '../../types';

// Mockup generation no longer calls an LLM. Instead it deterministically
// derives a screen specification from the upstream artifacts that the AI
// generation pipeline has already produced:
//
//   - screen_inventory (which screens exist, their purpose, UI elements)
//   - component_inventory (which reusable components live on each screen)
//   - design_system (token contract for the AI image prompt downstream)
//
// The visual rendering is produced by OpenAI gpt-image-2 in
// mockupImageService; this service only shapes the per-screen specs the
// image prompt builds on.

export interface ParseResult {
    payload: MockupPayload;
    /** Non-fatal notes surfaced to the UI (e.g. "screen_inventory missing"). */
    warnings: string[];
}

const PRIORITY_RANK: Record<ScreenPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

const normalizePriority = (raw: ScreenItem['priority']): ScreenPriority => {
    if (raw === 'P0' || raw === 'P1' || raw === 'P2' || raw === 'P3') return raw;
    if (raw === 'core') return 'P0';
    if (raw === 'secondary') return 'P1';
    if (raw === 'supporting') return 'P2';
    return 'P1';
};

const scopeScreenCount = (scope: MockupScope): number => {
    if (scope === 'single_screen') return 1;
    if (scope === 'multi_screen') return 4;
    return 5; // key_workflow
};

const slugify = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Build a lookup of component-name -> matching screen slugs, derived from
// each component's `usedIn` array. The lookup is then inverted per-screen
// when we attach componentRefs.
const indexComponentsByScreen = (
    inv: ComponentInventoryContent | null,
): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    if (!inv) return map;
    for (const category of inv.categories ?? []) {
        for (const comp of category.components ?? []) {
            const usedIn = comp.usedIn ?? [];
            for (const screenName of usedIn) {
                const slug = slugify(screenName);
                if (!slug) continue;
                const list = map.get(slug) ?? [];
                if (!list.includes(comp.name)) list.push(comp.name);
                map.set(slug, list);
            }
        }
    }
    return map;
};

// Flatten all screens out of an inventory, preserving section order so a
// `key_workflow` scope can walk them as a coherent journey.
const flattenScreens = (inv: ScreenInventoryContent): ScreenItem[] => {
    const out: ScreenItem[] = [];
    for (const section of inv.sections ?? []) {
        for (const screen of section.screens ?? []) {
            if (screen.name) out.push(screen);
        }
    }
    return out;
};

// Pick the screens that should appear in the mockup, based on scope.
// `single_screen`: highest priority screen overall.
// `multi_screen`: top N screens by priority then inventory order.
// `key_workflow`: the first N P0/P1 screens in inventory order, preserving
// the section sequence so the workflow narrative reads correctly.
const selectScreens = (
    all: ScreenItem[],
    scope: MockupScope,
): ScreenItem[] => {
    const limit = scopeScreenCount(scope);

    const fullScreens = all.filter(s => !s.type || s.type === 'screen');
    const pool = fullScreens.length > 0 ? fullScreens : all;

    if (scope === 'key_workflow') {
        const ordered = pool.filter(s => {
            const p = normalizePriority(s.priority);
            return p === 'P0' || p === 'P1';
        });
        return (ordered.length > 0 ? ordered : pool).slice(0, limit);
    }

    const ranked = [...pool].sort((a, b) => {
        const pa = PRIORITY_RANK[normalizePriority(a.priority)];
        const pb = PRIORITY_RANK[normalizePriority(b.priority)];
        return pa - pb;
    });
    return ranked.slice(0, limit);
};

const buildScreenTitle = (structuredPRD?: StructuredPRD): string => {
    const product = structuredPRD?.productName?.trim();
    if (product) return `${product} — UI Mockups`;
    const visionFirstLine = structuredPRD?.vision?.split(/[.\n]/)[0]?.trim();
    if (visionFirstLine) return `${visionFirstLine.slice(0, 50)} — Mockups`;
    return 'Product Mockups';
};

const buildSummary = (
    structuredPRD: StructuredPRD | undefined,
    settings: MockupSettings,
    screenCount: number,
): string => {
    const scopeLabel =
        settings.scope === 'single_screen' ? 'single key screen' :
        settings.scope === 'multi_screen' ? `${screenCount} core screens` :
        `${screenCount}-step key workflow`;
    const platformLabel =
        settings.platform === 'mobile' ? 'mobile' :
        settings.platform === 'desktop' ? 'desktop' :
        'responsive';
    const vision = structuredPRD?.vision?.trim();
    if (vision) {
        return `${vision} Rendered as ${scopeLabel} for ${platformLabel}.`.replace(/\s+/g, ' ').trim();
    }
    return `${scopeLabel.charAt(0).toUpperCase()}${scopeLabel.slice(1)} rendered for ${platformLabel}.`;
};

/**
 * Derive a structured MockupPayload from upstream artifacts. No LLM call —
 * everything in the payload was already produced by upstream AI passes
 * (screen_inventory, component_inventory). Each MockupScreen carries
 * enough semantic context (purpose, userIntent, coreUIElements,
 * componentRefs) that the image-generation prompt downstream can be
 * tightly coupled to the rest of the design system.
 *
 * Returns a payload + warnings. When screen_inventory is missing, falls
 * back to a single placeholder screen so the UI still has something to
 * render and the user is steered toward generating the missing artifact.
 */
export const generateMockup = (
    settings: MockupSettings,
    structuredPRD: StructuredPRD | undefined,
    screenInventory: ScreenInventoryContent | null,
    componentInventory: ComponentInventoryContent | null,
): ParseResult => {
    const warnings: string[] = [];

    if (!screenInventory || !screenInventory.sections?.length) {
        warnings.push('Screen Inventory artifact is missing — mockup will use a placeholder screen.');
        const placeholder: MockupScreen = {
            id: uuidv4(),
            name: 'Primary Screen',
            purpose: structuredPRD?.vision ?? 'Primary product screen.',
        };
        return {
            payload: {
                version: 'mockup_spec_v1',
                title: buildScreenTitle(structuredPRD),
                summary: buildSummary(structuredPRD, settings, 1),
                screens: [placeholder],
            },
            warnings,
        };
    }

    if (!componentInventory) {
        warnings.push('Component Inventory artifact is missing — component coupling will be skipped.');
    }

    const componentsByScreen = indexComponentsByScreen(componentInventory);
    const allScreens = flattenScreens(screenInventory);

    if (allScreens.length === 0) {
        warnings.push('Screen Inventory has no screens — mockup will use a placeholder screen.');
        const placeholder: MockupScreen = {
            id: uuidv4(),
            name: 'Primary Screen',
            purpose: structuredPRD?.vision ?? 'Primary product screen.',
        };
        return {
            payload: {
                version: 'mockup_spec_v1',
                title: buildScreenTitle(structuredPRD),
                summary: buildSummary(structuredPRD, settings, 1),
                screens: [placeholder],
            },
            warnings,
        };
    }

    const picked = selectScreens(allScreens, settings.scope);

    const screens: MockupScreen[] = picked.map(item => {
        const slug = slugify(item.name);
        const componentRefs = componentsByScreen.get(slug);
        const uiElements = item.coreUIElements ?? item.components;
        return {
            id: uuidv4(),
            name: item.name,
            purpose: item.purpose,
            userIntent: item.userIntent,
            priority: normalizePriority(item.priority),
            type: item.type,
            coreUIElements: uiElements?.slice(0, 12),
            componentRefs,
            // Canonical inventory screen id (stamped by assignStableScreenIds
            // in screenInventoryNormalize) — the rename-safe join key the
            // Experience workspace prefers over name matching.
            sourceScreenId: item.id,
        };
    });

    return {
        payload: {
            version: 'mockup_spec_v1',
            title: buildScreenTitle(structuredPRD),
            summary: buildSummary(structuredPRD, settings, screens.length),
            screens,
        },
        warnings,
    };
};
