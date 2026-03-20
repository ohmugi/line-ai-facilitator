// src/pages/SessionPage.jsx
import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, X, User, Users } from "lucide-react";

import { useAppStore } from "../stores/appStore";
import { useRealtimeSession } from "../hooks/useRealtimeSession";
import { supabase } from "../api/supabase";
import { api } from "../api/client";
import LoadingScreen from "../components/LoadingScreen";

const STEPS = ["step1", "step2", "step3", "step4"];

// ============================================================
// 子どもレンズ固定データ
// ============================================================
const CHILD_LENS_REASON_TYPES = [
  "気質・生まれつきの性格だと思う",
  "最近のエピソードや体験から",
  "自分（親）の育て方や関わり方の影響",
  "よくわからない・なんとなくそう感じた",
];

const CHILD_LENS_FEELINGS = [
  { label: "安心する・それでいいと思う",    emoji: "😌" },
  { label: "心配になる",                    emoji: "😟" },
  { label: "何とかしてあげたい",            emoji: "🤗" },
  { label: "自分のせいかもしれない",        emoji: "😔" },
  { label: "複雑・どうしたらいいか迷う",    emoji: "😕" },
  { label: "もどかしい・歯がゆい",          emoji: "😤" },
];

// Step1 の固定データ
const EMOTIONS = [
  { label: "心配・不安",    emoji: "😟" },
  { label: "イラっとする",  emoji: "😤" },
  { label: "悲しい・辛い",  emoji: "😢" },
  { label: "モヤモヤする",  emoji: "😕" },
  { label: "怖い・焦る",    emoji: "😨" },
  { label: "特に感情はない",emoji: "😐" },
];

const INTENSITY_LEVELS = [
  { value: 1,  label: "ほとんど感じない" },
  { value: 3,  label: "少し感じる" },
  { value: 5,  label: "そこそこ感じる" },
  { value: 7,  label: "かなり感じる" },
  { value: 10, label: "頭から離れないくらい" },
];

// ============================================================

// ============================================================
// Step コンポーネント群
// ============================================================

/** Step1-1: 感情の種類選択 */
function Step1Emotion({ value, onChange }) {
  const isPreset = EMOTIONS.some((e) => e.label === value);
  const [freeText, setFreeText] = useState(isPreset ? "" : (value || ""));

  const selectPreset = (label) => {
    setFreeText("");
    onChange(label);
  };
  const handleFreeText = (text) => {
    setFreeText(text);
    onChange(text);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 mb-4">まず、どんな気持ちになった？</p>
      {EMOTIONS.map(({ label, emoji }) => (
        <button
          key={label}
          onClick={() => selectPreset(label)}
          className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors
            ${value === label ? "border-orange-400 bg-orange-50" : "border-gray-100 bg-white"}`}
        >
          <span className="text-2xl">{emoji}</span>
          <span className="text-sm text-gray-700">{label}</span>
        </button>
      ))}
      <div className={`border-2 rounded-xl p-3 transition-colors
        ${!isPreset && value ? "border-orange-400 bg-orange-50" : "border-dashed border-gray-200 bg-white"}`}>
        <p className="text-xs text-gray-400 mb-2">または自分の言葉で</p>
        <input
          type="text"
          placeholder="例: ドキドキする、嬉しいような不安なような…"
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          className="w-full text-sm text-gray-700 bg-transparent outline-none"
        />
      </div>
    </div>
  );
}

/** Step1-2: 感情の強度選択 */
function Step1Intensity({ emotion, value, onChange }) {
  return (
    <div className="space-y-3">
      <div className="bg-orange-50 rounded-2xl px-4 py-3 mb-4">
        <p className="text-sm text-orange-700">
          「<span className="font-semibold">{emotion}</span>」を
          どのくらい感じた？
        </p>
      </div>
      {INTENSITY_LEVELS.map(({ value: v, label }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`w-full flex items-center justify-between p-4 rounded-xl border-2 text-left transition-colors
            ${value === v ? "border-orange-400 bg-orange-50" : "border-gray-100 bg-white"}`}
        >
          <span className="text-sm text-gray-700">{label}</span>
          <span className={`text-lg font-bold ${value === v ? "text-orange-500" : "text-gray-300"}`}>
            {v}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Step1-3: 想い・考え選択（AI生成） */
function Step1Thought({ emotion, intensity, options, value, onChange }) {
  const intensityLabel =
    intensity <= 1 ? "ほとんど感じない" :
    intensity <= 3 ? "少し" :
    intensity <= 5 ? "そこそこ" :
    intensity <= 7 ? "かなり" : "とても強く";
  const isNoEmotion = emotion === "特に感情はない";

  const isPreset = (options || []).includes(value);
  const [freeText, setFreeText] = useState(isPreset ? "" : (value || ""));

  const selectPreset = (opt) => { setFreeText(""); onChange(opt); };
  const handleFreeText = (text) => { setFreeText(text); onChange(text); };

  return (
    <div className="space-y-3">
      <div className="bg-orange-50 rounded-2xl px-4 py-3 mb-4">
        <p className="text-sm text-orange-700">
          {isNoEmotion ? "特に感情はなかったんだね🐾" : `${emotion}を${intensityLabel}感じたんだね🐾`}<br />
          そのとき、どう思った？
        </p>
      </div>
      {(options || []).map((opt) => (
        <button
          key={opt}
          onClick={() => selectPreset(opt)}
          className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors
            ${value === opt ? "border-orange-400 bg-orange-50" : "border-gray-100 bg-white"}`}
        >
          <span className="text-sm text-gray-700">{opt}</span>
        </button>
      ))}
      <div className={`border-2 rounded-xl p-3 transition-colors
        ${!isPreset && value ? "border-orange-400 bg-orange-50" : "border-dashed border-gray-200 bg-white"}`}>
        <p className="text-xs text-gray-400 mb-2">または自分の言葉で</p>
        <textarea
          rows={2}
          placeholder="自由に書いてにゃ…"
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          className="w-full text-sm text-gray-700 bg-transparent outline-none resize-none"
        />
      </div>
    </div>
  );
}

