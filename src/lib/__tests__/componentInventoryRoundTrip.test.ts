import { describe, it, expect } from 'vitest';
import { structuredArtifactToMarkdown } from '../services/coreArtifactService';
import { parseComponentInventoryMarkdown } from '../componentInventoryParse';
import type { ComponentInventoryContent } from '../../types';

describe('component inventory markdown round-trip', () => {
    it('preserves accessibility, previewType, and per-prop required through markdown', () => {
        const inventory: ComponentInventoryContent = {
            categories: [{
                name: 'Navigation',
                components: [{
                    name: 'SettingsAccordion',
                    purpose: 'Collapsible container for advanced configuration options.',
                    complexity: 'simple',
                    previewType: 'accordion',
                    props: [
                        { name: 'title', type: 'string', required: true, description: 'Header text of the accordion.' },
                        { name: 'onToggle', type: 'function', description: 'Callback when header is toggled.' },
                    ],
                    usedIn: ['Endpoint Discovery', 'Settings'],
                    accessibility: { keyboard: true, focusManagement: true, screenReader: true, aria: ['aria-expanded', 'aria-controls'] },
                    notes: 'Must animate height deterministically.',
                }],
            }],
        };

        const markdown = structuredArtifactToMarkdown('component_inventory', inventory);
        const parsed = parseComponentInventoryMarkdown(markdown);

        expect(parsed).not.toBeNull();
        const comp = parsed!.categories[0].components[0];
        expect(comp.name).toBe('SettingsAccordion');
        expect(comp.complexity).toBe('simple');
        expect(comp.previewType).toBe('accordion');
        expect(comp.usedIn).toEqual(['Endpoint Discovery', 'Settings']);
        expect(comp.props).toEqual([
            { name: 'title', type: 'string', required: true, description: 'Header text of the accordion.' },
            { name: 'onToggle', type: 'function', description: 'Callback when header is toggled.' },
        ]);
        expect(comp.accessibility).toMatchObject({
            keyboard: true,
            focusManagement: true,
            screenReader: true,
            aria: ['aria-expanded', 'aria-controls'],
        });
        expect(comp.notes).toBe('Must animate height deterministically.');
    });
});
