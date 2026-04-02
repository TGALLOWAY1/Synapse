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
 *
 * Structured renderers expect JSON content. Since generateCoreArtifact()
 * converts JSON responses to markdown via structuredArtifactToMarkdown()
 * before storage, content is typically markdown. We check if the content
 * is valid JSON before attempting the structured renderer path.
 */
function isJsonString(str: string): boolean {
    try {
        JSON.parse(str);
        return true;
    } catch {
        return false;
    }
}

export function ArtifactContentRenderer({ subtype, content }: { subtype: CoreArtifactSubtype; content: string }) {
    const StructuredRenderer = STRUCTURED_RENDERERS[subtype];
    if (StructuredRenderer && isJsonString(content)) {
        return <StructuredRenderer content={content} />;
    }

    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
