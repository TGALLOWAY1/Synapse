// Safety guardrail types. The domain shapes (SafetyClassification,
// SafetyClassificationResult, SpineSafetyReview) live in src/types as the
// single source of truth; re-exported here so the safety module is the natural
// import surface for callers. This file adds only safety-local constants.

export type {
    SafetyClassification,
    SafetyConfidence,
    SafetyClassificationResult,
    SpineSafetyReview,
} from '../../types';

/** Default safe alternatives surfaced when the model returns none. */
export const DEFAULT_SAFE_ALTERNATIVES: string[] = [
    'Security awareness training platform',
    'Employee phishing simulation with consent and admin oversight',
    'Endpoint monitoring dashboard',
    'Vulnerability management workflow',
    'Security audit reporting tool',
    'Detection engineering workflow',
    'Incident response case management system',
];
