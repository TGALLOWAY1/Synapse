// Design System Presets — a one-time visual-direction choice made before
// artifact generation. The selected preset id is stored on the Project
// (`Project.designSystemPreset`) and read at design-system generation time
// (`coreArtifactService` via `artifactJobController`) so that every downstream
// consumer — internal mockups, the Screen Inventory copy-prompt, uploaded
// external mockups — stays anchored to the same visual language.
//
// Presets only *steer* generation; the Gemini design-system pass still adapts
// the chosen direction to the product's domain and audience. "Custom /
// Generate for me" carries an empty directive, preserving the original
// PRD-only behavior for users who'd rather let the model decide.

import type { LucideIcon } from 'lucide-react';
import { LayoutGrid, Sparkles, BookOpen, Terminal, Smartphone, Wand2 } from 'lucide-react';

export interface DesignSystemPreset {
    /** Stable id persisted on the project. Never rename — older projects store it. */
    id: string;
    /** Short label shown in the picker. */
    label: string;
    /** Tiny tag shown beside the label. */
    subtitle: string;
    /** One-line description for the picker card. */
    detail: string;
    /** Picker icon. */
    icon: LucideIcon;
    /**
     * Direction injected into the design-system generation prompt. Empty for
     * "Custom / Generate for me" (no steering → original behavior).
     */
    directive: string;
}

export const DESIGN_SYSTEM_PRESETS: DesignSystemPreset[] = [
    {
        id: 'saas_minimal',
        label: 'SaaS Minimal',
        subtitle: 'Clean B2B',
        detail: 'Restrained, professional, whitespace-forward. Great for dashboards and admin tools.',
        icon: LayoutGrid,
        directive:
            'Adopt a restrained, professional B2B SaaS aesthetic: a neutral grayscale surface system with a single confident brand accent, generous whitespace, crisp ~1px borders, small-to-medium radii (6–10px), and a clean sans-serif UI face (Inter or system-ui). Subtle, low shadows. Prioritize clarity, legibility, and density over decoration.',
    },
    {
        id: 'ai_workspace',
        label: 'AI Workspace',
        subtitle: 'Modern, focused',
        detail: 'Calm dark-or-light surfaces, a vivid accent, soft depth. Suits assistants and agent tools.',
        icon: Sparkles,
        directive:
            'Adopt a modern AI-workspace aesthetic: calm, slightly cool neutral surfaces with one vivid, saturated brand accent (e.g. indigo/violet/teal) reserved for primary actions and active states. Soft, layered elevation, medium radii (10–16px), a contemporary geometric sans (Inter, Outfit, or Manrope). Focused and uncluttered, with clear hierarchy for conversational/canvas layouts.',
    },
    {
        id: 'editorial_learning',
        label: 'Editorial / Learning',
        subtitle: 'Readable, warm',
        detail: 'Reading-first typography, warm neutrals, comfortable rhythm. For content and courses.',
        icon: BookOpen,
        directive:
            'Adopt an editorial, reading-first aesthetic: warm off-white/paper neutrals, a comfortable serif or humanist-sans for body text with strong typographic hierarchy, generous line-height and spacing, and a single muted accent for links and actions. Soft or minimal shadows, gentle radii (4–8px). Optimize for sustained reading and content density without crowding.',
    },
    {
        id: 'developer_tool',
        label: 'Developer Tool',
        subtitle: 'Dense, technical',
        detail: 'Dark-leaning, monospace accents, compact spacing. For IDEs, CLIs, and infra UIs.',
        icon: Terminal,
        directive:
            'Adopt a developer-tool aesthetic: dark-leaning, high-contrast neutral surfaces with a precise functional accent (often green/blue/amber), compact spacing for information density, small radii (2–6px), and a monospace face for code, identifiers, and data. Minimal, sharp shadows. Favor legibility of dense technical content and status/state colors over visual flourish.',
    },
    {
        id: 'consumer_mobile',
        label: 'Consumer Mobile',
        subtitle: 'Bold, friendly',
        detail: 'Vivid color, rounded shapes, big tap targets. For lifestyle and social apps.',
        icon: Smartphone,
        directive:
            'Adopt a consumer-mobile aesthetic: vivid, friendly color with a high-energy brand accent, large rounded shapes (16–24px radii), bold rounded sans typography, generous tap targets, and playful but tasteful elevation. Mobile-first layouts with prominent primary actions. Energetic and approachable while staying accessible.',
    },
    {
        id: 'custom',
        label: 'Custom / Generate for me',
        subtitle: 'AI decides',
        detail: "Let Synapse design the system from your PRD's domain and audience.",
        icon: Wand2,
        directive: '',
    },
];

const PRESETS_BY_ID = new Map(DESIGN_SYSTEM_PRESETS.map(p => [p.id, p]));

export function getDesignSystemPreset(id?: string): DesignSystemPreset | undefined {
    if (!id) return undefined;
    return PRESETS_BY_ID.get(id);
}

/**
 * Resolve the prompt directive for a preset id. Returns '' for unknown ids,
 * a missing id, or the explicit "custom" preset — in all of which cases the
 * design-system prompt is left unchanged.
 */
export function getDesignSystemPresetDirective(id?: string): string {
    return getDesignSystemPreset(id)?.directive ?? '';
}

/** Human label for a stored preset id (falls back to the raw id). */
export function getDesignSystemPresetLabel(id?: string): string | undefined {
    return id ? (getDesignSystemPreset(id)?.label ?? id) : undefined;
}
