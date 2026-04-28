// Deterministic StructuredPRD → premium markdown renderer.
//
// Used in two places:
// 1. Progressive render after Pass A — gives the user readable markdown
//    immediately, before Pass B's model-rendered version arrives.
// 2. After Pass C revision — re-renders the patched JSON without spending
//    another LLM call.
//
// The model-rendered output from Pass B is preferred for the final saved
// markdown when available, since it can produce tighter prose. This module
// is the safety net that always works.

import type {
    StructuredPRD,
    Feature,
    UXPage,
    StateMachine,
    Jtbd,
    UserLoop,
    Principle,
    RolePermission,
    RiskDetailed,
    SuccessMetric,
    ArchFlow,
    PrdEntity,
} from '../../types';

const tierTag = (tier?: string): string => {
    if (!tier) return '';
    if (tier === 'mvp') return ' `[MVP]`';
    if (tier === 'v1') return ' `[V1]`';
    if (tier === 'later') return ' `[Later]`';
    return '';
};

const escapeCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const renderJtbdTable = (jtbd: Jtbd[]): string[] => {
    const lines: string[] = [];
    lines.push('| Segment | Motivation | Job-to-be-Done | Pain Points | Success Moment |');
    lines.push('|---|---|---|---|---|');
    jtbd.forEach(j => {
        const pains = (j.painPoints || []).join('; ') || '—';
        lines.push(`| ${escapeCell(j.segment)} | ${escapeCell(j.motivation)} | ${escapeCell(j.job)} | ${escapeCell(pains)} | ${escapeCell(j.successMoment)} |`);
    });
    return lines;
};

const renderPrinciples = (principles: Principle[]): string[] => {
    const lines: string[] = [];
    principles.forEach(p => {
        lines.push(`- **${p.name}** — ${p.description}`);
    });
    return lines;
};

const renderUserLoops = (loops: UserLoop[]): string[] => {
    const lines: string[] = [];
    lines.push('| Loop | Trigger | Action | System Response | Reward | Retention |');
    lines.push('|---|---|---|---|---|---|');
    loops.forEach(l => {
        lines.push(`| ${escapeCell(l.name)} | ${escapeCell(l.trigger)} | ${escapeCell(l.action)} | ${escapeCell(l.systemResponse)} | ${escapeCell(l.reward)} | ${escapeCell(l.retentionMechanic)} |`);
    });
    return lines;
};

const renderUxPages = (pages: UXPage[]): string[] => {
    const lines: string[] = [];
    pages.forEach(page => {
        lines.push(`### ${page.name}`);
        lines.push(`**Purpose:** ${page.purpose}`);
        if (page.primaryUser) lines.push(`**Primary user:** ${page.primaryUser}`);
        if (page.components?.length) {
            lines.push('**Key components:**');
            page.components.forEach(c => lines.push(`- ${c}`));
        }
        if (page.interactions?.length) {
            lines.push('**Main interactions:**');
            page.interactions.forEach(i => lines.push(`- ${i}`));
        }
        if (page.emptyState) lines.push(`**Empty state:** ${page.emptyState}`);
        if (page.loadingState) lines.push(`**Loading state:** ${page.loadingState}`);
        if (page.errorState) lines.push(`**Error state:** ${page.errorState}`);
        if (page.responsiveNotes) lines.push(`**Responsive:** ${page.responsiveNotes}`);
        lines.push('');
    });
    return lines;
};

