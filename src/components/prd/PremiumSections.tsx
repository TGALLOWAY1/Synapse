import type {
    Jtbd, Principle, UserLoop, UXPage, FeatureSystem, PrdDataModel,
    StateMachine, RolePermission, ArchFlow, RiskDetailed, MvpScope,
    SuccessMetric, Assumption, ProductThesis,
} from '../../types';

// Shared section wrapper. Mirrors the heading style used in StructuredPRDView
// for visual consistency.
function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
    return (
        <div id={id} className="mb-8 scroll-mt-24">
            <div className="flex items-center justify-between mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">{title}</h3>
            </div>
            {children}
        </div>
    );
}

const tierClasses: Record<string, string> = {
    mvp: 'bg-green-100 text-green-800 border-green-300',
    v1: 'bg-blue-100 text-blue-800 border-blue-300',
    later: 'bg-neutral-100 text-neutral-700 border-neutral-300',
};

export function MvpTag({ tier }: { tier?: 'mvp' | 'v1' | 'later' }) {
    if (!tier) return null;
    const cls = tierClasses[tier];
    const label = tier === 'mvp' ? 'MVP' : tier === 'v1' ? 'V1' : 'Later';
    return (
        <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
            {label}
        </span>
    );
}

export function ExecutiveSummarySection({ summary }: { summary: string }) {
    return (
        <Section title="Executive Summary" id="prd-executive-summary">
            <div className="p-4 bg-indigo-50/40 border border-indigo-100 rounded-lg text-sm text-neutral-800 whitespace-pre-wrap leading-relaxed">
                {summary}
            </div>
        </Section>
    );
}

export function ProductThesisSection({ thesis }: { thesis: ProductThesis }) {
    return (
        <Section title="Product Thesis" id="prd-product-thesis">
            <div className="space-y-3 p-4 bg-neutral-50 border border-neutral-200 rounded-lg text-sm text-neutral-800">
                <p><span className="font-semibold">Why this should exist:</span> {thesis.whyExist}</p>
                {thesis.whyNow && <p><span className="font-semibold">Why now:</span> {thesis.whyNow}</p>}
                <p><span className="font-semibold">Differentiation:</span> {thesis.differentiation}</p>
                {thesis.intentionalTradeoffs?.length ? (
                    <div>
                        <p className="font-semibold mb-1">Intentional tradeoffs:</p>
                        <ul className="list-disc pl-5 space-y-0.5">
                            {thesis.intentionalTradeoffs.map((t, i) => <li key={i}>{t}</li>)}
                        </ul>
                    </div>
                ) : null}
                {thesis.nonGoals?.length ? (
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-900">
                        <p className="font-semibold mb-1 text-xs uppercase tracking-wider">Non-goals — what this product should NOT become</p>
                        <ul className="list-disc pl-5 space-y-0.5 text-sm">
                            {thesis.nonGoals.map((g, i) => <li key={i}>{g}</li>)}
                        </ul>
                    </div>
                ) : null}
            </div>
        </Section>
    );
}

