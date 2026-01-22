// src/server.js
import express from "express";

const app = express();

app.get("/health", (_, res) => {
  res.status(200).send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`server running on ${PORT}`);
});
