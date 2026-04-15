// src/pages/OnboardingPage.jsx
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "../stores/appStore";
import { api } from "../api/client";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS  = Array.from({ length: CURRENT_YEAR - 1989 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const AGE_GROUP_LABEL = {
  toddler:          "乳幼児・未就学",
  elementary_lower: "小学校低学年",
  elementary_upper: "小学校高学年",
  teen:             "中学生・高校生",
  universal:        "全年齢",
};

function calcAge(year, month) {
  if (!year || !month) return null;
  const now = new Date();
  const age = now.getFullYear() - year;
  return (now.getMonth() + 1) < month ? age - 1 : age;
}

function calcAgeGroup(year, month) {
  if (!year) return null;
  const now = new Date();
  const cur = (now.getMonth() + 1) >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const entry = month <= 3 ? year + 6 : year + 7;
  const grade = cur - entry + 1;
  if (grade <= 0)  return "toddler";
  if (grade <= 3)  return "elementary_lower";
  if (grade <= 6)  return "elementary_upper";
  if (grade <= 12) return "teen";
  return "universal";
}

export default function OnboardingPage() {
  const navigate    = useNavigate();
  const idToken     = useAppStore((s) => s.idToken);
  const setUser     = useAppStore((s) => s.setUser);
  const setHousehold = useAppStore((s) => s.setHousehold);
  const setPartner   = useAppStore((s) => s.setPartner);

  const [year,        setYear]        = useState("");
  const [month,       setMonth]       = useState("");
  const [hasSiblings, setHasSiblings] = useState(null); // null=未選択, true/false
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);

  // 招待コード入力モード
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [inviteCode,    setInviteCode]    = useState("");
  const [codeLoading,   setCodeLoading]   = useState(false);
  const [codeError,     setCodeError]     = useState(null);

  const handleJoinByCode = async () => {
    const code = inviteCode.trim();
    if (!code) return;
    if (!idToken) {
      setCodeError("LINEアプリから開いてくださいにゃ🐾");
      return;
    }
    setCodeLoading(true);
    setCodeError(null);
    try {
      const { user, household, partner } = await api.joinInvite(idToken, code);
      setUser(user);
      setHousehold(household);
      setPartner(partner);
      navigate("/home");
    } catch (err) {
      setCodeError(err.message);
    } finally {
      setCodeLoading(false);
    }
  };

  const age      = useMemo(() => calcAge(Number(year), Number(month)), [year, month]);
  const ageGroup = useMemo(() => calcAgeGroup(Number(year), Number(month)), [year, month]);

  const handleSubmit = async () => {
    if (!year || !month) return;
    if (!idToken) {
      setError("LINEアプリから開いてくださいにゃ🐾");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { user, household } = await api.onboarding(
        idToken,
        Number(year),
        Number(month),
        hasSiblings,
      );
      setUser(user);
      setHousehold(household);
      navigate("/invite-generate");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="flex flex-col min-h-screen px-6 py-10"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* ヘッダー */}
      <div className="text-center mb-8">
        <span className="text-5xl">🐾</span>
        <h1 className="mt-3 text-xl font-bold text-gray-800">けみーにゃ</h1>
        <p className="mt-1 text-sm text-gray-500">夫婦の対話をちょっとだけ深めるにゃ</p>
      </div>

      {/* 招待コード入力モード */}
      <AnimatePresence>
        {showCodeEntry && (
          <motion.div
            className="bg-white rounded-2xl shadow-sm p-6 mb-4"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <h2 className="text-base font-semibold text-gray-700 mb-1">招待コードで参加にゃ🐾</h2>
            <p className="text-xs text-gray-400 mb-4">パートナーから受け取ったコードを入力してにゃ</p>
            <input
              type="text"
              placeholder="例: a1b2c3d4"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.trim())}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 bg-gray-50 font-mono text-center tracking-widest mb-3 focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            {codeError && (
              <p className="text-red-500 text-xs mb-3 text-center">{codeError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleJoinByCode}
                disabled={!inviteCode.trim() || codeLoading}
                className="flex-1 bg-green-500 disabled:bg-gray-200 text-white disabled:text-gray-400 font-semibold py-3 rounded-xl"
              >
                {codeLoading ? "参加中にゃ…" : "参加する"}
              </button>
              <button
                onClick={() => { setShowCodeEntry(false); setCodeError(null); }}
                className="px-4 border border-gray-200 text-gray-500 rounded-xl text-sm"
              >
                戻る
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* カード */}
      <div className="bg-white rounded-2xl shadow-sm p-6 flex-1">
        <h2 className="text-base font-semibold text-gray-700 mb-1">
          お子さんの生まれ年月を教えてくれるかにゃ？🐾
        </h2>
        <p className="text-xs text-gray-400 mb-1">
          年齢に合った育児シナリオをお届けするにゃ。後からでも変更できるにゃ。
        </p>
        <p className="text-xs text-orange-400 mb-6">
          ※ お子さんが二人以上いる場合は、いちばん上の子の生まれ年月を入力してにゃ🐾
        </p>

        {/* 年 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-600 mb-1">年</label>
          <select
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-400"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="">選択してください</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
        </div>

        {/* 月 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-600 mb-1">月</label>
          <select
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-400"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            <option value="">選択してください</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>{m}月</option>
            ))}
          </select>
        </div>

        {/* 兄弟・姉妹 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-600 mb-2">
            兄弟・姉妹はいる？
          </label>
          <div className="flex gap-3">
            {[
              { value: true,  label: "いる" },
              { value: false, label: "ひとりっこ" },
            ].map(({ value, label }) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setHasSiblings(value)}
                className={`flex-1 py-3 rounded-xl border-2 text-sm font-medium transition-colors
                  ${hasSiblings === value
                    ? "border-green-400 bg-green-50 text-green-700"
                    : "border-gray-200 bg-gray-50 text-gray-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            兄弟げんかのシナリオはひとりっこには出さないにゃ
          </p>
        </div>

        {/* 年齢プレビュー */}
        {age !== null && (
          <motion.div
            className="bg-green-50 rounded-xl p-4 mb-6 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <p className="text-sm text-green-700 font-medium">
              お子さんの年齢: <span className="text-lg font-bold">{age}歳</span>
            </p>
            <p className="text-xs text-green-600 mt-1">
              ({AGE_GROUP_LABEL[ageGroup]})
            </p>
          </motion.div>
        )}

        {error && (
          <p className="text-red-500 text-sm mb-4 text-center">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={!year || !month || loading}
          className="w-full bg-green-500 disabled:bg-gray-200 text-white disabled:text-gray-400 font-semibold py-4 rounded-2xl transition-colors"
        >
          {loading ? "設定中にゃ…" : "次へ →"}
        </button>

        {!showCodeEntry && (
          <button
            type="button"
            onClick={() => setShowCodeEntry(true)}
            className="w-full mt-3 text-xs text-gray-400 underline py-2"
          >
            招待コードを受け取った方はこちら
          </button>
        )}
      </div>
    </motion.div>
  );
}
