import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = req.headers['x-api-key'] as string || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(401).json({ error: 'Missing API key. Provide via x-api-key header or server GEMINI_API_KEY env var.' });
    }

    const { promptText, schema } = req.body;
    if (!promptText) {
        return res.status(400).json({ error: 'Missing promptText in request body' });
    }

    const systemInstruction = `You are an expert product manager. Generate a structured Product Requirements Document based on the user's idea.
Provide a clear vision statement, identify target users, define the core problem, list features with complexity ratings, describe the technical architecture, and identify risks.
Each feature should have a unique id (like "f1", "f2", etc.), a name, description, user value explanation, and complexity rating (low/medium/high).
Be thorough but concise. Focus on actionable, specific content.`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        const body: Record<string, unknown> = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: `User's Idea: ${promptText}` }] }],
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
