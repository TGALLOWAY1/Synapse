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
    SuccessMetric,
    ArchFlow,
    PrdEntity,
} from '../../types';
import { coerceToBulletList } from '../textCleanup';
import {
    deriveDeferredFeatureIds,
    deriveImplementationSummary,
    isImplementationSummaryEmpty,
    splitFeaturesByTier,
} from '../derive/implementationSummary';
import { deriveDecisionLog } from '../derive/prdDecisions';
import { splitDecisionInputs, deriveRisks } from '../derive/prdViews';
import { sanitizeRolePermissions } from '../prdRolesSanitizer';
import { stripLeadingListNumber } from '../utils/stripLeadingListNumber';

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
    // Per-state subsections with bullet lists. The previous wide-table
    // layout could overflow horribly when the model emitted a degenerate
    // mega-string into one cell; bullets render cleanly at any width and
    // collapsing through coerceToBulletList prevents repetition leaking
    // through from legacy projects.
    const lines: string[] = [];
    lines.push(`### ${m.entity}`);
    lines.push('');
    m.states.forEach(s => {
        lines.push(`#### ${s.name}`);
        if (s.trigger) lines.push(`**Trigger:** ${s.trigger}`);
        const next = s.nextStates && s.nextStates.length ? s.nextStates.join(' → ') : '';
        if (next) lines.push(`**Next states:** ${next}`);
        const userVisible = coerceToBulletList(s.userVisible, { max: 6 });
        if (userVisible.length) {
            lines.push('**User-visible:**');
            userVisible.forEach(b => lines.push(`- ${b}`));
        }
        const systemBehavior = coerceToBulletList(s.systemBehavior, { max: 6 });
        if (systemBehavior.length) {
            lines.push('**System behavior:**');
            systemBehavior.forEach(b => lines.push(`- ${b}`));
        }
        lines.push('');
    });
    return lines;
};

const renderRoles = (rawRoles: RolePermission[]): string[] => {
    // Sanitize at render so legacy persisted PRDs (generated before the roles
    // quality gate) still display business-oriented, concise permissions.
    const roles = sanitizeRolePermissions(rawRoles) ?? rawRoles;
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
        f.steps.forEach((step, idx) => lines.push(`${idx + 1}. ${stripLeadingListNumber(step)}`));
        lines.push('');
    });
    return lines;
};

// Instrumentation was dropped from this table: new generations no longer
// produce it (analytics detail belongs to downstream artifacts) so the column
// rendered blank. Mirrors MetricsSection in PremiumSections.tsx.
const renderMetrics = (metrics: SuccessMetric[]): string[] => {
    const lines: string[] = [];
    lines.push('| Metric | Target |');
    lines.push('|---|---|');
    metrics.forEach(m => {
        lines.push(`| ${escapeCell(m.name)} | ${escapeCell(m.target || '—')} |`);
    });
    return lines;
};

