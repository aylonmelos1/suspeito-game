import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { config } from 'dotenv';
import log from './log';
import cookieParser from 'cookie-parser'
import { VersioningService } from './services/versioning';
import { SocketService } from './services/socket';
import route from './controllers/routes';
import path from 'path';

config()

const app = express();
log.info(path.join(__dirname, 'public'))
VersioningService.initialize(path.join(__dirname, '..', 'public'));

app.use((req, res, next) => {
    // Se o arquivo tem query string 'v' (versão), cache longo (1 ano) e imutável
    if (req.query.v) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    // Se é um arquivo estático conhecido sem versão, cache curto (1 hora)
    else if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico)$/)) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    // HTML e root: sem cache para garantir que sempre peguem a versão nova
    else if (req.path === '/' || req.path.match(/\.(html)$/)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

app.use(cookieParser())


// Rota principal - Injeta versões no HTML
app.get(['/', '/index.html'], (req, res) => {
    serveVersionedHtml(res, 'index.html');
});

// Rota do jogo - Injeta versões no HTML
app.get(['/app', '/app.html'], (req, res) => {
    serveVersionedHtml(res, 'app.html');
});

// Endpoint de versão para o client verificar updates
app.get('/api/version', (req, res) => {
    res.json({ version: VersioningService.getAppVersion() });
});

function serveVersionedHtml(res: express.Response, filename: string) {
    const filePath = path.join(__dirname, '..', 'public', filename);
    const fs = require('fs');
    fs.readFile(filePath, 'utf8', (err: Error, data: string) => {
        if (err) {
            log.error(`Erro ao ler ${filename}:`, err);
            return res.status(500).send('Erro interno do servidor');
        }
        const versionedHtml = VersioningService.injectVersions(data);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.send(versionedHtml);
    });
}

app.use(express.static('public', {
    index: false, // Desabilita index automático para usarmos a rota acima
    extensions: ['html']
}));

app.use('/api', route)

const PORT = process.env.PORT || 3000;
import { StorageService } from './services/storage';

// ... (existing imports)

const server = createServer(app);
const io = new Server(server);

// Initialize Storage (SQLite + Cache)
StorageService.initialize().then(() => {
    SocketService.initialize(io);

    server.listen(PORT, () => {
        log.debug('Server and Storage started on port 3000');
    });
});