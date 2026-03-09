// src/server.js
console.log("SERVER FILE LOADED");
console.log("SERVER BOOT START");


import "dotenv/config";
import express from "express";
import crypto from "crypto";

import { replyText } from "./line/reply.js";
import { saveMessage } from "./supabase/messages.js";
import {
  startSession,
  isSessionActive,
  getSession,
  endSession,
  saveSession,
  loadSessionFromDB,
} from "./session/sessionManager.js";

import { getActiveScene } from "./db/scenes.js";
import { generateStep1Options } from "./ai/generateStep1.js";
import { getLineProfile } from "./line/getProfile.js";
import { replyQuickText } from "./line/replyQuick.js";
import { pushMessage } from "./line/push.js";
import { supabase } from "./supabase/client.js";
import { pushQuickText } from "./line/pushQuick.js";
import { pushQuickMention } from "./line/pushQuickMention.js";
import { handleJoin } from "./handlers/join.js";
import { handleFollow } from "./handlers/follow.js";
import { startFirstSceneByPush, startFirstSceneByPushWithTarget } from "./logic/startFirstSceneByPush.js";



// AI
import { generateReflection } from "./ai/generateReflection.js";
import { generateStep2Question, generateStep2Options } from "./ai/generateStep2.js";
import { generateStep3Question, generateStep3Options } from "./ai/generateStep3.js";
import { generateStep4Question, generateStep4Options } from "./ai/generateStep4.js";
import {
  generateStep3_2Question,
  generateStep3_2Options,
  generateStep3_3Question,
  generateStep3_3Options,
} from "./ai/generateStep3Deep.js";



import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// 静的ファイル（dashboard.html など）
app.use(express.static(path.join(__dirname, "../public")));

// JSON ボディパーサー（API 用）
app.use("/api", express.json());
function updateContext(session) {
  session.context = {
    sceneText: session.sceneText,
    emotion: session.lastEmotionAnswer,
    value: session.lastValueChoice,
    background: session.lastBackgroundChoice,
    vision: session.lastVisionChoice,
  };
}

/**
 * =========================
 * Health check
 * =========================
 */
app.get("/", (_, res) => res.status(200).send("ok"));
app.get("/health", (_, res) => res.status(200).send("ok"));
app.get("/dashboard", (_, res) => res.sendFile(path.join(__dirname, "../public/dashboard.html")));

/**
 * =========================
 * Dashboard API
 * =========================
 */
app.get("/api/household", async (req, res) => {
  const { groupId } = req.query;
  if (!groupId) return res.status(400).json({ error: "groupId required" });

  const { data, error } = await supabase
    .from("households")
    .select("*")
    .eq("group_id", groupId)
    .maybeSingle();

  if (error) {
    console.error("[household GET]", error);
    return res.status(500).json({ error: "db error" });
  }
  return res.json(data);
});

app.post("/api/household", async (req, res) => {
  const { groupId, childBirthYear, childBirthMonth } = req.body;
  if (!groupId || !childBirthYear || !childBirthMonth) {
    return res.status(400).json({ error: "missing fields" });
  }

  const { data, error } = await supabase
    .from("households")
    .upsert(
      {
        group_id: groupId,
        child_birth_year: childBirthYear,
        child_birth_month: childBirthMonth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "group_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("[household POST]", error);
    return res.status(500).json({ error: "db error" });
  }
  return res.json(data);
});

/**
 * =========================
 * 定数
 * =========================
 */
const START_SIGNAL = "はじめる";

/**
 * =========================
 * LINE署名検証
 * =========================
 */
function validateLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const computed = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");

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
    req.rawBody = req.body;

    if (!validateLineSignature(req)) {
      console.error("signature validation failed");
      return res.sendStatus(401);
    }

    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error", e);
      return res.sendStatus(400);
    }

    res.sendStatus(200);
    handleWebhookEvents(body.events).catch(console.error);
  }
);

/**
 * =========================
 * Webhook handler
 * =========================
 */
