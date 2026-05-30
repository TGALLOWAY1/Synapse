// Render-side fallbacks for the two fields older Component Inventory data
// lacks: `previewType` and `accessibility`. Newer generations supply both
// (see componentInventorySchema); when absent we derive sensible defaults so
// every card still shows a live preview and a non-empty accessibility block.

import type { ComponentA11y, ComponentItem, ComponentPreviewType } from '../../../types';

/** Accessibility data plus a flag marking it as heuristic (unverified). */
export interface DerivedA11y extends ComponentA11y {
    /** True when the contract was inferred rather than authored. */
    reviewNeeded: boolean;
}

const NAME_RULES: ReadonlyArray<[RegExp, ComponentPreviewType]> = [
    [/accordion|collapse|expand|disclosure|drawer/i, 'accordion'],
    [/toggle|switch|checkbox/i, 'toggle'],
    [/button|cta|fab/i, 'button'],
    [/input|search|field|select|textarea|combobox|picker|dropdown/i, 'input'],
];

/**
 * Best-effort preview archetype for a component. Honors an explicit
 * `previewType` when present, otherwise matches the component name (and, as a
 * last resort, its props) against keyword rules. Falls back to 'custom'.
 */
export function inferPreviewType(component: Pick<ComponentItem, 'name' | 'previewType' | 'props'>): ComponentPreviewType {
    if (component.previewType) return component.previewType;

    const name = component.name ?? '';
    for (const [pattern, type] of NAME_RULES) {
        if (pattern.test(name)) return type;
    }

    // Fall back to prop-name hints (e.g. an `onToggle` or `checked` prop).
    const propBlob = (component.props ?? []).map(p => `${p.name} ${p.type}`).join(' ');
    if (/toggle|checked|switch/i.test(propBlob)) return 'toggle';
    if (/value|placeholder|onchange/i.test(propBlob)) return 'input';
    if (/onclick|onpress/i.test(propBlob)) return 'button';

    return 'custom';
}

// Heuristic accessibility contracts keyed by preview archetype. These are
// deliberately conservative defaults — the UI labels them "review needed".
const A11Y_BY_PREVIEW: Record<ComponentPreviewType, ComponentA11y> = {
    accordion: { keyboard: true, focusManagement: true, screenReader: true, aria: ['aria-expanded', 'aria-controls'] },
    input: { keyboard: true, focusManagement: true, screenReader: true, aria: ['aria-label'] },
    toggle: { keyboard: true, focusManagement: true, screenReader: true, aria: ['aria-checked', 'role="switch"'] },
    button: { keyboard: true, focusManagement: true, screenReader: true, aria: ['aria-label'] },
    custom: { keyboard: true, focusManagement: false, screenReader: true, aria: [] },
};

/**
 * Returns the component's authored accessibility contract when present
 * (reviewNeeded=false), otherwise a heuristic contract derived from the
 * inferred preview type (reviewNeeded=true). Never returns null so the card
 * always renders a dedicated accessibility block.
 */
export function deriveAccessibility(component: Pick<ComponentItem, 'name' | 'previewType' | 'props' | 'accessibility'>): DerivedA11y {
    if (component.accessibility) {
        return { ...component.accessibility, reviewNeeded: false };
    }
    const preview = inferPreviewType(component);
    return { ...A11Y_BY_PREVIEW[preview], reviewNeeded: true };
}
