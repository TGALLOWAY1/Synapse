// Reactive read of the OpenAI-key-configured flag. The underlying flag in
// openaiClient is primed asynchronously after auth resolves, so components that
// gate UI on it (e.g. the mockup image generate / high-quality / redo buttons)
// must subscribe — otherwise they capture `false` at first render and never
// re-enable when priming completes.

import { useSyncExternalStore } from 'react';
import { hasOpenAIKey, subscribeOpenAIKey } from './openaiClient';

export const useHasOpenAIKey = (): boolean =>
    useSyncExternalStore(subscribeOpenAIKey, hasOpenAIKey, hasOpenAIKey);
