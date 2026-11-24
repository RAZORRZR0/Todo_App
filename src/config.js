const crypto = require('crypto');

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
    // No shared fallback: a random per-process secret means tokens simply expire on restart.
    console.warn('JWT_SECRET not set; using a random secret (logins reset on restart).');
    jwtSecret = crypto.randomBytes(32).toString('hex');
}

module.exports = {
    PORT: process.env.PORT || 3000,
    MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/todoapp',
    JWT_SECRET: jwtSecret,
};
