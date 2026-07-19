import { useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
    DomainEntity, Feature, FeatureSystem, ImplementationPlan, UXPage,
} from '../../../types';
import { parseFlows } from './parseFlow';
import type { FeatureRef, FlowIssue } from './types';
import { FlowSidebar } from './FlowSidebar';
import { FlowSummaryCard } from './FlowSummaryCard';
import { FlowJourney } from './FlowJourney';
import { StepCard } from './StepCard';
import { SuccessCriteriaBlock } from './SuccessCriteriaBlock';
import { IssuesPanel } from './IssuesPanel';
import { FeatureDetailDrawer } from './FeatureDetailDrawer';
import { RelatedArtifactsPanel } from './RelatedArtifactsPanel';
import { AssumptionsPanel } from './AssumptionsPanel';
import { computeRelatedArtifacts } from './relatedArtifacts';

interface Props {
    content: string;
    /** Canonical feature catalog from the current spine PRD. Optional — drawer
     * shows a graceful fallback when missing. */
    features?: Feature[];
    /** Optional related-artifact context from the structured PRD. Surfaced
     * in the "Related artifacts" panel via heuristic matching. */
    uxPages?: UXPage[];
    domainEntities?: DomainEntity[];
    featureSystems?: FeatureSystem[];
    implementationPlan?: ImplementationPlan;
    /** Experience-workspace wiring: clicking a screen journey node whose slug
     * exists in `availableScreenSlugs` opens that screen's detail view. Both
     * optional — omitted, the journey keeps its scroll-only behavior. */
    onNavigateToScreen?: (screenSlug: string) => void;
    availableScreenSlugs?: ReadonlySet<string>;
    initialFlowId?: string;
    initialStepIndex?: number;
}

const flowId = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow';

const TTV_RE = /<\s*(\d+(?:\.\d+)?)\s*(s|sec|seconds|m|min|minutes|h|hr|hours)\b|\b(\d+(?:\.\d+)?)\s*(s|sec|seconds|m|min|minutes|h|hr|hours)\s+to\s+value\b/i;

function inferTimeToValue(sources: Array<string | undefined>): string | null {
    const text = sources.filter(Boolean).join('\n');
    const m = text.match(TTV_RE);
    if (!m) return null;
    const value = m[1] ?? m[3];
    const unit = m[2] ?? m[4];
    if (!value || !unit) return null;
    return `<${value}${unit}`;
}

