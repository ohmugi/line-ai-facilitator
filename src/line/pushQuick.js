import axios from "axios";

export async function pushQuickText(to, text, options = []) {
  await axios.post(
    "https://api.line.me/v2/bot/message/push",
    {
      to,
      messages: [
        {
          type: "text",
          text,
          quickReply: {
            items: options.map((opt) => ({
              type: "action",
              action: { type: "message", label: opt, text: opt },
            })),
          },
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
