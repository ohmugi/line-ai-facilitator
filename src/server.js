// src/server.js
console.log("SERVER FILE LOADED");

import "dotenv/config";
import express from "express";
import crypto from "crypto";

// 既存ロジック
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
import { getActiveScene } from "./db/scenes.js";

const app = express();

/**
 * =========================
 * Health check（Render）
 * =========================
 */
app.get("/", (_, res) => res.status(200).send("ok"));
app.get("/health", (_, res) => res.status(200).send("ok"));
app.use((req, res, next) => {
  console.log("INCOMING:", req.method, req.url);
  next();
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
 * LINE署名検証（自前・唯一）
 * =========================
 */
function validateLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const computed = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");

  console.log("=== SIGNATURE DEBUG ===");
  console.log("header signature :", signature);
  console.log("computed signature:", computed);
  console.log("secret length     :", process.env.LINE_CHANNEL_SECRET?.length);
  console.log("rawBody length    :", req.rawBody?.length);
  console.log("=======================");

  return computed === signature;
}

/**
 * =========================
 * Webhook
 * =========================
 */
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    // raw body 保存
    req.rawBody = req.body;

    // 署名検証
    if (!validateLineSignature(req)) {
      console.error("signature validation failed (custom)");
      return res.sendStatus(401);
    }

    // JSON parse
    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error", e);
      return res.sendStatus(400);
    }

    console.log("webhook OK (signature verified)");

    // LINE には即 200
    res.sendStatus(200);

    // 非同期処理
    handleWebhookEvents(body.events).catch(console.error);
  }
);

/**
 * =========================
 * Webhook 中身
 * =========================
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

async function handleMessageEvent(event) {
  const replyToken = event.replyToken;
  const userText = event.message?.text ?? "";

  // いまは条件を絞らず、何が来ても scene を返す
  const scene = await getActiveScene();

  if (!scene) {
    await replyText(replyToken, "ごめんにゃ、準備中みたいにゃ🐾");
    return;
  }

  const message =
`けみーだにゃ🐾
ちょっと考えてほしい場面があるにゃ。

${scene.scene_text}

この場面、思い浮かびそうかにゃ？`;

  await replyText(replyToken, message);
}


/**
 * =========================
 * 質問送信
 * =========================
 */
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
 * Server start
 * =========================
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on ${PORT}`);
});

