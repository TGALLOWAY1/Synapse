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

    const { prdSummary, schema } = req.body;
    if (!prdSummary) {
        return res.status(400).json({ error: 'Missing prdSummary in request body' });
    }

    const systemInstruction = `You are an expert software architect and project planner. Given a structured PRD, create a milestone-based development roadmap.
Each milestone should represent a logical phase of development.
Each milestone should contain specific, actionable tasks.
Use unique IDs like "m1", "m2" for milestones and "t1", "t2" for tasks.
All tasks should start with status "pending".
Order milestones sequentially.
Be practical and specific to the product described.`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        const body: Record<string, unknown> = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: `Create a development plan for this product:\n\n${prdSummary}` }] }],
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
