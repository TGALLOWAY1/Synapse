import type { CoreArtifactSubtype } from '../../types';
import { ScreenInventoryRenderer } from './ScreenInventoryRenderer';
import type { ScreenImageGalleryContext } from './ScreenImageGallery';
import { DataModelRenderer } from './DataModelRenderer';
import { ComponentInventoryRenderer } from './ComponentInventoryRenderer';
import { DesignSystemRenderer } from './DesignSystemRenderer';
import { UserFlowsRenderer } from './UserFlowsRenderer';
import { ImplementationPlanRenderer } from './ImplementationPlanRenderer';
import { PromptPackRenderer } from './PromptPackRenderer';
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
 * Three subtypes (`screen_inventory`, `data_model`, `component_inventory`)
 * are stored as JSON when generation succeeds and rendered through
 * structured renderers; the structured renderers return `null` if the
 * content turns out not to be JSON, and we fall through.
 *
 * The four markdown-only subtypes (`design_system`, `user_flows`,
 * `implementation_plan`, `prompt_pack`) get bespoke layouts that parse
 * the conventional markdown shapes into rich visual presentations
 * (color swatches, milestone timeline, prompt cards, etc.). Each
 * gracefully falls back to ReactMarkdown if the conventions don't
 * match — older artifacts always remain readable.
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
    if (subtype === 'data_model') {
        return <DataModelRenderer content={content} />;
    }
    if (subtype === 'component_inventory' && isJsonString(content)) {
        return <ComponentInventoryRenderer content={content} />;
    }
    if (subtype === 'design_system') {
        return <DesignSystemRenderer content={content} />;
    }
    if (subtype === 'user_flows') {
        return <UserFlowsRenderer content={content} />;
    }
    if (subtype === 'implementation_plan') {
        return <ImplementationPlanRenderer content={content} />;
    }
    if (subtype === 'prompt_pack') {
        return <PromptPackRenderer content={content} />;
    }
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