// ── Part I — Product Overview ────────────────────────────────────────────────
const overviewLines = (prd: StructuredPRD): string[] => {
    const lines: string[] = [];

    if (prd.executiveSummary) {
        lines.push('## Executive Summary');
        lines.push(prd.executiveSummary);
        lines.push('');
    }

    // Problem & Opportunity → Vision → Value proposition (Product Thesis).
    lines.push('## Problem and Opportunity');
    lines.push(prd.coreProblem);
    lines.push('');

    lines.push('## Vision');
    lines.push(prd.vision);
    lines.push('');

    if (prd.productThesis) {
        lines.push('## Value Proposition');
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

    if (prd.principles?.length) {
        lines.push('## Product Principles');
        renderPrinciples(prd.principles).forEach(l => lines.push(l));
        lines.push('');
    }

    if (prd.jtbd?.length) {
        lines.push('## Target Users and Jobs');
        renderJtbdTable(prd.jtbd).forEach(l => lines.push(l));
        lines.push('');
    } else if (prd.targetUsers?.length) {
        lines.push('## Target Users and Jobs');
        prd.targetUsers.forEach(u => lines.push(`- ${u}`));
        lines.push('');
    }

    if (prd.successMetrics?.length) {
        lines.push('## Goals and Success Metrics');
        renderMetrics(prd.successMetrics).forEach(l => lines.push(l));
        lines.push('');
    }

    // Scope & Constraints — the single MVP/V1 scope surface (build-first order
    // + rationale); risks live in Part III to avoid duplicating them here.
    const summary = deriveImplementationSummary(prd);
    const hasScope = !isImplementationSummaryEmpty(summary) || !!prd.mvpScope?.rationale;
    if (hasScope || prd.constraints?.length || prd.nonFunctionalRequirements?.length) {
        lines.push('## Scope and Constraints');
        lines.push('');
        if (prd.mvpScope?.rationale) {
            lines.push(`> [!DECISION] ${prd.mvpScope.rationale}`);
            lines.push('');
        }
        if (summary.buildFirst.length > 0) {
            lines.push('### Build First (MVP — Minimum Viable Product)');
            summary.buildFirst.forEach((f, i) => {
                const id = f.id ? `**${f.id}** ` : '';
                const reason = f.reason ? ` — ${f.reason}` : '';
                lines.push(`${i + 1}. ${id}${f.name}${reason}`);
            });
            lines.push('');
        }
        if (summary.buildNext.length > 0) {
            lines.push('### Build Next');
            summary.buildNext.forEach(f => {
                const id = f.id ? `**${f.id}** ` : '';
                const reason = f.reason ? ` — ${f.reason}` : '';
                lines.push(`- ${id}${f.name}${reason}`);
            });
            lines.push('');
        }
        if (prd.constraints?.length) {
            lines.push('### Constraints');
            prd.constraints.forEach(c => lines.push(`- ${c}`));
            lines.push('');
        }
        if (prd.nonFunctionalRequirements?.length) {
            lines.push('### Quality & Performance Requirements');
            prd.nonFunctionalRequirements.forEach(r => lines.push(`- ${r}`));
            lines.push('');
        }
    }

    return lines;
};

// ── Part II — Feature Specification ──────────────────────────────────────────
const featuresLines = (prd: StructuredPRD): string[] => {
    const lines: string[] = [];
    const featureGroups = splitFeaturesByTier(prd.features, deriveDeferredFeatureIds(prd));
    const deferredIds = new Set(featureGroups.deferred.map(f => f.id.toLowerCase()));

    // Feature Systems first (the high-level capability groups), then detail.
    if (prd.featureSystems?.length) {
        lines.push('## Feature Systems');
        prd.featureSystems.forEach(s => {
            lines.push(`### ${s.name}`);
            lines.push(`**Purpose:** ${s.purpose}`);
            if (s.endToEndBehavior) lines.push(`**User outcome:** ${s.endToEndBehavior}`);
            const visibleIds = (s.featureIds ?? []).filter(id => !deferredIds.has(id.toLowerCase()));
            if (visibleIds.length) lines.push(`**Features:** ${visibleIds.join(', ')}`);
            if (s.dependencies?.length) lines.push(`**Dependencies:** ${s.dependencies.join(', ')}`);
            if (s.edgeCases?.length) {
                lines.push('**Edge cases:**');
                s.edgeCases.forEach(e => lines.push(`- ${e}`));
            }
            lines.push('');
        });
    }

    lines.push('## Detailed Features');
    featureGroups.mvp.forEach(f => renderFeature(f).forEach(l => lines.push(l)));
    featureGroups.v1.forEach(f => renderFeature(f).forEach(l => lines.push(l)));

    // Cross-Feature Dependencies — explicit dependency edges only.
    const byId = new Map(prd.features.map(f => [f.id, f]));
    const depLines: string[] = [];
    prd.features.forEach(f => {
        const deps = (f.dependencies ?? []).map(id => byId.get(id)?.name).filter(Boolean) as string[];
        if (deps.length) depLines.push(`- **${f.name}** depends on ${deps.join(', ')}`);
    });
    if (depLines.length) {
        lines.push('## Cross-Feature Dependencies');
        depLines.forEach(l => lines.push(l));
        lines.push('');
    }

    return lines;
};

// ── Part III — Decisions and Validation ──────────────────────────────────────
const decisionsLines = (prd: StructuredPRD): string[] => {
    const lines: string[] = [];
    const { needsInput, toValidate } = splitDecisionInputs(prd.assumptions);
    const decisionLog = deriveDecisionLog(prd).filter(e => e.verdict !== 'deferred');
    const deferred = deriveDecisionLog(prd).filter(e => e.verdict === 'deferred');
    const risks = deriveRisks(prd);

    if (needsInput.length > 0) {
        lines.push('## Open Questions');
        lines.push('Low-confidence assumptions that need a decision before the PRD relies on them:');
        needsInput.forEach(a => lines.push(`- ${a.statement}`));
        lines.push('');
    }

    if (toValidate.length > 0) {
        lines.push('## Assumptions to Validate');
        toValidate.forEach(a => lines.push(`- **${a.confidence} confidence** — ${a.statement}`));
        lines.push('');
    }

    if (decisionLog.length > 0) {
        lines.push('## Decision Log');
        decisionLog.forEach(e => {
            const verdict = e.kind === 'feature'
                ? 'Feature confirmed'
                : e.verdict === 'confirmed' ? 'Confirmed' : 'Marked incorrect';
            const notePrefix = e.verdict === 'rejected' ? ' — Correction: ' : ' — ';
            const note = e.note ? `${notePrefix}${e.note}` : '';
            const label = e.label ? ` (${e.label})` : '';
            lines.push(`- **${verdict}**${label}: ${e.statement}${note}`);
        });
        lines.push('');
    }

    if (deferred.length > 0 || risks.length > 0) {
        lines.push('## Risks and Deferred Items');
        lines.push('');
        if (deferred.length > 0) {
            lines.push('### Deferred');
            deferred.forEach(e => {
                const label = e.label ? `**${e.label}** ` : '';
                const note = e.note ? ` — ${e.note}` : '';
                lines.push(`- ${label}${e.statement}${note}`);
            });
            lines.push('');
        }
        if (risks.length > 0) {
            lines.push('### Risks');
            risks.forEach(r => {
                const tag = r.likelihood ? ` (${r.likelihood})` : '';
                const impact = r.impact ? ` — ${r.impact}` : '';
                const mit = r.mitigation ? ` Mitigation: ${r.mitigation}` : '';
                lines.push(`- ${r.risk}${tag}${impact}${mit}`);
            });
            lines.push('');
        }
    }

    return lines;
};

// ── Appendices — technical context, traceability, handoff ────────────────────
const appendixLines = (prd: StructuredPRD): string[] => {
    const lines: string[] = [];

    // Architecture & additional technical context (legacy sections preserved).
    const hasArch = prd.architecture || prd.architectureFlows?.length || prd.roles?.length
        || prd.uxPages?.length || prd.userLoops?.length || prd.richDataModel?.entities?.length
        || prd.stateMachines?.length;
    if (hasArch) {
        lines.push('## Architecture and Additional Context');
        lines.push('');
        if (prd.architecture) {
            lines.push('### Architecture');
            lines.push(prd.architecture);
            lines.push('');
        }
        if (prd.architectureFlows?.length) {
            lines.push('### Example Flows');
            renderArchFlows(prd.architectureFlows).forEach(l => lines.push(l));
        }
        if (prd.roles?.length) {
            lines.push('### Permissions & Roles');
            renderRoles(prd.roles).forEach(l => lines.push(l));
        }
        if (prd.uxPages?.length) {
            lines.push('### UX Architecture');
            renderUxPages(prd.uxPages).forEach(l => lines.push(l));
        }
        if (prd.userLoops?.length) {
            lines.push('### Core User Flows');
            renderUserLoops(prd.userLoops).forEach(l => lines.push(l));
            lines.push('');
        }
        if (prd.richDataModel?.entities?.length) {
            lines.push('### Data Model');
            prd.richDataModel.entities.forEach(e => renderEntity(e).forEach(l => lines.push(l)));
        }
        if (prd.stateMachines?.length) {
            lines.push('### State Machines');
            prd.stateMachines.forEach(m => renderStateMachine(m).forEach(l => lines.push(l)));
        }
    }

    // Traceability Index — feature → system + dependency edges (explicit only).
    const byId = new Map(prd.features.map(f => [f.id, f]));
    const systemOf = (fid: string): string | undefined =>
        (prd.featureSystems ?? []).find(s => (s.featureIds ?? []).includes(fid))?.name;
    const traceRows = prd.features.map(f => {
        const parts: string[] = [];
        const sys = systemOf(f.id) ?? f.system;
        if (sys) parts.push(`system: ${sys}`);
        const deps = (f.dependencies ?? []).map(id => byId.get(id)?.name).filter(Boolean) as string[];
        if (deps.length) parts.push(`depends on: ${deps.join(', ')}`);
        return { f, detail: parts.join('; ') };
    }).filter(r => r.detail);
    if (traceRows.length) {
        lines.push('## Traceability Index');
        traceRows.forEach(({ f, detail }) => lines.push(`- **${f.id}** ${f.name} — ${detail}`));
        lines.push('');
    }

    // Domain grounding (still consumed by downstream mockup engine).
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
    if (prd.primaryActions?.length) {
        lines.push('## Primary Actions');
        prd.primaryActions.forEach(a => lines.push(`- ${a.verb} ${a.target}`));
        lines.push('');
    }

    return lines;
};

const titleLines = (prd: StructuredPRD): string[] => {
    const lines: string[] = [];
    const title = prd.productName || 'Product Requirements Document';
    lines.push(`# ${title}`);
    if (prd.productCategory) lines.push(`*${prd.productCategory}*`);
    lines.push('');
    return lines;
};

/** The three coordinated export parts, matching the in-app views. */
export type PrdExportSection = 'overview' | 'features' | 'decisions';

const PART_HEADERS: Record<PrdExportSection, string> = {
    overview: '# Part I — Product Overview',
    features: '# Part II — Feature Specification',
    decisions: '# Part III — Decisions and Validation',
};

/**
 * Render a single export section (Product Overview / Feature Specification /
 * Decisions and Validation) as a self-contained markdown document. Used by the
 * section-specific export option; the default export is the full document below.
 */
export const renderPrdSectionMarkdown = (prd: StructuredPRD, section: PrdExportSection): string => {
    const body =
        section === 'overview' ? overviewLines(prd)
        : section === 'features' ? featuresLines(prd)
        : decisionsLines(prd);
    const lines = [...titleLines(prd), PART_HEADERS[section], '', ...body];
    return lines.join('\n').trimEnd() + '\n';
};

/**
 * Render a StructuredPRD to canonical premium markdown — one coherent document
 * organized into three parts (Product Overview, Feature Specification, Decisions
 * and Validation) plus appendices, mirroring the in-app Overview/Features/
 * Decisions views. Always defensive — legacy PRDs missing the newer sections
 * still render cleanly using the legacy fields. Reordering is presentation-only;
 * downstream artifacts consume the StructuredPRD object by field, not this
 * markdown, so blocks may be reorganized without affecting generation.
 */
export const renderPremiumMarkdown = (prd: StructuredPRD): string => {
    const lines: string[] = [...titleLines(prd)];
    lines.push(PART_HEADERS.overview, '');
    lines.push(...overviewLines(prd));
    lines.push(PART_HEADERS.features, '');
    lines.push(...featuresLines(prd));
    lines.push(PART_HEADERS.decisions, '');
    lines.push(...decisionsLines(prd));
    lines.push('# Appendices', '');
    lines.push(...appendixLines(prd));
    return lines.join('\n').trimEnd() + '\n';
};
