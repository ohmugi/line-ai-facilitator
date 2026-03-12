// src/api/client.js
// バックエンド API クライアント（すべての書き込みはここ経由）

const BASE = "/api/liff";

async function request(method, path, body, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["x-liff-id-token"] = idToken;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export const api = {
  /** LIFF トークンでユーザー情報取得 */
  getMe: (idToken) =>
    request("GET", "/me", null, idToken),

  /** 初回設定（生年月登録） */
  onboarding: (liffIdToken, childBirthYear, childBirthMonth) =>
    request("POST", "/onboarding", { liffIdToken, childBirthYear, childBirthMonth }),

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
  getOptions: (sessionId, step, userId) =>
    request("GET", `/sessions/${sessionId}/options?step=${step}&userId=${userId}`),

  /** 回答保存 */
  saveAnswer: (sessionId, userId, step, answer) =>
    request("POST", `/sessions/${sessionId}/answer`, { userId, step, answer }),

  /** セッション完了・リフレクション生成 */
  completeSession: (sessionId, userId) =>
    request("POST", `/sessions/${sessionId}/complete`, { userId }),
};
