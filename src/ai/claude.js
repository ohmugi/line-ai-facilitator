// src/ai/claude.js
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-sonnet-4-20250514";

/**
 * Claude APIを呼び出す共通関数
 */
async function callClaude({ system, messages, maxTokens = 1024 }) {
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });

    return response.content[0].text;
  } catch (error) {
    console.error("[Claude API Error]", error);
    throw error;
  }
}

export { callClaude };
