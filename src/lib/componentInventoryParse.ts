// Read-side parser for the Component Inventory artifact. The artifact is
// stored as markdown (rendered from the structured JSON during generation),
// so downstream consumers like the mockup spec builder need a way to walk
// back to component-name + usedIn pairs.

import type { ComponentInventoryContent, ComponentItem } from '../types';

const HEADING_CATEGORY = /^##\s+(.+?)\s*$/;
const HEADING_COMPONENT = /^####?\s+(.+?)\s*$/;
const FIELD_LINE = /^\*\*([A-Za-z][A-Za-z /]+?):\*\*\s*(.+?)\s*$/;

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
        } else if (key === 'notes') {
            currentComponent.notes = value;
        }
    }

    commitComponent();

    const nonEmpty = categories.filter(c => c.components.length > 0);
    if (nonEmpty.length === 0) return null;
    return { categories: nonEmpty };
}
