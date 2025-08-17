// server.js — Kemii Bot (MVP + Name Registration)
// Run with Node.js 20+. package.json should include: { "type": "module" }
// Required ENVs: PORT, CHANNEL_SECRET, CHANNEL_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY

import express from "express";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  CHANNEL_SECRET,
  CHANNEL_ACCESS_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("⚠️ Missing required environment variables. Required: CHANNEL_ACCESS_TOKEN, CHANNEL_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Utilities ---
function verifyLineSignature(req) {
  try {
    const signature = req.headers["x-line-signature"];
    const body = JSON.stringify(req.body);
    const hmac = crypto.createHmac("sha256", CHANNEL_SECRET).update(body).digest("base64");
    return signature === hmac;
  } catch {
    return false;
  }
}

function log(level, msg, extra = {}) {
  try {
    console.log(JSON.stringify({ level, msg, ...extra, ts: new Date().toISOString() }));
  } catch (e) {
    console.log(`[${level}] ${msg}`, extra);
  }
}

async function getLineProfile(userId) {
  const resp = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` }
  });
  if (!resp.ok) return null;
  return await resp.json();
}

async function getGroupMemberProfile(groupId, userId) {
  const resp = await fetch(`https://api.line.me/v2/bot/group/${groupId}/member/${userId}`, {
    headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` }
  });
  if (!resp.ok) return null;
  return await resp.json();
}

// グループのメンバーID一覧（最大200件、必要数だけ） 
async function getGroupMemberIds(groupId, limit = 10) {
  const url = `https://api.line.me/v2/bot/group/${groupId}/members/ids`;
  let start = null, ids = [];
  while (ids.length < limit) {
    const resp = await fetch(start ? `${url}?start=${start}` : url, {
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
    });
    if (!resp.ok) break;
    const json = await resp.json(); // { memberIds:[], next? }
    ids.push(...(json.memberIds || []));
    if (!json.next) break;
    start = json.next;
  }
  return ids.slice(0, limit);
}

// メンション付テキストを作る（表示名を先頭に置き、そこをメンション） 
async function buildMentionMessage(groupId, userId, afterText) {
  const prof = await getGroupMemberProfile(groupId, userId);
  const name = (prof?.displayName || "あなた").slice(0, 20);
  const text = `${name}さん ${afterText}`;
  return {
    type: "text",
    text,
    mention: { mentionees: [{ index: 0, length: `${name}さん`.length, userId }] }
  };
}


function extractDisplayName(raw) {
  if (!raw) return "";
  let t = raw.trim();

  const quotePatterns = [
    /「([^」]{1,20})」/, /『([^』]{1,20})』/, /“([^”]{1,20})”/, /"([^"]{1,20})"/, /'([^']{1,20})'/
  ];
  for (const rx of quotePatterns) {
    const m = t.match(rx);
    if (m?.[1]) return m[1].trim();
  }

  const tails = [
    /(と)?呼んでください(?:ね)?。?$/u,
    /(と)?呼んでね。?$/u,
    /(と)?呼んで。?$/u,
    /でお願いします。?$/u,
    /です。?$/u,
    /だよ。?$/u,
    /だよ$/u,
    /だよね。?$/u,
    /かな。?$/u,
    /ですか。?$/u
  ];
  for (const rx of tails) t = t.replace(rx, "").trim();

  const heads = [
    /^私は/u, /^僕は/u, /^俺は/u, /^わたしは/u, /^わたくしは/u,
    /^名前は/u, /^名前が/u, /^呼び名は/u
  ];
  for (const rx of heads) t = t.replace(rx, "").trim();

  t = t.replace(/(さん|ちゃん|くん|様)$/u, "").trim();
  t = t.replace(/^[\s、,。・:：\-~〜]+|[\s、,。・:：\-~〜]+$/g, "").slice(0, 20);
  if (!t) t = raw.trim().slice(0, 20);
  return t;
}

// --- Supabase helpers ---
async function upsertUserPending(userId, fallbackName) {
  const { data: existed } = await supabase.from("users").select("user_id").eq("user_id", userId).maybeSingle();
  if (!existed) {
    await supabase.from("users").insert({ user_id: userId, display_name: fallbackName || null, name_state: "pending" });
  } else {
    await supabase.from("users").update({ name_state: "pending", updated_at: new Date().toISOString() }).eq("user_id", userId);
  }
}

async function setUserName(userId, name) {
  const clean = (name || "").trim().slice(0, 20);
  await supabase.from("users").upsert({
    user_id: userId,
    display_name: clean,
    name_state: "set",
    updated_at: new Date().toISOString()
  });
  return clean;
}

async function getDisplayName(userId) {
  const { data } = await supabase.from("users").select("display_name").eq("user_id", userId).maybeSingle();
  return data?.display_name || null;
}

async function getUserState(userId) {
  const { data } = await supabase
    .from("users")
    .select("display_name,name_state,prompted_at")
    .eq("user_id", userId)
    .maybeSingle();
  return data || { name_state: "unset" };
}

