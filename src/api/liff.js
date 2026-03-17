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
import { generateCoupleReflection } from "../ai/generateCoupleReflection.js";
import { generateChildLensStepAOptions } from "../ai/generateChildLensStepA.js";
import { generateChildLensStepDOptions } from "../ai/generateChildLensStepD.js";
import { generateChildLensReflection, generateChildLensCoupleReflection } from "../ai/generateChildLensReflection.js";
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
 * has_siblings が false/null の場合は requires_siblings=true のシナリオを除外
 */
async function deliverSessions(householdId, birthYear, birthMonth, hasSiblings) {
  const ageGroup = calcAgeGroup(birthYear, birthMonth);
  const ageGroups = ageGroup === "universal" ? ["universal"] : [ageGroup, "universal"];

  // 配信済みセッション（最新順）と最後のカテゴリを取得
  const { data: existing } = await supabase
    .from("liff_sessions")
    .select("scenario_id, scenario:scenes(category)")
    .eq("household_id", householdId)
    .order("delivered_at", { ascending: false });

  const existingIds = new Set((existing || []).map((s) => s.scenario_id));
  const isFirst = existingIds.size === 0;
  const lastCategory = existing?.[0]?.scenario?.category ?? null;

  // 年齢対象のアクティブシナリオを全件取得
  const { data: allScenes } = await supabase
    .from("scenes")
    .select("id, requires_siblings, category")
    .eq("is_active", true)
    .in("age_group", ageGroups);

  if (!allScenes?.length) return;

  // ひとりっ子フィルタ ＋ 配信済み除外
  const candidates = allScenes.filter((s) => {
    if (s.requires_siblings && !hasSiblings) return false;
    if (existingIds.has(s.id)) return false;
    return true;
  });

  if (!candidates.length) return;

  let selected;
  if (isFirst) {
    // 初回: is_starter=true のシナリオを優先（カラム未存在時はフォールバック）
    let starterId = null;
    try {
      const { data: starters } = await supabase
        .from("scenes")
        .select("id")
        .eq("is_starter", true)
        .in("age_group", ageGroups)
        .limit(1);
      starterId = starters?.[0]?.id ?? null;
    } catch { /* is_starter 未マイグレーション時は無視 */ }
    selected = (starterId ? candidates.find((c) => c.id === starterId) : null) ?? candidates[0];
  } else {
    // 2回目以降: 同カテゴリ回避 ＋ ランダム
    const diffCategory = candidates.filter((s) => s.category !== lastCategory);
    const pool = diffCategory.length > 0 ? diffCategory : candidates;
    selected = pool[Math.floor(Math.random() * pool.length)];
  }

  await supabase.from("liff_sessions").insert({
    household_id: householdId,
    scenario_id: selected.id,
    status: "new",
  });
}