const renderFeature = (f: Feature): string[] => {
    const lines: string[] = [];
    lines.push(`### ${f.name}${tierTag(f.tier)}`);
    lines.push(f.description);
    lines.push('');
    lines.push(`- **User value:** ${f.userValue}`);
    lines.push(`- **Complexity:** ${f.complexity}`);
    if (f.priority) lines.push(`- **Priority:** ${f.priority}`);
    if (f.system) lines.push(`- **System:** ${f.system}`);
    if (f.dependencies?.length) lines.push(`- **Dependencies:** ${f.dependencies.join(', ')}`);

    const successList = f.successCriteria?.length ? f.successCriteria : f.acceptanceCriteria;
    if (successList?.length) {
        lines.push('');
        lines.push('**Acceptance criteria — success:**');
        successList.forEach(c => lines.push(`- ${c}`));
    }
    if (f.edgeCases?.length) {
        lines.push('');
        lines.push('**Acceptance criteria — edge cases:**');
        f.edgeCases.forEach(c => lines.push(`- ${c}`));
    }
    if (f.failureModes?.length) {
        lines.push('');
        lines.push('**Acceptance criteria — failure modes:**');
        f.failureModes.forEach(c => lines.push(`- ${c}`));
    }
    if (f.uiAcceptanceCriteria?.length) {
        lines.push('');
        lines.push('**Acceptance criteria — UI behavior:**');
        f.uiAcceptanceCriteria.forEach(c => lines.push(`- ${c}`));
    }
    if (f.analyticsEvents?.length) {
        lines.push('');
        lines.push('**Analytics events:**');
        f.analyticsEvents.forEach(c => lines.push(`- ${c}`));
    }
    lines.push('');
    return lines;
};

const renderEntity = (e: PrdEntity): string[] => {
    const lines: string[] = [];
    lines.push(`### ${e.name}`);
    lines.push(e.description);
    lines.push('');
    if (e.fields?.length) {
        lines.push('| Field | Type | Required | Notes |');
        lines.push('|---|---|---|---|');
        e.fields.forEach(field => {
            lines.push(`| ${escapeCell(field.name)} | ${escapeCell(field.type)} | ${field.required ? 'yes' : 'no'} | ${escapeCell(field.notes || '')} |`);
        });
        lines.push('');
    }
    if (e.relationships?.length) {
        lines.push('**Relationships:**');
        e.relationships.forEach(r => lines.push(`- ${r}`));
        lines.push('');
    }
    if (e.constraints?.length) {
        lines.push('**Constraints:**');
        e.constraints.forEach(c => lines.push(`- ${c}`));
        lines.push('');
    }
    if (e.examples?.length) {
        lines.push('**Example records:**');
        e.examples.forEach(ex => lines.push(`- ${ex}`));
        lines.push('');
    }
    return lines;
};

const renderStateMachine = (m: StateMachine): string[] => {
    const lines: string[] = [];
    lines.push(`### ${m.entity}`);
    lines.push('| State | Trigger | Next States | User-visible | System behavior |');
    lines.push('|---|---|---|---|---|');
    m.states.forEach(s => {
        const next = (s.nextStates || []).join(', ') || '—';
        lines.push(`| ${escapeCell(s.name)} | ${escapeCell(s.trigger || '—')} | ${escapeCell(next)} | ${escapeCell(s.userVisible || '—')} | ${escapeCell(s.systemBehavior || '—')} |`);
    });
    lines.push('');
    return lines;
};

const renderRoles = (roles: RolePermission[]): string[] => {
    const lines: string[] = [];
    roles.forEach(r => {
        lines.push(`### ${r.role}`);
        if (r.dataVisibility) lines.push(`**Data visibility:** ${r.dataVisibility}`);
        if (r.allowed?.length) {
            lines.push('**Allowed:**');
            r.allowed.forEach(a => lines.push(`- ${a}`));
        }
        if (r.restricted?.length) {
            lines.push('**Restricted:**');
            r.restricted.forEach(a => lines.push(`- ${a}`));
        }
        if (r.notes) lines.push(`> [!NOTE] ${r.notes}`);
        lines.push('');
    });
    return lines;
};

const renderArchFlows = (flows: ArchFlow[]): string[] => {
    const lines: string[] = [];
    flows.forEach(f => {
        lines.push(`### ${f.name}`);
        f.steps.forEach((step, idx) => lines.push(`${idx + 1}. ${step}`));
        lines.push('');
    });
    return lines;
};

const renderRisksDetailed = (risks: RiskDetailed[]): string[] => {
    const lines: string[] = [];
    lines.push('| Risk | Likelihood | Impact | Mitigation | Owner |');
    lines.push('|---|---|---|---|---|');
    risks.forEach(r => {
        lines.push(`| ${escapeCell(r.risk)} | ${r.likelihood} | ${escapeCell(r.impact)} | ${escapeCell(r.mitigation)} | ${escapeCell(r.owner || '—')} |`);
    });
    return lines;
};

