import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();

router.post("/voice-chat", async (req, res) => {
  const { message, history = [] } = req.body ?? {};

  // Input validation
  if (
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 2000
  ) {
    return res.status(400).json({
      error: "Message must contain between 1 and 2,000 characters.",
    });
  }

  if (
    !Array.isArray(history) ||
    history.length > 20 ||
    history.some(
      (item) =>
        !item ||
        !["user", "assistant"].includes(item.role) ||
        typeof item.content !== "string" ||
        item.content.length > 2000
    )
  ) {
    return res.status(400).json({
      error: "Invalid conversation history structure.",
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const modelId = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";

  if (!apiKey || apiKey.trim() === "") {
    return res.status(503).json({
      error: "AI service is not configured. ANTHROPIC_API_KEY is missing in backend/.env.",
    });
  }

  try {
    const client = new Anthropic({
      apiKey: apiKey.trim(),
      timeout: 20000,
      maxRetries: 1,
    });

    const messages = [
      ...history.map(({ role, content }) => ({ role, content })),
      { role: "user", content: message.trim() },
    ];

    const response = await client.messages.create({
      model: modelId,
      max_tokens: 220,
      system:
        "You are Aria, an intelligent and friendly voice assistant at OnCall Desk. " +
        "You speak naturally in concise sentences (1 to 3 short sentences per turn), ideal for spoken audio. " +
        "Never use markdown formatting, asterisks, bullet points, numbered lists, or emojis, as your text will be read aloud directly by a text-to-speech engine. " +
        "Never claim you executed external phone calls or database operations unless verified.",
      messages,
    });

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!reply) {
      return res.status(502).json({
        error: "The AI service returned an empty response.",
      });
    }

    return res.json({
      reply,
      model: response.model,
      usage: response.usage,
    });
  } catch (error) {
    console.error("AI request error:", error.status ?? error.name, error.message);

    if (error.status === 401) {
      return res.status(401).json({
        error: "Invalid Anthropic API key. Please check your credentials in backend/.env.",
      });
    }

    if (error.status === 429) {
      return res.status(429).json({
        error: "Anthropic rate limit or quota exceeded. Please check your account usage.",
      });
    }

    return res.status(502).json({
      error: "The AI service could not complete your request. Please try again.",
    });
  }
});

export default router;
