const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    role: { type: String, default: 'user' },
    created_at: { type: Date, default: Date.now }
});

const NoteSchema = new mongoose.Schema({
    user_id: { type: String, required: true }, // Keeping strict link, Mongoose uses ObjectId internally but we pass strings usually
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
    created_at: { type: Date, default: Date.now }
});

// Create Models
const User = mongoose.model('User', UserSchema);
const Note = mongoose.model('Note', NoteSchema);

module.exports = {
    User,
    Note
};
