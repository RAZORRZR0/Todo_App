const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    role: { type: String, default: 'user' },
    created_at: { type: Date, default: Date.now }
});

const NoteSchema = new mongoose.Schema({
    user_id: { type: String, required: true }, // owner's User _id as a string
    title: { type: String },
    content: { type: String },
    items: [{
        text: { type: String },
        is_done: { type: Boolean, default: false },
        images: [String] // Array of URL paths
    }],
    shared_with: [{
        user_id: { type: String },
        username: { type: String },
        permission: { type: String, enum: ['read', 'write'], default: 'read' }
    }],
    is_done: { type: Boolean, default: false }, // Keeping for backward compatibility/overall status
    // Bumped on every edit; a save must quote the version it started from (optimistic locking).
    version: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
});

// Create Models
const User = mongoose.model('User', UserSchema);
const Note = mongoose.model('Note', NoteSchema);

module.exports = {
    User,
    Note
};
