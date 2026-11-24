// Live updates over Socket.IO. Each logged-in socket joins a room named after its user,
// and note changes are pushed to every user who can see the note.
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config');

let io = null;

function attach(httpServer) {
    io = new Server(httpServer, { serveClient: true });

    // The browser passes its JWT in the handshake; no token, no socket.
    io.use((socket, next) => {
        try {
            socket.user = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
            next();
        } catch {
            next(new Error('unauthorized'));
        }
    });

    io.on('connection', (socket) => socket.join(`user:${socket.user.id}`));
    return io;
}

// Tells each user in userIds that a note changed. The socket that made the change
// (sent by the client as X-Socket-Id) is skipped; it already has the new state.
function notify(userIds, payload, exceptSocketId) {
    if (!io) return;
    const rooms = [...new Set(userIds)].map(id => `user:${id}`);
    let target = io.to(rooms);
    if (typeof exceptSocketId === 'string' && exceptSocketId) target = target.except(exceptSocketId);
    target.emit('note:changed', payload);
}

module.exports = { attach, notify };
