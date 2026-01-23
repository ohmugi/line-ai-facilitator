//src/server.js
import "dotenv/config";
import express from "express";
import crypto from "crypto";
import { middleware } from "@line/bot-sdk";

import { replyText } from "./line/reply.js";
import { saveMessage, getSessionTranscript } from "./supabase/messages.js";
import { getRandomQuestion } from "./supabase/questions.js";
import {
  startSession,
  isSessionActive,
  getSession,
  proceedSession,
  endSession,
} from "./session/sessionManager.js";
import { generateNextQuestion } from "./ai/nextQuestion.js";

const app = express();

/**
 * Health check（Render 用）
 */
app.get("/", (_, res) => res.status(200).send("ok"));
app.get("/health", (_, res) => res.status(200).send("ok"));

/**
 * JSON parser
 */
app.use(express.json());

/**
 * LINE Middleware
 */
const lineMiddleware = middleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

const START_SIGNAL = "はじめる";
const MAX_QUESTIONS = 3;

/**
 * Webhook
 */
// ★これだけにする
app.post("/webhook", (req, res) => {
  console.log("webhook hit");
  res.sendStatus(200);
});




async function handleWebhookEvents(events = []) {
  console.log("source.type =", source?.type);

  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;

    const userText = event.message.text.trim();
    const replyToken = event.replyToken;
    const householdId = event.source.groupId;

    if (userText === START_SIGNAL) {
      const sessionId = crypto.randomUUID();
      startSession(householdId, sessionId, MAX_QUESTIONS);
      await sendFirstQuestion(replyToken, householdId, sessionId);
      continue;
    }

    if (isSessionActive(householdId)) {
      const session = getSession(householdId);

      await saveMessage({
        householdId,
        role: "A",
        text: userText,
        sessionId: session.sessionId,
      });

      if (!proceedSession(householdId)) {
        await replyText(replyToken, "いまの話を並べると、大事にしている背景がいくつかありそうだね。");
        endSession(householdId);
        continue;
      }

      await sendNextAiQuestion(replyToken, householdId, session.sessionId);
    }
  }
}

/**
 * Server start
 */
const PORT = Number(process.env.PORT);
if (!PORT) throw new Error("PORT is not set");

app.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on ${PORT}`);
});