export function JtbdSection({ jtbd }: { jtbd: Jtbd[] }) {
    return (
        <Section title="Target Users & Jobs-to-be-Done" id="prd-jtbd">
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-neutral-500 uppercase text-[10px] tracking-wider">
                        <tr>
                            <th className="px-3 py-2 text-left">Segment</th>
                            <th className="px-3 py-2 text-left">Motivation</th>
                            <th className="px-3 py-2 text-left">Job-to-be-Done</th>
                            <th className="px-3 py-2 text-left">Pain Points</th>
                            <th className="px-3 py-2 text-left">Success Moment</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                        {jtbd.map((j, i) => (
                            <tr key={i}>
                                <td className="px-3 py-2 font-semibold text-neutral-800 align-top">{j.segment}</td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{j.motivation}</td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{j.job}</td>
                                <td className="px-3 py-2 text-neutral-700 align-top">
                                    {j.painPoints?.length ? (
                                        <ul className="list-disc pl-4 space-y-0.5">
                                            {j.painPoints.map((p, k) => <li key={k}>{p}</li>)}
                                        </ul>
                                    ) : '—'}
                                </td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{j.successMoment}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Section>
    );
}

export function PrinciplesSection({ principles }: { principles: Principle[] }) {
    return (
        <Section title="Product Principles" id="prd-principles">
            <div className="grid sm:grid-cols-2 gap-3">
                {principles.map((p, i) => (
                    <div key={i} className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                        <p className="text-sm font-bold text-neutral-900">{p.name}</p>
                        <p className="text-xs text-neutral-600 mt-1 leading-relaxed">{p.description}</p>
                    </div>
                ))}
            </div>
        </Section>
    );
}

export function UserLoopsSection({ loops }: { loops: UserLoop[] }) {
    return (
        <Section title="Core User Loops" id="prd-user-loops">
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-neutral-500 uppercase text-[10px] tracking-wider">
                        <tr>
                            <th className="px-3 py-2 text-left">Loop</th>
                            <th className="px-3 py-2 text-left">Trigger</th>
                            <th className="px-3 py-2 text-left">Action</th>
                            <th className="px-3 py-2 text-left">System Response</th>
                            <th className="px-3 py-2 text-left">Reward</th>
                            <th className="px-3 py-2 text-left">Retention</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                        {loops.map((l, i) => (
                            <tr key={i}>
                                <td className="px-3 py-2 font-semibold text-neutral-800 align-top">{l.name}</td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{l.trigger}</td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{l.action}</td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{l.systemResponse}</td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{l.reward}</td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{l.retentionMechanic}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Section>
    );
}

export function UxArchitectureSection({ pages }: { pages: UXPage[] }) {
    return (
        <Section title="UX Architecture" id="prd-ux-architecture">
            <div className="space-y-3">
                {pages.map((page) => (
                    <div key={page.id} className="p-4 bg-white border border-neutral-200 rounded-lg">
                        <div className="flex items-baseline justify-between mb-1">
                            <h4 className="text-base font-bold text-neutral-900">{page.name}</h4>
                            {page.primaryUser && (
                                <span className="text-[10px] uppercase tracking-wider text-neutral-500">{page.primaryUser}</span>
                            )}
                        </div>
                        <p className="text-sm text-neutral-700 mb-2">{page.purpose}</p>
                        <div className="grid sm:grid-cols-2 gap-3 text-xs">
                            {page.components?.length ? (
                                <div>
                                    <p className="font-semibold text-neutral-600 mb-1">Components</p>
                                    <ul className="list-disc pl-4 space-y-0.5 text-neutral-700">
                                        {page.components.map((c, i) => <li key={i}>{c}</li>)}
                                    </ul>
                                </div>
                            ) : null}
                            {page.interactions?.length ? (
                                <div>
                                    <p className="font-semibold text-neutral-600 mb-1">Interactions</p>
                                    <ul className="list-disc pl-4 space-y-0.5 text-neutral-700">
                                        {page.interactions.map((c, i) => <li key={i}>{c}</li>)}
                                    </ul>
                                </div>
                            ) : null}
                        </div>
                        {(page.emptyState || page.loadingState || page.errorState || page.responsiveNotes) && (
                            <div className="mt-3 grid sm:grid-cols-2 gap-2 text-[11px]">
                                {page.emptyState && (
                                    <div className="p-2 rounded bg-neutral-50 border border-neutral-200">
                                        <span className="font-semibold text-neutral-500">Empty:</span> <span className="text-neutral-700">{page.emptyState}</span>
                                    </div>
                                )}
                                {page.loadingState && (
                                    <div className="p-2 rounded bg-neutral-50 border border-neutral-200">
                                        <span className="font-semibold text-neutral-500">Loading:</span> <span className="text-neutral-700">{page.loadingState}</span>
                                    </div>
                                )}
                                {page.errorState && (
                                    <div className="p-2 rounded bg-neutral-50 border border-neutral-200">
                                        <span className="font-semibold text-neutral-500">Error:</span> <span className="text-neutral-700">{page.errorState}</span>
                                    </div>
                                )}
                                {page.responsiveNotes && (
                                    <div className="p-2 rounded bg-neutral-50 border border-neutral-200">
                                        <span className="font-semibold text-neutral-500">Responsive:</span> <span className="text-neutral-700">{page.responsiveNotes}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </Section>
    );
}

export function FeatureSystemsSection({ systems }: { systems: FeatureSystem[] }) {
    return (
        <Section title="Feature Systems" id="prd-feature-systems">
            <div className="grid sm:grid-cols-2 gap-3">
                {systems.map((s) => (
                    <div key={s.id} className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                        <p className="text-sm font-bold text-neutral-900">{s.name}</p>
                        <p className="text-xs text-neutral-600 mt-1 leading-relaxed">{s.purpose}</p>
                        {s.featureIds?.length ? (
                            <p className="text-[11px] text-neutral-500 mt-2">
                                <span className="font-semibold uppercase tracking-wider">Features:</span> {s.featureIds.join(', ')}
                            </p>
                        ) : null}
                        {s.endToEndBehavior && (
                            <p className="text-xs text-neutral-700 mt-2"><span className="font-semibold">End-to-end:</span> {s.endToEndBehavior}</p>
                        )}
                        {s.mvpVsLater && (
                            <p className="text-xs text-neutral-700 mt-1"><span className="font-semibold">MVP vs later:</span> {s.mvpVsLater}</p>
                        )}
                    </div>
                ))}
            </div>
        </Section>
    );
}

export function DataModelSection({ model }: { model: PrdDataModel }) {
    return (
        <Section title="Data Model" id="prd-data-model">
            <div className="space-y-4">
                {model.entities.map((e, idx) => (
                    <div key={idx} className="p-4 bg-white border border-neutral-200 rounded-lg">
                        <p className="text-base font-bold text-neutral-900">{e.name}</p>
                        <p className="text-sm text-neutral-700 mt-0.5 mb-3">{e.description}</p>
                        <div className="overflow-x-auto rounded border border-neutral-100">
                            <table className="w-full text-xs">
                                <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider">
                                    <tr>
                                        <th className="px-2 py-1.5 text-left">Field</th>
                                        <th className="px-2 py-1.5 text-left">Type</th>
                                        <th className="px-2 py-1.5 text-left">Required</th>
                                        <th className="px-2 py-1.5 text-left">Notes</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {e.fields.map((f, k) => (
                                        <tr key={k}>
                                            <td className="px-2 py-1.5 font-mono text-neutral-800">{f.name}</td>
                                            <td className="px-2 py-1.5 text-neutral-700">{f.type}</td>
                                            <td className="px-2 py-1.5 text-neutral-600">{f.required ? 'yes' : 'no'}</td>
                                            <td className="px-2 py-1.5 text-neutral-600">{f.notes || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {e.relationships?.length ? (
                            <div className="mt-2 text-xs">
                                <span className="font-semibold text-neutral-600">Relationships:</span>{' '}
                                <span className="text-neutral-700">{e.relationships.join('; ')}</span>
                            </div>
                        ) : null}
                        {e.examples?.length ? (
                            <div className="mt-2 text-xs">
                                <p className="font-semibold text-neutral-600">Example records:</p>
                                <ul className="list-disc pl-4 text-neutral-700 mt-0.5">
                                    {e.examples.map((ex, i) => <li key={i}>{ex}</li>)}
                                </ul>
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>
        </Section>
    );
}

export function StateMachinesSection({ machines }: { machines: StateMachine[] }) {
    return (
        <Section title="State Machines" id="prd-state-machines">
            <div className="space-y-4">
                {machines.map((m, idx) => (
                    <div key={idx}>
                        <p className="text-sm font-bold text-neutral-900 mb-2">{m.entity}</p>
                        <div className="overflow-x-auto rounded-lg border border-neutral-200">
                            <table className="w-full text-xs">
                                <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider">
                                    <tr>
                                        <th className="px-2 py-1.5 text-left">State</th>
                                        <th className="px-2 py-1.5 text-left">Trigger</th>
                                        <th className="px-2 py-1.5 text-left">Next States</th>
                                        <th className="px-2 py-1.5 text-left">User-visible</th>
                                        <th className="px-2 py-1.5 text-left">System behavior</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {m.states.map((s, k) => (
                                        <tr key={k}>
                                            <td className="px-2 py-1.5 font-mono text-neutral-800">{s.name}</td>
                                            <td className="px-2 py-1.5 text-neutral-700">{s.trigger || '—'}</td>
                                            <td className="px-2 py-1.5 text-neutral-700">{(s.nextStates || []).join(', ') || '—'}</td>
                                            <td className="px-2 py-1.5 text-neutral-700">{s.userVisible || '—'}</td>
                                            <td className="px-2 py-1.5 text-neutral-700">{s.systemBehavior || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>
        </Section>
    );
}

export function RolesSection({ roles }: { roles: RolePermission[] }) {
    return (
        <Section title="Permissions & Roles" id="prd-roles">
            <div className="grid sm:grid-cols-2 gap-3">
                {roles.map((r, i) => (
                    <div key={i} className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                        <p className="text-sm font-bold text-neutral-900">{r.role}</p>
                        {r.dataVisibility && (
                            <p className="text-[11px] text-neutral-500 mt-0.5"><span className="font-semibold">Data:</span> {r.dataVisibility}</p>
                        )}
                        {r.allowed?.length ? (
                            <div className="mt-2">
                                <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Allowed</p>
                                <ul className="list-disc pl-4 text-xs text-neutral-700">
                                    {r.allowed.map((a, k) => <li key={k}>{a}</li>)}
                                </ul>
                            </div>
                        ) : null}
                        {r.restricted?.length ? (
                            <div className="mt-2">
                                <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wider">Restricted</p>
                                <ul className="list-disc pl-4 text-xs text-neutral-700">
                                    {r.restricted.map((a, k) => <li key={k}>{a}</li>)}
                                </ul>
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>
        </Section>
    );
}

export function ArchFlowsSection({ flows }: { flows: ArchFlow[] }) {
    return (
        <Section title="Example Flows" id="prd-arch-flows">
            <div className="space-y-3">
                {flows.map((f, i) => (
                    <div key={i} className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                        <p className="text-sm font-bold text-neutral-900 mb-2">{f.name}</p>
                        <ol className="list-decimal pl-5 text-sm text-neutral-700 space-y-1">
                            {f.steps.map((s, k) => <li key={k}>{s}</li>)}
                        </ol>
                    </div>
                ))}
            </div>
        </Section>
    );
}

const likelihoodTone = (l: 'low' | 'med' | 'high') =>
    l === 'high' ? 'bg-red-100 text-red-800' :
    l === 'med' ? 'bg-amber-100 text-amber-800' :
    'bg-neutral-100 text-neutral-700';

export function RisksDetailedSection({ risks }: { risks: RiskDetailed[] }) {
    return (
        <Section title="Risks" id="prd-risks">
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-neutral-500 uppercase text-[10px] tracking-wider">
                        <tr>
                            <th className="px-3 py-2 text-left">Risk</th>
                            <th className="px-3 py-2 text-left">Likelihood</th>
                            <th className="px-3 py-2 text-left">Impact</th>
                            <th className="px-3 py-2 text-left">Mitigation</th>
                            <th className="px-3 py-2 text-left">Owner</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                        {risks.map((r, i) => (
                            <tr key={i}>
                                <td className="px-3 py-2 text-neutral-800 align-top">{r.risk}</td>
                                <td className="px-3 py-2 align-top">
                                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${likelihoodTone(r.likelihood)}`}>
                                        {r.likelihood}
                                    </span>
                                </td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{r.impact}</td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{r.mitigation}</td>
                                <td className="px-3 py-2 text-neutral-700 align-top">{r.owner || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Section>
    );
}

export function MvpScopeSection({ scope }: { scope: MvpScope }) {
    return (
        <Section title="MVP Scope" id="prd-mvp-scope">
            {scope.rationale && (
                <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                    <span className="text-[10px] uppercase font-bold tracking-wider mr-2 px-1.5 py-0.5 rounded bg-indigo-200 text-indigo-900">Decision</span>
                    {scope.rationale}
                </div>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-xs font-bold uppercase tracking-wider text-green-800 mb-2">MVP — ship first</p>
                    <ul className="list-disc pl-4 space-y-0.5 text-sm text-neutral-800">
                        {scope.mvp.map((i, k) => <li key={k}>{i}</li>)}
                    </ul>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-800 mb-2">V1 — soon after launch</p>
                    <ul className="list-disc pl-4 space-y-0.5 text-sm text-neutral-800">
                        {scope.v1.map((i, k) => <li key={k}>{i}</li>)}
                    </ul>
                </div>
                <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                    <p className="text-xs font-bold uppercase tracking-wider text-neutral-700 mb-2">Later — defer</p>
                    <ul className="list-disc pl-4 space-y-0.5 text-sm text-neutral-700">
                        {scope.later.map((i, k) => <li key={k}>{i}</li>)}
                    </ul>
                </div>
            </div>
        </Section>
    );
}

export function MetricsSection({ metrics }: { metrics: SuccessMetric[] }) {
    return (
        <Section title="Success Metrics" id="prd-metrics">
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-neutral-500 uppercase text-[10px] tracking-wider">
                        <tr>
                            <th className="px-3 py-2 text-left">Metric</th>
                            <th className="px-3 py-2 text-left">Target</th>
                            <th className="px-3 py-2 text-left">Instrumentation</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                        {metrics.map((m, i) => (
                            <tr key={i}>
                                <td className="px-3 py-2 font-semibold text-neutral-800">{m.name}</td>
                                <td className="px-3 py-2 text-neutral-700">{m.target || '—'}</td>
                                <td className="px-3 py-2 text-neutral-700">{m.instrumentation || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Section>
    );
}

const confidenceTone = (c: 'low' | 'med' | 'high') =>
    c === 'high' ? 'bg-emerald-100 text-emerald-800' :
    c === 'med' ? 'bg-amber-100 text-amber-800' :
    'bg-neutral-100 text-neutral-700';

export function AssumptionsSection({ assumptions }: { assumptions: Assumption[] }) {
    return (
        <Section title="Assumptions" id="prd-assumptions">
            <ul className="space-y-2">
                {assumptions.map(a => (
                    <li key={a.id} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                        <span className={`inline-block text-[10px] font-bold uppercase tracking-wider mr-2 px-1.5 py-0.5 rounded ${confidenceTone(a.confidence)}`}>
                            {a.confidence} confidence
                        </span>
                        {a.statement}
                    </li>
                ))}
            </ul>
        </Section>
    );
}
