import type {
    MockupFidelity,
    MockupPlatform,
    MockupSettings,
    ProjectPlatform,
    StructuredPRD,
} from '../types';

// Project-level platform ('app' / 'web') maps directly to the mockup shell.
export const mapProjectPlatform = (p?: ProjectPlatform): MockupPlatform =>
    p === 'app' ? 'mobile' : 'desktop';

// Choose fidelity between 'mid' (structured) and 'high' (polished) based on
// PRD richness. Sparse PRDs yield 'mid'; feature-heavy or long PRDs yield
// 'high'. Wireframe ('low') is intentionally never auto-selected.
export const pickFidelity = (prd: string, structured?: StructuredPRD): MockupFidelity => {
    const words = prd.trim().split(/\s+/).filter(Boolean).length;
    if (structured) {
        const feats = structured.features ?? [];
        const highCt = feats.filter(f => f.complexity === 'high').length;
        if (feats.length >= 6 || highCt >= 2 || words >= 1500) return 'high';
        return 'mid';
    }
    return words >= 1500 ? 'high' : 'mid';
};

// Settings used for the auto-kicked mockup job after PRD finalization. The
// user can still regenerate with custom settings later via the workspace
// "Regenerate with options" affordance.
export function buildAutoMockupSettings(
    prdContent: string,
    structuredPRD: StructuredPRD,
    platform?: ProjectPlatform,
): MockupSettings {
    return {
        platform: mapProjectPlatform(platform),
        fidelity: pickFidelity(prdContent, structuredPRD),
        scope: 'key_workflow',
    };
}
