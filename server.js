import express from "express";
import cors from "cors";

const { GEMINI_API_KEY, PORT = 3000, MODEL = "gemini-2.5-flash" } = process.env;

if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY environment variable.");
  process.exit(1);
}

// The system prompt lives on the server so the page can't change it.
const SYSTEM =
  "You are Cruzr, a friendly service robot. Reply in the same language the user wrote in " +
  "(Arabic or English; for Arabic use simple, clear Arabic). Keep answers short (1 to 3 sentences) " +
  "because they are spoken aloud. Plain text only: no markdown, no emojis, no lists.";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50kb" }));
app.use(express.static("public")); // optional: put cruzr-chat.html in ./public

// Very small in-memory rate limit: 30 requests per minute per IP.
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
function limited(ip) {
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  return n > 30;
}

function validMessages(m) {
  if (!Array.isArray(m) || m.length === 0 || m.length > 20) return false;
  if (m[0].role !== "user" || m[m.length - 1].role !== "user") return false;
  return m.every(
    (x, i) =>
      x.role === (i % 2 === 0 ? "user" : "assistant") &&
      typeof x.content === "string" &&
      x.content.length > 0 &&
      x.content.length <= 2000
  );
}

app.post("/chat", async (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: "Too many requests" });

  const { messages } = req.body ?? {};
  if (!validMessages(messages)) return res.status(400).json({ error: "Invalid messages" });

  // Gemini uses "model" instead of "assistant" for the role name.
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { maxOutputTokens: 1000, temperature: 0.7 },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) {
      console.error("Gemini API error:", r.status, JSON.stringify(data));
      return res.status(502).json({ error: "Upstream error" });
    }
    const reply = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!reply) {
      console.error("Empty reply:", JSON.stringify(data));
      return res.status(502).json({ error: "Empty reply" });
    }
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Cruzr backend running on port ${PORT} (model: ${MODEL})`));
