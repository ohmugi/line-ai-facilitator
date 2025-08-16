import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// ---- env ----
const {
  PORT = 3000,
  CHANNEL_SECRET,
  CHANNEL_ACCESS_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
} = process.env;

// ---- clients ----
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---- util: LINE署名検証（任意/推奨）----
function verifyLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);
  const hmac = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body).digest("base64");
  return signature === hmac;
}

// ---- health ----
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/version", (_req, res) => {
  res.status(200).json({
    commit: process.env.RENDER_GIT_COMMIT || "local",
    time: new Date().toISOString()
  });
});

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    level,
    msg,
    ...extra,
    ts: new Date().toISOString()
  }));
}


// ---- 定数：固定質問（MVPは1問だけ）----
const QUESTION_ID = "q001";
const QUESTION_TEXT = "最近、お互いに「嬉しかった小さなこと」を1つ教えてください。";

// ---- コマンド: /sekirara start ----
app.post("/webhook", async (req, res) => {
  // 署名チェック（開発中は一時オフでもOK）
  // if (!verifyLineSignature(req)) return res.status(403).end();

  const events = req.body?.events || [];
  for (const ev of events) {
    try {
      if (ev.type === "message" && ev.message?.type === "text") {
        const text = ev.message.text.trim();
        const source = ev.source; // { type: 'group' | 'user' | ... , groupId?, userId? }

        // MVP: グループでのみ動かす
        if (source.type !== "group") continue;
        const groupId = source.groupId;

        // コマンドで質問を投下
        if (text === "セキララ") {
          await reply(ev.replyToken, [
            {
              type: "text",
              text:
                `【セキララ質問】\n${QUESTION_TEXT}\n\n` +
                "このスレッドでは、各自“最初の回答”だけ保存します。"
            }
          ]);
          continue;
        }

        // 回答の受理（/sekirara start 後は自由入力でOK）
        // 条件：テキストを送ったユーザの最初の回答のみ保存
        const userId = source.userId; // グループでも個人の userId が入る
        if (!userId) continue;

        // 既にこの userId が回答済みか？
        const { data: existed, error: selErr } = await supabase
          .from("answers")
          .select("id")
          .eq("group_id", groupId)
          .eq("user_id", userId)
          .eq("question_id", QUESTION_ID)
          .maybeSingle();

        if (selErr) {
          await push(groupId, `保存確認エラー：${selErr.message}`);
          continue;
        }

        if (!existed) {
          const { error: insErr } = await supabase
            .from("answers")
            .insert({
              group_id: groupId,
              user_id: userId,
              question_id: QUESTION_ID,
              text
            });

          if (insErr) {
            await push(groupId, `保存エラー：${insErr.message}`);
          } else {
            await push(groupId, "回答を受け取りました（最初の1回だけ保存します）");
          }

          // 2件そろったか or 片方だけ24h経過の判定は簡易でOK
          // ここでは「2件そろったら即AI返答」にします
          const { data: two, error: cntErr } = await supabase
            .from("answers")
            .select("id", { count: "exact", head: true })
            .eq("group_id", groupId)
            .eq("question_id", QUESTION_ID);

          if (!cntErr && two?.length === 0) {
            // head:true の場合 dataは空配列。件数は count で取得する方法も可。
          }

          // 再取得して実体を集める
          const { data: rows, error: getErr } = await supabase
            .from("answers")
            .select("user_id,text,created_at")
            .eq("group_id", groupId)
            .eq("question_id", QUESTION_ID)
            .order("created_at", { ascending: true });

          if (!getErr && rows && rows.length >= 2) {
            // 既に要約済みか？
            const { data: summed } = await supabase
              .from("ai_summaries")
              .select("id")
              .eq("group_id", groupId)
              .eq("question_id", QUESTION_ID)
              .maybeSingle();
            if (!summed) {
              const [a, b] = rows;
              const aiText = await buildAiSummary(QUESTION_TEXT, a.text, b.text);
              await supabase.from("ai_summaries").insert({
                group_id: groupId,
                question_id: QUESTION_ID,
                summary_text: aiText
              });
              await push(groupId, aiText);
            }
          }
        } else {
          // 2回目以降は保存しない
          await push(groupId, "今回は“最初の回答”だけ保存しています。");
        }
      }
    } catch (e) {
      // 失敗時は短く通知
      try { await push(ev.source.groupId, `処理に失敗しました：${e.message}`); } catch {}
    }
  }
  res.status(200).end();
});