/** Step2: チェックボックス（複数選択） */
function Step2({ options, question, onChange, value }) {
  const [selected, setSelected] = useState(value?.values || []);
  const [freeText, setFreeText] = useState("");

  const toggle = (opt) => {
    const next = selected.includes(opt)
      ? selected.filter((v) => v !== opt)
      : [...selected, opt];
    setSelected(next);
    onChange({ values: [...next, ...(freeText ? [freeText] : [])] });
  };

  const handleFreeText = (text) => {
    setFreeText(text);
    onChange({ values: [...selected, ...(text ? [text] : [])] });
  };

  return (
    <div className="space-y-3">
      {question && (
        <div className="bg-green-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-green-700">{question}</p>
        </div>
      )}
      {(options || []).map((opt) => (
        <label
          key={opt}
          className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors
            ${selected.includes(opt) ? "border-green-400 bg-green-50" : "border-gray-100 bg-white"}`}
        >
          <input
            type="checkbox"
            className="accent-green-500 w-4 h-4"
            checked={selected.includes(opt)}
            onChange={() => toggle(opt)}
          />
          <span className="text-sm text-gray-700">{opt}</span>
        </label>
      ))}
      <div className={`border-2 rounded-xl p-3 transition-colors
        ${freeText ? "border-green-400 bg-green-50" : "border-dashed border-gray-200 bg-white"}`}>
        <p className="text-xs text-gray-400 mb-2">または自分の言葉で追加</p>
        <input
          type="text"
          placeholder="自由に書いてにゃ…"
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          className="w-full text-sm text-gray-700 bg-transparent outline-none"
        />
      </div>
    </div>
  );
}

/** Step3: 原体験選択 */
function Step3({ options, question, onChange, value }) {
  const [background, setBackground] = useState(value?.background || "");
  const isPreset = (options || []).includes(background);
  const [freeText, setFreeText] = useState(isPreset ? "" : background);

  const handleChange = (opt) => {
    setFreeText("");
    setBackground(opt);
    onChange({ background: opt });
  };
  const handleFreeText = (text) => {
    setFreeText(text);
    setBackground(text);
    onChange({ background: text });
  };

  return (
    <div className="space-y-3">
      {question && (
        <div className="bg-blue-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-blue-700">{question}</p>
        </div>
      )}
      {(options || []).map((opt) => (
        <label
          key={opt}
          className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors
            ${background === opt ? "border-blue-400 bg-blue-50" : "border-gray-100 bg-white"}`}
        >
          <input
            type="radio"
            className="accent-blue-500"
            checked={background === opt}
            onChange={() => handleChange(opt)}
          />
          <span className="text-sm text-gray-700">{opt}</span>
        </label>
      ))}
      <div className={`border-2 rounded-xl p-3 transition-colors
        ${!isPreset && background ? "border-blue-400 bg-blue-50" : "border-dashed border-gray-200 bg-white"}`}>
        <p className="text-xs text-gray-400 mb-2">または自分の言葉で</p>
        <textarea
          rows={2}
          placeholder="自由に書いてにゃ…"
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          className="w-full text-sm text-gray-700 bg-transparent outline-none resize-none"
        />
      </div>
    </div>
  );
}

/** Step3深掘り（Step3-2 / Step3-3 共用） */
function Step3Deep({ options, question, value, onChange }) {
  const isPreset = (options || []).includes(value);
  const [freeText, setFreeText] = useState(isPreset ? "" : (value || ""));

  const handleChange = (opt) => { setFreeText(""); onChange(opt); };
  const handleFreeText = (text) => { setFreeText(text); onChange(text); };

  return (
    <div className="space-y-3">
      {question && (
        <div className="bg-blue-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-blue-700">{question}</p>
        </div>
      )}
      {(options || []).map((opt) => (
        <label
          key={opt}
          className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors
            ${value === opt ? "border-blue-400 bg-blue-50" : "border-gray-100 bg-white"}`}
        >
          <input
            type="radio"
            className="accent-blue-500"
            checked={value === opt}
            onChange={() => handleChange(opt)}
          />
          <span className="text-sm text-gray-700">{opt}</span>
        </label>
      ))}
      <div className={`border-2 rounded-xl p-3 transition-colors
        ${!isPreset && value && !value.includes("次に進みたい") ? "border-blue-400 bg-blue-50" : "border-dashed border-gray-200 bg-white"}`}>
        <p className="text-xs text-gray-400 mb-2">または自分の言葉で</p>
        <textarea
          rows={2}
          placeholder="自由に書いてにゃ…"
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          className="w-full text-sm text-gray-700 bg-transparent outline-none resize-none"
        />
      </div>
    </div>
  );
}

/** Step4: ラジオ選択 + 自由入力 */
function Step4({ options, question, onChange, value }) {
  const FREE_LABEL = "自分の言葉で書く";
  const isPreset = (options || []).includes(value?.choice);
  const [freeText, setFreeText] = useState(isPreset ? "" : (value?.choice || ""));
  const [showFree, setShowFree] = useState(!isPreset && !!value?.choice);

  useEffect(() => {
    if (options && !value?.choice) {
      // 初期表示時に onChange を呼んで完了ボタンを正しい状態にする（何も選択していないのでまだ無効のまま）
    }
  }, [options]);

  const selectPreset = (opt) => {
    setShowFree(false);
    setFreeText("");
    onChange({ choice: opt, is_custom: false });
  };

  const selectFree = () => {
    setShowFree(true);
    onChange({ choice: freeText, is_custom: true });
  };

  const handleFreeText = (text) => {
    setFreeText(text);
    onChange({ choice: text, is_custom: true });
  };

  return (
    <div className="space-y-3">
      {question && (
        <div className="bg-purple-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-purple-700">{question}</p>
        </div>
      )}
      {(options || []).map((opt) => (
        <button
          key={opt}
          onClick={() => selectPreset(opt)}
          className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors
            ${value?.choice === opt && !showFree ? "border-purple-400 bg-purple-50" : "border-gray-100 bg-white"}`}
        >
          <span className="text-sm text-gray-700">{opt}</span>
        </button>
      ))}
      <div
        className={`border-2 rounded-xl p-3 transition-colors
          ${showFree ? "border-purple-400 bg-purple-50" : "border-dashed border-gray-200 bg-white"}`}
      >
        <p
          className="text-xs text-gray-400 mb-2 cursor-pointer"
          onClick={selectFree}
        >
          または自分の言葉で
        </p>
        <textarea
          rows={2}
          placeholder="自由に書いてにゃ…"
          value={freeText}
          onFocus={selectFree}
          onChange={(e) => handleFreeText(e.target.value)}
          className="w-full text-sm text-gray-700 bg-transparent outline-none resize-none"
        />
      </div>
    </div>
  );
}

