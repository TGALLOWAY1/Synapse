import type { QualityGateCategory } from '../../../types';

// Own module (not a component file) — the react-refresh/only-export-components
// rule forbids constant exports from component files.
export const GATE_CATEGORY_LABELS: Record<QualityGateCategory, string> = {
    design_fidelity: 'Design fidelity',
    functional: 'Functional',
    data_integrity: 'Data integrity',
    integration: 'Integration',
    accessibility: 'Accessibility',
    performance: 'Performance',
    testing: 'Testing',
    regression: 'Regression',
};

export const GATE_CATEGORY_ORDER: QualityGateCategory[] = [
    'design_fidelity',
    'functional',
    'data_integrity',
    'integration',
    'accessibility',
    'performance',
    'testing',
    'regression',
];
