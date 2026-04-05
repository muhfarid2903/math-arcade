const express = require('express');
const router = express.Router();
const mikrotik = require('../services/mikrotik');
const gameSession = require('../services/gameSession');
const { claimLimiter } = require('../middleware/rateLimiter');

// Reward tiers
const REWARD_TIERS = {
  3:  { uptime: '1h',  label: '1 Jam',  hours: 1, profile: 'game-1h' },
  5:  { uptime: '2h',  label: '2 Jam',  hours: 2, profile: 'game-2h' },
  7:  { uptime: '3h',  label: '3 Jam',  hours: 3, profile: 'game-3h' }
};

const MAX_VOUCHERS_PER_DAY = 3;
const COOLDOWN_HOURS = 0; // Tidak ada cooldown

module.exports = function(db) {

  // ===== POST /api/game/start — Mulai sesi game baru =====
  router.post('/start', (req, res) => {
    try {
      const { player_name, game_type, device_id } = req.body;
      
      if (!player_name || !game_type || !device_id) {
        return res.status(400).json({ 
          success: false, 
          error: 'Data tidak lengkap' 
        });
      }
      
      const cleanName = player_name.trim().substring(0, 30).replace(/[^a-zA-Z0-9 _-]/g, '');
      if (!cleanName) {
        return res.status(400).json({ success: false, error: 'Nama tidak valid' });
      }
      
      // Create game session
      const token = gameSession.startSession(cleanName, game_type, device_id);
      
      res.json({ 
        success: true, 
        token,
        message: 'Game dimulai! Selamat bermain!' 
      });
    } catch (err) {
      console.error('[Game] Start error:', err);
      res.status(500).json({ success: false, error: 'Server error' });
    }
  });

  // ===== POST /api/game/progress — Update progress game =====
  router.post('/progress', (req, res) => {
    try {
      const { token, level, score } = req.body;
      if (!token) return res.status(400).json({ success: false, error: 'Token tidak valid' });
      
      gameSession.updateProgress(token, level || 1, score || 0);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Server error' });
    }
  });

  // ===== POST /api/game/claim — Klaim voucher WiFi (PROTECTED) =====
  router.post('/claim', claimLimiter(5, 60000), async (req, res) => {
    try {
      const { player_name, level, score, game_type, device_id, token } = req.body;

      // 1. Validate input
      if (!player_name || !level || !score || !game_type || !device_id || !token) {
        return res.status(400).json({ 
          success: false, 
          error: 'Data tidak lengkap.' 
        });
      }

      // 2. Check reward tier exists
      const reward = REWARD_TIERS[level];
      if (!reward) {
        return res.status(400).json({ 
          success: false, 
          error: `Level ${level} tidak punya reward.` 
        });
      }

      const cleanName = player_name.trim().substring(0, 30).replace(/[^a-zA-Z0-9 _-]/g, '');
      if (!cleanName) {
        return res.status(400).json({ success: false, error: 'Nama tidak valid' });
      }

      // 3. Verify game session (anti-API abuse)
      const verification = gameSession.verifyScore(token, cleanName, device_id, level, score);
      if (!verification.valid) {
        return res.status(403).json({ 
          success: false, 
          error: verification.reason 
        });
      }

      // 4. Check daily voucher limit BY DEVICE (anti name-change abuse)
      const today = new Date().toISOString().split('T')[0];
      const deviceDailyCount = db.prepare(
        `SELECT COUNT(*) as count FROM vouchers 
         WHERE device_id = ? AND date(created_at) = date(?)`
      ).get(device_id, today);

      if (deviceDailyCount.count >= MAX_VOUCHERS_PER_DAY) {
        return res.status(429).json({ 
          success: false, 
          error: `Device ini sudah klaim ${MAX_VOUCHERS_PER_DAY} voucher hari ini. Coba lagi besok!`,
          daily_limit: MAX_VOUCHERS_PER_DAY,
          used: deviceDailyCount.count
        });
      }

      // 5. Also check by player name
      const nameDailyCount = db.prepare(
        `SELECT COUNT(*) as count FROM vouchers 
         WHERE player_name = ? AND date(created_at) = date(?)`
      ).get(cleanName, today);

      if (nameDailyCount.count >= MAX_VOUCHERS_PER_DAY) {
        return res.status(429).json({ 
          success: false, 
          error: `Kamu sudah klaim ${MAX_VOUCHERS_PER_DAY} voucher hari ini. Coba lagi besok!`,
          daily_limit: MAX_VOUCHERS_PER_DAY,
          used: nameDailyCount.count
        });
      }

      // 6. Check cooldown (2 jam setelah klaim terakhir)
      const lastClaim = db.prepare(
        `SELECT created_at FROM vouchers 
         WHERE (device_id = ? OR player_name = ?) AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`
      ).get(device_id, cleanName);

      if (lastClaim) {
        const lastTime = new Date(lastClaim.created_at + 'Z').getTime();
        const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;
        const elapsed = Date.now() - lastTime;
        
        if (elapsed < cooldownMs) {
          const remainingMin = Math.ceil((cooldownMs - elapsed) / 60000);
          return res.status(429).json({ 
            success: false, 
            error: `Cooldown aktif. Tunggu ${remainingMin} menit lagi sebelum klaim berikutnya.` 
          });
        }
      }

      // 7. Check duplicate claim (same device + same level today)
      const alreadyClaimed = db.prepare(
        `SELECT id FROM vouchers 
         WHERE device_id = ? AND level = ? AND date(created_at) = date(?)`
      ).get(device_id, level, today);

      if (alreadyClaimed) {
        return res.status(409).json({ 
          success: false, 
          error: `Reward level ${level} sudah diklaim hari ini dari device ini.` 
        });
      }

      // 8. Generate voucher code
      const code = mikrotik.generateCode();

      // 9. Create voucher on MikroTik
      let mikrotikStatus = 'pending';
      try {
        await mikrotik.createVoucher(code, reward.uptime, reward.profile);
        mikrotikStatus = 'active';
      } catch (err) {
        console.error('[Game] MikroTik error:', err.message);
        mikrotikStatus = 'failed';
      }

      // 10. Save to database (with device_id)
      db.prepare(`
        INSERT INTO vouchers (code, player_name, device_id, level, score, game_type, reward_label, reward_hours, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(code, cleanName, device_id, level, score, game_type, reward.label, reward.hours, mikrotikStatus);

      // 11. Save to leaderboard
      db.prepare(`
        INSERT OR REPLACE INTO leaderboard (player_name, game_type, best_score, best_level, games_played, updated_at)
        VALUES (
          ?, ?, 
          MAX(?, COALESCE((SELECT best_score FROM leaderboard WHERE player_name = ? AND game_type = ?), 0)),
          MAX(?, COALESCE((SELECT best_level FROM leaderboard WHERE player_name = ? AND game_type = ?), 0)),
          COALESCE((SELECT games_played FROM leaderboard WHERE player_name = ? AND game_type = ?), 0) + 1,
          datetime('now')
        )
      `).run(cleanName, game_type, score, cleanName, game_type, level, cleanName, game_type, cleanName, game_type);

      // 12. Mark claimed in session
      gameSession.markClaimed(token, level);

      if (mikrotikStatus === 'failed') {
        return res.status(503).json({
          success: false,
          error: 'MikroTik offline. Hubungi admin untuk aktivasi.',
          code: code
        });
      }

      const totalUsed = Math.max(deviceDailyCount.count, nameDailyCount.count) + 1;

      res.json({
        success: true,
        voucher: {
          code,
          username: code,
          password: code,
          reward: reward.label,
          duration: reward.uptime
        },
        message: `Selamat! Kamu dapat WiFi gratis ${reward.label}!`,
        daily_remaining: MAX_VOUCHERS_PER_DAY - totalUsed,
        cooldown_minutes: COOLDOWN_HOURS * 60
      });

    } catch (err) {
      console.error('[Game] Claim error:', err);
      res.status(500).json({ success: false, error: 'Server error' });
    }
  });

  // ===== GET /api/game/leaderboard =====
  router.get('/leaderboard', (req, res) => {
    try {
      const { game_type, limit = 20 } = req.query;
      let query = `SELECT player_name, game_type, best_score, best_level, games_played, updated_at FROM leaderboard`;
      const params = [];

      if (game_type && game_type !== 'all') {
        query += ' WHERE game_type = ?';
        params.push(game_type);
      }
      query += ' ORDER BY best_score DESC LIMIT ?';
      params.push(Math.min(parseInt(limit) || 20, 50));

      res.json({ success: true, leaderboard: db.prepare(query).all(...params) });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Server error' });
    }
  });

  // ===== POST /api/game/save-score =====
  router.post('/save-score', (req, res) => {
    try {
      const { player_name, level, score, game_type } = req.body;
      if (!player_name || !score || !game_type) {
        return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
      }
      const cleanName = player_name.trim().substring(0, 30).replace(/[^a-zA-Z0-9 _-]/g, '');

      db.prepare(`
        INSERT OR REPLACE INTO leaderboard (player_name, game_type, best_score, best_level, games_played, updated_at)
        VALUES (?, ?,
          MAX(?, COALESCE((SELECT best_score FROM leaderboard WHERE player_name = ? AND game_type = ?), 0)),
          MAX(?, COALESCE((SELECT best_level FROM leaderboard WHERE player_name = ? AND game_type = ?), 0)),
          COALESCE((SELECT games_played FROM leaderboard WHERE player_name = ? AND game_type = ?), 0) + 1,
          datetime('now'))
      `).run(cleanName, game_type, score, cleanName, game_type, level || 0, cleanName, game_type, cleanName, game_type);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Server error' });
    }
  });

  // ===== GET /api/game/my-vouchers =====
  router.get('/my-vouchers', (req, res) => {
    try {
      const { player_name, device_id } = req.query;
      if (!player_name && !device_id) {
        return res.status(400).json({ success: false, error: 'Butuh player_name atau device_id' });
      }

      // Search by device_id first, fallback to player_name
      const searchField = device_id ? 'device_id' : 'player_name';
      const searchValue = device_id || player_name.trim();

      const vouchers = db.prepare(`
        SELECT code, player_name, level, reward_label, reward_hours, status, created_at
        FROM vouchers WHERE ${searchField} = ?
        ORDER BY created_at DESC LIMIT 20
      `).all(searchValue);

      const today = new Date().toISOString().split('T')[0];
      const todayCount = db.prepare(
        `SELECT COUNT(*) as count FROM vouchers WHERE ${searchField} = ? AND date(created_at) = date(?)`
      ).get(searchValue, today);

      // Check cooldown
      const lastClaim = db.prepare(
        `SELECT created_at FROM vouchers 
         WHERE ${searchField} = ? AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`
      ).get(searchValue);

      let cooldownRemaining = 0;
      if (lastClaim) {
        const lastTime = new Date(lastClaim.created_at + 'Z').getTime();
        const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;
        const elapsed = Date.now() - lastTime;
        if (elapsed < cooldownMs) {
          cooldownRemaining = Math.ceil((cooldownMs - elapsed) / 60000);
        }
      }

      res.json({ 
        success: true, 
        vouchers,
        daily_used: todayCount.count,
        daily_limit: MAX_VOUCHERS_PER_DAY,
        daily_remaining: MAX_VOUCHERS_PER_DAY - todayCount.count,
        cooldown_remaining_minutes: cooldownRemaining
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Server error' });
    }
  });

  // ===== GET /api/game/rewards =====
  router.get('/rewards', (req, res) => {
    res.json({ 
      success: true, 
      rewards: REWARD_TIERS,
      daily_limit: MAX_VOUCHERS_PER_DAY,
      cooldown_hours: COOLDOWN_HOURS
    });
  });

  // ===== GET /api/game/custom-questions — Fetch random custom questions =====
  router.get('/custom-questions', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 50);
      const difficulty = parseInt(req.query.difficulty) || 0;
      
      let query = 'SELECT id, question, answer, category, difficulty FROM questions';
      const params = [];
      
      if (difficulty > 0) {
        query += ' WHERE difficulty <= ?';
        params.push(difficulty);
      }
      
      query += ' ORDER BY RANDOM() LIMIT ?';
      params.push(limit);
      
      const questions = db.prepare(query).all(...params);
      res.json({ success: true, questions });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Server error' });
    }
  });

  return router;
};
