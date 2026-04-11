# Archive

Historical design notes, audits, and assessments from Synapse's development.
These files are retained for context but are **not current documentation** —
see [`../architecture.md`](../architecture.md),
[`../artifact-flow.md`](../artifact-flow.md), and
[`../deployment.md`](../deployment.md) for the current product.

| File | What it is |
|---|---|
| [`original-prd.md`](./original-prd.md) | Original Synapse v1 PRD (Feb 2026). Describes the spec-driven canvas concept before the artifact pipeline existed. |
| [`prd-compliance.md`](./prd-compliance.md) | Early compliance checklist mapping S1–S3 deliverables to the original PRD. |
| [`expansion-plan.md`](./expansion-plan.md) | Design doc for expanding the 3-stage pipeline into the current 4-stage (PRD → Mockups → Artifacts → History) model. Implemented. |
| [`v1-to-v2-upgrade.md`](./v1-to-v2-upgrade.md) | Strategic V1 → V2 roadmap. Parts were implemented as the current artifact system; some ideas deferred. |
| [`codebase-audit-2026-03-25.md`](./codebase-audit-2026-03-25.md) | Deep technical audit. Many findings (e.g., `llmProvider` god file) have since been addressed. |
| [`codebase-assessment.md`](./codebase-assessment.md) | Pre-refactor assessment identifying quality gaps. |
| [`assessment-action-plan.md`](./assessment-action-plan.md) | Log of validated fixes applied in response to the codebase assessment. |
| [`recruiter-readiness-audit-2026-04-09.md`](./recruiter-readiness-audit-2026-04-09.md) | Portfolio review identifying gaps for recruiter presentation. |
| [`presentation-analysis.md`](./presentation-analysis.md) | Long-form technical narrative written for a recruiter deck. |
| [`qa-testing-guide.md`](./qa-testing-guide.md) | Internal manual QA checklist used during development. |
