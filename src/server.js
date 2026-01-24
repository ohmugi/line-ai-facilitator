import "dotenv/config";
import express from "express";
import { middleware } from "@line/bot-sdk";

const app = express();

const lineMiddleware = middleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

app.get("/", (_, res) => res.send("ok"));

app.post(
  "/webhook",
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
  lineMiddleware,
  (req, res) => {
    console.log("webhook OK");
    res.sendStatus(200);
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("server running");
});