// ---- AI 要約（OpenAI例：環境変数 OPENAI_API_KEY 必要）----
async function buildAiSummary(question, aText, bText) {
  const prompt =
    `質問:「${question}」\nAさん:「${aText}」\nBさん:「${bText}」\n` +
    `以下のフォーマットで短く。追い質問は禁止。\n` +
    `1) まとめ（3行以内）\n2) 共通点（1行）\n3) 相違点（1行）\n4) 次の一歩（1行, 今夜3分で実行できること）`;

  // 必要なモデルに置き換えてください（仮のシンプル実装）
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
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
  const text = data?.choices?.[0]?.message?.content?.trim() || "要約に失敗しました。";
  return text;
}

// ---- LINE返信/プッシュ ----
async function reply(replyToken, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ replyToken, messages })
  });
}

async function push(to, text) {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text }]
    })
  });
}

app.listen(PORT, () => console.log("listening on", PORT));

async function upsertUserPending(userId, fallbackName) {
  // 既存がなければ pending で作成、あれば state を pending に
  const { data: existed } = await supabase.from("users").select("user_id").eq("user_id", userId).maybeSingle();
  if (!existed) {
    await supabase.from("users").insert({ user_id: userId, display_name: fallbackName || null, name_state: "pending" });
  } else {
    await supabase.from("users").update({ name_state: "pending", updated_at: new Date().toISOString() }).eq("user_id", userId);
  }
}

async function setUserName(userId, name) {
  const clean = (name || "").trim().slice(0, 20); // 20文字で切る
  await supabase.from("users").upsert({
    user_id: userId,
    display_name: clean,
    name_state: "set",
    updated_at: new Date().toISOString()
  });
  return clean;
}

async function getDisplayName(userId) {
  const { data } = await supabase.from("users").select("display_name,name_state").eq("user_id", userId).maybeSingle();
  return data?.display_name || null;
}

// LINEプロフィール（1:1限定で取得可能）
async function getLineProfile(userId) {
  const resp = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
  });
  if (!resp.ok) return null;
  return await resp.json(); // { displayName, userId, pictureUrl, statusMessage }
}

+// --- name state helpers -----------------------------------------------------
+async function getUserState(userId) {
+  const { data } = await supabase
+    .from("users")
+    .select("display_name,name_state,prompted_at")
+    .eq("user_id", userId)
+    .maybeSingle();
+  return data || { name_state: "unset" };
+}
+
+async function markPrompted(userId) {
+  await supabase.from("users")
+    .upsert({ user_id: userId, prompted_at: new Date().toISOString() });
+}
+
+function shouldNudgeAgain(prompted_at, hours = 24) {
+  if (!prompted_at) return true;
+  const last = new Date(prompted_at).getTime();
+  return Date.now() - last > hours * 3600 * 1000;
+}
+

app.post("/webhook", async (req, res) => {
  const events = req.body?.events || [];
  for (const ev of events) {
    try {
     +      // 友だち追加時（1:1）— 登録済みなら聞かずに名前で挨拶、未登録だけお願い
+      if (ev.type === "follow" && ev.source?.type === "user") {
+        const userId = ev.source.userId;
+        const state = await getUserState(userId);
+        if (state.name_state === "set" && state.display_name) {
+          await reply(ev.replyToken, [{
+            type: "text",
+            text: `また会えたね、${state.display_name}さん🐾\n今日もよろしくにゃ。`
+          }]);
+        } else {
+          const prof = await getLineProfile(userId);
+          await upsertUserPending(userId, prof?.displayName);
+          await reply(ev.replyToken, [{
+            type: "text",
+            text:
+              `はじめまして、けみーだよ🐾\n` +
+              `なんて呼べばいいにゃ？（例：「すずき」「あや」など）\n` +
+              (prof?.displayName ? `候補：${prof.displayName}\n` : ``) +
+              `※あとで「名前」と送ると変更できるよ`
+          }]);
+        }
+        continue;
+      }
      // 1:1で名前再設定のコマンド
      if (ev.type === "message" && ev.message?.type === "text" && ev.source?.type === "user") {
        const userId = ev.source.userId;
        const text = ev.message.text.trim();

        // 再設定コマンド：「名前」
        if (text === "名前") {
          await upsertUserPending(userId, (await getLineProfile(userId))?.displayName);
          await reply(ev.replyToken, [{ type: "text", text: "新しい呼び名を教えてにゃ（20文字まで）" }]);
          continue;
        }

        // pending 中なら、そのテキストを名前として保存
        const { data: u } = await supabase.from("users")
          .select("name_state").eq("user_id", userId).maybeSingle();
        if (u?.name_state === "pending") {
          const saved = await setUserName(userId, text);
          await reply(ev.replyToken, [{
            type: "text",
            text: `了解だにゃ。「${saved}」って呼ぶね！\n（変更したくなったらまた「名前」と送ってね）`
          }]);
          continue;
        }
      }

      // …（この下にあなたの既存ロジック：トリガー「セキララ」、回答保存、要約 などが続く）
      // 例：質問投稿時・要約投稿時に getDisplayName(userId) を使って名前を差し込めます

    } catch (e) {
      try { await push(ev.source?.groupId || ev.source?.userId, `処理に失敗しました：${e.message}`); } catch {}
    }
  }
  res.status(200).end();
});

