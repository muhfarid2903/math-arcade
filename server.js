require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const initDB = require('./services/database');
const gameRoutes = require('./routes/game');
const adminRoutes = require('./routes/admin');
const { rateLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3001;

const db = initDB();

app.use(cors({
  origin: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',') 
    : ['https://balanglompo.com', 'https://www.balanglompo.com', 'https://game.balanglompo.com', 'http://localhost:3001']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global rate limit: 60 requests per minute per IP
app.use('/api', rateLimiter(60, 60000));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/game', gameRoutes(db));
app.use('/api/admin', adminRoutes(db));

app.get('/api/health', async (req, res) => {
  const mikrotik = require('./services/mikrotik');
  const mkStatus = await mikrotik.healthCheck();
  res.json({ 
    status: 'ok', 
    service: 'math-arcade-game',
    version: '2.0.0',
    mikrotik: mkStatus,
    timestamp: new Date().toISOString()
  });
});

// Admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   🎮 Math Arcade Game Server v2.0          ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║   🌐 http://localhost:${PORT}                  ║`);
  console.log('║   🛡️  Anti-abuse protection: ACTIVE         ║');
  console.log('║   🎯 Rewards: Level 3/5/7/10 = WiFi gratis ║');
  console.log('║   ⏱️  Cooldown: 2 jam antar klaim           ║');
  console.log('║   📊 Max 3 voucher/device/hari             ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
});

process.on('SIGINT', async () => {
  const mikrotik = require('./services/mikrotik');
  await mikrotik.disconnect();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  const mikrotik = require('./services/mikrotik');
  await mikrotik.disconnect();
  db.close();
  process.exit(0);
});
