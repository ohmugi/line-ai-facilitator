//server.js
console.log("CWD:", process.cwd());
console.log("DIR:", new URL('.', import.meta.url).pathname);
console.log("FILES CHECK", {
  reply: import.meta.url,
});


import "dotenv/config";
import express from "express";
import crypto from "crypto";

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
app.use(express.json());

const START_SIGNAL = "はじめる";
const MAX_QUESTIONS = 3;

// 1問目はDBから（固定でもOKだが、今はDBランダムに統一）
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

// セッションの途中質問（OpenAIで生成）
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

app.get("/health", (_, res) => res.status(200).send("ok"));

app.post("/webhook", async (req, res) => {
  try {
    const event = req.body.events?.[0];
    if (!event || event.type !== "message" || event.message.type !== "text") {
      return res.sendStatus(200);
    }

    const userText = event.message.text.trim();
    const replyToken = event.replyToken;
    const source = event.source;

    // グループ以外は無視
    if (source.type !== "group") {
      return res.sendStatus(200);
    }

    const householdId = source.groupId;

    // --- セッション開始合図 ---
    if (userText === START_SIGNAL) {
      const sessionId = crypto.randomUUID();
      startSession(householdId, sessionId, MAX_QUESTIONS);

      // 1問目（DBから）
      await sendFirstQuestion(replyToken, householdId, sessionId);

      return res.sendStatus(200);
    }

    // --- セッション中 ---
    if (isSessionActive(householdId)) {
      const session = getSession(householdId);

      // ユーザー発言を保存（今はA固定。後でA/Bに拡張）
      await saveMessage({
        householdId,
        role: "A",
        text: userText,
        sessionId: session.sessionId,
      });

      // 次の質問を続けるか（コード側）
      const shouldContinue = proceedSession(householdId);

      if (!shouldContinue) {
        // 最後に「仮整理」っぽい1通（今は固定文。後でAI化してもOK）
        await replyText(
          replyToken,
          "いまの話を並べると、大事にしている背景がいくつかありそうだね。"
        );
        endSession(householdId);
        return res.sendStatus(200);
      }

      // 2問目以降：OpenAIで「深掘り質問」を1つ生成
      await sendNextAiQuestion(replyToken, householdId, session.sessionId);

      return res.sendStatus(200);
    }

    // セッション外の通常発言は無視（今は）
    return res.sendStatus(200);
  } catch (err) {
    console.error("[webhook error]", err);
    return res.sendStatus(200); // LINEには200返すのが安全
  }
});

app.listen(3000, () => {
  console.log("server running on 3000");
});