// ============================================================
// POST /api/liff/onboarding
// 初回設定: 生年月登録 → household + user 作成 → セッション配信
// ============================================================
liffRouter.post("/onboarding", async (req, res) => {
  console.log("[onboarding] body:", JSON.stringify(req.body));
  try {
    const { liffIdToken, childBirthYear, childBirthMonth, hasSiblings } = req.body;
    console.log("[onboarding] liffIdToken exists:", !!liffIdToken, "LIFF_CHANNEL_ID exists:", !!process.env.LIFF_CHANNEL_ID);
    if (!liffIdToken) {
      return res.status(400).json({ error: "LINEアプリからアクセスしてくださいにゃ🐾" });
    }
    const { lineUserId, displayName } = await verifyLiffToken(liffIdToken);

    // 既存ユーザー確認
    const { data: existingUser } = await supabase
      .from("liff_users")
      .select("*, liff_households(*)")
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    if (existingUser?.household_id) {
      // 既存: 生年月を更新してセッション追加配信
      const updateFields = {
        child_birth_year:  childBirthYear,
        child_birth_month: childBirthMonth,
        updated_at: new Date().toISOString(),
      };
      if (hasSiblings !== undefined) updateFields.has_siblings = hasSiblings;

      const { data: household } = await supabase
        .from("liff_households")
        .update(updateFields)
        .eq("id", existingUser.household_id)
        .select()
        .single();

      await deliverSessions(household.id, childBirthYear, childBirthMonth, household.has_siblings);

      return res.json({
        household: enrichHousehold(household),
        user: existingUser,
        inviteUrl: `https://liff.line.me/${process.env.LIFF_ID}?invite=${household.invite_code}`,
      });
    }

    // 新規: household 作成
    const newHouseholdData = { child_birth_year: childBirthYear, child_birth_month: childBirthMonth };
    if (hasSiblings !== undefined) newHouseholdData.has_siblings = hasSiblings;

    const { data: household, error: hhErr } = await supabase
      .from("liff_households")
      .insert(newHouseholdData)
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
    await deliverSessions(household.id, childBirthYear, childBirthMonth, household.has_siblings);

    res.json({
      household: enrichHousehold(household),
      user,
      inviteUrl: `https://liff.line.me/${process.env.LIFF_ID}?invite=${household.invite_code}`,
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
    if (!liffIdToken) {
      return res.status(400).json({ error: "LINEアプリから開いてにゃ🐾" });
    }
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
      (sessions || []).map(async (s) => {
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

    const sceneText  = session.scenario.scene_text;
    const sessionType = session.scenario.session_type || "parent";

    // ============================================================
    // 子どもレンズ (child_lens) セッション用選択肢生成
    // ============================================================
    if (sessionType === "child_lens") {
      // Step A (step1): AI が子どもの行動選択肢を生成
      if (step === "step1") {
        const options = await generateChildLensStepAOptions({ sceneText });
        return res.json({ options, question: "子どもはどうすると思う？" });
      }

      // Step B (step2): 固定選択肢（根拠の性質）
      if (step === "step2") {
        return res.json({
          options: [
            "気質・生まれつきの性格だと思う",
            "最近のエピソードや体験から",
            "自分（親）の育て方や関わり方の影響",
            "よくわからない・なんとなくそう感じた",
          ],
          question: "なぜそう思う？その根拠は？",
        });
      }

      // Step C (step3): 固定選択肢（感情反応）
      if (step === "step3") {
        return res.json({
          options: [
            "安心する・それでいいと思う",
            "心配になる",
            "何とかしてあげたい",
            "自分のせいかもしれない",
            "複雑・どうしたらいいか迷う",
            "もどかしい・歯がゆい",
          ],
          question: "そのとき、あなたはどう感じる？",
        });
      }

      // Step D (step4): AI が理想像選択肢を生成（Step A + Step C のコンテキスト込み）
      if (step === "step4") {
        const { data: answers } = await supabase
          .from("session_answers")
          .select("step, answer")
          .eq("session_id", req.params.id)
          .eq("user_id", userId);
        const byStep = Object.fromEntries((answers || []).map((a) => [a.step, a.answer]));
        const behaviorChoice = byStep.step1?.behavior || "";
        const feelingChoice  = byStep.step3?.feeling  || "";
        const options = await generateChildLensStepDOptions({ sceneText, behaviorChoice, feelingChoice });
        return res.json({ options, question: "本当はどうなってほしい？" });
      }

      return res.status(400).json({ error: `Unknown step: ${step}` });
    }

    // ============================================================
    // 既存の親目線 (parent) セッション用選択肢生成
    // ============================================================

    // Step1-3: emotion + intensity を踏まえた想い・考えを生成（ユーザー別、キャッシュなし）
    if (step === "step1") {
      const { emotion, intensity } = req.query;
      if (!emotion) {
        return res.status(400).json({ error: "emotion required" });
      }
      const options = await generateStep1Options({
        sceneText,
        emotion,
        intensity: Number(intensity) || 5,
      });
      return res.json({ options, question: null });
    }

    // Step2〜4: ユーザーの回答をコンテキストに生成
    const { data: answers } = await supabase
      .from("session_answers")
      .select("step, answer")
      .eq("session_id", req.params.id)
      .eq("user_id", userId);

    const byStep = Object.fromEntries((answers || []).map((a) => [a.step, a.answer]));

    // Step1の感情・強度・想いを統合してコンテキスト文字列化
    const buildEmotionContext = (s1) => {
      if (!s1) return "";
      const { emotion, intensity, thought } = s1;
      if (emotion && intensity && thought) {
        const lbl = intensity <= 3 ? "少し" : intensity <= 5 ? "そこそこ" : intensity <= 7 ? "かなり" : "とても強く";
        return `${emotion}を${lbl}（${intensity}/10）感じ、「${thought}」と思っている`;
      }
      return thought || emotion || "";
    };

    if (step === "step2") {
      const emotionAnswer = buildEmotionContext(byStep.step1);
      const options = await generateStep2Options({ sceneText, emotionAnswer });
      const question = await import("../ai/generateStep2.js")
        .then((m) => m.generateStep2Question({ sceneText, emotionAnswer, userName: "あなた" }));
      return res.json({ options, question });
    }

    if (step === "step3") {
      const emotionAnswer = buildEmotionContext(byStep.step1);
      const valueChoice   = Array.isArray(byStep.step2?.values) ? byStep.step2.values.join("、") : (byStep.step2?.value || "");
      const options = await generateStep3Options({ sceneText, emotionAnswer, valueChoice });
      const question = await import("../ai/generateStep3.js")
        .then((m) => m.generateStep3Question({ sceneText, emotionAnswer, valueChoice, userName: "あなた" }));
      return res.json({ options, question });
    }

    if (step === "step4") {
      const emotionAnswer    = buildEmotionContext(byStep.step1);
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

    const sceneText   = session.scenario.scene_text;
    const sessionType = session.scenario.session_type || "parent";
    const isUser1     = session.user1_id === userId;
    const partnerId   = isUser1 ? session.user2_id : session.user1_id;
    const partnerStep = isUser1 ? session.user2_current_step : session.user1_current_step;
    const partnerDone = partnerStep === "completed";

    const myAns  = byUser[userId] || {};
    const myName = isUser1
      ? session.user1?.display_name || "あなた"
      : session.user2?.display_name || "あなた";

    let myReflectionText = null;
    let coupleReflectionText = null;

    if (sessionType === "child_lens") {
      // ── 子どもレンズ 個別リフレクション ──
      const behaviorChoice = myAns.step1?.behavior || "";
      const reasonType     = myAns.step2?.reasonType || "";
      const feelingChoice  = myAns.step3?.feeling    || "";
      const idealChoice    = myAns.step4?.ideal      || "";

      if (behaviorChoice) {
        myReflectionText = await generateChildLensReflection({
          sceneText,
          behaviorChoice,
          reasonType,
          feelingChoice,
          idealChoice,
          userName: myName,
        });
      }

      // ── 子どもレンズ カップルリフレクション ──
      if (partnerDone && byUser[partnerId]) {
        const partnerAns  = byUser[partnerId];
        const partnerName = isUser1
          ? session.user2?.display_name || "パートナー"
          : session.user1?.display_name || "パートナー";

        const u1Ans  = isUser1 ? myAns      : partnerAns;
        const u2Ans  = isUser1 ? partnerAns : myAns;
        const u1Name = isUser1 ? myName     : partnerName;
        const u2Name = isUser1 ? partnerName : myName;

        coupleReflectionText = await generateChildLensCoupleReflection({
          sceneText,
          user1Name:     u1Name,
          user1Behavior: u1Ans.step1?.behavior || "",
          user1Feeling:  u1Ans.step3?.feeling  || "",
          user1Ideal:    u1Ans.step4?.ideal    || "",
          user2Name:     u2Name,
          user2Behavior: u2Ans.step1?.behavior || "",
          user2Feeling:  u2Ans.step3?.feeling  || "",
          user2Ideal:    u2Ans.step4?.ideal    || "",
        });
      }
    } else {
      // ── 既存の親目線 個別リフレクション ──
      const s1 = myAns.step1 || {};
      const emotionAnswer = s1.emotion && s1.intensity && s1.thought
        ? (() => {
            const lbl = s1.intensity <= 3 ? "少し" : s1.intensity <= 5 ? "そこそこ" : s1.intensity <= 7 ? "かなり" : "とても強く";
            return `${s1.emotion}を${lbl}（${s1.intensity}/10）感じ、「${s1.thought}」と思っている`;
          })()
        : s1.thought || s1.emotion || "";

      if (emotionAnswer) {
        myReflectionText = await generateReflection({
          sceneText,
          emotionAnswer,
          valueChoice:      Array.isArray(myAns.step2?.values) ? myAns.step2.values.join("、") : (myAns.step2?.value || ""),
          backgroundChoice: myAns.step3?.background || "",
          visionChoice:     Array.isArray(myAns.step4?.priorities) ? myAns.step4.priorities.map((p) => p.value).join("、") : (myAns.step4?.vision || ""),
          userName: myName,
        });
      }

      // ── 既存の親目線 カップルリフレクション ──
      if (partnerDone && byUser[partnerId]) {
        const partnerAns  = byUser[partnerId];
        const partnerName = isUser1
          ? session.user2?.display_name || "パートナー"
          : session.user1?.display_name || "パートナー";

        coupleReflectionText = await generateCoupleReflection({
          sceneText,
          user1Name:  isUser1 ? myName : partnerName,
          user1Step1: isUser1 ? myAns.step1 : partnerAns.step1,
          user1Step2: isUser1 ? myAns.step2 : partnerAns.step2,
          user2Name:  isUser1 ? partnerName : myName,
          user2Step1: isUser1 ? partnerAns.step1 : myAns.step1,
          user2Step2: isUser1 ? partnerAns.step2 : myAns.step2,
        });
      }
    }

    // 既存の reflection（パートナーの個別リフレクション）を保持してマージ
    const existingPerUser = session.reflection?.perUser || {};
    const newReflection = {
      perUser: { ...existingPerUser, ...(myReflectionText ? { [userId]: myReflectionText } : {}) },
      difference: coupleReflectionText,
    };

    // セッション状態を更新
    const updateData = { reflection: newReflection };
    if (coupleReflectionText) updateData.couple_reflection = coupleReflectionText;
    updateData[isUser1 ? "user1_current_step" : "user2_current_step"] = "completed";
    if (partnerDone) {
      updateData.status = "completed";
      updateData.completed_at = new Date().toISOString();
    } else {
      updateData.status = "in_progress";
    }

    await supabase.from("liff_sessions").update(updateData).eq("id", sessionId);

    // 完了したら次のシナリオを1件追加解放
    if (session.household_id) {
      const hh = session.liff_households || {};
      const { data: hhData } = await supabase
        .from("liff_households")
        .select("child_birth_year, child_birth_month, has_siblings")
        .eq("id", session.household_id)
        .maybeSingle();
      if (hhData) {
        await deliverSessions(
          session.household_id,
          hhData.child_birth_year,
          hhData.child_birth_month,
          hhData.has_siblings
        );
      }
    }

    res.json({
      reflection: {
        perUser:    { [userId]: myReflectionText },
        difference: coupleReflectionText,
      },
    });
  } catch (err) {
    console.error("[liff/sessions/:id/complete]", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PATCH /api/liff/household/settings
// 家族設定の更新（兄弟あり/なし など）
// ============================================================
liffRouter.patch("/household/settings", async (req, res) => {
  try {
    const idToken = req.headers["x-liff-id-token"];
    if (!idToken) return res.status(401).json({ error: "Missing LIFF token" });

    const { lineUserId } = await verifyLiffToken(idToken);

    const { data: user } = await supabase
      .from("liff_users")
      .select("household_id")
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    if (!user?.household_id) return res.status(404).json({ error: "Household not found" });

    const { hasSiblings } = req.body;
    const updates = {};
    if (hasSiblings !== undefined) updates.has_siblings = hasSiblings;

    const { data: household, error } = await supabase
      .from("liff_households")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", user.household_id)
      .select()
      .single();
    if (error) throw error;

    res.json({ household: enrichHousehold(household) });
  } catch (err) {
    console.error("[liff/household/settings]", err);
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
// DELETE /api/liff/me
// アカウントをリセット（ユーザー・世帯・セッション・回答をすべて削除）
// ============================================================
liffRouter.delete("/me", async (req, res) => {
  try {
    const idToken = req.headers["x-liff-id-token"];
    if (!idToken) return res.status(401).json({ error: "Missing LIFF token" });

    const { lineUserId } = await verifyLiffToken(idToken);

    const { data: user } = await supabase
      .from("liff_users")
      .select("id, household_id")
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    if (!user) return res.json({ ok: true });

    const householdId = user.household_id;

    if (householdId) {
      // セッションID一覧を取得
      const { data: sessions } = await supabase
        .from("liff_sessions")
        .select("id")
        .eq("household_id", householdId);

      const sessionIds = (sessions || []).map((s) => s.id);

      // 回答を削除
      if (sessionIds.length > 0) {
        await supabase.from("liff_answers").delete().in("session_id", sessionIds);
      }

      // セッションを削除
      await supabase.from("liff_sessions").delete().eq("household_id", householdId);

      // 世帯内の全ユーザーを削除
      await supabase.from("liff_users").delete().eq("household_id", householdId);

      // 世帯を削除
      await supabase.from("liff_households").delete().eq("id", householdId);
    } else {
      // 世帯未設定のユーザーのみ削除
      await supabase.from("liff_users").delete().eq("id", user.id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[liff/me DELETE]", err);
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
