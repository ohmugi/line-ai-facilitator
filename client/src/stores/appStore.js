// src/stores/appStore.js
import { create } from "zustand";

export const useAppStore = create((set) => ({
  // LIFF / LINE ユーザー情報
  lineUserId:  null,
  displayName: null,
  idToken:     null,
  liffReady:   false,

  // アプリユーザー（DB上のliff_users）
  user:      null,
  household: null,
  partner:   null,

  // セッション一覧
  sessions: [],

  // 現在のセッション（セッション画面で使用）
  currentSession:  null,
  currentAnswers:  [],  // session_answers
  partnerAnswers:  [],

  setLiff:      (data) => set(data),
  setUser:      (user)      => set({ user }),
  setHousehold: (household) => set({ household }),
  setPartner:   (partner)   => set({ partner }),
  setSessions:  (sessions)  => set({ sessions }),

  setCurrentSession: (session) => set({ currentSession: session }),
  setCurrentAnswers: (answers) => set({ currentAnswers: answers }),
  setPartnerAnswers: (answers) => set({ partnerAnswers: answers }),

  updatePartnerAnswer: (step, answer) =>
    set((s) => {
      const filtered = s.partnerAnswers.filter((a) => a.step !== step);
      return { partnerAnswers: [...filtered, { step, answer }] };
    }),
}));
