const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

// Verifies "Authorization: Bearer <token>" and puts the token's claims on req.user.
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Login required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(401).json({ error: 'Session expired, please log in again' });
        req.user = user;
        next();
    });
};

module.exports = authenticateToken;
