const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const automacao = require('./automacao.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve frontend estático
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Armazena os logs recentes para quem conectar depois
const logHistory = [];
const maxLogs = 500;

function sendLog(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${msg}`;
    logHistory.push(logEntry);
    if (logHistory.length > maxLogs) logHistory.shift();
    io.emit('terminal-log', logEntry);
}

// API para iniciar/parar o robô
app.post('/api/start', (req, res) => {
    if (automacao.getStatus()) {
        return res.status(400).json({ error: 'O robô já está rodando!' });
    }
    
    const config = req.body;
    const success = automacao.startDaemon(config, sendLog, io);
    
    if (success) {
        res.json({ message: 'Robô iniciado com sucesso!' });
    } else {
        res.status(500).json({ error: 'Falha ao iniciar o robô.' });
    }
});

app.post('/api/stop', async (req, res) => {
    if (!automacao.getStatus()) {
        return res.status(400).json({ error: 'O robô já está parado.' });
    }
    
    await automacao.stopDaemon();
    res.json({ message: 'Robô parado com sucesso!' });
});

app.get('/api/status', (req, res) => {
    res.json({ isRunning: automacao.getStatus() });
});

// Socket.io eventos
io.on('connection', (socket) => {
    console.log('Cliente conectado ao painel.');
    // Envia o histórico ao conectar
    socket.emit('log-history', logHistory);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`🌟 Servidor Miwra rodando!`);
    console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
    console.log(`=================================`);
});
