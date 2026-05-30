// Read-side parser for the Component Inventory artifact. The artifact is
// stored as markdown (rendered from the structured JSON during generation),
// so downstream consumers like the mockup spec builder need a way to walk
// back to component-name + usedIn pairs.

import type { ComponentA11y, ComponentInventoryContent, ComponentItem, ComponentPreviewType } from '../types';

const HEADING_CATEGORY = /^##\s+(.+?)\s*$/;
const HEADING_COMPONENT = /^####?\s+(.+?)\s*$/;
const FIELD_LINE = /^\*\*([A-Za-z][A-Za-z /]+?):\*\*\s*(.+?)\s*$/;
// A props bullet emitted by structuredArtifactToMarkdown, e.g.
//   - `title`: string (required) — Header text of the accordion.
const PROP_LINE = /^-\s+`([^`]+)`:\s*(.+?)\s*$/;
const PREVIEW_TYPES: ReadonlySet<string> = new Set(['accordion', 'input', 'toggle', 'button', 'custom']);

/** Parse a single props bullet value like "string (required) — Header text". */
function parsePropValue(name: string, value: string): NonNullable<ComponentItem['props']>[number] {
    let rest = value;
    let description: string | undefined;
    const dashIdx = rest.indexOf(' — ');
    if (dashIdx !== -1) {
        description = rest.slice(dashIdx + 3).trim() || undefined;
        rest = rest.slice(0, dashIdx);
    }
    let required = false;
    rest = rest.replace(/\(required\)/i, () => {
        required = true;
        return '';
    });
    const type = rest.trim();
    const prop: NonNullable<ComponentItem['props']>[number] = { name, type };
    if (required) prop.required = true;
    if (description) prop.description = description;
    return prop;
}

/** Parse the inline accessibility summary line into a structured contract. */
function parseAccessibility(value: string): ComponentA11y {
    const a11y: ComponentA11y = {};
    for (const rawSeg of value.split(';')) {
        const seg = rawSeg.trim();
        if (!seg) continue;
        const lower = seg.toLowerCase();
        if (lower === 'keyboard') a11y.keyboard = true;
        else if (lower === 'focus management') a11y.focusManagement = true;
        else if (lower === 'screen reader') a11y.screenReader = true;
        else if (lower.startsWith('aria:')) {
            a11y.aria = seg.slice(seg.indexOf(':') + 1).split(',').map(s => s.trim()).filter(Boolean);
        } else {
            a11y.notes = a11y.notes ? `${a11y.notes}; ${seg}` : seg;
        }
    }
    return a11y;
}

/**
 * Parse the markdown form emitted by `structuredArtifactToMarkdown('component_inventory', ...)`.
 * Returns null when the content is not parseable as a component inventory.
 * Also accepts raw JSON for completeness (some pipelines persist JSON).
 */
export function parseComponentInventoryMarkdown(content: string): ComponentInventoryContent | null {
    if (!content || !content.trim()) return null;

    // Try JSON first — cheap and unambiguous when present.
    try {
        const parsed = JSON.parse(content);
        if (parsed && Array.isArray(parsed.categories)) {
            return parsed as ComponentInventoryContent;
        }
    } catch {
        // Fall through to markdown parsing.
    }

    const lines = content.split(/\r?\n/);
    const categories: { name: string; components: ComponentItem[] }[] = [];

    let currentCategory: { name: string; components: ComponentItem[] } | null = null;
    let currentComponent: ComponentItem | null = null;

    const commitComponent = () => {
        if (currentCategory && currentComponent) {
            currentCategory.components.push(currentComponent);
        }
        currentComponent = null;
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const catMatch = line.match(HEADING_CATEGORY);
        if (catMatch) {
            commitComponent();
            currentCategory = { name: catMatch[1], components: [] };
            categories.push(currentCategory);
            continue;
        }

        const compMatch = line.match(HEADING_COMPONENT);
        if (compMatch && currentCategory) {
            commitComponent();
            currentComponent = {
                name: compMatch[1],
                purpose: '',
                complexity: 'moderate',
            };
            continue;
        }

        if (!currentComponent) continue;

        const propMatch = line.match(PROP_LINE);
        if (propMatch) {
            const prop = parsePropValue(propMatch[1], propMatch[2]);
            (currentComponent.props ??= []).push(prop);
            continue;
        }

        const fieldMatch = line.match(FIELD_LINE);
        if (!fieldMatch) continue;
        const key = fieldMatch[1].toLowerCase();
        const value = fieldMatch[2];

        if (key === 'purpose') {
            currentComponent.purpose = value;
        } else if (key === 'complexity') {
            const v = value.toLowerCase();
            if (v === 'simple' || v === 'moderate' || v === 'complex') {
                currentComponent.complexity = v;
            }
        } else if (key === 'used in') {
            currentComponent.usedIn = value
                .split(/[,;]/)
                .map(s => s.trim())
                .filter(Boolean);
        } else if (key === 'preview') {
            const v = value.toLowerCase();
            if (PREVIEW_TYPES.has(v)) {
                currentComponent.previewType = v as ComponentPreviewType;
            }
        } else if (key === 'accessibility') {
            currentComponent.accessibility = parseAccessibility(value);
        } else if (key === 'notes') {
            currentComponent.notes = value;
        }
    }

    commitComponent();

    const nonEmpty = categories.filter(c => c.components.length > 0);
    if (nonEmpty.length === 0) return null;
    return { categories: nonEmpty };
}
