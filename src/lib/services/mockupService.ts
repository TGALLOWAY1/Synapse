import type { MockupSettings } from '../../types';
import { callGemini } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';

const FIDELITY_INSTRUCTIONS: Record<string, string> = {
    low: 'Use simple ASCII wireframes with boxes, lines, and placeholder text. Focus on layout and content hierarchy, not visual detail.',
    mid: 'Use structured text descriptions with clear component names, layout specifications, and content placeholders. Include navigation and interaction notes.',
    high: 'Provide detailed, polished descriptions including typography, spacing, color suggestions, hover states, and micro-interactions.',
};

const PLATFORM_INSTRUCTIONS: Record<string, string> = {
    desktop: 'Design for a desktop/laptop viewport (1280px+ width). Use appropriate navigation patterns like sidebars, top bars, and multi-column layouts.',
    mobile: 'Design for mobile viewport (375px width). Use mobile patterns like bottom navigation, hamburger menus, and single-column layouts.',
    responsive: 'Describe both desktop and mobile layouts, noting how the design adapts across breakpoints.',
};

const SCOPE_INSTRUCTIONS: Record<string, string> = {
    single_screen: 'Generate a single, detailed screen mockup.',
    multi_screen: 'Generate mockups for 3-5 key screens that represent the core experience.',
    key_workflow: 'Generate mockups for a complete key user workflow, showing each step and transition.',
};

export const generateMockup = async (
    prdContent: string,
    settings: MockupSettings,
    options?: ProviderOptions
): Promise<string> => {
    options?.onStatus?.('Generating mockup...');

    const system = `You are an expert UI/UX designer. Generate text-based mockups for a product based on its PRD.

${FIDELITY_INSTRUCTIONS[settings.fidelity]}
${PLATFORM_INSTRUCTIONS[settings.platform]}
${SCOPE_INSTRUCTIONS[settings.scope]}

${settings.style ? `Style direction: ${settings.style}` : ''}
${settings.notes ? `Additional notes: ${settings.notes}` : ''}

For each screen, provide:
1. Screen name and purpose
2. Visual layout using ASCII art or structured description
3. Component list with descriptions
4. Navigation and interaction notes
5. Content/copy placeholders

Use clear section headers and consistent formatting throughout.`;

    return callGemini(system, `Generate mockups based on this PRD:\n\n${prdContent}`);
};
