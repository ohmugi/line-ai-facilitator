// src/api/liff.js
// LIFF Web App 用 API ルーター
import { Router } from "express";
import { supabase } from "../supabase/client.js";
import { generateStep1Options } from "../ai/generateStep1.js";
import { generateStepActionOptions } from "../ai/generateStepAction.js";
import { generateStepIntentQuestion, generateStepIntentOptions } from "../ai/generateStepIntent.js";
import { generateStepScriptQuestion, generateStepScriptOptions } from "../ai/generateStepScript.js";
import { generatePersonalityTraits } from "../ai/generatePersonalityTraits.js";
import { generateReflection } from "../ai/generateReflection.js";
import { generateCoupleReflection } from "../ai/generateCoupleReflection.js";
import { generateChildLensStepAOptions } from "../ai/generateChildLensStepA.js";
import { generateChildLensStepDOptions } from "../ai/generateChildLensStepD.js";
import { generateChildLensReflection, generateChildLensCoupleReflection } from "../ai/generateChildLensReflection.js";
import { generateGeneralStepOptions, generateGeneralReflection, generateGeneralCoupleReflection } from "../ai/generateGeneral.js";
import { callClaude } from "../ai/claude.js";

export const liffRouter = Router();

// ============================================================
// ヘルパー
// ============================================================

