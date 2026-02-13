console.log("BOOT");

import express from "express";

const app = express();

app.get("/", (_, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("LISTENING", PORT);
});
