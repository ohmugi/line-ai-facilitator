// src/server.js
import "dotenv/config";
import express from "express";
import crypto from "crypto";

// あなたの既存ロジック
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
 * Health check（Render 用）
 * =========================
 */
app.get("/", (_, res) => res.status(200).send("ok"));
app.get("/health", (_, res) => res.status(200).send("ok"));

/**
 * =========================
 * LINE署名検証（自前）
 * =========================
 */
function validateLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");

  return hash === signature;
}

/**
 * =========================
 * 定数
 * =========================
 */
const START_SIGNAL = "はじめる";
const MAX_QUESTIONS = 3;

/**
 * =========================
 * Webhook
 *  - raw body で受信
 *  - 自前で署名検証
 * =========================
 */
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    // raw body を保存
    req.rawBody = req.body;

    // 署名検証
    if (!validateLineSignature(req)) {
      console.error("signature validation failed (custom)");
      return res.sendStatus(401);
    }

    // JSON に変換
    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error", e);
      return res.sendStatus(400);
    }

    console.log("webhook OK (custom verify)");

    // LINE には即 200
    res.sendStatus(200);

    // 重い処理は後ろで
    handleWebhookEvents(body.events).catch((err) => {
      console.error("[handleWebhookEvents error]", err);
    });
  }
);

/**
 * =========================
 * Webhook 中身の処理
 * =========================
 */
async function handleWebhookEvents(events = []) {
  for (const event of events) {
    console.log("source.type =", event.source?.type);

    // text message 以外は無視
    if (event.type !== "message" || event.message?.type !== "text") continue;

    const userText = event.message.text.trim();
    const replyToken = event.replyToken;

    const source = event.source;
    const householdId =
      source.groupId || source.roomId || source.userId;

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
      await sendNextAiQuestion(replyToken, householdId, session.sessionId);
    }
  }
}

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

function validateLineSignature(req) {
  const signature = req.headers["x-line-signature"];

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

console.log(
  "rawBody first 50 bytes:",
  req.rawBody.slice(0, 50).toString("hex")
);



/**
 * =========================
 * Server Start
 * =========================
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on ${PORT}`);
});
