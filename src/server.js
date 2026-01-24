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
 * LINE Middleware
 */
const lineMiddleware = middleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

/**
 * rawBody を保持する JSON parser
 */
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

const START_SIGNAL = "はじめる";
const MAX_QUESTIONS = 3;

/**
 * Webhook
 */
app.post(
  "/webhook",
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
  lineMiddleware,
  (req, res) => {
    console.log("webhook hit (middleware OK)");
    res.sendStatus(200);

    handleWebhookEvents(req.body.events).catch(console.error);
  }
);


/**
 * Webhook handler
 */
async function handleWebhookEvents(events = []) {
  for (const event of events) {
    console.log("source.type =", event.source?.type);

    if (event.type !== "message" || event.message?.type !== "text") continue;

    const userText = event.message.text.trim();
    const replyToken = event.replyToken;

    const source = event.source;
    const householdId =
      source.groupId || source.roomId || source.userId;

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
        await replyText(
          replyToken,
          "いまの話を並べると、大事にしている背景がいくつかありそうだね。"
        );
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on ${PORT}`);
});
