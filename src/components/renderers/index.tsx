import type { CoreArtifactSubtype } from '../../types';
import { ScreenInventoryRenderer } from './ScreenInventoryRenderer';
import { DataModelRenderer } from './DataModelRenderer';
import { ComponentInventoryRenderer } from './ComponentInventoryRenderer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface RendererProps {
    content: string;
}

type RendererComponent = React.ComponentType<RendererProps>;

const STRUCTURED_RENDERERS: Partial<Record<CoreArtifactSubtype, RendererComponent>> = {
    screen_inventory: ScreenInventoryRenderer,
    data_model: DataModelRenderer,
    component_inventory: ComponentInventoryRenderer,
};

/**
 * Render artifact content using a type-specific renderer if available,
 * falling back to ReactMarkdown for markdown content.
 */
export function ArtifactContentRenderer({ subtype, content }: { subtype: CoreArtifactSubtype; content: string }) {
    // Try structured renderer first
    const StructuredRenderer = STRUCTURED_RENDERERS[subtype];
    if (StructuredRenderer) {
        const rendered = <StructuredRenderer content={content} />;
        // If the structured renderer returns null (couldn't parse), fall back to markdown
        if (rendered !== null) return rendered;
    }

    // Default: markdown rendering
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
