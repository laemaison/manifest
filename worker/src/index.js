// Manifest AI proxy.
//
// Holds the xAI key server-side so it never ships to the browser, and answers
// in the response shape index.html already parses, so the page only needed its
// fetch URL changed.

const ALLOWED_ORIGINS = new Set([
  "https://laemaison.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

const MODEL = "grok-4.6";
const ENDPOINT = "https://api.x.ai/v1/responses";

const MAX_PROMPT_CHARS = 8000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST." }, 405, headers);
    }
    // Weak but free: keeps the key from being a public endpoint for anyone
    // who finds the worker URL. A determined caller can forge Origin.
    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed." }, 403, headers);
    }
    if (!env.XAI_API_KEY) {
      return json({ error: "XAI_API_KEY is not set on the worker." }, 500, headers);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Body must be JSON." }, 400, headers);
    }

    const prompt = extractPrompt(body);
    if (!prompt) {
      return json({ error: "No prompt found in messages[0].content." }, 400, headers);
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return json({ error: "Prompt too long." }, 413, headers);
    }

    let upstream;
    try {
      upstream = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + env.XAI_API_KEY,
        },
        body: JSON.stringify({
          model: MODEL,
          input: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search" }],
        }),
      });
    } catch (err) {
      return json({ error: "Could not reach xAI.", detail: String(err) }, 502, headers);
    }

    if (!upstream.ok) {
      const detail = await upstream.text();
      return json(
        { error: "xAI returned an error.", status: upstream.status, detail: detail.slice(0, 500) },
        502,
        headers,
      );
    }

    const data = await upstream.json();
    const text = extractText(data);

    if (!text.trim()) {
      // Usually a refusal or a response that was all tool calls; surface it
      // rather than returning a success the page will fail to parse.
      return json(
        { error: "xAI returned no text.", status: data?.status ?? null },
        502,
        headers,
      );
    }

    return json({ content: [{ type: "text", text }] }, 200, headers);
  },
};

// The page still sends an Anthropic-shaped body; accept either a plain string
// or an array of content blocks.
function extractPrompt(body) {
  const content = body?.messages?.[0]?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("\n")
      .trim();
  }
  if (typeof body?.prompt === "string") return body.prompt.trim();
  return "";
}

// Responses API returns output[] holding both web_search tool items and the
// assistant message, so pull text only from message items. The top-level
// output_text is an SDK convenience that may not be in the raw JSON — use it
// only as a fallback.
function extractText(data) {
  const output = Array.isArray(data?.output) ? data.output : [];
  const text = output
    .filter((item) => item?.type === "message")
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((block) => block?.type === "output_text")
    .map((block) => block.text || "")
    .join("");

  if (text) return text;
  return typeof data?.output_text === "string" ? data.output_text : "";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://laemaison.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
