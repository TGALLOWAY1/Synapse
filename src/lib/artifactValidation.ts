import type { CoreArtifactSubtype } from '../types';

export interface ValidationResult {
    isValid: boolean;
    qualityScore: number; // 0-100
    warnings: string[];
}

const MIN_CONTENT_LENGTH: Record<CoreArtifactSubtype, number> = {
    screen_inventory: 200,
    user_flows: 200,
    component_inventory: 200,
    implementation_plan: 200,
    data_model: 200,
    prompt_pack: 200,
    design_system: 200,
};

const EXPECTED_HEADERS: Record<CoreArtifactSubtype, string[]> = {
    screen_inventory: ['###', 'Purpose', 'Components', 'Navigation', 'Priority'],
    user_flows: ['Flow', 'Goal', 'Steps', 'Success', 'Error'],
    component_inventory: ['Purpose', 'Props', 'Used In', 'Complexity'],
    implementation_plan: ['Milestone', 'Goal', 'Deliverables', 'Dependencies'],
    data_model: ['Fields', 'Relationships', 'Type'],
    prompt_pack: ['Prompt', 'Category', 'Target'],
    design_system: ['Color', 'Typography', 'Spacing', 'Component'],
};

export function validateArtifactContent(
    subtype: CoreArtifactSubtype,
    content: string
): ValidationResult {
    const warnings: string[] = [];
    let score = 100;

    // Check minimum length
    const minLen = MIN_CONTENT_LENGTH[subtype];
    if (content.length < minLen) {
        warnings.push(`Content appears truncated (${content.length} chars, expected at least ${minLen})`);
        score -= 30;
    }

    // Check for expected headers/keywords
    const expectedHeaders = EXPECTED_HEADERS[subtype];
    const missingHeaders = expectedHeaders.filter(h => !content.includes(h));
    if (missingHeaders.length > 0) {
        const missingRatio = missingHeaders.length / expectedHeaders.length;
        if (missingRatio > 0.5) {
            warnings.push(`Missing expected sections: ${missingHeaders.join(', ')}`);
            score -= 20;
        } else if (missingRatio > 0.2) {
            warnings.push(`Some expected sections may be missing: ${missingHeaders.join(', ')}`);
            score -= 10;
        }
    }

    // Check for markdown structure
    const hasHeaders = /^#{1,4}\s/m.test(content);
    const hasList = /^[-*]\s/m.test(content) || /^\d+\.\s/m.test(content);
    if (!hasHeaders) {
        warnings.push('No markdown headers found — output may lack structure');
        score -= 15;
    }
    if (!hasList) {
        warnings.push('No lists found — output may lack detail');
        score -= 10;
    }

    // Check for overly short sections (potential truncation mid-section)
    if (content.endsWith('...') || content.endsWith('etc.')) {
        warnings.push('Content may be incomplete (ends with ellipsis)');
        score -= 10;
    }

    return {
        isValid: score >= 40,
        qualityScore: Math.max(0, Math.min(100, score)),
        warnings,
    };
}
