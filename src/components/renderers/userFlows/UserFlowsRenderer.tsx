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
}

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

    const [selectedIndex, setSelectedIndex] = useState(0);
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

    return (
        <div className="flex gap-5 items-start">
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
                    timeToValue={ttvByFlow[safeIndex]}
                    featuresById={featuresById}
                    onSelectFeature={onSelectFeature}
                />

                <FlowJourney
                    flowIndex={safeIndex}
                    steps={flow.steps}
                    issuesByStep={issuesByStep}
                />

                {flow.steps.length > 0 && (
                    <section className="mb-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                            Step-by-step flow
                        </p>
                        {flow.steps.map(step => (
                            <StepCard
                                key={step.index}
                                flowIndex={safeIndex}
                                step={step}
                                inlineIssues={inlineByStep.get(step.index) ?? []}
                                featuresById={featuresById}
                                onSelectFeature={onSelectFeature}
                            />
                        ))}
                    </section>
                )}

                {flow.steps.length === 0 && flow.rest && (
                    <section className="bg-white rounded-xl border border-neutral-200 p-4 mb-4 prose prose-sm prose-neutral max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{flow.rest}</ReactMarkdown>
                    </section>
                )}

                <SuccessCriteriaBlock flow={flow} />

                <RelatedArtifactsPanel
                    flow={flow}
                    featuresById={featuresById}
                    onSelectFeature={onSelectFeature}
                    uxPages={uxPages}
                    domainEntities={domainEntities}
                    featureSystems={featureSystems}
                    implementationPlan={implementationPlan}
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
