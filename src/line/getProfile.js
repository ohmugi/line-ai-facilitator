// src/line/getProfile.js
import fetch from "node-fetch";

export async function getLineProfile(userId) {
  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/profile/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );

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
