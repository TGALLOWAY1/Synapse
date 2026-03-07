import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = req.headers['x-api-key'] as string || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(401).json({ error: 'Missing API key.' });
    }

    const { milestoneContext, target, schema } = req.body;
    if (!milestoneContext || !target) {
        return res.status(400).json({ error: 'Missing milestoneContext or target in request body' });
    }

    const targetLabels: Record<string, string> = {
        cursor: 'Cursor',
        codex: 'Codex',
        claude: 'Claude Code',
        copilot: 'GitHub Copilot',
    };

    const targetLabel = targetLabels[target] || target;

    const systemInstruction = `You are an expert at writing prompts for AI coding agents. Generate a structured, ready-to-use coding prompt for ${targetLabel}.
The prompt should be specific, actionable, and include a git branch name, clear objective, task breakdown, technical constraints, and verification steps.
The rawPromptText field should be the full, copy-pasteable prompt that a developer can give directly to ${targetLabel}.
Make the rawPromptText comprehensive but focused.`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        const body: Record<string, unknown> = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: `Generate a ${targetLabel} coding prompt for this milestone:\n\n${milestoneContext}` }] }],
        };

        if (schema) {
            body.generationConfig = {
                responseMimeType: "application/json",
                responseSchema: schema,
            };
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            return res.status(response.status).json({
                error: `Gemini API Error: ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`,
            });
        }

        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;
        return res.status(200).json({ result: text });
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        return res.status(500).json({ error: errorMsg });
    }
}
