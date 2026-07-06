// Quality review + repair for the PRD "Permissions & Roles" section.
//
// The model, left unguided, sometimes turns a role's permission lists into
// security/threat-model documentation — hundreds of "restricted" items like
// "Disable SSL pinning", "Modify SQLite database", "Bypass rate limiting".
// That output reads like hallucinated infrastructure docs (or prompt
// injection) rather than a product manager's PRD, so a non-technical user
// rightly distrusts it.
//
// Permissions & Roles describe **business capabilities available to users
// inside the product** — "Create workouts", "Invite users", "View analytics"
// — not every implementation detail the software happens to prevent. This
// module is the deterministic (no-LLM) validation-and-repair pass that
// enforces that contract as defense-in-depth alongside the generation prompt:
//
//   1. drop any permission that names backend / infrastructure / OS /
//      networking / security-implementation concepts (semantic validation:
//      "is this something a user can do inside the product?"),
//   2. dedupe repeated / near-identical items,
//   3. cap each list so the artifact stays scannable (a typical role has
//      ~5–15 allowed capabilities and 3–10 restricted items, often none),
//   4. omit an empty Restricted section entirely.
//
// It is pure and idempotent, so it runs both at generation time (cleaning new
// output at the source) and at render time (so already-persisted legacy PRDs
// display clean without regeneration).

import type { RolePermission } from '../types';

// Approximate the product-manager sizing guidance. Lists longer than this are
// the exhaustive/repetitive output we want to avoid; the cap keeps the
// artifact scannable in under a minute.
export const MAX_ALLOWED_PER_ROLE = 15;
export const MAX_RESTRICTED_PER_ROLE = 10;

// Technical / implementation terminology that must never appear in a
// product-facing permissions artifact. A permission that mentions any of these
// is describing how the software is built or secured — architecture or
// security documentation — not a capability a user exercises in the product.
//
// Patterns are deliberately precise to avoid nuking legitimate business
// capabilities: we match "authentication server" but not a bare "authorize",
// "feature flag" but not "feature gating" (a real product concept), and rely
// on specific nouns ("endpoint", "database", "sqlite") rather than broad verbs.
const IMPLEMENTATION_TERMS: RegExp[] = [
    // Transport / crypto / auth protocols
    /\bssl\b/i,
    /\btls\b/i,
    /\bhttps?\b/i,
    /\bjwt\b/i,
    /\boauth\b/i,
    /\bcertificate(s)?\b/i,
    /\bencrypt(ion|ed|ing)?\b/i,
    /\bdecrypt(ion|ed|ing)?\b/i,
    /\bcipher\b/i,
    /\bsession cookie\b/i,
    /\bsession token\b/i,
    // Datastores
    /\bdatabase(s)?\b/i,
    /\bsqlite\b/i,
    /\bpostgres(ql)?\b/i,
    /\bmysql\b/i,
    /\bmongo(db)?\b/i,
    /\bredis\b/i,
    /\bdynamodb\b/i,
    /\bno-?sql\b/i,
    /\bsql\b/i,
    /\bmigration(s)?\b/i,
    // Caching / networking / infra
    /\bcach(e|es|ing)\b/i,
    /\bcdn\b/i,
    /\bdns\b/i,
    /\bvpc\b/i,
    /\bfirewall\b/i,
    /\bload.?balanc(er|ing)\b/i,
    /\brate.?limit(ing|ed|s)?\b/i,
    /\bthrottl(e|es|ing|ed)\b/i,
    /\bproxy\b/i,
    /\bwebsocket(s)?\b/i,
    /\btcp\b/i,
    /\budp\b/i,
    // Platform / ops
    /\bkubernetes\b/i,
    /\bk8s\b/i,
    /\bdocker\b/i,
    /\binfrastructure\b/i,
    /\bnginx\b/i,
    /\bapache\b/i,
    /\bserver config(uration)?\b/i,
    /\bsecurity config(uration)?\b/i,
    /\bsystem config(uration)?\b/i,
    /\bapplication-level\b/i,
    /\benvironment variable(s)?\b/i,
    /\bfeature flag(s)?\b/i,
    /\bmiddleware\b/i,
    /\bauthentication server\b/i,
    /\bauthorization server\b/i,
    /\bauth server\b/i,
    // Endpoints / APIs / diagnostics / OS
    /\bendpoint(s)?\b/i,
    /\bapi gateway\b/i,
    /\btimeout(s)?\b/i,
    /\btelemetry\b/i,
    /\bdiagnostic(s)?\b/i,
    /\bsandbox(ed|ing)?\b/i,
    /\boperating system\b/i,
    /\bfile.?system(s)?\b/i,
    /\bback-?end\b/i,
    /\bcompiler\b/i,
    /\bbytecode\b/i,
];

/**
 * Semantic validation gate: does this permission describe a technical /
 * implementation concept (and therefore fail "is this something a user can do
 * inside the product?"). Exported for tests.
 */
export const isImplementationPermission = (item: string): boolean =>
    IMPLEMENTATION_TERMS.some((re) => re.test(item));

const cleanList = (items: string[] | undefined, max: number): string[] => {
    if (!Array.isArray(items)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
        if (typeof raw !== 'string') continue;
        const item = raw.trim();
        if (!item) continue;
        if (isImplementationPermission(item)) continue;
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
        if (out.length >= max) break;
    }
    return out;
};

/**
 * Validate + repair a single role's permission lists. Removes
 * implementation-detail items, dedupes, caps sizes, and drops an empty
 * Restricted list so the section stays business-oriented and concise.
 */
export const sanitizeRolePermission = (role: RolePermission): RolePermission => {
    const cleaned: RolePermission = {
        ...role,
        allowed: cleanList(role.allowed, MAX_ALLOWED_PER_ROLE),
    };
    const restricted = cleanList(role.restricted, MAX_RESTRICTED_PER_ROLE);
    if (restricted.length) cleaned.restricted = restricted;
    else delete cleaned.restricted;
    return cleaned;
};

/**
 * Sanitize every role in a Permissions & Roles list. Pure and idempotent;
 * returns the input unchanged when it isn't an array (defensive against legacy
 * / malformed data).
 */
export const sanitizeRolePermissions = (
    roles: RolePermission[] | undefined,
): RolePermission[] | undefined => {
    if (!Array.isArray(roles)) return roles;
    return roles.map(sanitizeRolePermission);
};
