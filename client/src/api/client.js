// src/api/client.js
// バックエンド API クライアント（すべての書き込みはここ経由）

const BASE = `${import.meta.env.VITE_API_BASE_URL || ""}/api/liff`;

async function request(method, path, body, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["x-liff-id-token"] = idToken;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`サーバーエラー (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export const api = {
  /** LIFF トークンでユーザー情報取得 */
  getMe: (idToken) =>
    request("GET", "/me", null, idToken),

  /** 初回設定（生年月登録） */
  onboarding: (liffIdToken, childBirthYear, childBirthMonth, hasSiblings) =>
    request("POST", "/onboarding", { liffIdToken, childBirthYear, childBirthMonth, hasSiblings }),

  /** 家族設定更新（兄弟あり/なし など） */
  updateHouseholdSettings: (idToken, settings) =>
    request("PATCH", "/household/settings", settings, idToken),

  /** 招待コード情報取得 */
  getInvite: (code) =>
    request("GET", `/invite/${code}`),

  /** 招待経由で参加 */
  joinInvite: (liffIdToken, inviteCode) =>
    request("POST", "/invite/join", { liffIdToken, inviteCode }),

  /** セッション一覧取得 */
  getSessions: (householdId) =>
    request("GET", `/sessions?householdId=${householdId}`),

  /** セッション詳細取得 */
  getSession: (sessionId) =>
    request("GET", `/sessions/${sessionId}`),

  /** ステップの選択肢生成 */
  getOptions: (sessionId, step, userId, extraParams = {}) => {
    const params = new URLSearchParams({ step, userId, ...extraParams });
    return request("GET", `/sessions/${sessionId}/options?${params}`);
  },

  /** 回答保存 */
  saveAnswer: (sessionId, userId, step, answer) =>
    request("POST", `/sessions/${sessionId}/answer`, { userId, step, answer }),

  /** セッション完了・リフレクション生成 */
  completeSession: (sessionId, userId) =>
    request("POST", `/sessions/${sessionId}/complete`, { userId }),
};
