import { callGemini, getStrongModel } from '../geminiClient';
import type { SpecialistTransport } from './orchestrator';

/**
 * Optional production adapter. The review engine itself only knows the
 * injectable SpecialistTransport contract; provider choice stays at this edge.
 */
export function createGeminiSpecialistTransport(): SpecialistTransport {
    return async ({ specialist, prompt, schema, signal, repair }) => {
        const repairBlock = repair
            ? [
                '',
                'Your prior response failed structured validation.',
                `Validation error: ${repair.validationError}`,
                'Return a complete corrected JSON object. Do not add prose or code fences.',
                `Prior response:\n${repair.previousResponse}`,
            ].join('\n')
            : '';
        return callGemini(
            `You are Synapse's ${specialist.label} planning-review specialist. Follow the supplied responsibility and boundaries exactly.`,
            `${prompt}${repairBlock}`,
            {
                responseMimeType: 'application/json',
                responseSchema: schema,
                model: getStrongModel(),
                temperature: 0.25,
                topP: 0.9,
                maxOutputTokens: 8192,
                traceMeta: {
                    stage: 'Adversarial Review',
                    purpose: `Specialist analysis: ${specialist.label}`,
                    artifact: specialist.id,
                    inputs: ['Frozen review context manifest', 'Specialty-specific evidence locator index'],
                },
            },
            signal,
        );
    };
}