async function markPrompted(userId) {
  await supabase.from("users").upsert({ user_id: userId, prompted_at: new Date().toISOString() });
}

function shouldNudgeAgain(prompted_at, hours = 24) {
  if (!prompted_at) return true;
  const last = new Date(prompted_at).getTime();
  return Date.now() - last > hours * 3600 * 1000;
}

// --- LINE reply/push ---
async function reply(replyToken, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages })
  });
}

async function push(to, textOrMessages) {
  const messages = Array.isArray(textOrMessages) ? textOrMessages : [{ type: "text", text: textOrMessages }];
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, messages })
  });
}

// --- OpenAI summary ---
async function buildAiSummary(question, aText, bText) {
  const prompt =
    `質問:「${question}」\nAさん:「${aText}」\nBさん:「${bText}」\n` +
    `以下のフォーマットで短く。追い質問は禁止。\n` +
    `1) まとめ（3行以内）\n2) 共通点（1行）\n3) 相違点（1行）\n4) 次の一歩（1行, 今夜3分で実行できること）`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "短く、穏やかに、具体的に。フォーマット厳守。" },
        { role: "user", content: prompt }
      ],
      max_tokens: 300,
      temperature: 0.4
    })
  });
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || "要約に失敗しました。";
}

// --- HEALTH ---
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/version", (_req, res) => {
  res.status(200).json({ commit: process.env.RENDER_GIT_COMMIT || "local", time: new Date().toISOString() });
});

// --- Constants ---
const QUESTION_ID = "q001";
const QUESTION_TEXT = "最近、お互いに『嬉しかった小さなこと』を1つ教えてください。";
const TRIGGER = "セキララ";