// ============================================================
// 子どもレンズ Step コンポーネント群
// ============================================================

/** Step A: 子どもの行動予測（AI生成選択肢） */
function ChildLensStepA({ options, question, value, onChange }) {
  const isPreset = (options || []).includes(value?.behavior);
  const [freeText, setFreeText] = useState(isPreset ? "" : (value?.behavior || ""));

  const selectPreset = (opt) => { setFreeText(""); onChange({ behavior: opt }); };
  const handleFreeText = (text) => { setFreeText(text); onChange({ behavior: text }); };

  return (
    <div className="space-y-3">
      {question && (
        <div className="bg-sky-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-sky-700 font-medium">{question}</p>
        </div>
      )}
      {(options || []).map((opt) => (
        <button
          key={opt}
          onClick={() => selectPreset(opt)}
          className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors
            ${value?.behavior === opt ? "border-sky-400 bg-sky-50" : "border-gray-100 bg-white"}`}
        >
          <span className="text-sm text-gray-700">{opt}</span>
        </button>
      ))}
      <div className={`border-2 rounded-xl p-3 transition-colors
        ${!isPreset && value?.behavior ? "border-sky-400 bg-sky-50" : "border-dashed border-gray-200 bg-white"}`}>
        <p className="text-xs text-gray-400 mb-2">または自分の言葉で</p>
        <textarea
          rows={2}
          placeholder="自由に書いてにゃ…"
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          className="w-full text-sm text-gray-700 bg-transparent outline-none resize-none"
        />
      </div>
    </div>
  );
}

/** Step B: 根拠の性質（固定選択肢） */
function ChildLensStepB({ question, value, onChange }) {
  const isPreset = CHILD_LENS_REASON_TYPES.includes(value?.reasonType);
  const [freeText, setFreeText] = useState(isPreset ? "" : (value?.reasonType || ""));

  const selectPreset = (opt) => { setFreeText(""); onChange({ reasonType: opt }); };
  const handleFreeText = (text) => { setFreeText(text); onChange({ reasonType: text }); };

  return (
    <div className="space-y-3">
      {question && (
        <div className="bg-amber-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-amber-700 font-medium">{question}</p>
        </div>
      )}
      {CHILD_LENS_REASON_TYPES.map((opt) => (
        <button
          key={opt}
          onClick={() => selectPreset(opt)}
          className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors
            ${value?.reasonType === opt ? "border-amber-400 bg-amber-50" : "border-gray-100 bg-white"}`}
        >
          <span className="text-sm text-gray-700">{opt}</span>
        </button>
      ))}
      <div className={`border-2 rounded-xl p-3 transition-colors
        ${!isPreset && value?.reasonType ? "border-amber-400 bg-amber-50" : "border-dashed border-gray-200 bg-white"}`}>
        <p className="text-xs text-gray-400 mb-2">または自分の言葉で</p>
        <input
          type="text"
          placeholder="自由に書いてにゃ…"
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          className="w-full text-sm text-gray-700 bg-transparent outline-none"
        />
      </div>
    </div>
  );
}

/** Step C: 感情反応（固定選択肢） */
function ChildLensStepC({ question, value, onChange }) {
  const isPreset = CHILD_LENS_FEELINGS.some((f) => f.label === value?.feeling);
  const [freeText, setFreeText] = useState(isPreset ? "" : (value?.feeling || ""));

  const selectPreset = (label) => { setFreeText(""); onChange({ feeling: label }); };
  const handleFreeText = (text) => { setFreeText(text); onChange({ feeling: text }); };

  return (
    <div className="space-y-3">
      {question && (
        <div className="bg-rose-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-rose-700 font-medium">{question}</p>
        </div>
      )}
      {CHILD_LENS_FEELINGS.map(({ label, emoji }) => (
        <button
          key={label}
          onClick={() => selectPreset(label)}
          className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors
            ${value?.feeling === label ? "border-rose-400 bg-rose-50" : "border-gray-100 bg-white"}`}
        >
          <span className="text-2xl">{emoji}</span>
          <span className="text-sm text-gray-700">{label}</span>
        </button>
      ))}
      <div className={`border-2 rounded-xl p-3 transition-colors
        ${!isPreset && value?.feeling ? "border-rose-400 bg-rose-50" : "border-dashed border-gray-200 bg-white"}`}>
        <p className="text-xs text-gray-400 mb-2">または自分の言葉で</p>
        <input
          type="text"
          placeholder="自由に書いてにゃ…"
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          className="w-full text-sm text-gray-700 bg-transparent outline-none"
        />
      </div>
    </div>
  );
}

/** Step D: 理想像（AI生成選択肢） */
function ChildLensStepD({ options, question, value, onChange }) {
  const isPreset = (options || []).includes(value?.ideal);
  const [freeText, setFreeText] = useState(isPreset ? "" : (value?.ideal || ""));

  const selectPreset = (opt) => { setFreeText(""); onChange({ ideal: opt }); };
  const handleFreeText = (text) => { setFreeText(text); onChange({ ideal: text }); };

  return (
    <div className="space-y-3">
      {question && (
        <div className="bg-violet-50 rounded-2xl px-4 py-3 mb-4">
          <p className="text-sm text-violet-700 font-medium">{question}</p>
        </div>
      )}
      {(options || []).map((opt) => (
        <button
          key={opt}
          onClick={() => selectPreset(opt)}
          className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors
            ${value?.ideal === opt ? "border-violet-400 bg-violet-50" : "border-gray-100 bg-white"}`}
        >
          <span className="text-sm text-gray-700">{opt}</span>
        </button>
      ))}
      <div className={`border-2 rounded-xl p-3 transition-colors
        ${!isPreset && value?.ideal ? "border-violet-400 bg-violet-50" : "border-dashed border-gray-200 bg-white"}`}>
        <p className="text-xs text-gray-400 mb-2">または自分の言葉で</p>
        <textarea
          rows={2}
          placeholder="自由に書いてにゃ…"
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          className="w-full text-sm text-gray-700 bg-transparent outline-none resize-none"
        />
      </div>
    </div>
  );
}

