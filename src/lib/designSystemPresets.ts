// Design System Presets — the project's visual-direction choice. The selected
// preset id is stored on the Project (`Project.designSystemPreset`) and read at
// design-system generation time (`coreArtifactService` via
// `artifactJobController`) so that every downstream consumer — internal
// mockups, the Screen Inventory copy-prompt, uploaded external mockups — stays
// anchored to the same visual language.
//
// The choice is made during project setup (`DesignSetupStep`, shown while the
// PRD generates in the background) with the Mark-as-Final gate in
// `ProjectWorkspace` as the fallback for users who skipped setup and for
// legacy projects that predate the setup step.
//
// Presets only *steer* generation; the Gemini design-system pass still adapts
// the chosen direction to the product's domain and audience. "Custom /
// Generate for me" carries an empty directive, preserving the original
// PRD-only behavior for users who'd rather let the model decide.

import type { LucideIcon } from 'lucide-react';
import {
    LayoutGrid,
    Briefcase,
    Sparkles,
    BookOpen,
    Terminal,
    Smartphone,
    Palette,
    Wand2,
} from 'lucide-react';

/**
 * Tokens for the lightweight static preview card shown in the setup step.
 * These are presentation-only — they never feed generation (the `directive`
 * does that) — so they can be tuned freely without affecting stored projects.
 */
export interface PresetPreviewTokens {
    /** Page background. */
    background: string;
    /** Card / sidebar surface. */
    surface: string;
    /** Primary text color. */
    text: string;
    /** Secondary / muted text color. */
    mutedText: string;
    /** Brand accent — primary buttons and active states. */
    primary: string;
    /** Text color on the primary accent. */
    primaryText: string;
    /** Border / divider color. */
    border: string;
    /** Representative corner radius in px. */
    radius: number;
    /** CSS font stack used for the preview's type sample. */
    fontFamily: string;
    /** Heading font weight for the type sample. */
    headingWeight: number;
}

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
    // --- Setup-step metadata (optional — 'custom' has no visual identity of
    // its own, so it carries none of these). ---
    /** Three-word feel, e.g. "Clean, neutral, polished". */
    tone?: string;
    /** Product categories this direction suits. */
    recommendedUseCases?: string[];
    /** Short visual traits shown on the preview card. */
    visualTraits?: string[];
    /** Tokens for the static mini-layout preview. */
    previewTokens?: PresetPreviewTokens;
}

