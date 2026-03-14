import { GoogleGenAI } from '@google/genai';
import { requireAuth } from './_auth.js';

type RequestBody = {
  videoUrl?: string;
  topic?: string;
  projectDescription?: string;
};

const MODEL_VIDEO = 'gemini-2.5-flash';

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

if (!apiKey) {
  console.warn('[api/youtube-video-analysis] Missing GEMINI_API_KEY or API_KEY environment variable.');
}

const client = apiKey ? new GoogleGenAI({ apiKey }) : null;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    if (!client) {
      return new Response(JSON.stringify({ error: 'Gemini client is not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = (await request.json()) as RequestBody;
      const videoUrl = (body.videoUrl || '').trim();
      if (!videoUrl) {
        return new Response(JSON.stringify({ error: 'videoUrl is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const topic = (body.topic || '').trim();
      const projectDescription = (body.projectDescription || '').trim();

      // Use URL context to analyze the YouTube video
      // Gemini can analyze YouTube videos directly via URL when passed as text context
      const prompt = `You are an expert research analyst.

Analyze the YouTube video at this URL: ${videoUrl}

Return ONLY Markdown format.

Requirements:
- Start with a 3-5 sentence summary of the video content.
- Provide a section: "Key Moments" with bullet points including timestamps in MM:SS format.
- Provide a section: "Notable Claims & Evidence" (include any numbers/statistics mentioned).
- Provide a section: "Practical Takeaways" with actionable insights.
- If the video seems irrelevant or low quality, explain why briefly.

Context (optional):
Topic: ${topic || 'N/A'}
Project description: ${projectDescription || 'N/A'}
`;

      // Use generateContent with tools for URL context
      const response = await client.models.generateContent({
        model: MODEL_VIDEO,
        contents: prompt,
        config: {
          tools: [{
            urlContext: {}
          }]
        }
      });

      const analysis = (response.text || '').trim();
      if (!analysis) {
        throw new Error('Empty response from Gemini');
      }

      return new Response(JSON.stringify({ analysis }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: any) {
      console.error('[api/youtube-video-analysis] Error handling request:', error);
      return new Response(JSON.stringify({ error: error.message || 'Failed to analyze video' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};