// ============================================================
// パートナータブ
// ============================================================
function PartnerTab({ partnerAnswers, isChildLens, partnerCompleted }) {
  // 子どもレンズはパートナー完了前は非表示
  if (isChildLens && !partnerCompleted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <span className="text-4xl">🔒</span>
        <p className="text-sm text-gray-400 text-center">
          パートナーが完了するまで<br />見立ては非公開にゃ🐾
        </p>
        <p className="text-xs text-gray-300 text-center mt-1">
          先に答えを見ると、お互いの「素直な見立て」が<br />影響し合ってしまうためにゃ
        </p>
      </div>
    );
  }

  if (!partnerAnswers?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <span className="text-4xl">⏳</span>
        <p className="text-sm text-gray-400 text-center">
          パートナーの回答待ちにゃ🐾
        </p>
      </div>
    );
  }

  // 子どもレンズ用表示
  if (isChildLens) {
    const stepLabels = {
      step1: "Step A: 子どもの行動予測",
      step2: "Step B: そう思う根拠",
      step3: "Step C: 感情反応",
      step4: "Step D: 理想像",
    };
    return (
      <div className="space-y-4">
        {partnerAnswers.map((a) => (
          <div key={a.step} className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-xs font-medium text-gray-400 mb-2">{stepLabels[a.step] || a.step}</p>
            <div className="text-sm text-gray-700 space-y-1">
              {a.step === "step1" && <p>行動予測: {a.answer?.behavior}</p>}
              {a.step === "step2" && <p>根拠: {a.answer?.reasonType}</p>}
              {a.step === "step3" && <p>感情: {a.answer?.feeling}</p>}
              {a.step === "step4" && <p>理想像: {a.answer?.ideal}</p>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {partnerAnswers.map((a) => (
        <div key={a.step} className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xs font-medium text-gray-400 mb-2">
            {a.step === "step1" ? "Step1: 気持ち" :
             a.step === "step2" ? "Step2: 価値観" :
             a.step === "step3" ? "Step3: 原体験" : "Step4: 関わり方"}
          </p>
          {a.step === "step1" && a.answer?.emotion ? (
            <div className="text-sm text-gray-700 space-y-1">
              <p>感情: {a.answer.emotion}（{a.answer.intensity}/10）</p>
              {a.answer.thought && <p>想い: {a.answer.thought}</p>}
            </div>
          ) : (
            <pre className="text-sm text-gray-700 whitespace-pre-wrap">
              {JSON.stringify(a.answer, null, 2)
                .replace(/[{}"\[\]]/g, "")
                .replace(/,\n/g, "\n")
                .trim()}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// ステップ回答レンダラー（案A用）
// ============================================================
function renderAnswer(step, answer, isChildLens) {
  if (!answer) return <span className="text-gray-300 text-xs">未回答</span>;

  if (isChildLens) {
    if (step === "step1") return <span>{answer.behavior}</span>;
    if (step === "step2") return <span>{answer.reasonType}</span>;
    if (step === "step3") return <span>{answer.feeling}</span>;
    if (step === "step4") return <span>{answer.ideal}</span>;
  } else {
    if (step === "step1") {
      if (!answer.emotion) return <span>感情なし</span>;
      return (
        <>
          <span>{answer.emotion}（{answer.intensity}/10）</span>
          {answer.thought && (
            <span className="block mt-1 text-gray-500">想い: {answer.thought}</span>
          )}
        </>
      );
    }
    if (step === "step2") {
      const vals = Array.isArray(answer.values) ? answer.values : [];
      return <span>{vals.join("、")}</span>;
    }
    if (step === "step3") {
      return (
        <>
          <span>{answer.background}</span>
          {answer.deepening2 && <span className="block mt-1 text-gray-500">{answer.deepening2}</span>}
          {answer.deepening3 && <span className="block mt-1 text-gray-500">{answer.deepening3}</span>}
        </>
      );
    }
    if (step === "step4") {
      // 新形式 { choice } を優先、旧形式 { priorities } にも対応
      if (answer.choice) return <span>{answer.choice}</span>;
      const priorities = Array.isArray(answer.priorities)
        ? [...answer.priorities].sort((a, b) => a.rank - b.rank)
        : [];
      return (
        <ol className="list-decimal list-inside space-y-0.5">
          {priorities.map((p, i) => <li key={i}>{p.value}</li>)}
        </ol>
      );
    }
  }
  return null;
}

// ============================================================
// リフレクション
// ============================================================
function ReflectionView({ myReflectionText, coupleReflection, onHome, myAnswers, partnerAnswers, isChildLens }) {
  const partnerMap = {};
  (partnerAnswers || []).forEach(({ step, answer }) => { partnerMap[step] = answer; });

  const hasPartner = partnerAnswers?.length > 0;

  const steps = isChildLens
    ? [
        { key: "step1", label: "Step A: 行動予測" },
        { key: "step2", label: "Step B: 根拠" },
        { key: "step3", label: "Step C: 感情反応" },
        { key: "step4", label: "Step D: 理想像" },
      ]
    : [
        { key: "step1", label: "Step 1: 気持ち" },
        { key: "step2", label: "Step 2: 価値観" },
        { key: "step3", label: "Step 3: 原体験" },
        { key: "step4", label: "Step 4: 関わり方" },
      ];

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    >
      {/* 個別リフレクション */}
      {myReflectionText && (
        <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100">
          <p className="text-xs font-medium text-orange-400 mb-2">けみーより🐾</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {myReflectionText}
          </p>
        </div>
      )}

      {/* カップルリフレクション */}
      <AnimatePresence>
        {coupleReflection ? (
          <motion.div
            key="couple"
            className="bg-green-50 rounded-2xl p-5 border border-green-100"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <p className="text-xs font-medium text-green-600 mb-2">ふたりへ 💚</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {coupleReflection}
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="waiting"
            className="bg-gray-50 rounded-2xl p-5 border border-gray-100 text-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          >
            <p className="text-xs text-gray-400 mb-1">ふたりへのメッセージ</p>
            <p className="text-sm text-gray-400">パートナーが完了したら届くにゃ🐾</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ステップ別比較（案A） */}
      {hasPartner && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-gray-400 px-1">ステップ別の回答比較</p>
          {steps.map(({ key, label }) => (
            <div key={key} className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-xs font-medium text-gray-400 mb-3">{label}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-orange-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-orange-400 mb-1.5">自分</p>
                  <div className="text-xs text-gray-700 leading-relaxed">
                    {renderAnswer(key, myAnswers?.[key], isChildLens)}
                  </div>
                </div>
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-blue-400 mb-1.5">パートナー</p>
                  <div className="text-xs text-gray-700 leading-relaxed">
                    {partnerMap[key]
                      ? renderAnswer(key, partnerMap[key], isChildLens)
                      : <span className="text-gray-300">未回答</span>
                    }
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onHome}
        className="w-full bg-gray-800 text-white font-semibold py-4 rounded-2xl mt-4"
      >
        ホームに戻る
      </button>
    </motion.div>
  );
}

// ============================================================
// セッション画面メイン
// ============================================================

export default function SessionPage() {
  const { sessionId }  = useParams();
  const navigate       = useNavigate();
  const user           = useAppStore((s) => s.user);
  const partnerAnswers = useAppStore((s) => s.partnerAnswers);
  const setPartnerAnswers = useAppStore((s) => s.setPartnerAnswers);

  const [session,    setSession]    = useState(null);
  const [myAnswers,  setMyAnswers]  = useState({});
  const [stepIndex,  setStepIndex]  = useState(0);
  const [step1SubStep, setStep1SubStep] = useState(0); // 0=emotion 1=intensity 2=thought
  const [step3SubStep, setStep3SubStep] = useState(0); // 0=background 1=deep2 2=deep3
  const [step3DeepOptions, setStep3DeepOptions] = useState(null);
  const [step3DeepQuestion, setStep3DeepQuestion] = useState(null);
  const [step3DeepAnswer, setStep3DeepAnswer] = useState({ deepening2: "", deepening3: "" });
  const [tab,        setTab]        = useState("me");
  const [options,    setOptions]    = useState(null);
  const [question,   setQuestion]   = useState(null);
  const [step4ConcreteLevel, setStep4ConcreteLevel] = useState(null);
  const [loadingOpts,setLoadingOpts]= useState(false);
  const [saving,     setSaving]     = useState(false);
  const [myReflectionText,  setMyReflectionText]  = useState(null);
  const [coupleReflection,  setCoupleReflection]  = useState(null);
  const [showReflection, setShowReflection] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [confirmExit, setConfirmExit] = useState(false);
  const [partnerCompleted, setPartnerCompleted] = useState(false);

  // Step1 の一時状態（サブステップ間で保持）
  const [step1Draft, setStep1Draft] = useState({ emotion: "", intensity: null, thought: "" });

  const isChildLens = session?.scenario?.session_type === "child_lens";

  useRealtimeSession(sessionId);

  // セッション読み込み
  useEffect(() => {
    api.getSession(sessionId).then(({ session, answers }) => {
      setSession(session);

      const mine = answers.filter((a) => a.user_id === user?.id);
      const map  = {};
      mine.forEach((a) => { map[a.step] = a.answer; });
      setMyAnswers(map);

      const theirs = answers.filter((a) => a.user_id !== user?.id);
      setPartnerAnswers(theirs.map((a) => ({ step: a.step, answer: a.answer })));
      // パートナーが4ステップ全て完了しているか
      const partnerSteps = new Set(theirs.map((a) => a.step));
      setPartnerCompleted(STEPS.every((s) => partnerSteps.has(s)));

      // 完了済みリフレクションを復元
      if (session.reflection) {
        const perUser = session.reflection.perUser || {};
        if (perUser[user?.id]) {
          setMyReflectionText(perUser[user?.id]);
          setShowReflection(true);
        }
        if (session.reflection.difference) setCoupleReflection(session.reflection.difference);
      }

      const completedSteps = mine.map((a) => a.step);
      const nextIdx = STEPS.findIndex((s) => !completedSteps.includes(s));
      setStepIndex(nextIdx === -1 ? 4 : nextIdx);

      setLoading(false);
    });
  }, [sessionId, user?.id]);

  // liff_sessions のカップルリフレクション・パートナー完了をリアルタイム受信
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`session-couple:${sessionId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "liff_sessions",
        filter: `id=eq.${sessionId}`,
      }, (payload) => {
        const cr = payload.new?.couple_reflection;
        if (cr && !coupleReflection) setCoupleReflection(cr);

        // パートナーが完了したか確認（子どもレンズのパートナータブ開示用）
        const partnerField = payload.new?.user1_id === user?.id
          ? "user2_current_step"
          : "user1_current_step";
        if (payload.new?.[partnerField] === "completed") {
          setPartnerCompleted(true);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [sessionId]);

  // 選択肢を自動取得
  // - 親目線: step2〜4 のみ自動取得（step1 は感情選択後に手動）
  // - 子どもレンズ: step1（Step A）・step4（Step D）はAI生成、step2・3は固定なのでAPIから取得しない
  useEffect(() => {
    if (!session || stepIndex >= 4) return;
    const step = STEPS[stepIndex];
    if (myAnswers[step]) return;

    const childLens = session?.scenario?.session_type === "child_lens";

    if (childLens) {
      if (step === "step1") {
        // Step A: AI生成
        setLoadingOpts(true);
        api.getOptions(sessionId, "step1", user?.id)
          .then(({ options, question }) => {
            setOptions(options);
            setQuestion(question);
          })
          .finally(() => setLoadingOpts(false));
      } else if (step === "step2") {
        // Step B: 固定選択肢をAPIから取得
        setLoadingOpts(true);
        api.getOptions(sessionId, "step2", user?.id)
          .then(({ options, question }) => {
            setOptions(options);
            setQuestion(question);
          })
          .finally(() => setLoadingOpts(false));
      } else if (step === "step3") {
        // Step C: 固定選択肢をAPIから取得
        setLoadingOpts(true);
        api.getOptions(sessionId, "step3", user?.id)
          .then(({ options, question }) => {
            setOptions(options);
            setQuestion(question);
          })
          .finally(() => setLoadingOpts(false));
      } else if (step === "step4") {
        // Step D: AI生成（Step A・C のコンテキスト込み）
        setLoadingOpts(true);
        api.getOptions(sessionId, "step4", user?.id)
          .then(({ options, question }) => {
            setOptions(options);
            setQuestion(question);
          })
          .finally(() => setLoadingOpts(false));
      }
    } else {
      // 親目線: step1 は手動、step2〜4 は自動取得
      if (stepIndex === 0) return;
      setLoadingOpts(true);
      api.getOptions(sessionId, step, user?.id)
        .then(({ options, question, concreteness_level }) => {
          setOptions(options);
          setQuestion(question);
          if (concreteness_level) setStep4ConcreteLevel(concreteness_level);
        })
        .finally(() => setLoadingOpts(false));
    }
  }, [stepIndex, session?.id]);

  const currentStep   = STEPS[stepIndex];
  const currentAnswer = myAnswers[currentStep];
  const isCompleted   = stepIndex >= 4;

  // 「次へ」ボタンの活性判定
  const isAnswerReady = (() => {
    if (isChildLens) {
      // 子どもレンズ: 各ステップの answer オブジェクトが存在するか
      if (currentStep === "step1") return !!currentAnswer?.behavior;
      if (currentStep === "step2") return !!currentAnswer?.reasonType;
      if (currentStep === "step3") return !!currentAnswer?.feeling;
      if (currentStep === "step4") return !!currentAnswer?.ideal;
      return false;
    }
    // 親目線
    if (stepIndex === 0) {
      if (step1SubStep === 0) return !!step1Draft.emotion;
      if (step1SubStep === 1) return step1Draft.intensity !== null;
      return !!step1Draft.thought;
    }
    if (stepIndex === 2) { // step3
      if (step3SubStep === 0) return !!currentAnswer?.background;
      if (step3SubStep === 1) return !!step3DeepAnswer.deepening2;
      if (step3SubStep === 2) return !!step3DeepAnswer.deepening3;
    }
    if (stepIndex === 3) return !!currentAnswer?.choice; // step4: 新形式
    return !!currentAnswer;
  })();

  const handleNext = async () => {
    // ── 子どもレンズ: サブステップなし、直接保存 ──
    if (isChildLens) {
      if (!isAnswerReady) return;
      setSaving(true);
      try {
        await api.saveAnswer(sessionId, user.id, currentStep, currentAnswer);
        setMyAnswers((prev) => ({ ...prev, [currentStep]: currentAnswer }));

        if (stepIndex === 3) {
          const { reflection } = await api.completeSession(sessionId, user.id);
          if (reflection?.perUser?.[user.id]) setMyReflectionText(reflection.perUser[user.id]);
          if (reflection?.difference) setCoupleReflection(reflection.difference);
          setShowReflection(true);
          setStepIndex(4);
        } else {
          setOptions(null);
          setQuestion(null);
          setStepIndex((i) => i + 1);
        }
      } finally {
        setSaving(false);
      }
      return;
    }

    // ── 親目線: Step1 サブステップの処理 ──
    if (stepIndex === 0) {
      if (step1SubStep === 0) {
        // 「特に感情はない」は強度ステップをスキップして想いへ
        if (step1Draft.emotion === "特に感情はない") {
          setLoadingOpts(true);
          try {
            const { options } = await api.getOptions(sessionId, "step1", user?.id, {
              emotion: step1Draft.emotion,
              intensity: 0,
            });
            setOptions(options);
            setStep1Draft((d) => ({ ...d, intensity: 0 }));
            setStep1SubStep(2);
          } finally {
            setLoadingOpts(false);
          }
          return;
        }
        setStep1SubStep(1);
        return;
      }
      if (step1SubStep === 1) {
        // Step1-3 の選択肢を取得してから Sub-step 2 へ
        setLoadingOpts(true);
        try {
          const { options } = await api.getOptions(sessionId, "step1", user?.id, {
            emotion: step1Draft.emotion,
            intensity: step1Draft.intensity,
          });
          setOptions(options);
          setStep1SubStep(2);
        } finally {
          setLoadingOpts(false);
        }
        return;
      }
      // step1SubStep === 2: thought 選択済み → 保存して step2 へ
    }

    // ── 親目線: Step3 深掘りサブステップ ──
    if (!isChildLens && stepIndex === 2) {
      if (step3SubStep === 0) {
        if (!isAnswerReady) return;
        setSaving(true);
        try {
          // 初回選択を DB に保存（step3_2 生成時に読み込まれる）
          await api.saveAnswer(sessionId, user.id, "step3", { background: currentAnswer.background });
          setMyAnswers((prev) => ({ ...prev, step3: { background: currentAnswer.background } }));
          setLoadingOpts(true);
          const { options: deepOpts, question: deepQ } = await api.getOptions(sessionId, "step3_2", user?.id);
          setStep3DeepOptions(deepOpts);
          setStep3DeepQuestion(deepQ);
          setStep3SubStep(1);
        } finally {
          setSaving(false);
          setLoadingOpts(false);
        }
        return;
      }

      if (step3SubStep === 1) {
        if (!isAnswerReady) return;
        const isSkip = step3DeepAnswer.deepening2.includes("次に進みたい");
        if (isSkip) {
          setStep3SubStep(0);
          setStep3DeepOptions(null);
          setStep3DeepQuestion(null);
          setStep3DeepAnswer({ deepening2: "", deepening3: "" });
          setOptions(null);
          setQuestion(null);
          setStepIndex((i) => i + 1);
          return;
        }
        setSaving(true);
        try {
          const updated = { background: myAnswers.step3?.background, deepening2: step3DeepAnswer.deepening2 };
          await api.saveAnswer(sessionId, user.id, "step3", updated);
          setMyAnswers((prev) => ({ ...prev, step3: updated }));
          setLoadingOpts(true);
          const { options: deepOpts3, question: deepQ3 } = await api.getOptions(sessionId, "step3_3", user?.id);
          setStep3DeepOptions(deepOpts3);
          setStep3DeepQuestion(deepQ3);
          setStep3SubStep(2);
        } finally {
          setSaving(false);
          setLoadingOpts(false);
        }
        return;
      }

      if (step3SubStep === 2) {
        if (!isAnswerReady) return;
        const isSkip = step3DeepAnswer.deepening3.includes("次に進みたい");
        if (!isSkip) {
          setSaving(true);
          try {
            const updated = { ...myAnswers.step3, deepening3: step3DeepAnswer.deepening3 };
            await api.saveAnswer(sessionId, user.id, "step3", updated);
            setMyAnswers((prev) => ({ ...prev, step3: updated }));
          } finally {
            setSaving(false);
          }
        }
        setStep3SubStep(0);
        setStep3DeepOptions(null);
        setStep3DeepQuestion(null);
        setStep3DeepAnswer({ deepening2: "", deepening3: "" });
        setOptions(null);
        setQuestion(null);
        setStepIndex((i) => i + 1);
        return;
      }
    }

    if (!isAnswerReady) return;
    setSaving(true);
    try {
      const answerToSave = stepIndex === 0
        ? { emotion: step1Draft.emotion, intensity: step1Draft.intensity, thought: step1Draft.thought }
        : currentAnswer;

      const extraMeta = (currentStep === "step4" && step4ConcreteLevel)
        ? { concreteness_level: step4ConcreteLevel }
        : {};
      await api.saveAnswer(sessionId, user.id, currentStep, answerToSave, extraMeta);
      setMyAnswers((prev) => ({ ...prev, [currentStep]: answerToSave }));

      if (stepIndex === 3) {
        const { reflection } = await api.completeSession(sessionId, user.id);
        if (reflection?.perUser?.[user.id]) setMyReflectionText(reflection.perUser[user.id]);
        if (reflection?.difference) setCoupleReflection(reflection.difference);
        setShowReflection(true);
        setStepIndex(4);
      } else {
        setOptions(null);
        setQuestion(null);
        setStep1SubStep(0);
        setStep1Draft({ emotion: "", intensity: null, thought: "" });
        setStepIndex((i) => i + 1);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingScreen />;

  const scenarioText = session?.scenario?.scene_text || "";
  const partnerNew   = partnerAnswers.filter(
    (a) => !Object.keys(myAnswers).includes(a.step)
  ).length;

  // ヘッダーラベル
  const stepLabel = showReflection ? "リフレクション" :
    isChildLens
      ? (["Step A: 行動予測", "Step B: 根拠", "Step C: 感情", "Step D: 理想像", "完了"][stepIndex] || "完了")
      : stepIndex === 0
        ? ["気持ちを選ぶ", "感じた強さ", "どう思った？"][step1SubStep]
        : stepIndex === 2 && step3SubStep > 0
          ? `Step 3/4: 深掘り (${step3SubStep}/2)`
          : ["Step 2/4", "Step 3/4", "Step 4/4", "完了"][stepIndex - 1];

  // ============================================================
  // UI
  // ============================================================
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <button onClick={() => setConfirmExit(true)} className="p-1">
          <ArrowLeft size={22} className="text-gray-600" />
        </button>
        <span className="text-sm font-medium text-gray-600">{stepLabel}</span>
        <button onClick={() => setConfirmExit(true)} className="p-1">
          <X size={22} className="text-gray-400" />
        </button>
      </header>

      {/* シナリオ */}
      <div className="bg-white mx-4 mt-4 rounded-2xl p-4 border border-gray-100">
        <p className="text-xs text-gray-400 mb-1">シナリオ</p>
        <p className="text-sm text-gray-700 leading-relaxed">
          {scenarioText.length > 80 ? scenarioText.slice(0, 80) + "…" : scenarioText}
        </p>
      </div>

      {/* タブ */}
      {!showReflection && (
        <div className="flex mx-4 mt-3 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setTab("me")}
            className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === "me" ? "bg-white shadow-sm text-gray-800" : "text-gray-400"}`}
          >
            <User size={15} />
            自分
          </button>
          <button
            onClick={() => setTab("partner")}
            className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-colors relative
              ${tab === "partner" ? "bg-white shadow-sm text-gray-800" : "text-gray-400"}`}
          >
            <Users size={15} />
            パートナー
            {partnerNew > 0 && (
              <span className="absolute top-1 right-3 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center">
                {partnerNew}
              </span>
            )}
          </button>
        </div>
      )}

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        <AnimatePresence mode="wait">
          {showReflection ? (
            <motion.div key="reflection"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            >
              <ReflectionView
                myReflectionText={myReflectionText}
                coupleReflection={coupleReflection}
                onHome={() => navigate("/home")}
                myAnswers={myAnswers}
                partnerAnswers={partnerAnswers}
                isChildLens={isChildLens}
              />
            </motion.div>
          ) : tab === "partner" ? (
            <motion.div key="partner"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            >
              <PartnerTab
                partnerAnswers={partnerAnswers}
                isChildLens={isChildLens}
                partnerCompleted={partnerCompleted}
              />
            </motion.div>
          ) : loadingOpts ? (
            <motion.div key="loading"
              className="flex flex-col items-center py-16 gap-3"
            >
              <div className="w-8 h-8 border-3 border-orange-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-400">けみーが考え中にゃ…</p>
            </motion.div>
          ) : (
            <motion.div key={`${currentStep}-${step1SubStep}`}
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            >
              {/* ── 子どもレンズ ── */}
              {isChildLens && currentStep === "step1" && (
                <ChildLensStepA
                  options={options}
                  question={question}
                  value={currentAnswer}
                  onChange={(v) => setMyAnswers((prev) => ({ ...prev, step1: v }))}
                />
              )}
              {isChildLens && currentStep === "step2" && (
                <ChildLensStepB
                  question={question}
                  value={currentAnswer}
                  onChange={(v) => setMyAnswers((prev) => ({ ...prev, step2: v }))}
                />
              )}
              {isChildLens && currentStep === "step3" && (
                <ChildLensStepC
                  question={question}
                  value={currentAnswer}
                  onChange={(v) => setMyAnswers((prev) => ({ ...prev, step3: v }))}
                />
              )}
              {isChildLens && currentStep === "step4" && (
                <ChildLensStepD
                  options={options}
                  question={question}
                  value={currentAnswer}
                  onChange={(v) => setMyAnswers((prev) => ({ ...prev, step4: v }))}
                />
              )}

              {/* ── 親目線 ── */}
              {!isChildLens && currentStep === "step1" && step1SubStep === 0 && (
                <Step1Emotion
                  value={step1Draft.emotion}
                  onChange={(e) => setStep1Draft((d) => ({ ...d, emotion: e }))}
                />
              )}
              {!isChildLens && currentStep === "step1" && step1SubStep === 1 && (
                <Step1Intensity
                  emotion={step1Draft.emotion}
                  value={step1Draft.intensity}
                  onChange={(v) => setStep1Draft((d) => ({ ...d, intensity: v }))}
                />
              )}
              {!isChildLens && currentStep === "step1" && step1SubStep === 2 && (
                <Step1Thought
                  emotion={step1Draft.emotion}
                  intensity={step1Draft.intensity}
                  options={options}
                  value={step1Draft.thought}
                  onChange={(t) => setStep1Draft((d) => ({ ...d, thought: t }))}
                />
              )}
              {!isChildLens && currentStep === "step2" && (
                <Step2
                  options={options}
                  question={question}
                  value={currentAnswer}
                  onChange={(v) => setMyAnswers((prev) => ({ ...prev, step2: v }))}
                />
              )}
              {!isChildLens && currentStep === "step3" && step3SubStep === 0 && (
                <Step3
                  options={options}
                  question={question}
                  value={currentAnswer}
                  onChange={(v) => setMyAnswers((prev) => ({ ...prev, step3: v }))}
                />
              )}
              {!isChildLens && currentStep === "step3" && step3SubStep === 1 && (
                <Step3Deep
                  options={step3DeepOptions}
                  question={step3DeepQuestion}
                  value={step3DeepAnswer.deepening2}
                  onChange={(v) => setStep3DeepAnswer((prev) => ({ ...prev, deepening2: v }))}
                />
              )}
              {!isChildLens && currentStep === "step3" && step3SubStep === 2 && (
                <Step3Deep
                  options={step3DeepOptions}
                  question={step3DeepQuestion}
                  value={step3DeepAnswer.deepening3}
                  onChange={(v) => setStep3DeepAnswer((prev) => ({ ...prev, deepening3: v }))}
                />
              )}
              {!isChildLens && currentStep === "step4" && (
                <Step4
                  options={options}
                  question={question}
                  value={currentAnswer}
                  onChange={(v) => setMyAnswers((prev) => ({ ...prev, step4: v }))}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 次へボタン */}
      {!showReflection && tab === "me" && !loadingOpts && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-gray-100 px-4 py-4">
          <button
            onClick={handleNext}
            disabled={!isAnswerReady || saving}
            className="w-full bg-orange-400 disabled:bg-gray-200 text-white disabled:text-gray-400 font-semibold py-4 rounded-2xl transition-colors"
          >
            {saving
              ? "保存中にゃ…"
              : stepIndex === 3
              ? "完了してリフレクションを見る 🐾"
              : "次へ →"}
          </button>
        </div>
      )}

      {/* 離脱確認ダイアログ */}
      <AnimatePresence>
        {confirmExit && (
          <motion.div
            className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setConfirmExit(false)}
          >
            <motion.div
              className="bg-white w-full max-w-md rounded-t-3xl p-6"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-base font-semibold text-gray-800 mb-1">中断しますか？</p>
              <p className="text-sm text-gray-500 mb-6">
                回答は保存されているにゃ。後で続きからできるにゃ🐾
              </p>
              <button
                onClick={() => navigate("/home")}
                className="w-full bg-gray-800 text-white font-semibold py-3 rounded-2xl mb-3"
              >
                ホームに戻る
              </button>
              <button
                onClick={() => setConfirmExit(false)}
                className="w-full text-gray-500 py-2"
              >
                続ける
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
