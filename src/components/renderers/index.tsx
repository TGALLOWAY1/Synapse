import type { CoreArtifactSubtype } from '../../types';
import { ScreenInventoryRenderer } from './ScreenInventoryRenderer';
import type { ScreenImageGalleryContext } from './ScreenImageGallery';
import { DataModelRenderer } from './DataModelRenderer';
import { ComponentInventoryRenderer } from './ComponentInventoryRenderer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface DispatchProps {
    subtype: CoreArtifactSubtype;
    content: string;
    /** Only consumed by `screen_inventory` today. Other subtypes ignore it. */
    screenImageContext?: ScreenImageGalleryContext;
}

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

export function ArtifactContentRenderer({ subtype, content, screenImageContext }: DispatchProps) {
    if (subtype === 'screen_inventory' && isJsonString(content)) {
        return <ScreenInventoryRenderer content={content} imageContext={screenImageContext} />;
    }
    if (subtype === 'data_model' && isJsonString(content)) {
        return <DataModelRenderer content={content} />;
    }
    if (subtype === 'component_inventory' && isJsonString(content)) {
        return <ComponentInventoryRenderer content={content} />;
    }
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
