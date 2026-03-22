const fs = require('fs');
const path = require('path');

function loadConfig() {
    const configPath = path.join(__dirname, '..', 'config', 'app.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const data = JSON.parse(raw);

    const publicUrl = (process.env.PUBLIC_URL || data.publicUrl || '').trim().replace(/\/$/, '');
    const secretToken = process.env.SECRET_TOKEN || data.secretToken || 'qutmess';

    if (!publicUrl) {
        throw new Error('config/app.json must set publicUrl (or set PUBLIC_URL)');
    }

    return { publicUrl, secretToken };
}

module.exports = { loadConfig };
