// src/line/reply.js

import axios from "axios";

export async function replyText(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [
        {
          type: "text",
          text: text,
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// export async function replyTextWithQuickReply(replyToken, text, options = []) {
//   return client.replyMessage(replyToken, {
   //  type: "text",
 //    text,
 //    quickReply: {
 //      items: options.map(opt => ({
 //        type: "action",
 //        action: {
 //          type: "message",
 //          label: opt,
 //          text: opt
 //        }
 //      }))
 //    }
 //  });
// }

