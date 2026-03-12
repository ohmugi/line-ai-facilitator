// src/api/liff.js
// LIFF Web App 用 API ルーター
import { Router } from "express";
import axios from "axios";
import { supabase } from "../supabase/client.js";
import { generateStep1Options } from "../ai/generateStep1.js";
import { generateStep2Options } from "../ai/generateStep2.js";
import { generateStep3Options } from "../ai/generateStep3.js";
import { generateStep4Options } from "../ai/generateStep4.js";
import { generateReflection } from "../ai/generateReflection.js";
import { callClaude } from "../ai/claude.js";

export const liffRouter = Router();

// ============================================================
// ヘルパー
// ============================================================

/** LIFF ID トークンを LINE API で検証し { lineUserId, displayName } を返す */
async function verifyLiffToken(idToken) {
  const { data } = await axios.post(
    "https://api.line.me/oauth2/v2.1/verify",
    new URLSearchParams({
      id_token: idToken,
      client_id: process.env.LIFF_CHANNEL_ID,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return { lineUserId: data.sub, displayName: data.name };
}

/**
 * 生年月から年齢区分を計算
 * Bot 版 startFirstSceneByPush.js と同ロジック
 */
function calcAgeGroup(birthYear, birthMonth) {
  if (!birthYear) return "universal";
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentSchoolYear = currentMonth >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const schoolEntryYear = birthMonth <= 3 ? birthYear + 6 : birthYear + 7;
  const grade = currentSchoolYear - schoolEntryYear + 1;
  if (grade <= 0)  return "toddler";
  if (grade <= 3)  return "elementary_lower";
  if (grade <= 6)  return "elementary_upper";
  if (grade <= 12) return "teen";
  return "universal";
}

/** 年齢区分の表示名 */
const AGE_GROUP_LABEL = {
  toddler:          "乳幼児・未就学",
  elementary_lower: "小学校低学年",
  elementary_upper: "小学校高学年",
  teen:             "中学生・高校生",
  universal:        "全年齢",
};

/** 年齢を計算 */
function calcAge(birthYear, birthMonth) {
  if (!birthYear) return null;
  const now = new Date();
  const age = now.getFullYear() - birthYear;
  return (now.getMonth() + 1) < birthMonth ? age - 1 : age;
}

/** household に年齢情報を付加 */
function enrichHousehold(hh) {
  const age = calcAge(hh.child_birth_year, hh.child_birth_month);
  return {
    ...hh,
    child_age: age,
    child_age_group: AGE_GROUP_LABEL[calcAgeGroup(hh.child_birth_year, hh.child_birth_month)] ?? "全年齢",
  };
}

/**
 * household の年齢区分に合うアクティブシナリオを全件取得し、
 * liff_sessions レコードを作成（重複なし）
 */
async function deliverSessions(householdId, birthYear, birthMonth) {
  const ageGroup = calcAgeGroup(birthYear, birthMonth);

  const { data: scenarios } = await supabase
    .from("scenes")
    .select("id")
    .eq("is_active", true)
    .in("age_group", [ageGroup, "universal"]);

  if (!scenarios?.length) return;

  // 既存セッションのシナリオIDを取得（重複作成防止）
  const { data: existing } = await supabase
    .from("liff_sessions")
    .select("scenario_id")
    .eq("household_id", householdId);

  const existingIds = new Set((existing || []).map((s) => s.scenario_id));

  const toInsert = scenarios
    .filter((s) => !existingIds.has(s.id))
    .map((s) => ({
      household_id: householdId,
      scenario_id: s.id,
      status: "new",
    }));

  if (toInsert.length > 0) {
    await supabase.from("liff_sessions").insert(toInsert);
  }
}

// ============================================================
// POST /api/liff/onboarding
// 初回設定: 生年月登録 → household + user 作成 → セッション配信
// ============================================================
liffRouter.post("/onboarding", async (req, res) => {
  try {
    const { liffIdToken, childBirthYear, childBirthMonth } = req.body;
    const { lineUserId, displayName } = await verifyLiffToken(liffIdToken);

    // 既存ユーザー確認
    const { data: existingUser } = await supabase
      .from("liff_users")
      .select("*, liff_households(*)")
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    if (existingUser?.household_id) {
      // 既存: 生年月を更新してセッション追加配信
      const { data: household } = await supabase
        .from("liff_households")
        .update({
          child_birth_year:  childBirthYear,
          child_birth_month: childBirthMonth,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingUser.household_id)
        .select()
        .single();

      await deliverSessions(household.id, childBirthYear, childBirthMonth);

      return res.json({
        household: enrichHousehold(household),
        user: existingUser,
        inviteUrl: `${process.env.APP_URL}/invite/${household.invite_code}`,
      });
    }

    // 新規: household 作成
    const { data: household, error: hhErr } = await supabase
      .from("liff_households")
      .insert({ child_birth_year: childBirthYear, child_birth_month: childBirthMonth })
      .select()
      .single();
    if (hhErr) throw hhErr;

    // ユーザー作成
    const { data: user, error: userErr } = await supabase
      .from("liff_users")
      .insert({
        line_user_id: lineUserId,
        household_id: household.id,
        display_name: displayName,
        role: "inviter",
      })
      .select()
      .single();
    if (userErr) throw userErr;

    // セッション配信
    await deliverSessions(household.id, childBirthYear, childBirthMonth);

    res.json({
      household: enrichHousehold(household),
      user,
      inviteUrl: `${process.env.APP_URL}/invite/${household.invite_code}`,
    });
  } catch (err) {
    console.error("[liff/onboarding]", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/liff/me
// LIFF トークンでユーザー情報取得（アプリ起動時に使用）
// ============================================================
liffRouter.get("/me", async (req, res) => {
  try {
    const idToken = req.headers["x-liff-id-token"];
    if (!idToken) return res.status(401).json({ error: "Missing LIFF token" });

    const { lineUserId, displayName } = await verifyLiffToken(idToken);

    const { data: user } = await supabase
      .from("liff_users")
      .select("*, liff_households(*)")
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    if (!user) {
      return res.json({ user: null, lineUserId, displayName });
    }

    const partner = user.household_id
      ? await supabase
          .from("liff_users")
          .select("id, display_name, role")
          .eq("household_id", user.household_id)
          .neq("line_user_id", lineUserId)
          .maybeSingle()
          .then(({ data }) => data)
      : null;

    res.json({
      user,
      household: user.liff_households ? enrichHousehold(user.liff_households) : null,
      partner,
    });
  } catch (err) {
    console.error("[liff/me]", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/liff/invite/join
// 招待コード経由で参加
// ============================================================
liffRouter.post("/invite/join", async (req, res) => {
  try {
    const { liffIdToken, inviteCode } = req.body;
    const { lineUserId, displayName } = await verifyLiffToken(liffIdToken);

    // 招待コードで household 取得
    const { data: household } = await supabase
      .from("liff_households")
      .select("*")
      .eq("invite_code", inviteCode)
      .maybeSingle();

    if (!household) {
      return res.status(404).json({ error: "招待コードが無効ですにゃ🐾" });
    }

    // 既存ユーザー確認（既に参加済み）
    const { data: existingUser } = await supabase
      .from("liff_users")
      .select("*")
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    let user = existingUser;

    if (!existingUser) {
      // 新規ユーザーとして参加
      const { data: newUser, error } = await supabase
        .from("liff_users")
        .insert({
          line_user_id: lineUserId,
          household_id: household.id,
          display_name: displayName,
          role: "invitee",
        })
        .select()
        .single();
      if (error) throw error;
      user = newUser;
    } else if (!existingUser.household_id) {
      // 既存ユーザーだが household 未設定
      await supabase
        .from("liff_users")
        .update({ household_id: household.id, role: "invitee" })
        .eq("id", existingUser.id);
      user = { ...existingUser, household_id: household.id, role: "invitee" };
    }

    // 招待者情報
    const { data: partner } = await supabase
      .from("liff_users")
      .select("id, display_name, role")
      .eq("household_id", household.id)
      .neq("line_user_id", lineUserId)
      .maybeSingle();

    // liff_sessions の user2_id を設定（未設定のもの）
    if (user.household_id === household.id) {
      await supabase
        .from("liff_sessions")
        .update({ user2_id: user.id })
        .eq("household_id", household.id)
        .is("user2_id", null);
    }

    res.json({
      household: enrichHousehold(household),
      user,
      partner: partner || null,
    });
  } catch (err) {
    console.error("[liff/invite/join]", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/liff/sessions
// セッション一覧取得
// ============================================================
liffRouter.get("/sessions", async (req, res) => {
  try {
    const { householdId, userId } = req.query;
    if (!householdId) return res.status(400).json({ error: "householdId required" });

    const { data: sessions, error } = await supabase
      .from("liff_sessions")
      .select(`
        *,
        scenario:scenes(id, scene_text, category, age_group)
      `)
      .eq("household_id", householdId)
      .order("delivered_at", { ascending: false });

    if (error) throw error;

    // ユーザー別の回答ステップ情報を付加
    const enriched = await Promise.all(
      sessions.map(async (s) => {
        const { data: answers } = await supabase
          .from("session_answers")
          .select("user_id, step")
          .eq("session_id", s.id);

        return { ...s, answers: answers || [] };
      })
    );

    res.json({ sessions: enriched });
  } catch (err) {
    console.error("[liff/sessions]", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/liff/sessions/:id
// セッション詳細取得
// ============================================================
liffRouter.get("/sessions/:id", async (req, res) => {
  try {
    const { data: session, error } = await supabase
      .from("liff_sessions")
      .select(`*, scenario:scenes(*)`)
      .eq("id", req.params.id)
      .single();

    if (error || !session) return res.status(404).json({ error: "Session not found" });

    const { data: answers } = await supabase
      .from("session_answers")
      .select("*")
      .eq("session_id", req.params.id)
      .order("created_at");

    res.json({ session, answers: answers || [] });
  } catch (err) {
    console.error("[liff/sessions/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/liff/sessions/:id/options
// ステップの選択肢を生成（Step1はシナリオレベルでキャッシュ）
// ============================================================
liffRouter.get("/sessions/:id/options", async (req, res) => {
  try {
    const { step, userId } = req.query;
    if (!step) return res.status(400).json({ error: "step required" });

    const { data: session } = await supabase
      .from("liff_sessions")
      .select("*, scenario:scenes(*)")
      .eq("id", req.params.id)
      .single();

    if (!session) return res.status(404).json({ error: "Session not found" });

    const sceneText = session.scenario.scene_text;

    // Step1: シナリオレベルでキャッシュ（7日間）
    if (step === "step1") {
      const cached = session.scenario.generated_content?.step1;
      const generatedAt = session.scenario.generated_at;
      const isValid = generatedAt &&
        (Date.now() - new Date(generatedAt).getTime()) < 7 * 24 * 60 * 60 * 1000;

      if (cached && isValid) {
        return res.json({ options: cached, question: null, cached: true });
      }

      const options = await generateStep1Options({ sceneText });

      // キャッシュ更新
      const existing = session.scenario.generated_content || {};
      await supabase
        .from("scenes")
        .update({
          generated_content: { ...existing, step1: options },
          generated_at: new Date().toISOString(),
        })
        .eq("id", session.scenario.id);

      return res.json({ options, question: null });
    }

    // Step2〜4: ユーザーの回答をコンテキストに生成
    const { data: answers } = await supabase
      .from("session_answers")
      .select("step, answer")
      .eq("session_id", req.params.id)
      .eq("user_id", userId);

    const byStep = Object.fromEntries((answers || []).map((a) => [a.step, a.answer]));

    if (step === "step2") {
      const emotionAnswer = byStep.step1?.thought || byStep.step1?.emotion || "";
      const options = await generateStep2Options({ sceneText, emotionAnswer });
      const question = await import("../ai/generateStep2.js")
        .then((m) => m.generateStep2Question({ sceneText, emotionAnswer, userName: "あなた" }));
      return res.json({ options, question });
    }

    if (step === "step3") {
      const emotionAnswer = byStep.step1?.thought || byStep.step1?.emotion || "";
      const valueChoice   = Array.isArray(byStep.step2?.values) ? byStep.step2.values.join("、") : (byStep.step2?.value || "");
      const options = await generateStep3Options({ sceneText, emotionAnswer, valueChoice });
      const question = await import("../ai/generateStep3.js")
        .then((m) => m.generateStep3Question({ sceneText, emotionAnswer, valueChoice, userName: "あなた" }));
      return res.json({ options, question });
    }

    if (step === "step4") {
      const emotionAnswer    = byStep.step1?.thought || byStep.step1?.emotion || "";
      const valueChoice      = Array.isArray(byStep.step2?.values) ? byStep.step2.values.join("、") : (byStep.step2?.value || "");
      const backgroundChoice = byStep.step3?.background || "";
      const options = await generateStep4Options({ sceneText, emotionAnswer, valueChoice, backgroundChoice });
      const question = await import("../ai/generateStep4.js")
        .then((m) => m.generateStep4Question({ sceneText, emotionAnswer, valueChoice, backgroundChoice, userName: "あなた" }));
      return res.json({ options, question });
    }

    return res.status(400).json({ error: `Unknown step: ${step}` });
  } catch (err) {
    console.error("[liff/sessions/:id/options]", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/liff/sessions/:id/answer
// 回答保存 + セッション進行状態を更新
// ============================================================
liffRouter.post("/sessions/:id/answer", async (req, res) => {
  try {
    const { userId, step, answer } = req.body;
    const sessionId = req.params.id;

    // 回答を upsert
    const { error: ansErr } = await supabase
      .from("session_answers")
      .upsert(
        { session_id: sessionId, user_id: userId, step, answer },
        { onConflict: "session_id,user_id,step" }
      );
    if (ansErr) throw ansErr;

    // セッションの現在ステップを更新
    const { data: session } = await supabase
      .from("liff_sessions")
      .select("user1_id, user2_id, user1_current_step, user2_current_step, status")
      .eq("id", sessionId)
      .single();

    const STEPS = ["step1", "step2", "step3", "step4"];
    const nextStep = STEPS[STEPS.indexOf(step) + 1] || "completed";

    const isUser1 = session.user1_id === userId;
    const updateField = isUser1 ? "user1_current_step" : "user2_current_step";

    const updates = {
      [updateField]: nextStep,
      status: "in_progress",
    };

    // 両者が completed なら sessions も completed に
    const otherStep = isUser1 ? session.user2_current_step : session.user1_current_step;
    if (nextStep === "completed" && otherStep === "completed") {
      updates.status = "completed";
      updates.completed_at = new Date().toISOString();
    }

    await supabase.from("liff_sessions").update(updates).eq("id", sessionId);

    res.json({ success: true, nextStep });
  } catch (err) {
    console.error("[liff/sessions/:id/answer]", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/liff/sessions/:id/complete
// Step4 完了後のリフレクション生成
// ============================================================
liffRouter.post("/sessions/:id/complete", async (req, res) => {
  try {
    const { userId } = req.body;
    const sessionId = req.params.id;

    const { data: session } = await supabase
      .from("liff_sessions")
      .select("*, scenario:scenes(*), user1:liff_users!user1_id(display_name), user2:liff_users!user2_id(display_name)")
      .eq("id", sessionId)
      .single();

    const { data: allAnswers } = await supabase
      .from("session_answers")
      .select("*")
      .eq("session_id", sessionId);

    const byUser = {};
    for (const a of allAnswers || []) {
      if (!byUser[a.user_id]) byUser[a.user_id] = {};
      byUser[a.user_id][a.step] = a.answer;
    }

    const sceneText = session.scenario.scene_text;
    const userIds = [session.user1_id, session.user2_id].filter(Boolean);

    // 各ユーザーの個別リフレクション生成
    const reflections = {};
    for (const uid of userIds) {
      const ans = byUser[uid] || {};
      const userName = uid === session.user1_id
        ? session.user1?.display_name || "あなた"
        : session.user2?.display_name || "パートナー";

      const emotionAnswer    = ans.step1?.thought || ans.step1?.emotion || "";
      const valueChoice      = Array.isArray(ans.step2?.values) ? ans.step2.values.join("、") : (ans.step2?.value || "");
      const backgroundChoice = ans.step3?.background || "";
      const visionChoice     = Array.isArray(ans.step4?.priorities)
        ? ans.step4.priorities.map((p) => p.value).join("、")
        : (ans.step4?.vision || "");

      if (emotionAnswer) {
        reflections[uid] = await generateReflection({
          sceneText, emotionAnswer, valueChoice, backgroundChoice, visionChoice, userName,
        });
      }
    }

    // 夫婦の違いサマリー（両者が完了している場合）
    let differenceSummary = null;
    if (userIds.length === 2 && reflections[userIds[0]] && reflections[userIds[1]]) {
      differenceSummary = await generateCoupleDifference({
        sceneText,
        user1Name: session.user1?.display_name || "パートナー1",
        user1Answers: byUser[session.user1_id] || {},
        user2Name: session.user2?.display_name || "パートナー2",
        user2Answers: byUser[session.user2_id] || {},
      });
    }

    const reflection = { perUser: reflections, difference: differenceSummary };

    // セッション更新
    const updateData = { reflection };
    if (session.status !== "completed") {
      // 自分の step を completed に
      const isUser1 = session.user1_id === userId;
      updateData[isUser1 ? "user1_current_step" : "user2_current_step"] = "completed";

      const otherStep = isUser1 ? session.user2_current_step : session.user1_current_step;
      if (otherStep === "completed") {
        updateData.status = "completed";
        updateData.completed_at = new Date().toISOString();
      } else {
        updateData.status = "in_progress";
      }
    }

    await supabase.from("liff_sessions").update(updateData).eq("id", sessionId);

    res.json({ reflection });
  } catch (err) {
    console.error("[liff/sessions/:id/complete]", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/liff/invite/:code
// 招待コードから household 情報を取得（招待受付画面用）
// ============================================================
liffRouter.get("/invite/:code", async (req, res) => {
  try {
    const { data: household } = await supabase
      .from("liff_households")
      .select("id, invite_code, child_birth_year, child_birth_month")
      .eq("invite_code", req.params.code)
      .maybeSingle();

    if (!household) return res.status(404).json({ error: "招待コードが無効ですにゃ🐾" });

    // 招待者名を取得
    const { data: inviter } = await supabase
      .from("liff_users")
      .select("display_name")
      .eq("household_id", household.id)
      .eq("role", "inviter")
      .maybeSingle();

    res.json({ household: enrichHousehold(household), inviterName: inviter?.display_name || null });
  } catch (err) {
    console.error("[liff/invite/:code]", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 夫婦の違いサマリー生成（内部関数）
// ============================================================
async function generateCoupleDifference({ sceneText, user1Name, user1Answers, user2Name, user2Answers }) {
  const fmt = (ans) => {
    const thought  = ans.step1?.thought || ans.step1?.emotion || "（未回答）";
    const values   = Array.isArray(ans.step2?.values) ? ans.step2.values.join("・") : (ans.step2?.value || "（未回答）");
    const bg       = ans.step3?.background || "（未回答）";
    const vision   = Array.isArray(ans.step4?.priorities) ? ans.step4.priorities.map((p) => p.value).join("・") : (ans.step4?.vision || "（未回答）");
    return `気持ち: ${thought}\n価値観: ${values}\n原体験: ${bg}\n関わり方: ${vision}`;
  };

  const prompt = `シナリオ: ${sceneText}

${user1Name}さんの回答:
${fmt(user1Answers)}

${user2Name}さんの回答:
${fmt(user2Answers)}

ふたりの「違い」と「共通点」を3行以内で、温かく伝えてくださいにゃ。
- 違いを責めず、「そういう見方もあるんだにゃ」という発見の視点で
- 語尾は「にゃ」
- 絵文字は🐾を1回だけ最後に使う
- 差異サマリーのみ出力（前置き不要）`;

  return await callClaude({
    system: "夫婦の対話を深めるファシリテーター「Kemy(けみー)」として回答してください。",
    messages: [{ role: "user", content: prompt }],
    maxTokens: 300,
  });
}
