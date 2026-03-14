/**
 * api/marketing.ts
 * 
 * Autonomous Marketing Agent — Backend Research & Planning API
 * 
 * Operations:
 *   trend-research       — Trending topics, hashtags, engagement stats for a niche + platform set
 *   market-analysis      — Competitor landscape, target audience insights, content gaps
 *   seo-keywords         — SEO keywords + estimated search volumes for a topic
 *   best-posting-times   — Optimal posting windows per platform + niche
 *   campaign-plan        — Full structured campaign plan from research + brief
 *   analyze-brand-file   — Marketing-lens analysis of an uploaded file (logo, guide, audio, doc, etc.)
 */

import { requireAuth } from './_auth';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || '';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = "gemini-3-flash-preview";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const err = (msg: string, status = 400) => json({ error: msg }, status);

async function callGemini(prompt: string, useGrounding = false): Promise<string> {
  const body: any = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };

  if (useGrounding) {
    body.tools = [{ googleSearch: {} }];
  }

  const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
}

async function braveSearch(query: string, count = 10): Promise<string> {
  if (!BRAVE_API_KEY) return '';
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
      { headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY } }
    );
    if (!res.ok) return '';
    const data = await res.json();
    return (data.web?.results || [])
      .slice(0, count)
      .map((r: any) => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.description || ''}`)
      .join('\n\n');
  } catch { return ''; }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleTrendResearch(body: any): Promise<Response> {
  const { niche, platforms = [], targetAudience = '' } = body;
  if (!niche) return err('niche required');

  const platformStr = platforms.join(', ') || 'all social media';

  // Parallel: brave search + gemini grounded
  const [braveResults, geminiTrends] = await Promise.all([
    braveSearch(`${niche} trending content ${platformStr} 2025 viral hashtags engagement`),
    callGemini(
      `You are a social media marketing expert. Research the current trending topics, viral content formats, and popular hashtags for: "${niche}" targeting "${targetAudience}" on ${platformStr}.

Return a JSON object with the following structure (return ONLY the JSON, no markdown):
{
  "trends": [
    { "topic": "...", "engagement": "high/medium/low", "relevance": "why relevant", "platform": "..." }
  ],
  "hashtags": ["#hashtag1", "#hashtag2", ...],
  "contentFormats": ["Reels with behind-the-scenes", "Educational carousels", ...],
  "audienceInsights": "Key insights about this target audience's content consumption habits"
}

Provide 8-12 trends, 15-25 hashtags, and 5-8 content formats. Base your answer on current 2025 social media trends.`,
      true
    ),
  ]);

  // Parse gemini response
  let parsed: any = {};
  try {
    const jsonMatch = geminiTrends.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch { /* use partial */ }

  // Augment with brave search results if available
  let augmented = parsed;
  if (braveResults && (!parsed.trends || parsed.trends.length === 0)) {
    const augmentPrompt = `Based on these search results about "${niche}" trends:\n\n${braveResults.substring(0, 3000)}\n\nExtract and return a JSON object with "trends" (array of {topic, engagement, relevance, platform}), "hashtags" (array), "contentFormats" (array), "audienceInsights" (string). Return ONLY the JSON.`;
    const augRes = await callGemini(augmentPrompt);
    try {
      const m = augRes.match(/\{[\s\S]*\}/);
      if (m) augmented = { ...parsed, ...JSON.parse(m[0]) };
    } catch { /* ignore */ }
  }

  return json({
    niche,
    platforms,
    trends: augmented.trends || [],
    hashtags: augmented.hashtags || [],
    contentFormats: augmented.contentFormats || [],
    audienceInsights: augmented.audienceInsights || '',
    researchedAt: Date.now(),
  });
}

async function handleMarketAnalysis(body: any): Promise<Response> {
  const { niche, targetAudience = '', platforms = [], businessName = '' } = body;
  if (!niche) return err('niche required');

  const [braveCompetitor, geminiAnalysis] = await Promise.all([
    braveSearch(`${niche} top brands social media strategy content marketing 2025`),
    callGemini(
      `You are a marketing strategist. Analyze the competitive landscape and audience for a ${niche} business called "${businessName}" targeting "${targetAudience}" on ${platforms.join(', ') || 'social media'}.