async function handleWebhookEvents(events = []) {
  for (const event of events) {
    try {
      console.log("=== EVENT RECEIVED ===");
      console.log(JSON.stringify(event, null, 2));
      console.log("[EVENT]", event.type);
      console.log("EVENT TYPE:", event.type);

      const source = event.source;
      const householdId = source.groupId || source.roomId || source.userId;
      const replyToken = event.replyToken;

      // =============================
      // memberJoined（メンバーが追加された）
      // =============================
      if (event.type === "memberJoined") {
        const session = getSession(householdId);
        if (!session.parents) session.parents = { A: null, B: null };

        for (const m of event.joined.members) {
          const profile = await getLineProfile(m.userId, householdId);
          const name = profile?.displayName || "あなた";

          if (!session.parents.A) {
            session.parents.A = { userId: m.userId, name };
          } else if (!session.parents.B && session.parents.A.userId !== m.userId) {
            session.parents.B = { userId: m.userId, name };
          }
        }

        // 2人揃ったらランダムで指定して開始
        if (session.parents.A && session.parents.B && !session.started) {
          session.started = true;
          session.pendingStart = false;
          const first = Math.random() < 0.5 ? session.parents.A : session.parents.B;
          session.currentUserId = first.userId;
          session.currentUserName = first.name;

          setTimeout(async () => {
            await startFirstSceneByPush(householdId);
          }, 3000);

        // 1人目が来た時点で pendingStart があればシナリオ開始を予約
        } else if (session.parents.A && !session.parents.B && session.pendingStart && !session.started) {
          session.started = true;
          session.pendingStart = false;
          session.currentUserId = session.parents.A.userId;
          session.currentUserName = session.parents.A.name;
          console.log("[memberJoined] pendingStart → schedule scene for", session.currentUserName);

          setTimeout(async () => {
            await startFirstSceneByPush(householdId);
          }, 3000);
        }

        continue;
      }

      /**
       * =============================
       * グループにけみーが追加されたとき（自動オンボーディング）
       * =============================
       */
if (event.type === "join") {
  await handleJoin({
    event,
    householdId,
    replyToken,
    startSession,
    getSession,
  });

  // memberJoined が並行して先に親ユーザーをセットしている場合はここで拾う
  {
    const session = getSession(householdId);
    if (session?.parents?.A && session.pendingStart && !session.started) {
      session.started = true;
      session.pendingStart = false;
      session.currentUserId = session.parents.A.userId;
      session.currentUserName = session.parents.A.name;
      console.log("[join] parents.A already set → schedule scene for", session.currentUserName);
      setTimeout(async () => {
        await startFirstSceneByPush(householdId);
      }, 3000);
    }
  }

  continue;
}

if (event.type === "follow") {
  await handleFollow({ event, replyToken });
  continue;
}

      // =============================
      // セッション開始（postback / はじめる）
      // =============================
    // =============================
    // 生まれ年月の設定（datetimepicker）
    // =============================
    if (event.type === "postback" && event.postback?.data === "set_birth_date") {
      const dateStr = event.postback.params?.date; // "YYYY-MM-DD"
      if (dateStr) {
        const [year, month] = dateStr.split("-").map(Number);
        await supabase.from("households").upsert(
          {
            group_id: householdId,
            child_birth_year: year,
            child_birth_month: month,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "group_id" }
        );
        await replyText(replyToken, `${year}年${month}月生まれね、わかったにゃ🐾\nその子に合ったシナリオをお届けするにゃ！`);

        // 生年月設定後、自動でセッション開始
        await startSession(householdId, crypto.randomUUID());
        const profile = await getLineProfile(source.userId, householdId);
        const displayName = profile?.displayName || "あなた";
        const session = getSession(householdId);
        if (!session.parents) session.parents = { A: null, B: null };
        session.parents.A = { userId: source.userId, name: displayName };
        if (!session.firstSpeaker) {
          session.firstSpeaker = Math.random() < 0.5 ? "A" : "B";
        }
        session.turn = session.firstSpeaker;
        session.currentUserId = source.userId;
        session.currentUserName = displayName;
        session.finishedUsers = [];
        await startFirstSceneByPush(householdId);
      }
      continue;
    }

    if (
  event.type === "postback" ||
  (event.type === "message" &&
    event.message?.type === "text" &&
    event.message.text.trim() === START_SIGNAL)
) {
  console.log("[SESSION] manual start triggered");

  await startSession(householdId, crypto.randomUUID());

  const profile = await getLineProfile(source.userId, householdId);
  const displayName = profile?.displayName || "あなた";

  const session = getSession(householdId);

  // parents 初期化(なければ作る)
  if (!session.parents) {
    session.parents = { A: null, B: null };
  }

  // この人を A として登録(暫定)
  session.parents.A = {
    userId: source.userId,
    name: displayName,
  };

  // 先攻をランダム決定(まだ決まっていなければ)
  if (!session.firstSpeaker) {
    session.firstSpeaker = Math.random() < 0.5 ? "A" : "B";
    console.log("[TURN] firstSpeaker:", session.firstSpeaker);
  }

  session.turn = session.firstSpeaker;
  session.currentUserId = source.userId;
  session.currentUserName = displayName;
  session.finishedUsers = [];  // ★ 初期化

  await sendSceneAndEmotion(replyToken, householdId);
  continue;
}

      // =============================
      // テキストメッセージ処理
      // =============================
      if (event.type === "message" && event.message?.type === "text") {
        const userText = event.message.text.trim();

        if (!isSessionActive(householdId)) {
          await loadSessionFromDB(householdId);
        }

        if (!isSessionActive(householdId)) {
          await replyText(replyToken, "けみーは聞いてるにゃ🐾");
          continue;
        }

        const session = getSession(householdId);
        console.log("[SESSION]", householdId, session.phase);

        // ======== 2人目の登録（B） ========
        if (
          session.parents &&
          session.parents.A &&
          !session.parents.B &&
          session.parents.A.userId !== source.userId
        ) {
          const profileB = await getLineProfile(source.userId, householdId);
          const nameB = profileB?.displayName || "あなた";

          session.parents.B = {
            userId: source.userId,
            name: nameB,
          };

          console.log("[PARENTS] Bに登録:", session.parents.B);
        }

        // ======== 再開キーワード ========
        if (userText === "再開") {
          const last = session.lastBotMessage;
          if (last) {
            await replyQuickText(replyToken, last.text, last.options || []);
          } else {
            await replyText(replyToken, "もう少し待っててにゃ🐾");
          }
          continue;
        }

        // ユーザー発話を保存
        await saveMessage({
          householdId,
          role: "A",
          text: userText,
          sessionId: session.sessionId,
        });

        // ======== switch ========
        switch (session.phase) {
          case "scene_emotion": {
  console.log("[DEBUG] scene_emotion 入力:", userText);

  session.lastEmotionAnswer = userText;
  updateContext(session);

  session.phase = "value_norm_choice";
  console.log("[DEBUG] phase -> value_norm_choice");

  // ★ Claude APIで質問と選択肢を生成
  let question, options;
  try {
    question = await generateStep2Question({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      userName: session.currentUserName,
    });
    options = await generateStep2Options({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
    });
  } catch (e) {
    console.error("[Claude ERROR] step2:", e?.message || e);
    await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
    session.phase = "scene_emotion";
    break;
  }

  session.lastBotMessage = { text: question, options };
  await saveSession(householdId);
  await replyQuickText(replyToken, question, options);
  break;
}

          case "value_norm_choice": {
  console.log("[DEBUG] value_norm_choice 入力:", userText);

  session.lastValueChoice = userText;
  updateContext(session);

  session.phase = "background_choice";
  console.log("[DEBUG] phase -> background_choice");

  // ★ Claude APIで質問と選択肢を生成
  let question, options;
  try {
    question = await generateStep3Question({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
      userName: session.currentUserName,
    });
    options = await generateStep3Options({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
    });
  } catch (e) {
    console.error("[Claude ERROR] step3:", e?.message || e);
    await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
    session.phase = "value_norm_choice";
    break;
  }

  session.lastBotMessage = { text: question, options };
  await saveSession(householdId);
  await replyQuickText(replyToken, question, options);
  break;
}

         case "background_choice": {
  console.log("[DEBUG] background_choice 入力:", userText);

  session.lastBackgroundChoice = userText;
  updateContext(session);

  // Step3深掘り初期化
  if (!session.step3Deepening) {
    session.step3Deepening = {
      initialAnswer: userText,
      step3_2Answer: null,
      step3_3Answer: null,
      currentDeepLevel: 0,
    };
  }

  // 「次に進みたい」が選ばれた場合、Step4へ
  if (userText.includes("次に進みたい") || userText.includes("十分")) {
    session.phase = "vision_choice";
    console.log("[DEBUG] phase -> vision_choice (脱出)");

    let question, options;
    try {
      question = await generateStep4Question({
        sceneText: session.sceneText,
        emotionAnswer: session.lastEmotionAnswer,
        valueChoice: session.lastValueChoice,
        backgroundChoice: session.lastBackgroundChoice,
        userName: session.currentUserName,
      });
      options = await generateStep4Options({
        sceneText: session.sceneText,
        emotionAnswer: session.lastEmotionAnswer,
        valueChoice: session.lastValueChoice,
        backgroundChoice: session.lastBackgroundChoice,
      });
    } catch (e) {
      console.error("[Claude ERROR] step4:", e?.message || e);
      await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
      session.phase = "background_choice";
      break;
    }

    session.lastBotMessage = { text: question, options };
    await saveSession(householdId);
    await replyQuickText(replyToken, question, options);
    break;
  }

  // Step3-2へ進む
  session.phase = "background_choice_deep2";
  session.step3Deepening.currentDeepLevel = 1;
  console.log("[DEBUG] phase -> background_choice_deep2");

  let question, options;
  try {
    question = await generateStep3_2Question({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
      initialAnswer: userText,
      userName: session.currentUserName,
    });
    options = await generateStep3_2Options({
      sceneText: session.sceneText,
      initialAnswer: userText,
      question: question,
    });
  } catch (e) {
    console.error("[Claude ERROR] step3-2:", e?.message || e);
    await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
    session.phase = "background_choice";
    break;
  }

  session.lastBotMessage = { text: question, options };
  await saveSession(householdId);
  await replyQuickText(replyToken, question, options);
  break;
}

         case "background_choice_deep2": {
  console.log("[DEBUG] background_choice_deep2 入力:", userText);

  session.step3Deepening.step3_2Answer = userText;
  updateContext(session);

  // 「次に進みたい」が選ばれた場合、Step4へ
  if (userText.includes("次に進みたい") || userText.includes("十分")) {
    session.phase = "vision_choice";
    console.log("[DEBUG] phase -> vision_choice (脱出)");

    let question, options;
    try {
      question = await generateStep4Question({
        sceneText: session.sceneText,
        emotionAnswer: session.lastEmotionAnswer,
        valueChoice: session.lastValueChoice,
        backgroundChoice: session.step3Deepening.initialAnswer,
        userName: session.currentUserName,
      });
      options = await generateStep4Options({
        sceneText: session.sceneText,
        emotionAnswer: session.lastEmotionAnswer,
        valueChoice: session.lastValueChoice,
        backgroundChoice: session.step3Deepening.initialAnswer,
      });
    } catch (e) {
      console.error("[Claude ERROR] step4:", e?.message || e);
      await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
      session.phase = "background_choice_deep2";
      break;
    }

    session.lastBotMessage = { text: question, options };
    await saveSession(householdId);
    await replyQuickText(replyToken, question, options);
    break;
  }

  // Step3-3へ進む
  session.phase = "background_choice_deep3";
  session.step3Deepening.currentDeepLevel = 2;
  console.log("[DEBUG] phase -> background_choice_deep3");

  let question, options;
  try {
    question = await generateStep3_3Question({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
      initialAnswer: session.step3Deepening.initialAnswer,
      step3_2Answer: userText,
      userName: session.currentUserName,
    });
    options = await generateStep3_3Options({
      sceneText: session.sceneText,
      initialAnswer: session.step3Deepening.initialAnswer,
      step3_2Answer: userText,
      question: question,
    });
  } catch (e) {
    console.error("[Claude ERROR] step3-3:", e?.message || e);
    await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
    session.phase = "background_choice_deep2";
    break;
  }

  session.lastBotMessage = { text: question, options };
  await saveSession(householdId);
  await replyQuickText(replyToken, question, options);
  break;
}

         case "background_choice_deep3": {
  console.log("[DEBUG] background_choice_deep3 入力:", userText);

  session.step3Deepening.step3_3Answer = userText;
  updateContext(session);

  // Step4へ進む
  session.phase = "vision_choice";
  console.log("[DEBUG] phase -> vision_choice");

  let question, options;
  try {
    question = await generateStep4Question({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
      backgroundChoice: session.step3Deepening.initialAnswer,
      userName: session.currentUserName,
    });
    options = await generateStep4Options({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
      backgroundChoice: session.step3Deepening.initialAnswer,
    });
  } catch (e) {
    console.error("[Claude ERROR] step4:", e?.message || e);
    await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
    session.phase = "background_choice_deep3";
    break;
  }

  session.lastBotMessage = { text: question, options };
  await saveSession(householdId);
  await replyQuickText(replyToken, question, options);
  break;
}

         case "vision_choice": {
  console.log("[DEBUG] vision_choice 入力:", userText);

  session.lastVisionChoice = userText;
  updateContext(session);

  session.phase = "finishing";
  console.log("[DEBUG] phase -> finishing");

  let reflection;
  try {
    reflection = await generateReflection({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
      backgroundChoice: session.step3Deepening?.initialAnswer || session.lastBackgroundChoice,
      backgroundDetail: session.step3Deepening?.step3_2Answer || null,
      backgroundEmotion: session.step3Deepening?.step3_3Answer || null,
      visionChoice: session.lastVisionChoice,
      userName: session.currentUserName,
    });
  } catch (e) {
    console.error("[Claude ERROR] reflection:", e?.message || e);
    await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
    session.phase = "vision_choice";
    break;
  }

  await saveMessage({
    householdId,
    role: "AI",
    text: reflection,
    sessionId: session.sessionId,
  });

  await replyText(replyToken, reflection);

  // ★★★ 夫婦交互ロジック ★★★
  session.finishedUsers = session.finishedUsers || [];
  session.finishedUsers.push(source.userId);
  console.log("[FINISHED]", session.finishedUsers);

  // 2人揃ってるかチェック
  const parents = session.parents;
  if (parents && parents.A && parents.B) {
    const bothFinished = 
      session.finishedUsers.includes(parents.A.userId) &&
      session.finishedUsers.includes(parents.B.userId);

    if (bothFinished) {
      // ★ 両方終わった → 次のシナリオへ（永久ループ）
      console.log("[SESSION] 両方完了 → 次のシナリオへ");

      const firstFinisher = session.finishedUsers[0];
      const nextFirst = firstFinisher === parents.A.userId ? parents.B : parents.A;

      session.finishedUsers = [];
      session.lastEmotionAnswer = null;
      session.lastValueChoice = null;
      session.lastBackgroundChoice = null;
      session.lastVisionChoice = null;
      session.step3Deepening = null;
      session.currentUserId = nextFirst.userId;
      session.currentUserName = nextFirst.name;

      await saveSession(householdId);
      await pushMessage(householdId, `ふたりとも答えてくれたにゃ🐾\nお互いの感じ方、どうだったにゃ？\n\n少し経ったら次のシナリオをお届けするにゃ…`);

      setTimeout(async () => {
        await startFirstSceneByPush(householdId);
      }, 5000);
    } else {
      // ★ まだ片方だけ → もう片方に通知
      const nextUser = session.finishedUsers.includes(parents.A.userId)
        ? parents.B
        : parents.A;

      console.log("[TURN] 次は", nextUser.name, "の番");

      session.currentUserId = nextUser.userId;
      session.currentUserName = nextUser.name;
      session.phase = "scene_emotion";

      // ★ 回答履歴をリセット(次の人用)
      session.lastEmotionAnswer = null;
      session.lastValueChoice = null;
      session.lastBackgroundChoice = null;
      session.lastVisionChoice = null;
      session.step3Deepening = null;

      // ★ 同じシナリオで、次の人にメンション付きpush通知
      const optionTexts = await generateStep1Options({ sceneText: session.sceneText });

      const msg = `お待たせしたにゃ🐾 次はあなたの番だにゃ。

${session.sceneText}

選択肢から選んでもいいし、
自分の言葉で書いてくれてもいいにゃ🐾`;

      session.lastBotMessage = { text: msg, options: optionTexts };
      await saveSession(householdId);
      await pushQuickMention(
        householdId,
        msg,
        optionTexts,
        nextUser.userId,
        nextUser.name
      );
    }
  } else {
    // ★ まだ1人しか登録されてない場合は、とりあえず終了
    console.log("[SESSION] 1人しか登録されてないため終了");
    await endSession(householdId);
  }

  break;
}

          case "background": {
            const reflection = await generateReflection({
              backgroundText: userText,
            });

            session.phase = "reflection";

            await saveMessage({
              householdId,
              role: "AI",
              text: reflection,
              sessionId: session.sessionId,
            });

            await replyText(replyToken, reflection);
            break;
          }

          case "reflection": {
            session.phase = "closing";

            await replyText(
              replyToken,
              `${session.currentUserName}さん、
ここまで一緒に考えてくれてありがとうにゃ🐾
今日は、気持ちの奥にある見え方が
少し整理できた気がするにゃ。

また別の場面でも考えてみるにゃ🐾`
            );

            await endSession(householdId);
            break;
          }

          default: {
            console.warn("未知のフェーズ:", session.phase);
            await replyText(replyToken, "けみーは聞いてるにゃ🐾");
            break;
          }
        }

        continue;
      }

      console.log("[IGNORED EVENT]", event.type);
    } catch (err) {
      console.error("[handleWebhookEvents ERROR]", err?.message || err?.code || String(err), err);
    }
  }
}

/**
 /**
 * =========================
 * scene + emotion（push版）
 * =========================
 */









/**
 * =========================
 * Server start
 * =========================
 */
const PORT = process.env.PORT || 3000;
console.log("ABOUT TO LISTEN");

app.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on ${PORT}`);
  console.log(`server running on ${PORT}`);

});
