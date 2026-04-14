const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

/**
 * Express middleware that verifies a JWT bearer token.
 * Attaches the decoded payload to req.admin on success.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];   // "Bearer <token>"
  const token      = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { authenticateToken, JWT_SECRET };