export const DESIGN_SYSTEM_PRESETS: DesignSystemPreset[] = [
    {
        id: 'saas_minimal',
        label: 'Modern SaaS',
        subtitle: 'Clean B2B',
        detail: 'Clean, neutral, polished. A great default for productivity and B2B apps.',
        icon: LayoutGrid,
        directive:
            'Adopt a restrained, professional B2B SaaS aesthetic: a neutral grayscale surface system with a single confident brand accent, generous whitespace, crisp ~1px borders, small-to-medium radii (6–10px), and a clean sans-serif UI face (Inter or system-ui). Subtle, low shadows. Prioritize clarity, legibility, and density over decoration.',
        tone: 'Clean, neutral, polished',
        recommendedUseCases: ['Productivity tools', 'B2B apps', 'Dashboards'],
        visualTraits: ['Neutral surfaces', 'One confident accent', 'Generous whitespace'],
        previewTokens: {
            background: '#f8fafc',
            surface: '#ffffff',
            text: '#0f172a',
            mutedText: '#64748b',
            primary: '#4f46e5',
            primaryText: '#ffffff',
            border: '#e2e8f0',
            radius: 8,
            fontFamily: "'Inter', system-ui, sans-serif",
            headingWeight: 600,
        },
    },
    {
        id: 'enterprise_professional',
        label: 'Enterprise Professional',
        subtitle: 'Dense, structured',
        detail: 'Structured and conservative. Suits CRM, admin, analytics, and internal tools.',
        icon: Briefcase,
        directive:
            'Adopt a conservative, enterprise-grade aesthetic: structured, information-dense layouts, a restrained blue-leaning corporate palette on cool neutral surfaces, small radii (2–6px), crisp 1px borders with table-friendly styling, and a workhorse UI sans (Segoe UI, Roboto, or Inter). Minimal shadows and decoration. Favor scannability, dense data tables, filters, and predictable convention-driven patterns over visual novelty.',
        tone: 'Dense, structured, conservative',
        recommendedUseCases: ['CRM', 'Admin & analytics', 'Internal tools'],
        visualTraits: ['Information-dense tables', 'Corporate blue accent', 'Small radii'],
        previewTokens: {
            background: '#f1f5f9',
            surface: '#ffffff',
            text: '#1e293b',
            mutedText: '#475569',
            primary: '#1d4ed8',
            primaryText: '#ffffff',
            border: '#cbd5e1',
            radius: 4,
            fontFamily: "'Segoe UI', system-ui, sans-serif",
            headingWeight: 600,
        },
    },
    {
        id: 'ai_workspace',
        label: 'AI Workspace',
        subtitle: 'Modern, focused',
        detail: 'Calm dark-or-light surfaces, a vivid accent, soft depth. Suits assistants and agent tools.',
        icon: Sparkles,
        directive:
            'Adopt a modern AI-workspace aesthetic: calm, slightly cool neutral surfaces with one vivid, saturated brand accent (e.g. indigo/violet/teal) reserved for primary actions and active states. Soft, layered elevation, medium radii (10–16px), a contemporary geometric sans (Inter, Outfit, or Manrope). Focused and uncluttered, with clear hierarchy for conversational/canvas layouts.',
        tone: 'Calm, focused, modern',
        recommendedUseCases: ['AI assistants', 'Agent tools', 'Canvas workspaces'],
        visualTraits: ['Cool neutral surfaces', 'Vivid saturated accent', 'Soft layered depth'],
        previewTokens: {
            background: '#12141c',
            surface: '#1b1e2b',
            text: '#e5e7ef',
            mutedText: '#9aa1b5',
            primary: '#8b5cf6',
            primaryText: '#ffffff',
            border: '#2a2e42',
            radius: 12,
            fontFamily: "'Manrope', 'Inter', sans-serif",
            headingWeight: 600,
        },
    },
    {
        id: 'editorial_learning',
        label: 'Minimal Editorial',
        subtitle: 'Readable, calm',
        detail: 'Calm, typography-forward. For writing, research, learning, and knowledge products.',
        icon: BookOpen,
        directive:
            'Adopt an editorial, reading-first aesthetic: warm off-white/paper neutrals, a comfortable serif or humanist-sans for body text with strong typographic hierarchy, generous line-height and spacing, and a single muted accent for links and actions. Soft or minimal shadows, gentle radii (4–8px). Optimize for sustained reading and content density without crowding.',
        tone: 'Calm, warm, typography-forward',
        recommendedUseCases: ['Writing & research', 'Learning products', 'Knowledge bases'],
        visualTraits: ['Paper-warm neutrals', 'Reading-first type', 'Muted single accent'],
        previewTokens: {
            background: '#faf7f2',
            surface: '#ffffff',
            text: '#292524',
            mutedText: '#78716c',
            primary: '#9a3412',
            primaryText: '#ffffff',
            border: '#e7e0d6',
            radius: 6,
            fontFamily: "Georgia, 'Times New Roman', serif",
            headingWeight: 700,
        },
    },
    {
        id: 'developer_tool',
        label: 'Developer / Technical',
        subtitle: 'Precise, functional',
        detail: 'Code-adjacent and compact. For API tools, dashboards, and AI workbenches.',
        icon: Terminal,
        directive:
            'Adopt a developer-tool aesthetic: dark-leaning, high-contrast neutral surfaces with a precise functional accent (often green/blue/amber), compact spacing for information density, small radii (2–6px), and a monospace face for code, identifiers, and data. Minimal, sharp shadows. Favor legibility of dense technical content and status/state colors over visual flourish.',
        tone: 'Precise, functional, code-adjacent',
        recommendedUseCases: ['API tools', 'Technical dashboards', 'AI workbenches'],
        visualTraits: ['Dark high-contrast surfaces', 'Monospace details', 'Compact density'],
        previewTokens: {
            background: '#0d1117',
            surface: '#161b22',
            text: '#e6edf3',
            mutedText: '#8b949e',
            primary: '#2ea043',
            primaryText: '#ffffff',
            border: '#30363d',
            radius: 4,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            headingWeight: 600,
        },
    },
    {
        id: 'consumer_mobile',
        label: 'Consumer Mobile',
        subtitle: 'Bold, friendly',
        detail: 'Friendly, spacious, colorful. For habit, wellness, lifestyle, and mobile-first products.',
        icon: Smartphone,
        directive:
            'Adopt a consumer-mobile aesthetic: vivid, friendly color with a high-energy brand accent, large rounded shapes (16–24px radii), bold rounded sans typography, generous tap targets, and playful but tasteful elevation. Mobile-first layouts with prominent primary actions. Energetic and approachable while staying accessible.',
        tone: 'Friendly, spacious, colorful',
        recommendedUseCases: ['Habit & wellness', 'Lifestyle apps', 'Mobile-first products'],
        visualTraits: ['Vivid friendly color', 'Large rounded shapes', 'Big tap targets'],
        previewTokens: {
            background: '#fff7f5',
            surface: '#ffffff',
            text: '#1f2937',
            mutedText: '#6b7280',
            primary: '#ec4899',
            primaryText: '#ffffff',
            border: '#fde4e1',
            radius: 20,
            fontFamily: "'Nunito', system-ui, sans-serif",
            headingWeight: 700,
        },
    },
    {
        id: 'creative_studio',
        label: 'Creative Studio',
        subtitle: 'Expressive, bold',
        detail: 'Expressive and media-forward. For music, design, creator, and portfolio tools.',
        icon: Palette,
        directive:
            'Adopt an expressive, media-forward creative aesthetic: bold typography with strong display headings, rich dark or saturated surfaces that let imagery, cover art, and media shine, a vivid expressive accent (magenta/violet/electric blue), generous radii (12–20px), and confident use of large imagery and canvases. Layouts may be asymmetric and editorial. Energetic and stylish while keeping controls legible and accessible.',
        tone: 'Expressive, bold, media-forward',
        recommendedUseCases: ['Music & audio', 'Creator & design tools', 'Portfolios'],
        visualTraits: ['Media-forward surfaces', 'Bold display type', 'Vivid expressive accent'],
        previewTokens: {
            background: '#18121f',
            surface: '#241a30',
            text: '#f5edff',
            mutedText: '#a795c0',
            primary: '#d946ef',
            primaryText: '#ffffff',
            border: '#3a2b4d',
            radius: 14,
            fontFamily: "'Space Grotesk', 'Inter', sans-serif",
            headingWeight: 700,
        },
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
