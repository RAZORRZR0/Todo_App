const mongoose = require('mongoose');
const { MONGO_URI } = require('../config');

// Mongoose does not retry a failed *first* connection, so keep trying; /healthz reports 503 meanwhile.
function connect() {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('Connected to MongoDB.'))
        .catch(err => {
            console.error('MongoDB connection error:', err.message, '- retrying in 10s');
            setTimeout(connect, 10000).unref();
        });
}
connect();

module.exports = mongoose;
