// Simple in-memory rate limiter
const requests = new Map();

function rateLimiter(maxRequests = 30, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    if (!requests.has(ip)) {
      requests.set(ip, []);
    }
    
    const timestamps = requests.get(ip).filter(t => now - t < windowMs);
    
    if (timestamps.length >= maxRequests) {
      return res.status(429).json({ 
        success: false, 
        error: 'Terlalu banyak request. Tunggu sebentar ya.' 
      });
    }
    
    timestamps.push(now);
    requests.set(ip, timestamps);
    next();
  };
}

// Stricter limiter for claim endpoint
function claimLimiter(maxRequests = 5, windowMs = 60000) {
  return rateLimiter(maxRequests, windowMs);
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of requests.entries()) {
    const valid = timestamps.filter(t => now - t < 300000);
    if (valid.length === 0) {
      requests.delete(ip);
    } else {
      requests.set(ip, valid);
    }
  }
}, 300000);

module.exports = { rateLimiter, claimLimiter };
