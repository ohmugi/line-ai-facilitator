//session/sessionManager.js
const sessions = {};

export function startSession(householdId, maxQuestions) {
  sessions[householdId] = {
    questionCount: 0,
    maxQuestions,
    active: true,
  };
}

export function isSessionActive(householdId) {
  return sessions[householdId]?.active;
}

export function proceedSession(householdId) {
  const session = sessions[householdId];
  session.questionCount += 1;
  return session.questionCount < session.maxQuestions;
}

export function endSession(householdId) {
  delete sessions[householdId];
}
