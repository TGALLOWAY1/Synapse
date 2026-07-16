import type {
    CoreArtifactSubtype, DomainEntity, Feature, FeatureSystem, ImplementationPlan, ProjectTask, StalenessState, UXPage,
} from '../../types';
import type { ImplementationPlanProgress } from '../../lib/services/implementationPlanInsights';
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
     * Per-version metadata. Consumed by `design_system` (structured token
     * contracts) and `implementation_plan` (the `planProgress` copy/gate
     * overlay); other subtypes ignore it.
     */
    metadata?: Record<string, unknown>;
    /**
     * Project id, used by the design_system renderer to look up the project's
     * selected design-direction preset for the design-direction note. Optional —
     * renderers fall back to a content-only view when absent.
     */
    projectId?: string;
    /** Consumed by `prompt_pack` and `user_flows` for canonical feature ID resolution. */
    features?: Feature[];
    /** Consumed only by `user_flows` to surface heuristic related-artifact links. */
    uxPages?: UXPage[];
    domainEntities?: DomainEntity[];
    featureSystems?: FeatureSystem[];
    implementationPlan?: ImplementationPlan;
    /** Only consumed by `user_flows`: Experience-workspace wiring so screen
     * journey nodes can open the matching Screen Detail view. */
    onNavigateToScreen?: (screenSlug: string) => void;
    availableScreenSlugs?: ReadonlySet<string>;
    /** Phase 5A region navigation. These values select and reveal the exact
     * flow/data-model region without changing either artifact. */
    initialFlowId?: string;
    initialFlowStepIndex?: number;
    initialDataEntityName?: string;
    /** Only consumed by `implementation_plan`: content of the project's legacy
     * standalone prompt_pack artifact, adapted into the consolidated view. */
    promptPackContent?: string;
    /** Only consumed by `implementation_plan`: saved (converted) project tasks
     * for this artifact — marks matching plan tasks as tracked. */
    savedTasks?: ProjectTask[];
    /** Only consumed by `implementation_plan`: opens the Convert-to-Tasks modal. */
    onConvertToTasks?: () => void;
    /** Only consumed by `implementation_plan`: persists the copy/gate-status
     * progress overlay (`metadata.planProgress`) on the version. */
    onUpdatePlanProgress?: (next: ImplementationPlanProgress) => void;
    /** Only consumed by `implementation_plan`: source artifact versions the
     * plan was generated from ("Data Model v1"), for coverage provenance. */
    sourceVersions?: string[];
    /** Only consumed by `prompt_pack`; per-prompt user edit overlay keyed by index. */
    promptEdits?: Record<number, string>;
    /** Only consumed by `prompt_pack`; persists the new edit overlay. */
    onUpdatePromptEdits?: (next: Record<number, string>) => void;
    /** Only consumed by `prompt_pack`; creation timestamp of the artifact version. */
    generatedAt?: number;
    /** Only consumed by `prompt_pack`; current artifact version number. */
    versionNumber?: number;
    /** Consumed by `implementation_plan`: source PRD version label. (Data Model
     * shows provenance at the page level, so it doesn't take this.) */
    prdVersionLabel?: string;
    /** Consumed by `data_model` and `implementation_plan`: freshness state. */
    staleness?: StalenessState;
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
    uxPages,
    domainEntities,
    featureSystems,
    implementationPlan,
    onNavigateToScreen,
    availableScreenSlugs,
    initialFlowId,
    initialFlowStepIndex,
    initialDataEntityName,
    promptPackContent,
    savedTasks,
    onConvertToTasks,
    onUpdatePlanProgress,
    sourceVersions,
    promptEdits,
    onUpdatePromptEdits,
    generatedAt,
    versionNumber,
    prdVersionLabel,
    staleness,
}: DispatchProps) {
    if (subtype === 'screen_inventory' && isJsonString(content)) {
        return <ScreenInventoryRenderer content={content} imageContext={screenImageContext} />;
    }
    if (subtype === 'data_model') {
        // PRD provenance (`prdVersionLabel`) is shown once at the page level, not
        // repeated inside the Data Model summary card — so it isn't passed here.
        return (
            <DataModelRenderer
                key={initialDataEntityName ?? 'data-model'}
                content={content}
                staleness={staleness}
                initialEntityName={initialDataEntityName}
            />
        );
    }
    if (subtype === 'component_inventory' && isJsonString(content)) {
        return <ComponentInventoryRenderer content={content} />;
    }
    if (subtype === 'design_system') {
        return <DesignSystemRenderer content={content} metadata={metadata} projectId={projectId} />;
    }
    if (subtype === 'user_flows') {
        return (
            <UserFlowsRenderer
                key={`${initialFlowId ?? 'flows'}:${initialFlowStepIndex ?? 'all'}`}
                content={content}
                features={features}
                uxPages={uxPages}
                domainEntities={domainEntities}
                featureSystems={featureSystems}
                implementationPlan={implementationPlan}
                onNavigateToScreen={onNavigateToScreen}
                availableScreenSlugs={availableScreenSlugs}
                initialFlowId={initialFlowId}
                initialStepIndex={initialFlowStepIndex}
            />
        );
    }
    if (subtype === 'implementation_plan') {
        return (
            <ImplementationPlanRenderer
                content={content}
                promptPackContent={promptPackContent}
                prdVersionLabel={prdVersionLabel}
                staleness={staleness}
                sourceVersions={sourceVersions}
                savedTasks={savedTasks}
                onConvertToTasks={onConvertToTasks}
                metadata={metadata}
                onUpdatePlanProgress={onUpdatePlanProgress}
            />
        );
    }
    if (subtype === 'prompt_pack') {
        return (
            <PromptPackRenderer
                content={content}
                features={features}
                edits={promptEdits}
                onUpdateEdits={onUpdatePromptEdits}
                generatedAt={generatedAt}
                versionNumber={versionNumber}
            />
        );
    }
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
