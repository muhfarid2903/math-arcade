const express = require('express');
const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'warkopsaja2024';

// Simple auth middleware
function auth(req, res, next) {
  const password = req.headers['x-admin-password'] || req.query.password;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Password salah' });
  }
  next();
}

module.exports = function(db) {

  // GET /api/admin/questions - List all questions
  router.get('/questions', auth, (req, res) => {
    try {
      const questions = db.prepare('SELECT * FROM questions ORDER BY id DESC').all();
      res.json({ success: true, questions });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/admin/questions - Add a question
  router.post('/questions', auth, (req, res) => {
    try {
      const { question, answer, category, difficulty } = req.body;
      if (!question || answer === undefined) {
        return res.status(400).json({ success: false, error: 'Butuh question dan answer' });
      }
      const result = db.prepare(
        'INSERT INTO questions (question, answer, category, difficulty) VALUES (?, ?, ?, ?)'
      ).run(question, parseFloat(answer), category || 'umum', parseInt(difficulty) || 1);
      
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/admin/questions/bulk - Add multiple questions at once
  router.post('/questions/bulk', auth, (req, res) => {
    try {
      const { questions } = req.body;
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ success: false, error: 'Butuh array questions' });
      }
      const stmt = db.prepare(
        'INSERT INTO questions (question, answer, category, difficulty) VALUES (?, ?, ?, ?)'
      );
      const insert = db.transaction((items) => {
        let count = 0;
        for (const q of items) {
          if (q.question && q.answer !== undefined) {
            stmt.run(q.question, parseFloat(q.answer), q.category || 'umum', parseInt(q.difficulty) || 1);
            count++;
          }
        }
        return count;
      });
      const count = insert(questions);
      res.json({ success: true, added: count });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // PUT /api/admin/questions/:id - Update a question
  router.put('/questions/:id', auth, (req, res) => {
    try {
      const { question, answer, category, difficulty } = req.body;
      db.prepare(
        'UPDATE questions SET question=?, answer=?, category=?, difficulty=? WHERE id=?'
      ).run(question, parseFloat(answer), category || 'umum', parseInt(difficulty) || 1, req.params.id);
      
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/admin/questions/:id - Delete a question
  router.delete('/questions/:id', auth, (req, res) => {
    try {
      db.prepare('DELETE FROM questions WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/admin/stats - Game statistics
  router.get('/stats', auth, (req, res) => {
    try {
      const totalVouchers = db.prepare('SELECT COUNT(*) as count FROM vouchers').get();
      const todayVouchers = db.prepare("SELECT COUNT(*) as count FROM vouchers WHERE date(created_at) = date('now')").get();
      const totalPlayers = db.prepare('SELECT COUNT(DISTINCT player_name) as count FROM leaderboard').get();
      const totalQuestions = db.prepare('SELECT COUNT(*) as count FROM questions').get();
      
      res.json({
        success: true,
        stats: {
          total_vouchers: totalVouchers.count,
          today_vouchers: todayVouchers.count,
          total_players: totalPlayers.count,
          custom_questions: totalQuestions.count
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