Return a JSON object (ONLY the JSON, no markdown):
{
  "competitorInsights": "Summary of what top competitors are doing, their content strategy, and gaps",
  "audienceInsights": "Deep insights about this target audience: pain points, desires, content preferences, peak online times",
  "contentGaps": ["Gap 1: ...", "Gap 2: ..."],
  "uniqueAngles": ["Angle 1: ...", "Angle 2: ..."],
  "recommendedTone": "description of ideal brand tone for this niche and audience"
}`,
      true
    ),
  ]);

  let parsed: any = {};
  try {
    const m = geminiAnalysis.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch { /* use partial */ }

  if (braveCompetitor && !parsed.competitorInsights) {
    const fallback = await callGemini(
      `Based on these search results:\n\n${braveCompetitor.substring(0, 3000)}\n\nSummarize key competitor strategies for the "${niche}" niche. Return a JSON object with "competitorInsights", "contentGaps" (array), "uniqueAngles" (array), "recommendedTone" strings. ONLY the JSON.`
    );
    try {
      const m = fallback.match(/\{[\s\S]*\}/);
      if (m) parsed = { ...parsed, ...JSON.parse(m[0]) };
    } catch { /* ignore */ }
  }

  return json({
    niche,
    competitorInsights: parsed.competitorInsights || '',
    audienceInsights: parsed.audienceInsights || '',
    contentGaps: parsed.contentGaps || [],
    uniqueAngles: parsed.uniqueAngles || [],
    recommendedTone: parsed.recommendedTone || '',
    analyzedAt: Date.now(),
  });
}

async function handleSeoKeywords(body: any): Promise<Response> {
  const { topic, niche = '', targetAudience = '' } = body;
  if (!topic) return err('topic required');

  const result = await callGemini(
    `You are an SEO expert. Generate a comprehensive keyword strategy for: "${topic}" in the "${niche}" niche targeting "${targetAudience}".

Return a JSON object (ONLY the JSON):
{
  "primaryKeywords": [
    { "keyword": "...", "searchIntent": "informational/transactional/navigational", "difficulty": "low/medium/high", "volume": "estimated monthly searches range" }
  ],
  "longTailKeywords": ["long tail phrase 1", "long tail phrase 2"],
  "hashtagKeywords": ["#keyword1", "#keyword2"],
  "captionKeywords": ["word to naturally include in captions"],
  "seoTitle": "Optimized title example",
  "seoDescription": "Optimized meta description example"
}

Provide 8-12 primary keywords and 15-20 long tail variations. Focus on keywords usable in social media captions and content.`,
    true
  );

  let parsed: any = {};
  try {
    const m = result.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch { /* use partial */ }

  return json({
    topic,
    niche,
    primaryKeywords: parsed.primaryKeywords || [],
    longTailKeywords: parsed.longTailKeywords || [],
    hashtagKeywords: parsed.hashtagKeywords || [],
    captionKeywords: parsed.captionKeywords || [],
    seoTitle: parsed.seoTitle || '',
    seoDescription: parsed.seoDescription || '',
    researchedAt: Date.now(),
  });
}

async function handleBestPostingTimes(body: any): Promise<Response> {
  const { platforms = [], niche = '', goal = 'engagement' } = body;
  if (!platforms.length) return err('platforms required');

  const result = await callGemini(
    `You are a social media scheduling expert. Research the optimal posting times for "${niche}" content aimed at "${goal}" on: ${platforms.join(', ')}.

Return a JSON object (ONLY the JSON, no markdown):
{
  "platforms": {
    "instagram": [
      { "day": "Monday", "timeRange": "10am–12pm EST", "rationale": "Peak engagement window for lifestyle content" }
    ],
    "tiktok": [...],
    "facebook": [...],
    "linkedin": [...],
    "x": [...],
    "youtube": [...]
  },
  "bestDaysOverall": ["Tuesday", "Wednesday", "Thursday"],
  "frequencyRecommendation": "Post 4-5x per week on Instagram, daily on TikTok",
  "niqueInsight": "Specific insight for this niche's audience behavior"
}

Only include platforms from this list: ${platforms.join(', ')}. Provide 3–5 time windows per day for each platform, covering weekdays and weekends.`
  );

  let parsed: any = {};
  try {
    const m = result.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch { /* use partial */ }

  return json({
    platforms,
    niche,
    goal,
    postingTimes: parsed.platforms || {},
    bestDaysOverall: parsed.bestDaysOverall || [],
    frequencyRecommendation: parsed.frequencyRecommendation || '',
    nicheInsight: parsed.niqueInsight || parsed.nicheInsight || '',
    researchedAt: Date.now(),
  });
}

async function handleCampaignPlan(body: any): Promise<Response> {
  const { brief, brandContext, researchResults, marketAnalysis } = body;
  if (!brief) return err('brief required');

  const contextJson = JSON.stringify({
    brief,
    brandContext: brandContext || {},
    trends: researchResults?.trends?.slice(0, 5) || [],
    hashtags: researchResults?.hashtags?.slice(0, 15) || [],
    bestPostingTimes: researchResults?.bestPostingTimes || {},
    seoKeywords: researchResults?.seoKeywords?.slice(0, 10) || [],
    competitorInsights: marketAnalysis?.competitorInsights || '',
    audienceInsights: researchResults?.audienceInsights || marketAnalysis?.audienceInsights || '',
  }, null, 2);

  const result = await callGemini(
    `You are a senior marketing strategist. Create a comprehensive, actionable campaign plan based on this context:

${contextJson}

