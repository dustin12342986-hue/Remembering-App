/**
 * Adulting / Blue Bonnet — Cloudflare Worker proxy.
 *
 * This is the full Worker script. Paste this whole thing over your existing
 * Worker's code (Cloudflare dashboard → Workers & Pages → your worker →
 * "Edit code"), replacing everything, then click Deploy.
 *
 * Why you need this update: Blue Bonnet can now actually perform actions in
 * the app (add a bill, check off a chore, log groceries, etc.) when you ask
 * in chat. That requires the app to send Anthropic a `tools` list describing
 * what it's allowed to do. Your existing Worker only forwarded
 * model/max_tokens/system/messages and silently dropped `tools`, so tool
 * actions wouldn't work until this is deployed.
 *
 * One-time setup reminders (same as before, nothing new here):
 *   - ANTHROPIC_API_KEY must be set as a Worker secret
 *     (Settings → Variables and Secrets → Add → name it ANTHROPIC_API_KEY).
 *   - ALLOWED_ORIGIN below must exactly match where Adulting is hosted
 *     (e.g. "https://your-username.github.io" — origin only, no path,
 *     no trailing slash). Update it if you haven't already pointed it at
 *     your live GitHub Pages URL.
 */

const ALLOWED_ORIGIN = "https://dustin12342986-hue.github.io";

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    let incoming;
    try {
      incoming = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: { message: "Invalid JSON body" } }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    // Build the request to Anthropic. `tools` and `tool_choice` are forwarded
    // through only when the app actually sent them (never sent during Blue
    // Bonnet's proactive check-ins, so those calls stay tool-free on purpose).
    const anthropicBody = {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: incoming.max_tokens || 1000,
      system: incoming.system || "",
      messages: incoming.messages || [],
    };
    if (Array.isArray(incoming.tools) && incoming.tools.length > 0) {
      anthropicBody.tools = incoming.tools;
    }
    if (incoming.tool_choice) {
      anthropicBody.tool_choice = incoming.tool_choice;
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await anthropicRes.json();

    return new Response(JSON.stringify(data), {
      status: anthropicRes.status,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
