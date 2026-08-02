import type {
    CoreArtifactSubtype, DomainEntity, Feature, FeatureSystem, ImplementationPlan, ProjectTask, UXPage,
} from '../../types';
import type { DependencyNodeStatus } from '../../lib/artifactDependencyGraph';
import type { ImplementationPlanProgress } from '../../lib/services/implementationPlanInsights';
import type { ImplementationPlanNavigationTarget } from '../../lib/planning/implementationPlanNavigation';
import type { PlanningArtifactRegionTarget } from '../../lib/planning/planningNavigation';
import type { BuildPacketArtifactSection } from '../../lib/planning/buildPacketReadiness';
import type { ComponentJoinScreen } from '../../lib/componentExperience';
import { ScreenInventoryRenderer } from './ScreenInventoryRenderer';
import type { ScreenImageGalleryContext } from './ScreenImageGallery';
import { ComponentInventoryRenderer } from './ComponentInventoryRenderer';
import { DataModelRenderer } from './DataModelRenderer';
import { DesignSystemRenderer } from './DesignSystemRenderer';
import { UserFlowsRenderer } from './UserFlowsRenderer';
import { ImplementationPlanRenderer } from './ImplementationPlanRenderer';
import type { PlanFinalReviewContext } from './implementationPlan/FinalReviewCard';
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
    /** Consumed by `user_flows` for canonical feature ID resolution. */
    features?: Feature[];
    /** Consumed only by `user_flows` to surface heuristic related-artifact links. */
    uxPages?: UXPage[];
    domainEntities?: DomainEntity[];
    featureSystems?: FeatureSystem[];
    implementationPlan?: ImplementationPlan;
    /**
     * Only consumed by `component_inventory`: screens projected from the
     * canonical Screens index (`componentJoinScreensFromIndex`) so each
     * component can show which screens reference it, and so component/screen
     * contradictions can be surfaced as advisories. Omitted → the components
     * render without back-references (there is no second screen join).
     */
    componentScreens?: readonly ComponentJoinScreen[];
    /** Consumed by `user_flows` (journey nodes) and `component_inventory`
     * (screen back-references): opens the matching Screen Detail view. */
    onNavigateToScreen?: (screenSlug: string) => void;
    availableScreenSlugs?: ReadonlySet<string>;
    /** Phase 5A region navigation. These values select and reveal the exact
     * flow/data-model region without changing either artifact. */
    initialFlowId?: string;
    initialFlowStepIndex?: number;
    initialDataEntityName?: string;
    initialDataMemberName?: string;
    initialDataMemberAspect?: PlanningArtifactRegionTarget['dataMemberAspect'];
    initialImplementationTarget?: ImplementationPlanNavigationTarget;
    /** Exact sub-surface requested by a Final Review blocker action. */
    initialBuildPacketSection?: BuildPacketArtifactSection;
    initialBuildPacketMilestoneId?: string;
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
    /** Consumed by `implementation_plan`: source PRD version label. (Data Model
     * shows provenance at the page level, so it doesn't take this.) */
    prdVersionLabel?: string;
    /**
     * Consumed by `implementation_plan`: canonical freshness. `data_model` no
     * longer takes this — its in-card freshness pill was removed as a
     * duplicate of the page-level provenance/freshness strip.
     */
    staleness?: DependencyNodeStatus;
    /** Only consumed by `implementation_plan`: build-packet context for the
     * Final Review decision surface (plan §W7). */
    planFinalReview?: PlanFinalReviewContext;
}

/**
 * Render artifact content using a type-specific renderer if available,
 * falling back to ReactMarkdown for markdown content.
 *
 * Two subtypes (`screen_inventory`, `data_model`) are stored as JSON when
 * generation succeeds and rendered through structured renderers; the
 * structured renderers return `null` if the content turns out not to be
 * JSON, and we fall through.
 *
 * The markdown-only subtypes (`component_inventory`, `design_system`,
 * `user_flows`, `implementation_plan`) get bespoke layouts that parse
 * the conventional markdown shapes into rich visual presentations
 * (color swatches, milestone timeline, prompt cards, etc.). Each
 * gracefully falls back to ReactMarkdown if the conventions don't
 * match — older artifacts always remain readable.
 *
 * `component_inventory` is reached from the **Components section inside the
 * Screens experience** (`ScreenComponentsSection`), not from a sidebar row: it
 * is a bridge artifact between screens and implementation, and per W4 of
 * docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md a separate top-level row would
 * re-fragment the same surface. It is deliberately absent from
 * `ARTIFACT_GROUPS`, so `selected` never holds it — exactly like
 * `screen_inventory`/`mockup`. It is no longer a *hidden* subtype.
 *
 * `prompt_pack` still has no dispatch branch: it is a retired
 * `CoreArtifactSubtype` (see `coreArtifactPipeline.ts`) that
 * `ArtifactWorkspace`'s `slotMetas` filters out of the sidebar, so `selected`
 * can never hold it and it falls through to the plain ReactMarkdown renderer
 * (its legacy content is consumed by the Implementation Plan adapter instead).
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
    componentScreens,
    onNavigateToScreen,
    availableScreenSlugs,
    initialFlowId,
    initialFlowStepIndex,
    initialDataEntityName,
    initialDataMemberName,
    initialDataMemberAspect,
    initialImplementationTarget,
    initialBuildPacketSection,
    initialBuildPacketMilestoneId,
    promptPackContent,
    savedTasks,
    onConvertToTasks,
    onUpdatePlanProgress,
    sourceVersions,
    prdVersionLabel,
    staleness,
    planFinalReview,
}: DispatchProps) {
    if (subtype === 'screen_inventory' && isJsonString(content)) {
        return <ScreenInventoryRenderer content={content} imageContext={screenImageContext} />;
    }
    if (subtype === 'data_model') {
        // PRD provenance (`prdVersionLabel`) is shown once at the page level, not
        // repeated inside the Data Model summary card — so it isn't passed here.
        return (
            <DataModelRenderer
                key={`${initialDataEntityName ?? 'data-model'}:${initialDataMemberAspect ?? ''}:${initialDataMemberName ?? ''}`}
                content={content}
                initialEntityName={initialDataEntityName}
                initialMemberName={initialDataMemberName}
                initialMemberAspect={initialDataMemberAspect}
                initialSection={initialBuildPacketSection === 'api_contract' ? 'api_contract' : undefined}
            />
        );
    }
    if (subtype === 'component_inventory') {
        // Falls back to plain markdown internally when the content isn't a
        // parseable component inventory (legacy / free-form artifacts).
        return (
            <ComponentInventoryRenderer
                content={content}
                screens={componentScreens}
                onNavigateToScreen={onNavigateToScreen}
            />
        );
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
                initialNavigationTarget={initialImplementationTarget}
                initialMilestoneId={
                    initialBuildPacketSection === 'first_milestone'
                        ? initialBuildPacketMilestoneId
                        : undefined
                }
                initialFinalReviewSection={initialBuildPacketSection === 'coverage' ? 'coverage' : undefined}
                finalReview={planFinalReview}
            />
        );
    }
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
