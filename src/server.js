import "dotenv/config";
import express from "express";

const app = express();

app.get("/", (_, res) => res.status(200).send("ok"));
app.get("/health", (_, res) => res.status(200).send("ok"));

const PORT = Number(process.env.PORT);
if (!PORT) throw new Error("PORT is not set");

app.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on ${PORT}`);
});
