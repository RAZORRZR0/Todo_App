const mongoose = require('mongoose');
const { MONGO_URI } = require('../config');

// Connects on import; Mongoose buffers queries until the connection is ready.
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB.'))
    .catch(err => console.error('MongoDB connection error:', err.message));

module.exports = mongoose;
