// src/components/LoadingScreen.jsx
export default function LoadingScreen({ message = "読み込み中にゃ🐾" }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="w-10 h-10 border-4 border-green-400 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  );
}
