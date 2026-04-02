import type { StructuredPRD, MarkupImageSpec, MarkupImageSubtype } from '../../types';
import { callGemini } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { markupImageSchema } from '../schemas/markupImageSchema';

const MARKUP_IMAGE_PROMPTS: Record<MarkupImageSubtype, string> = {
    screenshot_annotation: 'Create an annotated screenshot layout with numbered callouts highlighting key UI elements, issues, or design decisions. Use highlight boxes to draw attention to specific areas and callouts with explanatory text.',
    critique_board: 'Create a design critique board with highlight regions marking areas of concern, numbered markers for each issue, and callout boxes explaining what could be improved and why.',
    wireframe_callout: 'Create an annotated wireframe layout with labeled boxes for each UI section, arrows showing user flow between elements, and text blocks describing component behavior.',
    flow_annotation: 'Create a flow diagram with numbered steps, arrows showing progression between steps, and text labels describing each action and decision point.',
    design_feedback: 'Create a visual feedback board with highlight regions, arrows pointing to specific elements, and callout boxes with constructive feedback and suggestions.',
};

function clampMarkupImagePositions(spec: MarkupImageSpec): MarkupImageSpec {
    const { width, height } = spec.canvas;
    return {
        ...spec,
        layers: spec.layers.map(layer => ({
            ...layer,
            position: {
                x: Math.max(0, Math.min(width - 20, layer.position.x)),
                y: Math.max(0, Math.min(height - 20, layer.position.y)),
            },
        })),
    };
}

export const generateMarkupImage = async (
    subtype: MarkupImageSubtype,
    prdContent: string,
    structuredPRD: StructuredPRD,
    sourceArtifactContent?: string,
    options?: ProviderOptions,
): Promise<MarkupImageSpec> => {
    options?.onStatus?.(`Generating ${subtype.replace(/_/g, ' ')}...`);

    const subtypeInstruction = MARKUP_IMAGE_PROMPTS[subtype];

    const system = `You are an expert UI/UX designer and visual annotation specialist. Generate a structured annotation specification in JSON format.

${subtypeInstruction}

Important layout rules:
- Canvas should be 1280x800 pixels with a light background (#f8f8f8 or similar)
- Position all elements within the canvas bounds (0-1280 for x, 0-800 for y)
- Use consistent colors: red (#ef4444) for issues, blue (#3b82f6) for notes, green (#22c55e) for approvals, amber (#f59e0b) for warnings
- Number markers should be 24px circles with white text
- Callouts should be 200-300px wide with 12-14px text
- Leave 20px padding from canvas edges
- Ensure no overlapping elements — space callouts clearly
- Use 4-8 annotation layers for a clear, readable result

Return a MarkupImageSpec with version "markup_v1".`;

    const prompt = `${subtypeInstruction}

PRD Summary:
Vision: ${structuredPRD.vision}
Core Problem: ${structuredPRD.coreProblem}
Features: ${structuredPRD.features.map(f => `${f.name}: ${f.description}`).join('\n')}
${sourceArtifactContent ? `\nSource Artifact:\n${sourceArtifactContent.slice(0, 2000)}` : ''}

Full PRD:\n${prdContent.slice(0, 3000)}`;

    const result = await callGemini(
        system,
        prompt,
        { responseMimeType: 'application/json', responseSchema: markupImageSchema }
    );

    try {
        const spec = JSON.parse(result) as MarkupImageSpec;
        // Post-process: clamp positions to canvas bounds
        return clampMarkupImagePositions(spec);
    } catch {
        throw new Error('Failed to parse markup image spec from LLM. Please try again.');
    }
};
