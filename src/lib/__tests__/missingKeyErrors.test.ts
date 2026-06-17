import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callGemini } from '../geminiClient';
import { callOpenAIImage, setImageProviderConfigured } from '../openaiClient';
import { clearGeminiKey } from '../geminiKeyVault';

describe('missing-key errors are clear and user-friendly', () => {
  beforeEach(() => {
    localStorage.clear();
    clearGeminiKey();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('callGemini surfaces a Settings-pointing error when no Gemini key is available', async () => {
    // No vault key primed and no local key.
    await expect(callGemini('sys', 'prompt')).rejects.toThrow(
      'Add a Gemini API key in Settings to generate PRDs.',
    );
  });

  it('callOpenAIImage surfaces the no-key message when the proxy reports no_openai_key', async () => {
    setImageProviderConfigured(false);
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'no_openai_key', message: 'Add an OpenAI API key in Settings to generate mockups.' }),
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAIImage('a prompt', { quality: 'low', size: '1024x1024' }),
    ).rejects.toThrow('Add an OpenAI API key in Settings to generate mockups.');
  });
});
