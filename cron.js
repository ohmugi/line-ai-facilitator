// cron.js

import { updateCharacterPrompt } from './feedbackProcessor.js';

(async () => {
  try {
    await updateCharacterPrompt('けみー');
    console.log('✅ プロンプト更新完了');
    process.exit(0); // 正常終了
  } catch (err) {
    console.error('❌ Cronエラー:', err);
    process.exit(1); // 異常終了
  }
})();