// 受理後の通知例
const disp = await getDisplayName(userId);
// 名前未設定なら何もつけない or LINEプロフを使う（ここでは控えめに無記名推奨）
await push(groupId, disp ? `${disp}さん、回答ありがとう！` : `回答を受け取りました（最初の1回だけ保存します）`);

async function getGroupMemberProfile(groupId, userId) {
  const resp = await fetch(`https://api.line.me/v2/bot/group/${groupId}/member/${userId}`, {
    headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
  });
  if (!resp.ok) return null;
  return await resp.json(); // { displayName, userId, pictureUrl }
}

if (ev.type === "join" && ev.source?.type === "group") {
  const groupId = ev.source.groupId;
  await push(groupId,
    "けみーだよ🐾 これからよろしくね！\n" +
    "呼び名を決めたい人は「名前」と送ってから、次の発言に希望の呼び名を書いてね。\n" +
    "一発で決めたい時は「名前 すずき」みたいに書いてくれてOKだにゃ。"
  );
  continue;
}

if (ev.type === "message" && ev.message?.type === "text" && ev.source?.type === "group") {
  const groupId = ev.source.groupId;
  const userId  = ev.source.userId;
  const text    = ev.message.text.trim();
  +  const state   = await getUserState(userId);

  // 一発指定（例：「名前 すずき」）
  if (text.startsWith("名前 ")) {
    +    const want = extractDisplayName(text.slice("名前 ".length));
    const saved = await setUserName(userId, want);
    await push(groupId, `了解だにゃ。「${saved}」って呼ぶね！`);
    return res.status(200).end();
  }

  // 「名前」だけ → pending にして次の発言を名前として受理
  if (text === "名前") {
    const prof = await getGroupMemberProfile(groupId, userId);
    await upsertUserPending(userId, prof?.displayName);
    await push(groupId,
      `新しい呼び名を教えてにゃ（20文字まで）\n` +
      (prof?.displayName ? `候補：${prof.displayName}` : "")
    );
    return res.status(200).end();
  }

  +  // pending中なら、今回テキストを「名前だけ」に整形して保存
+  if (state.name_state === "pending") {
+    const saved = await setUserName(userId, extractDisplayName(text));
    await push(groupId, `了解だにゃ。「${saved}」って呼ぶね！`);
    return res.status(200).end();
  }
  +
+  // 未登録ユーザーが発言：24hに1回だけやさしく案内（連投防止）
+  if (state.name_state !== "set" && shouldNudgeAgain(state.prompted_at)) {
+    await markPrompted(userId);
+    await push(groupId, `よかったら呼び名を決めようかにゃ？「名前 すずき」みたいに送ればOKだよ🐾`);
+    return res.status(200).end();
+  }
 }
}

function extractDisplayName(raw) {
  if (!raw) return "";

  let t = raw.trim();

  // 1) 引用・カッコ内を優先
  const quotePatterns = [
    /「([^」]{1,20})」/,
    /『([^』]{1,20})』/,
    /“([^”]{1,20})”/,
    /"([^"]{1,20})"/,
    /'([^']{1,20})'/
  ];
  for (const rx of quotePatterns) {
    const m = t.match(rx);
    if (m?.[1]) return m[1].trim();
  }

  // 2) 定型フレーズを末尾から削る（順番大事）
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
    /ですか。?$/u,
  ];
  for (const rx of tails) t = t.replace(rx, "").trim();

  // 3) 先頭・末尾の補助語を削る
  const heads = [
    /^私は/u, /^僕は/u, /^俺は/u, /^わたしは/u, /^わたくしは/u,
    /^名前は/u, /^名前が/u, /^呼び名は/u
  ];
  for (const rx of heads) t = t.replace(rx, "").trim();

  // 4) 敬称を外す（末尾のみ）
  t = t.replace(/(さん|ちゃん|くん|様)$/u, "").trim();

  // 5) 無難な長さ・記号を整える
  t = t.replace(/^[\s、,。・:：\-~〜]+|[\s、,。・:：\-~〜]+$/g, "").slice(0, 20);

  // 6) もし空になったら元文を20文字で切る
  if (!t) t = raw.trim().slice(0, 20);

  return t;
}
if (u?.name_state === "pending") {
  const candidate = extractDisplayName(text);
  const saved = await setUserName(userId, candidate);
  await push(groupIdOrUserId, `了解だにゃ。「${saved}」って呼ぶね！\n（違ってたらまた「名前」と送ってにゃ）`);
  return res.status(200).end();
}
