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

    liff.init({ liffId }).then(async () => {
      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const idToken     = liff.getIDToken();
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