Generate a full campaign plan. Return ONLY a JSON object:
{
  "id": "${crypto.randomUUID()}",
  "summary": "2-3 sentence campaign overview",
  "contentPieces": [
    {
      "id": "cp-1",
      "platform": "instagram",
      "type": "image",
      "caption": "Full caption text with emojis and call to action, max 150 chars",
      "hashtags": ["#hashtag1", "#hashtag2"],
      "prompt": "Detailed image generation prompt using brand context",
      "status": "pending"
    }
  ],
  "schedule": [
    {
      "contentPieceId": "cp-1",
      "platform": "instagram",
      "scheduledAt": ${Date.now() + 86400000},
      "status": "pending"
    }
  ],
  "createdAt": ${Date.now()}
}

Requirements:
- Create 2–3 content pieces per platform in the brief.platforms list
- Content types: image posts, reels/videos, carousels, stories, text posts (choose best per platform)
- Captions must be authentic, not generic. Use the brand's tone.
- Image generation prompts must be detailed and reference brand colors/style if known
- Schedule times must use Unix timestamps and respect the researched best posting times
- Hashtags should be a mix from the research (popular + niche-specific)
- Each platform should have different angles: educational, entertaining, promotional, community-building
`
  );

  let parsed: any = {};
  try {
    const m = result.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch {
    return err('Failed to generate campaign plan. Please try again.');
  }

  return json(parsed);
}

async function handleAnalyzeBrandFile(body: any): Promise<Response> {
  const { fileName, fileUrl, projectId, fileType } = body;
  if (!fileName) return err('fileName required');

  // Try to use the gemini analyze-file endpoint for the actual file analysis
  const geminiAnalyzeBase = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  let fileAnalysis = '';
  if (fileUrl) {
    // Fetch file content and analyze directly
    const marketingPrompt = `Analyze this file from a MARKETING perspective. Extract:
1. Brand colors (if visual content)
2. Brand tone of voice
3. Key messages and value propositions
4. Target audience signals
5. Visual style and aesthetic
6. Logo description (if applicable)
7. Unique selling points
8. Any campaign ideas suggested by this content
9. Audio/musical mood and energy (if audio file)
10. Recommended content formats that would complement this brand

Be specific and actionable. Format as structured text with headers.`;

    try {
      const analyzeRes = await fetch(`${geminiAnalyzeBase}/api/gemini/analyze-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, task: marketingPrompt, projectId }),
      });
      if (analyzeRes.ok) {
        const data = await analyzeRes.json();
        fileAnalysis = data.analysis || '';
      }
    } catch { /* fallback below */ }
  }

  if (!fileAnalysis) {
    // Fallback: use Gemini directly with file description
    fileAnalysis = await callGemini(
      `A marketing file named "${fileName}" (type: ${fileType || 'unknown'}) was uploaded. Based on the filename and typical content of such files in a marketing context, describe what brand assets or marketing insights would typically be extracted from it. What should we look for in this type of file to build an effective marketing campaign?`
    );
  }

  // Extract structured brand context from the analysis
  const structuredResult = await callGemini(
    `Based on this brand file analysis:\n\n${fileAnalysis}\n\nExtract and return ONLY a JSON object:
{
  "colors": ["#hex1", "#hex2"],
  "tone": "brand tone description",
  "keyMessages": ["message 1", "message 2"],
  "logoDescription": "description or empty string",
  "audioDescription": "description or empty string",
  "visualStyle": "visual style description or empty string",
  "suggestedAngles": ["content angle 1", "content angle 2"]
}
Return ONLY the JSON.`
  );

  let structured: any = {};
  try {
    const m = structuredResult.match(/\{[\s\S]*\}/);
    if (m) structured = JSON.parse(m[0]);
  } catch { /* use raw */ }

  return json({
    fileName,
    analysis: fileAnalysis,
    brandContext: structured,
    analyzedAt: Date.now(),
  });
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request): Promise<Response> {
    // Auth
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const url = new URL(request.url, 'http://localhost');
    const op = url.searchParams.get('op') || '';

    let body: any = {};
    if (request.method === 'POST') {
      try { body = await request.json(); } catch { /* empty body ok */ }
    } else {
      url.searchParams.forEach((val, key) => {
        if (key !== 'op') body[key] = val;
      });
    }

    try {
      switch (op) {
        case 'trend-research': return await handleTrendResearch(body);
        case 'market-analysis': return await handleMarketAnalysis(body);
        case 'seo-keywords': return await handleSeoKeywords(body);
        case 'best-posting-times': return await handleBestPostingTimes(body);
        case 'campaign-plan': return await handleCampaignPlan(body);
        case 'analyze-brand-file': return await handleAnalyzeBrandFile(body);
        default: return err(`Unknown op: "${op}"`, 404);
      }
    } catch (e: any) {
      console.error('[Marketing API] Error:', e);
      return err(e?.message || 'Internal error', 500);
    }
  },
};
