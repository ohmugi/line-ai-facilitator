// src/hooks/useLiff.js
// LIFF SDK の初期化と ID トークン取得
import { useEffect } from "react";
import liff from "@line/liff";
import { useAppStore } from "../stores/appStore";
import { api } from "../api/client";

export function useLiff() {
  const setLiff  = useAppStore((s) => s.setLiff);
  const setUser  = useAppStore((s) => s.setUser);
  const setHousehold = useAppStore((s) => s.setHousehold);
  const setPartner   = useAppStore((s) => s.setPartner);

  useEffect(() => {
    const liffId = import.meta.env.VITE_LIFF_ID;

    // 10秒でタイムアウト（無限ループ防止）
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("LIFF init timeout")), 10000)
    );

    Promise.race([liff.init({ liffId }), timeout]).then(async () => {
      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const idToken     = liff.getIDToken();
      console.log("[useLiff] getIDToken:", idToken ? "OK" : "NULL");
      const profile     = await liff.getProfile();

      setLiff({
        lineUserId:  profile.userId,
        displayName: profile.displayName,
        idToken,
        liffReady:   true,
      });

      // バックエンドからユーザー情報を取得
      try {
        const { user, household, partner } = await api.getMe(idToken);
        if (user) {
          setUser(user);
          setHousehold(household);
          setPartner(partner);
        }
      } catch (err) {
        console.error("[useLiff] getMe failed:", err);
      }
    }).catch((err) => {
      console.error("[LIFF init error]", err);
      // 開発環境用フォールバック
      setLiff({ liffReady: true, idToken: "dev-token" });
    });
  }, []);
}
