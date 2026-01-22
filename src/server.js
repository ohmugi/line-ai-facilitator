// src/server.js
console.log("CWD:", process.cwd());
console.log("DIR:", new URL(".", import.meta.url).pathname);
console.log("FILES CHECK", {
  self: import.meta.url,
});

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
 * =========================
 * LINE Middleware
 * =========================
 */
const lineMiddleware = middleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

/**
 * =========================
 * 定数
 * =========================
 */
const START_SIGNAL = "はじめる";
const MAX_QUESTIONS = 3;

/**
 * =========================
 * 質問送信ロジック
 * =========================
 */

// 1問目（DBランダム）
async function sendFirstQuestion(replyToken, householdId, sessionId) {
  const q = await getRandomQuestion();

  await saveMessage({
    householdId,
    role: "AI",
    text: q.text,
    sessionId,
  });

  await replyText(replyToken, `Aに聞くね。\n${q.text}`);
}

// 2問目以降（OpenAI）
async function sendNextAiQuestion(replyToken, householdId, sessionId) {
  const transcript = await getSessionTranscript({ householdId, sessionId });

  const nextQ = await generateNextQuestion({ transcript });

  await saveMessage({
    householdId,
    role: "AI",
    text: nextQ,
    sessionId,
  });

  await replyText(replyToken, `Aに聞くね。\n${nextQ}`);
}

/**
 * =========================
 * Health Check
 * =========================
 */
app.get("/health", (_, res) => res.status(200).send("ok"));

/**
 * =========================
 * Webhook（最重要）
 * =========================
 * - LINE には即 200 を返す
 * - 中身の処理は非同期で切り離す
 */
app.post("/webhook", lineMiddleware, (req, res) => {
  // ✅ LINE には即レス
  res.sendStatus(200);

  // ❗重い処理は後ろで
  handleWebhookEvents(req.body.events).catch((err) => {
    console.error("[handleWebhookEvents error]", err);
  });
});

/**
 * =========================
 * Webhook 中身の処理
 * =========================
 */
async function handleWebhookEvents(events = []) {
  for (const event of events) {
    // text message 以外は無視
    if (
      event.type !== "message" ||
      event.message?.type !== "text"
    ) {
      continue;
    }

    const userText = event.message.text.trim();
    const replyToken = event.replyToken;
    const source = event.source;

    // グループ以外は無視
    if (source?.type !== "group") {
      continue;
    }

    const householdId = source.groupId;

    // --- セッション開始 ---
    if (userText === START_SIGNAL) {
      const sessionId = crypto.randomUUID();
      startSession(householdId, sessionId, MAX_QUESTIONS);

      await sendFirstQuestion(replyToken, householdId, sessionId);
      continue;
    }

    // --- セッション中 ---
    if (isSessionActive(householdId)) {
      const session = getSession(householdId);

      // ユーザー発言保存（今は A 固定）
      await saveMessage({
        householdId,
        role: "A",
        text: userText,
        sessionId: session.sessionId,
      });

      const shouldContinue = proceedSession(householdId);

      if (!shouldContinue) {
        await replyText(
          replyToken,
          "いまの話を並べると、大事にしている背景がいくつかありそうだね。"
        );
        endSession(householdId);
        continue;
      }

      // 次の深掘り質問
      await sendNextAiQuestion(
        replyToken,
        householdId,
        session.sessionId
      );
    }
  }
}

/**
 * =========================
 * JSON parser（webhook 後）
 * =========================
 */
app.use(express.json());

/**
 * =========================
 * Server Start
 * =========================
 */
app.listen(3000, () => {
  console.log("server running on 3000");
});