// --- Webhook ---
app.post("/webhook", async (req, res) => {
  const events = req.body?.events || [];
  for (const ev of events) {
    try {
      // follow (1:1)
      if (ev.type === "follow" && ev.source?.type === "user") {
        const userId = ev.source.userId;
        const state = await getUserState(userId);
        if (state.name_state === "set" && state.display_name) {
          await reply(ev.replyToken, [{ type: "text", text: `また会えたね、${state.display_name}さん🐾\n今日もよろしくにゃ。` }]);
        } else {
          const prof = await getLineProfile(userId);
          await upsertUserPending(userId, prof?.displayName);
          await reply(ev.replyToken, [{
            type: "text",
            text: `はじめまして、けみーだよ🐾\nなんて呼べばいいにゃ？（例：「すずき」「あや」など）\n${prof?.displayName ? `候補：${prof.displayName}\n` : ""}※あとで「名前」と送ると変更できるよ`
          }]);
        }
        continue;
      }

      // join (group)
      if (ev.type === "join" && ev.source?.type === "group") {
        const groupId = ev.source.groupId;
        await push(groupId, "けみーだよ🐾 よろしくね！\n呼び名を決めたい人は「名前」と送ってから、次の発言に希望の呼び名を書いてね。\n一発で決めるなら「名前 すずき」でもOKだにゃ。");
        continue;
      }

      // message
      if (ev.type === "message" && ev.message?.type === "text") {
        const text = ev.message.text.trim();
        const source = ev.source;

        // --- Group flow ---
        if (source.type === "group") {
          const groupId = source.groupId;
          const userId = source.userId;
          const state = await getUserState(userId);

          if (text.startsWith("名前 ")) {
            const want = extractDisplayName(text.slice("名前 ".length));
            const saved = await setUserName(userId, want);
            await push(groupId, `了解だにゃ。「${saved}」って呼ぶね！`);
            continue;
          }

          if (text === "名前") {
            const prof = await getGroupMemberProfile(groupId, userId);
            await upsertUserPending(userId, prof?.displayName);
            await push(groupId, `新しい呼び名を教えてにゃ（20文字まで）\n${prof?.displayName ? `候補：${prof.displayName}` : ""}`);
            continue;
          }

          if (state.name_state === "pending") {
            const saved = await setUserName(userId, extractDisplayName(text));
            await push(groupId, `了解だにゃ。「${saved}」って呼ぶね！`);
            continue;
          }

          if (state.name_state !== "set" && shouldNudgeAgain(state.prompted_at)) {
            await markPrompted(userId);
            await push(groupId, `よかったら呼び名を決めようかにゃ？「名前 すずき」みたいに送ればOKだよ🐾`);
            continue;
          }

          if (text === TRIGGER) {
           // 既存ランがあればキャンセル（安全運用・上書き開始）
            await supabase.from("question_runs")
              .upsert({ group_id: groupId, question_id: QUESTION_ID, targets: [], idx: 0, status: "canceled" });

            // グループのメンバーから「人」を2名抽出
            let memberIds = await getGroupMemberIds(groupId, 10);
            // ボット自身のIDは含まれない仕様だが、保険として userId 不要の空文字は除外
            memberIds = memberIds.filter(Boolean);
            // “夫婦想定”として先頭2名（必要ならここに除外ルールを足せます）
            const targets = memberIds.slice(0, 2);

            if (targets.length < 2) {
              await reply(ev.replyToken, [{ type: "text", text: "参加者が足りないみたい。2人以上のグループで試してね🐾" }]);
              continue;
            }

            // ランを保存して1人目にメンションで質問
            await supabase.from("question_runs").upsert({
              group_id: groupId, question_id: QUESTION_ID,
              targets, idx: 0, status: "active"
            });

            await push(groupId, [
              { type: "text", text: `【セキララ質問】\n${QUESTION_TEXT}\n\n順番にお聞きします。各自“最初の回答”だけ保存します。` },
            ]);
            const msg = await buildMentionMessage(groupId, targets[0], "まずはあなたから、一言でどうぞ！");
            await push(groupId, [msg]);
            continue;
          }

          // 保存処理
          const userIdAns = userId;
          if (!userIdAns) continue;

          const { data: existed } = await supabase.from("answers").select("id").eq("group_id", groupId).eq("user_id", userIdAns).eq("question_id", QUESTION_ID).maybeSingle();
          if (!existed) {
            await supabase.from("answers").insert({ group_id: groupId, user_id: userIdAns, question_id: QUESTION_ID, text });
            const disp = await getDisplayName(userIdAns);
            await push(groupId, disp ? `${disp}さん、回答ありがとう！（最初の1回だけ保存するよ）` : "回答を受け取りました（最初の1回だけ保存します）");

            // ☆ 順番ランの進行（自分の番だったら次の人へメンション）
const { data: run } = await supabase
  .from("question_runs")
  .select("targets, idx, status")
  .eq("group_id", groupId)
  .eq("question_id", QUESTION_ID)
  .maybeSingle();

if (run && run.status === "active" && Array.isArray(run.targets)) {
  const { targets, idx } = run;
  if (targets[idx] === userIdAns) {
    const nextIdx = idx + 1;
    if (nextIdx < targets.length) {
      await supabase.from("question_runs")
        .update({ idx: nextIdx })
        .eq("group_id", groupId).eq("question_id", QUESTION_ID);
      const msg2 = await buildMentionMessage(groupId, targets[nextIdx], "あなたの番だよ。教えてにゃ！");
      await push(groupId, [msg2]);
    } else {
      // 全員回ったら終了扱い
      await supabase.from("question_runs")
        .update({ status: "done" })
        .eq("group_id", groupId).eq("question_id", QUESTION_ID);
    }
  }
}


            const { data: rows } = await supabase.from("answers").select("user_id,text,created_at").eq("group_id", groupId).eq("question_id", QUESTION_ID).order("created_at", { ascending: true });
            if (rows && rows.length >= 2) {
              const { data: summed } = await supabase.from("ai_summaries").select("id").eq("group_id", groupId).eq("question_id", QUESTION_ID).maybeSingle();
              if (!summed) {
                const [a, b] = rows;
                const aiText = await buildAiSummary(QUESTION_TEXT, a.text, b.text);
                await supabase.from("ai_summaries").insert({ group_id: groupId, question_id: QUESTION_ID, summary_text: aiText });
                await push(groupId, aiText);
              }
            }
          } else {
            await push(groupId, "今回は“最初の回答”だけ保存しています。");
          }
          continue;
        }

        // --- 1:1 flow ---
        if (source.type === "user") {
          const userId = source.userId;
          const state = await getUserState(userId);

          if (text.startsWith("名前 ")) {
            const want = extractDisplayName(text.slice("名前 ".length));
            const saved = await setUserName(userId, want);
            await reply(ev.replyToken, [{ type: "text", text: `了解だにゃ。「${saved}」って呼ぶね！` }]);
            continue;
          }

          if (text === "名前") {
            const prof = await getLineProfile(userId);
            await upsertUserPending(userId, prof?.displayName);
            await reply(ev.replyToken, [{ type: "text", text: `新しい呼び名を教えてにゃ（20文字まで）${prof?.displayName ? `\n候補：${prof.displayName}` : ""}` }]);
            continue;
          }

          if (state.name_state === "pending") {
            const saved = await setUserName(userId, extractDisplayName(text));
            await reply(ev.replyToken, [{ type: "text", text: `了解だにゃ。「${saved}」って呼ぶね！` }]);
            continue;
          }

          await reply(ev.replyToken, [{ type: "text", text: "グループで「セキララ」と送ると質問が始まるよ🐾" }]);
          continue;
        }
      }
    } catch (e) {
      log("error", "event_failed", { error: String(e?.message || e) });
      try {
        const to = ev.source?.groupId || ev.source?.userId;
        if (to) await push(to, `処理に失敗しました：${e.message || e}`);
      } catch {}
    }
  }
  res.status(200).end();
});

// --- Start ---
app.listen(PORT, () => {
  console.log("listening on", PORT);
});