/** LIFF ID トークンを LINE API で検証し { lineUserId, displayName } を返す */
async function verifyLiffToken(idToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000); // 10秒タイムアウト
  try {
    const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id_token: idToken,
        client_id: process.env.LIFF_CHANNEL_ID,
      }).toString(),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.error || `LINE API error ${res.status}`);
    return { lineUserId: data.sub, displayName: data.name };
  } finally {
    clearTimeout(timer);
  }
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
async function deliverSessions(householdId, birthYear, birthMonth, hasSiblings, user1Id = null) {
  const ageGroup = calcAgeGroup(birthYear, birthMonth);
  const ageGroups = ageGroup === "universal" ? ["universal"] : [ageGroup, "universal"];

  // 配信済みセッション（最新順）と最後のカテゴリ・session_type を取得
  const { data: existing } = await supabase
    .from("liff_sessions")
    .select("scenario_id, scenario:scenes(category, session_type)")
    .eq("household_id", householdId)
    .order("delivered_at", { ascending: false });

  const existingIds = new Set((existing || []).map((s) => s.scenario_id));
  const isFirst = existingIds.size === 0;
  const lastCategory = existing?.[0]?.scenario?.category ?? null;
  const lastSessionType = existing?.[0]?.scenario?.session_type ?? null;

  // 年齢対象のアクティブシナリオを全件取得
  const { data: allScenes } = await supabase
    .from("scenes")
    .select("id, requires_siblings, category, session_type")
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

  let toInsert;

  if (isFirst) {
    // 初回: parent タイプから多様なカテゴリで3件を選択（is_starter 優先）
    const parentCandidates = candidates.filter((s) => s.session_type === "parent");
    const pool = parentCandidates.length >= 2 ? parentCandidates : candidates;

    let starterIds = new Set();
    try {
      const { data: starters } = await supabase
        .from("scenes")
        .select("id")
        .eq("is_starter", true)
        .in("age_group", ageGroups);
      (starters || []).forEach((s) => starterIds.add(s.id));
    } catch { /* is_starter 未マイグレーション時は無視 */ }

    // is_starter を先頭に並べてからカテゴリ多様性で3件選ぶ
    const sorted = [
      ...pool.filter((c) => starterIds.has(c.id)),
      ...pool.filter((c) => !starterIds.has(c.id)),
    ];

    const selectedScenes = [];
    const usedCategories = new Set();
    const selectedIds = new Set();

    for (const c of sorted) {
      if (selectedScenes.length >= 3) break;
      if (!usedCategories.has(c.category)) {
        selectedScenes.push(c);
        usedCategories.add(c.category);
        selectedIds.add(c.id);
      }
    }
    // カテゴリ多様性が不足する場合は補完
    for (const c of sorted) {
      if (selectedScenes.length >= 3) break;
      if (!selectedIds.has(c.id)) {
        selectedScenes.push(c);
        selectedIds.add(c.id);
      }
    }

    toInsert = selectedScenes.map((s) => ({
      household_id: householdId,
      scenario_id: s.id,
      status: "new",
      ...(user1Id ? { user1_id: user1Id } : {}),
    }));
  } else {
    // 2回目以降: 未配信の全シナリオを一括解放
    toInsert = candidates.map((s) => ({
      household_id: householdId,
      scenario_id: s.id,
      status: "new",
      ...(user1Id ? { user1_id: user1Id } : {}),
    }));
  }

  await supabase.from("liff_sessions").insert(toInsert);
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
    console.log("[onboarding] lineUserId:", lineUserId, "displayName:", displayName);
 claude/review-codebase-status-TQflc

    const householdFields = { child_birth_year: childBirthYear, child_birth_month: childBirthMonth };
    if (hasSiblings !== undefined && hasSiblings !== null) householdFields.has_siblings = hasSiblings;


    // 既存ユーザー確認
    const { data: existingUser, error: existingErr } = await supabase
      .from("liff_users")
      .select("id, household_id, line_user_id, display_name, role, created_at")
      .eq("line_user_id", lineUserId)
      .maybeSingle();
 claude/review-codebase-status-TQflc
    console.log("[onboarding] existingUser:", existingUser?.id, "household_id:", existingUser?.household_id);

    let household = null;

    if (existingUser?.household_id) {
      // 既存世帯を更新（世帯が存在する場合のみ）
      const { data: updated } = await supabase

    console.log("[onboarding] existingUser:", existingUser?.id, "existingErr:", existingErr?.message);

    if (existingUser?.household_id) {
      // 既存: 生年月を更新してセッション追加配信
      const updateFields = {
        child_birth_year:  childBirthYear,
        child_birth_month: childBirthMonth,
        updated_at: new Date().toISOString(),
      };
      if (hasSiblings !== undefined && hasSiblings !== null) updateFields.has_siblings = hasSiblings;

      const { data: household, error: hhUpdateErr } = await supabase

        .from("liff_households")
        .update({ ...householdFields, updated_at: new Date().toISOString() })
        .eq("id", existingUser.household_id)
        .select()
 claude/review-codebase-status-TQflc
        .maybeSingle();
      console.log("[onboarding] household update result:", updated?.id);
      household = updated;
    }

    if (!household) {
      // 世帯がない or 更新対象が存在しなかった → 新規作成
      const { data: created, error: hhErr } = await supabase
        .from("liff_households")
        .insert(householdFields)
        .select()
        .single();
      console.log("[onboarding] household insert:", created?.id, "err:", hhErr?.message);
      if (hhErr) throw hhErr;
      if (!created) throw new Error("世帯の作成に失敗しました。再度お試しください。");
      household = created;

      if (existingUser) {
        // 既存ユーザーの household_id を新世帯に付け替え
        await supabase.from("liff_users").update({ household_id: household.id }).eq("id", existingUser.id);
      }
    }

    let user = existingUser;

    if (!existingUser) {
      // 完全新規ユーザー作成
      const { data: created, error: userErr } = await supabase
        .from("liff_users")
        .insert({ line_user_id: lineUserId, household_id: household.id, display_name: displayName, role: "inviter" })
        .select()
        .single();
      console.log("[onboarding] user insert:", created?.id, "err:", userErr?.message);
      if (userErr) throw userErr;
      if (!created) throw new Error("ユーザーの作成に失敗しました。再度お試しください。");
      user = created;
    }

        .single();
      console.log("[onboarding] household update:", household?.id, "err:", hhUpdateErr?.message);
      if (hhUpdateErr) throw hhUpdateErr;
      if (!household) throw new Error("世帯情報の更新に失敗しました。再度お試しください。");

      await deliverSessions(household.id, childBirthYear, childBirthMonth, household.has_siblings, existingUser.id);

      return res.json({
        household: enrichHousehold(household),
        user: existingUser,
        inviteUrl: `https://liff.line.me/${process.env.LIFF_ID}?invite=${household.invite_code}`,
      });
    }

    // 新規: household 作成
    const newHouseholdData = { child_birth_year: childBirthYear, child_birth_month: childBirthMonth };
    if (hasSiblings !== undefined && hasSiblings !== null) newHouseholdData.has_siblings = hasSiblings;

    const { data: household, error: hhErr } = await supabase
      .from("liff_households")
      .insert(newHouseholdData)
      .select()
      .single();
    console.log("[onboarding] household insert:", household?.id, "err:", hhErr?.message);
    if (hhErr) throw hhErr;
    if (!household) throw new Error("世帯の作成に失敗しました。再度お試しください。");

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
    console.log("[onboarding] user insert:", user?.id, "err:", userErr?.message);
    if (userErr) throw userErr;
    if (!user) throw new Error("ユーザーの作成に失敗しました。再度お試しください。");


    // セッション配信
    await deliverSessions(household.id, childBirthYear, childBirthMonth, household.has_siblings, user.id);

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

    // 既存セッションが1件以上あれば、未配信シナリオを自動同期（新ドメイン追加対応）
    const { data: household } = await supabase
      .from("liff_households")
      .select("child_birth_year, child_birth_month, has_siblings")
      .eq("id", householdId)
      .maybeSingle();

    if (household) {
      const { count } = await supabase
        .from("liff_sessions")
        .select("id", { count: "exact", head: true })
        .eq("household_id", householdId);

      // 初回配信済み（count > 0）の場合のみ自動同期
      if (count > 0) {
        await deliverSessions(
          householdId,
          household.child_birth_year,
          household.child_birth_month,
          household.has_siblings,
          userId || null
        );
      }
    }

    const { data: sessions, error } = await supabase
      .from("liff_sessions")
      .select(`
        *,
        scenario:scenes(id, scene_text, category, age_group, session_type, domain)
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
    // general セッション用選択肢生成（お金・コミュニケーションなど）
    // ============================================================
    if (sessionType === "general") {
      const { data: prevAnswers } = await supabase
        .from("session_answers")
        .select("step, answer")
        .eq("session_id", req.params.id)
        .eq("user_id", userId);
      const byStep = Object.fromEntries((prevAnswers || []).map((a) => [a.step, a.answer]));

      const step1Action = byStep.step1?.action || "";
      const step2Reason = byStep.step2?.reason || "";

      const { question, options } = await generateGeneralStepOptions({
        sceneText,
        step,
        step1Action,
        step2Reason,
      });
      return res.json({ options, question });
    }

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
    // 親目線 (parent) セッション用選択肢生成
    // 新フロー: step1=アクション、step2=感情の想い、step3=意図、step4=スクリプト
    // ============================================================

    // Step1: アクション選択肢（AIが生成）
    if (step === "step1") {
      const options = await generateStepActionOptions({ sceneText });
      return res.json({ options, question: "この場面で、どうしてあげたいと思う？" });
    }

    // Step2: 感情の想い（emotion + intensity を踏まえた想い・考え）
    if (step === "step2") {
      const { emotion, intensity } = req.query;
      if (!emotion) {
        return res.status(400).json({ error: "emotion required for step2 thought options" });
      }
      const options = await generateStep1Options({
        sceneText,
        emotion,
        intensity: Number(intensity) || 5,
      });
      return res.json({ options, question: null });
    }

    // Step3〜4: ユーザーの回答をコンテキストに生成
    const { data: answers } = await supabase
      .from("session_answers")
      .select("step, answer")
      .eq("session_id", req.params.id)
      .eq("user_id", userId);

    const byStep = Object.fromEntries((answers || []).map((a) => [a.step, a.answer]));

    // Step2（感情）の回答をコンテキスト文字列化
    const buildEmotionContext = (s2) => {
      if (!s2) return "";
      const { emotion, intensity, thought } = s2;
      if (emotion && intensity && thought) {
        const lbl = intensity <= 3 ? "少し" : intensity <= 5 ? "そこそこ" : intensity <= 7 ? "かなり" : "とても強く";
        return `${emotion}を${lbl}（${intensity}/10）感じ、「${thought}」と思っている`;
      }
      return thought || emotion || "";
    };

    // ユーザー名を取得
    const { data: userData } = await supabase
      .from("liff_users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    const userName = userData?.display_name || "あなた";

    if (step === "step3") {
      const actionChoice  = byStep.step1?.action || "";
      const emotionAnswer = buildEmotionContext(byStep.step2);
      const [options, question] = await Promise.all([
        generateStepIntentOptions({ sceneText, actionChoice, emotionAnswer }),
        generateStepIntentQuestion({ sceneText, actionChoice, emotionAnswer, userName }),
      ]);
      return res.json({ options, question });
    }

    if (step === "step4") {
      const actionChoice  = byStep.step1?.action || "";
      const emotionAnswer = buildEmotionContext(byStep.step2);
      const intentChoice  = byStep.step3?.intent || "";
      const [options, question] = await Promise.all([
        generateStepScriptOptions({ sceneText, actionChoice, emotionAnswer, intentChoice }),
        generateStepScriptQuestion({ sceneText, actionChoice, emotionAnswer, intentChoice, userName }),
      ]);
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
    const { userId, step, answer, concreteness_level } = req.body;
    const sessionId = req.params.id;

    // 回答を upsert
    const upsertData = { session_id: sessionId, user_id: userId, step, answer };


    const { error: ansErr } = await supabase
      .from("session_answers")
      .upsert(upsertData, { onConflict: "session_id,user_id,step" });
    if (ansErr) throw ansErr;

    // セッションの現在ステップを更新
    const { data: session } = await supabase
      .from("liff_sessions")
      .select("user1_id, user2_id, user1_current_step, user2_current_step, status, scenario:scenes(session_type)")
      .eq("id", sessionId)
      .single();

    const sessionType = session.scenario?.session_type || "parent";
    // general タイプは 3 ステップ（step1→step2→step3→completed）
    const STEPS = sessionType === "general"
      ? ["step1", "step2", "step3"]
      : ["step1", "step2", "step3", "step4"];
    const nextStep = STEPS[STEPS.indexOf(step) + 1] || "completed";

    // user1_id が未設定のセッション（旧データ）は動的に割り当て
    let { user1_id } = session;
    if (!user1_id) {
      if (session.user2_id === userId) {
        // このユーザーが user2 → user1_id は不明（パートナーが先に来る想定）
      } else {
        // このユーザーが最初の回答者 → user1 として設定
        user1_id = userId;
        await supabase.from("liff_sessions").update({ user1_id: userId }).eq("id", sessionId);
      }
    }

    const isUser1 = user1_id === userId;
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
      .select("*, scenario:scenes(*)")
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

    // user1_id が未設定のセッション（旧データ）を考慮
    const isUser1 = session.user1_id
      ? session.user1_id === userId
      : session.user2_id !== userId;
    const partnerId   = isUser1 ? session.user2_id : session.user1_id;
    const partnerStep = isUser1 ? session.user2_current_step : session.user1_current_step;
    const partnerDone = partnerStep === "completed";

    const myAns = byUser[userId] || {};

    // ユーザー名を個別クエリで取得（同テーブルへの複数FK joinの曖昧さを回避）
    const myUserId      = userId;
    const partnerUserId = partnerId;
    const [{ data: myUserData }, { data: partnerUserData }] = await Promise.all([
      supabase.from("liff_users").select("display_name").eq("id", myUserId).maybeSingle(),
      partnerUserId
        ? supabase.from("liff_users").select("display_name").eq("id", partnerUserId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const myName      = myUserData?.display_name || "あなた";
    const partnerName = partnerUserData?.display_name || "パートナー";

    let myReflectionText = null;
    let coupleReflectionText = null;

    if (sessionType === "general") {
      // ── general 個別リフレクション（お金・コミュニケーションなど）──
      const actionChoice = myAns.step1?.action || "";
      const reasonChoice = myAns.step2?.reason || "";
      const valueChoice  = myAns.step3?.value  || "";

      if (actionChoice) {
        myReflectionText = await generateGeneralReflection({
          sceneText,
          actionChoice,
          reasonChoice,
          valueChoice,
          userName: myName,
        });
      }

      // ── general カップルリフレクション ──
      if (partnerDone && byUser[partnerId]) {
        const partnerAns = byUser[partnerId];
        const u1Ans  = isUser1 ? myAns      : partnerAns;
        const u2Ans  = isUser1 ? partnerAns : myAns;

        coupleReflectionText = await generateGeneralCoupleReflection({
          sceneText,
          user1Name:   isUser1 ? myName      : partnerName,
          user1Action: u1Ans.step1?.action || "",
          user1Reason: u1Ans.step2?.reason || "",
          user1Value:  u1Ans.step3?.value  || "",
          user2Name:   isUser1 ? partnerName : myName,
          user2Action: u2Ans.step1?.action || "",
          user2Reason: u2Ans.step2?.reason || "",
          user2Value:  u2Ans.step3?.value  || "",
        });
      }
    } else if (sessionType === "child_lens") {
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
        const partnerAns = byUser[partnerId];

        const u1Ans  = isUser1 ? myAns      : partnerAns;
        const u2Ans  = isUser1 ? partnerAns : myAns;
        const u1Name = isUser1 ? myName     : partnerName;
        const u2Name = isUser1 ? partnerName : myName;

        coupleReflectionText = await generateChildLensCoupleReflection({
          sceneText,
          user1Name:     u1Name,
          user1Behavior: u1Ans.step1?.behavior  || "",
          user1Basis:    u1Ans.step2?.reasonType || "",
          user1Feeling:  u1Ans.step3?.feeling   || "",
          user1Ideal:    u1Ans.step4?.ideal      || "",
          user2Name:     u2Name,
          user2Behavior: u2Ans.step1?.behavior  || "",
          user2Basis:    u2Ans.step2?.reasonType || "",
          user2Feeling:  u2Ans.step3?.feeling   || "",
          user2Ideal:    u2Ans.step4?.ideal      || "",
        });
      }
    } else {
      // ── 親目線 個別リフレクション（新フロー: step1=アクション, step2=感情, step3=意図, step4=スクリプト）──
      const buildEmotionCtx = (s2) => {
        if (!s2) return "";
        const { emotion, intensity, thought } = s2;
        if (emotion && intensity && thought) {
          const lbl = intensity <= 3 ? "少し" : intensity <= 5 ? "そこそこ" : intensity <= 7 ? "かなり" : "とても強く";
          return `${emotion}を${lbl}（${intensity}/10）感じ、「${thought}」と思っている`;
        }
        return thought || emotion || "";
      };

      const actionChoice  = myAns.step1?.action || "";
      const emotionAnswer = buildEmotionCtx(myAns.step2);
      const intentChoice  = myAns.step3?.intent || "";
      const scriptValues  = Array.isArray(myAns.step4?.values) ? myAns.step4.values.join("、") : (myAns.step4?.value || "");

      if (actionChoice || emotionAnswer) {
        // 個性特定（DB から全トレイトを取得）
        let identifiedTraits = [];
        try {
          const { data: allTraits } = await supabase
            .from("personality_traits")
            .select("name, description, category");

          if (allTraits?.length) {
            const { identified, newTrait } = await generatePersonalityTraits({
              sceneText,
              actionChoice,
              emotionAnswer,
              intentChoice,
              scriptValues,
              availableTraits: allTraits,
              userName: myName,
            });
            identifiedTraits = identified;

            // 新しい個性を DB に追加
            if (newTrait?.name) {
              const { data: inserted } = await supabase
                .from("personality_traits")
                .insert({ name: newTrait.name, description: newTrait.description, category: newTrait.category })
                .select("id")
                .maybeSingle();
              if (inserted?.id) identifiedTraits = [...identifiedTraits, newTrait.name];
            }

            // セッション×ユーザーの個性を保存
            if (identifiedTraits.length > 0) {
              const { data: traitRows } = await supabase
                .from("personality_traits")
                .select("id, name")
                .in("name", identifiedTraits);
              if (traitRows?.length) {
                await supabase.from("session_user_traits").upsert(
                  traitRows.map((t) => ({ session_id: sessionId, user_id: userId, trait_id: t.id })),
                  { onConflict: "session_id,user_id,trait_id" }
                );
              }
            }
          }
        } catch (traitErr) {
          console.error("[complete/personality_traits]", traitErr);
        }

        myReflectionText = await generateReflection({
          sceneText,
          actionChoice,
          emotionAnswer,
          intentChoice,
          scriptValues,
          identifiedTraits,
          userName: myName,
        });
      }

      // ── 親目線 カップルリフレクション ──
      if (partnerDone && byUser[partnerId]) {
        const partnerAns = byUser[partnerId];

        coupleReflectionText = await generateCoupleReflection({
          sceneText,
          user1Name:  isUser1 ? myName      : partnerName,
          user1Step1: isUser1 ? myAns.step1  : partnerAns.step1,
          user1Step2: isUser1 ? myAns.step2  : partnerAns.step2,
          user1Step3: isUser1 ? myAns.step3  : partnerAns.step3,
          user1Step4: isUser1 ? myAns.step4  : partnerAns.step4,
          user2Name:  isUser1 ? partnerName  : myName,
          user2Step1: isUser1 ? partnerAns.step1 : myAns.step1,
          user2Step2: isUser1 ? partnerAns.step2 : myAns.step2,
          user2Step3: isUser1 ? partnerAns.step3 : myAns.step3,
          user2Step4: isUser1 ? partnerAns.step4 : myAns.step4,
        });
      }
    }

    // AI生成後、直前に最新の reflection を再取得して競合上書きを防ぐ
    const { data: latestSession } = await supabase
      .from("liff_sessions")
      .select("reflection, couple_reflection")
      .eq("id", sessionId)
      .single();
    const existingPerUser = latestSession?.reflection?.perUser || {};
    const existingDifference = latestSession?.reflection?.difference
      || latestSession?.couple_reflection
      || null;
    const newReflection = {
      perUser: { ...existingPerUser, ...(myReflectionText ? { [userId]: myReflectionText } : {}) },
      difference: coupleReflectionText || existingDifference,
    };

    // セッション状態を更新
    const updateData = { reflection: newReflection };
    if (coupleReflectionText) updateData.couple_reflection = coupleReflectionText;
    updateData[isUser1 ? "user1_current_step" : "user2_current_step"] = "completed";
    const partnerExists = Boolean(partnerId);
    if (partnerDone || !partnerExists) {
      updateData.status = "completed";
      updateData.completed_at = new Date().toISOString();
    } else {
      updateData.status = "in_progress";
    }

    await supabase.from("liff_sessions").update(updateData).eq("id", sessionId);

    // 最初の一人が完了した時点で次のシナリオを1件追加解放（二人目が完了しても追加しない）
    if (!partnerDone && session.household_id) {
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

    res.json({ reflection: newReflection });
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
