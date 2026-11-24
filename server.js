require('dotenv').config({ quiet: true });
const { PORT, JWT_SECRET } = require('./src/config');
require('./src/db/database');
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const multer = require('multer');

const UserRepository = require('./src/repositories/userRepository');
const NoteRepository = require('./src/repositories/noteRepository');
const authenticateToken = require('./src/middleware/authMiddleware');
const adminMiddleware = require('./src/middleware/adminMiddleware');
const validate = require('./src/validate');
const { Image } = require('./src/db/models');
const demo = require('./src/demo');
const realtime = require('./src/realtime');

const app = express();
// Behind a host's proxy (Render, Heroku...), use the real client IP for the login throttle.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

app.get('/healthz', (req, res) => {
    const db = mongoose.connection.readyState === 1;
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'db unavailable' });
});
app.get('/api/config', (req, res) => res.json({ demo: demo.enabled, demoLogin: demo.enabled ? demo.LOGIN : null }));

app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rejects malformed :id params before they reach Mongoose (which would throw a CastError).
app.param('id', (req, res, next, id) => {
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
    next();
});

// --- Image uploads: images only, 5 MB max, stored in MongoDB under a random key ---
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(null, IMAGE_TYPES.includes(file.mimetype)),
});

app.post('/api/upload', authenticateToken, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) {
            const tooBig = err.code === 'LIMIT_FILE_SIZE';
            return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Image must be 5 MB or less' : 'Upload failed' });
        }
        if (!req.file) return res.status(400).json({ error: 'Upload a PNG, JPEG, GIF or WebP image' });
        try {
            const key = crypto.randomBytes(16).toString('hex');
            await Image.create({ key, owner: req.user.id, type: req.file.mimetype, data: req.file.buffer });
            res.json({ url: `/api/images/${key}` });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Upload failed' });
        }
    });
});

// Public by unguessable key, because <img> tags cannot send the Authorization header.
app.get('/api/images/:key', async (req, res) => {
    if (!/^[0-9a-f]{32}$/.test(req.params.key)) return res.status(404).end();
    const img = await Image.findOne({ key: req.params.key }, 'type data');
    if (!img) return res.status(404).end();
    res.set({ 'Content-Type': img.type, 'Cache-Control': 'private, max-age=31536000, immutable' });
    res.send(img.data);
});

// --- Auth ---
// shortcut: in-memory login throttle, per process; move to Redis if this runs on more than one instance.
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;
const failures = new Map(); // key -> { count, until }

function isLocked(key) {
    const f = failures.get(key);
    if (f && f.until > Date.now()) return true;
    if (f && f.until && f.until <= Date.now()) failures.delete(key);
    return false;
}

function recordFailure(key) {
    const f = failures.get(key) || { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= MAX_FAILURES) f.until = Date.now() + LOCK_MS;
    failures.set(key, f);
}

app.post('/api/auth/register', async (req, res) => {
    const { value, error } = validate.credentials(req.body);
    if (error) return res.status(400).json({ error });

    if (await UserRepository.findUserByUsername(value.username)) {
        return res.status(409).json({ error: 'Username already exists' });
    }
    const hash = await bcrypt.hash(value.password, 10);
    await UserRepository.createUser(value.username, hash);
    res.status(201).json({ message: 'User created successfully' });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Username and password required' });
    }
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (isLocked(key)) return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });

    const user = await UserRepository.findUserByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        recordFailure(key);
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    failures.delete(key);

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username: user.username, role: user.role });
});

// --- Admin ---
app.get('/api/admin/users', authenticateToken, adminMiddleware, async (req, res) => {
    res.json(await UserRepository.getAllUsers());
});

app.delete('/api/admin/users/:id', authenticateToken, adminMiddleware, async (req, res) => {
    const user = await UserRepository.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Admin accounts cannot be deleted here' });

    await UserRepository.deleteUser(user.id);
    await NoteRepository.removeUser(user.id);
    await Image.deleteMany({ owner: user.id });
    res.json({ message: 'User deleted' });
});

// --- User directory for the share picker ---
app.get('/api/users', authenticateToken, async (req, res) => {
    const users = await UserRepository.getAllUsers();
    res.json(users.filter(u => u.id !== req.user.id).map(u => ({ id: u.id, username: u.username })));
});

// --- Notes ---
app.get('/api/notes', authenticateToken, async (req, res) => {
    res.json(await NoteRepository.getNotes(req.user.id));
});

app.post('/api/notes', authenticateToken, async (req, res) => {
    const { value, error } = validate.note(req.body);
    if (error) return res.status(400).json({ error });
    const note = await NoteRepository.createNote({ ...value, user_id: req.user.id });
    realtime.notify([req.user.id], { id: note.id, type: 'created' }, req.get('X-Socket-Id'));
    res.status(201).json(note);
});

app.put('/api/notes/:id', authenticateToken, async (req, res) => {
    const { value, error } = validate.note(req.body);
    if (error) return res.status(400).json({ error });

    const { version } = req.body;
    if (!Number.isInteger(version) || version < 0) {
        return res.status(400).json({ error: 'version (the note version you edited) is required' });
    }

    const { status, note } = await NoteRepository.updateNote(req.params.id, req.user.id, value, version);
    if (status === 'not_found') return res.status(404).json({ error: 'Note not found' });
    if (status === 'forbidden') return res.status(403).json({ error: 'You have read-only access to this note' });
    if (status === 'conflict') {
        // Someone saved first. Send their version so the client can show it instead of overwriting it.
        return res.status(409).json({ error: 'This note was changed by someone else. Showing the latest version.', note });
    }
    realtime.notify(NoteRepository.audience(note), { id: note.id, type: 'updated', version: note.version }, req.get('X-Socket-Id'));
    res.json({ message: 'Note updated', version: note.version });
});

app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
    const note = await NoteRepository.deleteNote(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    realtime.notify(NoteRepository.audience(note), { id: req.params.id, type: 'deleted' }, req.get('X-Socket-Id'));
    res.json({ message: 'Note deleted' });
});

app.post('/api/notes/:id/share', authenticateToken, async (req, res) => {
    const { username, permission = 'read' } = req.body || {};
    if (typeof username !== 'string' || !['read', 'write'].includes(permission)) {
        return res.status(400).json({ error: 'Pick a user and a permission (read or write)' });
    }
    if (username === req.user.username) return res.status(400).json({ error: 'You already own this note' });

    const target = await UserRepository.findUserByUsername(username);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const note = await NoteRepository.shareNote(req.params.id, req.user.id, target, permission);
    if (!note) return res.status(404).json({ error: 'Note not found or you are not the owner' });
    realtime.notify(NoteRepository.audience(note), { id: req.params.id, type: 'shared' }, req.get('X-Socket-Id'));
    res.json({ message: `Note shared with ${target.username}` });
});

// Express 5 forwards rejected promises here; never leak internals to the client.
app.use((err, req, res, next) => {
    console.error(err);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);
realtime.attach(server);

if (require.main === module) {
    demo.seed().catch(err => console.error('Demo seed failed:', err.message));
    server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

module.exports = { app, server };