export function UserFlowsRenderer({
    content, features, uxPages, domainEntities, featureSystems, implementationPlan,
    onNavigateToScreen, availableScreenSlugs, initialFlowId, initialStepIndex,
}: Props) {
    const flows = useMemo(() => parseFlows(content), [content]);
    const featuresById = useMemo(() => {
        if (!features) return undefined;
        const map = new Map<string, Feature>();
        for (const f of features) {
            map.set(f.id.toLowerCase().replace(/-/g, ''), f);
        }
        return map;
    }, [features]);

    const ttvByFlow = useMemo(
        () => flows.map(f => inferTimeToValue([
            f.goal, f.successOutcome, f.preconditions, ...f.steps.map(s => s.rawText),
        ])),
        [flows],
    );

    const [selectedIndex, setSelectedIndex] = useState(() => {
        if (!initialFlowId) return 0;
        const index = flows.findIndex(flow => flowId(flow.title) === initialFlowId);
        return index >= 0 ? index : 0;
    });
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [drawerRef, setDrawerRef] = useState<FeatureRef | null>(null);
    const [drawerPinned, setDrawerPinned] = useState(false);

    const onSelectFeature = useCallback((refToken: FeatureRef) => {
        setDrawerRef(refToken);
    }, []);

    const onCloseDrawer = useCallback(() => {
        if (drawerPinned) return;
        setDrawerRef(null);
    }, [drawerPinned]);

    const onTogglePin = useCallback(() => {
        setDrawerPinned(p => !p);
    }, []);

    if (flows.length === 0) {
        return (
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }

    const safeIndex = Math.min(selectedIndex, flows.length - 1);
    const flow = flows[safeIndex];

    // Group inline issues by their linked step. Issues without a linked
    // step appear in the flow-level IssuesPanel.
    const inlineByStep = new Map<number, FlowIssue[]>();
    for (const issue of flow.issues) {
        if (typeof issue.linkedStepIndex !== 'number') continue;
        const list = inlineByStep.get(issue.linkedStepIndex) ?? [];
        list.push(issue);
        inlineByStep.set(issue.linkedStepIndex, list);
    }

    // Per-step issue counts surfaced on the journey nodes.
    const issuesByStep = new Map<number, number>();
    for (const issue of flow.issues) {
        if (typeof issue.linkedStepIndex !== 'number') continue;
        issuesByStep.set(
            issue.linkedStepIndex,
            (issuesByStep.get(issue.linkedStepIndex) ?? 0) + 1,
        );
    }

    const drawerFeature = drawerRef ? featuresById?.get(drawerRef.id) : undefined;

    // Heuristic join computed once, shared by the header relationship summary
    // and the Related Artifacts panel so their counts never disagree.
    const related = computeRelatedArtifacts(flow, {
        uxPages, domainEntities, implementationPlan, featureSystems,
    });

    return (
        // `not-prose` opts out of the surrounding ArtifactWorkspace `prose`
        // typography, which would otherwise indent <dd> values, and add stray
        // margins to the <dl>/<ul>/<h4>/<code> elements this card styles itself.
        <div className="not-prose md:flex md:gap-5 md:items-start">
            <FlowSidebar
                flows={flows}
                selectedIndex={safeIndex}
                onSelect={setSelectedIndex}
                isMobileOpen={mobileNavOpen}
                onToggleMobile={setMobileNavOpen}
                ttvByFlow={ttvByFlow}
            />
            <div className="flex-1 min-w-0">
                <FlowSummaryCard
                    flow={flow}
                    index={safeIndex}
                    featuresById={featuresById}
                    onSelectFeature={onSelectFeature}
                />

                {/* The journey is the SINGLE rendering of the flow's steps —
                    rows expand in place for full step detail. The old
                    "Step-by-step flow" section repeated every step as a second
                    full card list on the same page (audit H5). */}
                <FlowJourney
                    flowIndex={safeIndex}
                    steps={flow.steps}
                    issuesByStep={issuesByStep}
                    onNavigateToScreen={onNavigateToScreen}
                    availableScreenSlugs={availableScreenSlugs}
                    initialExpandedStepIndex={initialStepIndex}
                    renderStepDetail={(stepIndex) => {
                        const step = flow.steps[stepIndex];
                        if (!step) return null;
                        return (
                            <StepCard
                                embedded
                                flowIndex={safeIndex}
                                step={step}
                                inlineIssues={inlineByStep.get(stepIndex) ?? []}
                                featuresById={featuresById}
                                onSelectFeature={onSelectFeature}
                            />
                        );
                    }}
                />

                {flow.steps.length === 0 && flow.rest && (
                    <section className="bg-white rounded-xl border border-neutral-200 p-4 mb-4 prose prose-sm prose-neutral max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{flow.rest}</ReactMarkdown>
                    </section>
                )}

                <SuccessCriteriaBlock flow={flow} />

                <RelatedArtifactsPanel
                    related={related}
                    featuresById={featuresById}
                    onSelectFeature={onSelectFeature}
                />

                <IssuesPanel
                    flowIndex={safeIndex}
                    issues={flow.issues.filter(i => typeof i.linkedStepIndex !== 'number')}
                    edgeCases={flow.edgeCases}
                    steps={flow.steps}
                    featuresById={featuresById}
                    onSelectFeature={onSelectFeature}
                />

                <AssumptionsPanel
                    flow={flow}
                    featuresById={featuresById}
                    onSelectFeature={onSelectFeature}
                />
            </div>

            <FeatureDetailDrawer
                open={drawerRef !== null}
                refToken={drawerRef}
                feature={drawerFeature}
                flows={flows}
                onClose={onCloseDrawer}
                pinned={drawerPinned}
                onTogglePin={onTogglePin}
            />
        </div>
    );
}
