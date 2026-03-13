// src/pages/InviteGeneratePage.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Copy, Check, MessageCircle, ArrowRight } from "lucide-react";
import { useAppStore } from "../stores/appStore";

export default function InviteGeneratePage() {
  const navigate  = useNavigate();
  const household = useAppStore((s) => s.household);
  const [copied, setCopied] = useState(false);

  const liffId    = import.meta.env.VITE_LIFF_ID;
  const inviteUrl = `https://liff.line.me/${liffId}?invite=${household?.invite_code}`;

  const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(
    `パートナーを招待するにゃ🐾\n一緒に「けみー」をやってみよう！\n${inviteUrl}`
  )}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      className="flex flex-col min-h-screen px-6 py-10"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="text-center mb-8">
        <span className="text-4xl">🐾</span>
        <h1 className="mt-3 text-xl font-bold text-gray-800">パートナーを招待するにゃ</h1>
        <p className="mt-1 text-sm text-gray-500">以下のリンクを送ってにゃ</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
        {/* 招待URL表示 */}
        <div className="bg-gray-50 rounded-xl px-4 py-3 mb-4 break-all text-sm text-gray-600 border border-gray-100">
          {inviteUrl}
        </div>

        {/* LINEで送る */}
        <a
          href={lineShareUrl}
          className="block mb-3"
          onClick={() => setTimeout(() => navigate("/home"), 500)}
        >
          <button className="w-full flex items-center justify-center gap-2 bg-green-500 text-white font-semibold py-4 rounded-2xl">
            <MessageCircle size={20} />
            LINEで送る
          </button>
        </a>

        {/* コピー */}
        <button
          onClick={handleCopy}
          className="w-full flex items-center justify-center gap-2 border border-gray-200 text-gray-600 font-medium py-3 rounded-2xl transition-colors"
        >
          {copied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
          {copied ? "コピーしたにゃ！" : "リンクをコピー"}
        </button>
      </div>

      {/* スキップ */}
      <button
        onClick={() => navigate("/home")}
        className="flex items-center justify-center gap-1 text-sm text-gray-400 py-3"
      >
        後で招待する
        <ArrowRight size={14} />
      </button>
    </motion.div>
  );
}
