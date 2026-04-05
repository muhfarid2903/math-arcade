const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'game.db');

function initDB() {
  const db = new Database(DB_PATH);
  
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      player_name TEXT NOT NULL,
      device_id TEXT DEFAULT '',
      level INTEGER NOT NULL,
      score INTEGER NOT NULL,
      game_type TEXT NOT NULL,
      reward_label TEXT NOT NULL,
      reward_hours INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leaderboard (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_name TEXT NOT NULL,
      game_type TEXT NOT NULL,
      best_score INTEGER DEFAULT 0,
      best_level INTEGER DEFAULT 0,
      games_played INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(player_name, game_type)
    );

    CREATE INDEX IF NOT EXISTS idx_vouchers_player_date 
      ON vouchers(player_name, created_at);
    CREATE INDEX IF NOT EXISTS idx_vouchers_device_date 
      ON vouchers(device_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_vouchers_code 
      ON vouchers(code);
    CREATE INDEX IF NOT EXISTS idx_leaderboard_score 
      ON leaderboard(best_score DESC);

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer REAL NOT NULL,
      category TEXT DEFAULT 'umum',
      difficulty INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Add device_id column if not exists (for existing databases)
  try {
    db.exec(`ALTER TABLE vouchers ADD COLUMN device_id TEXT DEFAULT ''`);
    console.log('[DB] Added device_id column');
  } catch (e) {
    // Column already exists, ignore
  }

  console.log('[DB] Database initialized at', DB_PATH);
  return db;
}

module.exports = initDB;
