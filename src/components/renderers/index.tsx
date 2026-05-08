import type { CoreArtifactSubtype, Feature } from '../../types';
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
    /**
     * Per-version metadata. Currently consumed only by `design_system` to
     * surface structured token contracts; other subtypes ignore it.
     */
    metadata?: Record<string, unknown>;
    /**
     * Project id, used by the design_system renderer to query downstream
     * mockup / component_inventory artifacts for the "Downstream Usage"
     * indicator. Optional — renderers fall back to a content-only view
     * when absent.
     */
    projectId?: string;
    /** Consumed by `prompt_pack` and `user_flows` for canonical feature ID resolution. */
    features?: Feature[];
    /** Only consumed by `prompt_pack`; per-prompt user edit overlay keyed by index. */
    promptEdits?: Record<number, string>;
    /** Only consumed by `prompt_pack`; persists the new edit overlay. */
    onUpdatePromptEdits?: (next: Record<number, string>) => void;
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

export function ArtifactContentRenderer({
    subtype,
    content,
    screenImageContext,
    metadata,
    projectId,
    features,
    promptEdits,
    onUpdatePromptEdits,
}: DispatchProps) {
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
        return <DesignSystemRenderer content={content} metadata={metadata} projectId={projectId} />;
    }
    if (subtype === 'user_flows') {
        return <UserFlowsRenderer content={content} features={features} />;
    }
    if (subtype === 'implementation_plan') {
        return <ImplementationPlanRenderer content={content} />;
    }
    if (subtype === 'prompt_pack') {
        return (
            <PromptPackRenderer
                content={content}
                features={features}
                edits={promptEdits}
                onUpdateEdits={onUpdatePromptEdits}
            />
        );
    }
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