const renderMetrics = (metrics: SuccessMetric[]): string[] => {
    const lines: string[] = [];
    lines.push('| Metric | Target | Instrumentation |');
    lines.push('|---|---|---|');
    metrics.forEach(m => {
        lines.push(`| ${escapeCell(m.name)} | ${escapeCell(m.target || '—')} | ${escapeCell(m.instrumentation || '—')} |`);
    });
    return lines;
};

/**
 * Render a StructuredPRD to canonical premium markdown. Always defensive —
 * legacy PRDs missing the new sections still render cleanly using the legacy
 * fields (vision, targetUsers, coreProblem, features, architecture, risks).
 */
export const renderPremiumMarkdown = (prd: StructuredPRD): string => {
    const lines: string[] = [];

    // Title
    const title = prd.productName || 'Product Requirements Document';
    lines.push(`# ${title}`);
    if (prd.productCategory) lines.push(`*${prd.productCategory}*`);
    lines.push('');

    // Executive Summary
    if (prd.executiveSummary) {
        lines.push('## Executive Summary');
        lines.push(prd.executiveSummary);
        lines.push('');
    }

    // Vision (always present in legacy spec)
    lines.push('## Vision');
    lines.push(prd.vision);
    lines.push('');

    // Product Thesis
    if (prd.productThesis) {
        lines.push('## Product Thesis');
        lines.push(`**Why this should exist:** ${prd.productThesis.whyExist}`);
        if (prd.productThesis.whyNow) lines.push(`**Why now:** ${prd.productThesis.whyNow}`);
        lines.push(`**Differentiation:** ${prd.productThesis.differentiation}`);
        if (prd.productThesis.intentionalTradeoffs?.length) {
            lines.push('');
            lines.push('**Intentional tradeoffs:**');
            prd.productThesis.intentionalTradeoffs.forEach(t => lines.push(`- ${t}`));
        }
        if (prd.productThesis.nonGoals?.length) {
            lines.push('');
            lines.push('**Non-goals — what this product should NOT become:**');
            prd.productThesis.nonGoals.forEach(g => lines.push(`- ${g}`));
        }
        lines.push('');
    }

    // Target Users + JTBD
    if (prd.jtbd?.length) {
        lines.push('## Target Users & Jobs-to-be-Done');
        renderJtbdTable(prd.jtbd).forEach(l => lines.push(l));
        lines.push('');
    } else if (prd.targetUsers?.length) {
        lines.push('## Target Users');
        prd.targetUsers.forEach(u => lines.push(`- ${u}`));
        lines.push('');
    }

    // Core Problem
    lines.push('## Core Problem');
    lines.push(prd.coreProblem);
    lines.push('');

    // Principles
    if (prd.principles?.length) {
        lines.push('## Product Principles');
        renderPrinciples(prd.principles).forEach(l => lines.push(l));
        lines.push('');
    }

    // User Loops
    if (prd.userLoops?.length) {
        lines.push('## Core User Loops');
        renderUserLoops(prd.userLoops).forEach(l => lines.push(l));
        lines.push('');
    }

    // UX Architecture
    if (prd.uxPages?.length) {
        lines.push('## UX Architecture');
        renderUxPages(prd.uxPages).forEach(l => lines.push(l));
    }

    // Feature Systems
    if (prd.featureSystems?.length) {
        lines.push('## Feature Systems');
        prd.featureSystems.forEach(s => {
            lines.push(`### ${s.name}`);
            lines.push(`**Purpose:** ${s.purpose}`);
            if (s.endToEndBehavior) lines.push(`**End-to-end behavior:** ${s.endToEndBehavior}`);
            if (s.featureIds?.length) lines.push(`**Features:** ${s.featureIds.join(', ')}`);
            if (s.dependencies?.length) lines.push(`**Dependencies:** ${s.dependencies.join(', ')}`);
            if (s.edgeCases?.length) {
                lines.push('**Edge cases:**');
                s.edgeCases.forEach(e => lines.push(`- ${e}`));
            }
            if (s.mvpVsLater) lines.push(`**MVP vs later:** ${s.mvpVsLater}`);
            lines.push('');
        });
    }

    // Detailed Features
    lines.push('## Detailed Features');
    prd.features.forEach(f => renderFeature(f).forEach(l => lines.push(l)));

    // Data Model
    if (prd.richDataModel?.entities?.length) {
        lines.push('## Data Model');
        prd.richDataModel.entities.forEach(e => renderEntity(e).forEach(l => lines.push(l)));
    }

    // State Machines
    if (prd.stateMachines?.length) {
        lines.push('## State Machines');
        prd.stateMachines.forEach(m => renderStateMachine(m).forEach(l => lines.push(l)));
    }

    // Roles
    if (prd.roles?.length) {
        lines.push('## Permissions & Roles');
        renderRoles(prd.roles).forEach(l => lines.push(l));
    }

    // Architecture
    lines.push('## Architecture');
    lines.push(prd.architecture);
    lines.push('');
    if (prd.architectureFlows?.length) {
        lines.push('### Example Flows');
        renderArchFlows(prd.architectureFlows).forEach(l => lines.push(l));
    }

    // NFRs
    if (prd.nonFunctionalRequirements?.length) {
        lines.push('## Non-Functional Requirements');
        prd.nonFunctionalRequirements.forEach(r => lines.push(`- ${r}`));
        lines.push('');
    }

    // Risks
    if (prd.risksDetailed?.length) {
        lines.push('## Risks');
        renderRisksDetailed(prd.risksDetailed).forEach(l => lines.push(l));
        lines.push('');
    } else if (prd.risks?.length) {
        lines.push('## Risks');
        prd.risks.forEach(r => lines.push(`- ${r}`));
        lines.push('');
    }

    // MVP Scope
    if (prd.mvpScope) {
        lines.push('## MVP Scope');
        if (prd.mvpScope.rationale) {
            lines.push(`> [!DECISION] ${prd.mvpScope.rationale}`);
            lines.push('');
        }
        lines.push('**MVP — ship first:**');
        prd.mvpScope.mvp.forEach(i => lines.push(`- \`[MVP]\` ${i}`));
        if (prd.mvpScope.v1?.length) {
            lines.push('');
            lines.push('**V1 — soon after launch:**');
            prd.mvpScope.v1.forEach(i => lines.push(`- \`[V1]\` ${i}`));
        }
        if (prd.mvpScope.later?.length) {
            lines.push('');
            lines.push('**Later — defer:**');
            prd.mvpScope.later.forEach(i => lines.push(`- \`[Later]\` ${i}`));
        }
        lines.push('');
    }

    // Success Metrics
    if (prd.successMetrics?.length) {
        lines.push('## Success Metrics');
        renderMetrics(prd.successMetrics).forEach(l => lines.push(l));
        lines.push('');
    }

    // Constraints
    if (prd.constraints?.length) {
        lines.push('## Constraints');
        prd.constraints.forEach(c => lines.push(`- ${c}`));
        lines.push('');
    }

    // Domain Entities (legacy grounding — still useful for downstream)
    if (prd.domainEntities?.length) {
        lines.push('## Domain Entities');
        prd.domainEntities.forEach(entity => {
            const descPart = entity.description ? ` — ${entity.description}` : '';
            lines.push(`- **${entity.name}**${descPart}`);
            if (entity.exampleValues?.length) {
                lines.push(`  - Examples: ${entity.exampleValues.join(', ')}`);
            }
        });
        lines.push('');
    }

    // Primary Actions (legacy grounding)
    if (prd.primaryActions?.length) {
        lines.push('## Primary Actions');
        prd.primaryActions.forEach(a => lines.push(`- ${a.verb} ${a.target}`));
        lines.push('');
    }

    // Assumptions — last so they're easy to find
    if (prd.assumptions?.length) {
        lines.push('## Assumptions');
        prd.assumptions.forEach(a => {
            lines.push(`> [!ASSUMPTION] **${a.confidence} confidence** — ${a.statement}`);
            lines.push('');
        });
    }

    return lines.join('\n').trimEnd() + '\n';
};
