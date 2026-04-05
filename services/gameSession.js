const crypto = require('crypto');

// Active game sessions stored in memory
const sessions = new Map();

// Minimum seconds needed to reach each level (anti-cheat)
// Level 1 = 0s, each level needs ~30s minimum of real play
const MIN_SECONDS_PER_LEVEL = 25;

class GameSessionService {
  
  // Start a new game session - returns a token
  startSession(playerName, gameType, deviceId) {
    const token = crypto.randomBytes(32).toString('hex');
    
    sessions.set(token, {
      playerName,
      gameType,
      deviceId,
      startedAt: Date.now(),
      level: 1,
      score: 0,
      claimedLevels: new Set(),
      lastActivity: Date.now()
    });
    
    return token;
  }
  
  // Validate a session exists and belongs to this player/device
  getSession(token, playerName, deviceId) {
    const session = sessions.get(token);
    if (!session) return null;
    
    // Check player name matches
    if (session.playerName !== playerName) return null;
    
    // Check device matches
    if (session.deviceId !== deviceId) return null;
    
    // Session expires after 2 hours
    if (Date.now() - session.startedAt > 2 * 60 * 60 * 1000) {
      sessions.delete(token);
      return null;
    }
    
    return session;
  }
  
  // Verify that the claimed level/score is realistic
  verifyScore(token, playerName, deviceId, claimedLevel, claimedScore) {
    const session = this.getSession(token, playerName, deviceId);
    if (!session) {
      return { valid: false, reason: 'Sesi game tidak valid. Mulai game baru.' };
    }
    
    // Check minimum time played
    const elapsedSeconds = (Date.now() - session.startedAt) / 1000;
    const minSecondsNeeded = (claimedLevel - 1) * MIN_SECONDS_PER_LEVEL;
    
    if (elapsedSeconds < minSecondsNeeded) {
      return { 
        valid: false, 
        reason: `Waktu main terlalu cepat. Level ${claimedLevel} butuh minimal ${Math.ceil(minSecondsNeeded / 60)} menit.` 
      };
    }
    
    // Check score is reasonable (max ~200 points per level)
    const maxReasonableScore = claimedLevel * 200;
    if (claimedScore > maxReasonableScore) {
      return { 
        valid: false, 
        reason: 'Skor tidak valid.' 
      };
    }
    
    // Check if this level was already claimed in this session
    if (session.claimedLevels.has(claimedLevel)) {
      return { 
        valid: false, 
        reason: `Reward level ${claimedLevel} sudah diklaim di sesi ini.` 
      };
    }
    
    return { valid: true, session };
  }
  
  // Mark a level as claimed in this session
  markClaimed(token, level) {
    const session = sessions.get(token);
    if (session) {
      session.claimedLevels.add(level);
      session.lastActivity = Date.now();
    }
  }
  
  // Update session progress
  updateProgress(token, level, score) {
    const session = sessions.get(token);
    if (session) {
      session.level = Math.max(session.level, level);
      session.score = Math.max(session.score, score);
      session.lastActivity = Date.now();
    }
  }
  
  // Delete a session
  deleteSession(token) {
    sessions.delete(token);
  }
  
  // Clean up expired sessions (run periodically)
  cleanup() {
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;
    for (const [token, session] of sessions.entries()) {
      if (now - session.startedAt > twoHours) {
        sessions.delete(token);
      }
    }
  }
}

// Clean up every 10 minutes
const service = new GameSessionService();
setInterval(() => service.cleanup(), 10 * 60 * 1000);

module.exports = service;
