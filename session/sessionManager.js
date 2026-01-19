//session/sessionManager.js
const sessions = {}; // householdId -> { sessionId, questionCount, maxQuestions, active }

export function startSession(householdId, sessionId, maxQuestions) {
  sessions[householdId] = {
    sessionId,
    questionCount: 0, // 「AIで深掘り質問」を何回出したか（=2問目以降の回数）ではなく
    maxQuestions,     // セッション全体の質問数として扱いたいなら設計を合わせる
    active: true,
    askedTotal: 1, // 1問目は開始時に出している前提でカウント
  };
}

export function isSessionActive(householdId) {
  return sessions[householdId]?.active === true;
}

export function getSession(householdId) {
  return sessions[householdId] || null;
}

// 次の質問を続けるか判定して、内部カウントを進める
export function proceedSession(householdId) {
  const s = sessions[householdId];
  if (!s) return false;

  // これから「次の質問」を出すので +1
  s.askedTotal += 1;

  // 例：maxQuestions=3なら、1問目+2問目+3問目で終了
  return s.askedTotal <= s.maxQuestions;
}

export function endSession(householdId) {
  delete sessions[householdId];
}
