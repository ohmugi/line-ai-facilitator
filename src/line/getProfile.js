// src/line/getProfile.js
import fetch from "node-fetch";

export async function getLineProfile(userId, groupId = null) {
  const url = groupId
    ? `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`
    : `https://api.line.me/v2/bot/profile/${userId}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    });

    if (!res.ok) {
      console.error("LINE profile fetch failed:", await res.text());
      return null;
    }

    return await res.json();
    // { userId, displayName, pictureUrl, statusMessage }
  } catch (e) {
    console.error("getLineProfile error:", e);
    return null;
  }
}
