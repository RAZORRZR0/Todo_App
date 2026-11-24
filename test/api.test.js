// API tests. Needs a MongoDB server: MONGO_URL (default mongodb://127.0.0.1:27017).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const base = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
process.env.MONGO_URI = `${base}/notes_test_${process.pid}`;
process.env.JWT_SECRET = 'test-secret';
process.env.DEMO_MODE = 'true';

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { server: httpServer } = require('../server');
const { io: ioClient } = require('socket.io-client');
const { User } = require('../src/db/models');

const PASSWORD = 'correct-horse-1';
let url;

async function call(method, path, { token, body, form, socketId } = {}) {
    const headers = {};
    if (socketId) headers['X-Socket-Id'] = socketId;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url + path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
}

async function signup(username) {
    await call('POST', '/api/auth/register', { body: { username, password: PASSWORD } });
    const r = await call('POST', '/api/auth/login', { body: { username, password: PASSWORD } });
    assert.equal(r.status, 200, `login ${username}`);
    return r.data.token;
}

before(async () => {
    await mongoose.connection.asPromise();
    await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
    httpServer.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

test('register validates input and rejects duplicates', async () => {
    assert.equal((await call('POST', '/api/auth/register', { body: { username: 'ab', password: PASSWORD } })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', { body: { username: 'shortpw', password: '123' } })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', { body: { username: '<b>x</b>', password: PASSWORD } })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', { body: { username: 'dupe', password: PASSWORD } })).status, 201);
    assert.equal((await call('POST', '/api/auth/register', { body: { username: 'dupe', password: PASSWORD } })).status, 409);
});

test('login rejects operator injection and wrong passwords, then locks out', async () => {
    await signup('victim');
    const inj = await call('POST', '/api/auth/login', { body: { username: { $ne: null }, password: PASSWORD } });
    assert.equal(inj.status, 400);
    for (let i = 0; i < 5; i++) {
        assert.equal((await call('POST', '/api/auth/login', { body: { username: 'victim', password: 'wrong-pass' } })).status, 401);
    }
    // Even the right password is refused while locked.
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'victim', password: PASSWORD } })).status, 429);
});

test('API needs a valid token', async () => {
    assert.equal((await call('GET', '/api/notes')).status, 401);
    assert.equal((await call('GET', '/api/notes', { token: 'garbage' })).status, 401);
});

test('note CRUD with validation', async () => {
    const t = await signup('alice');
    const bad = await call('POST', '/api/notes', { token: t, body: { title: 'x', items: [{ text: 'a', images: ['https://evil/x.png'] }] } });
    assert.equal(bad.status, 400);

    const created = await call('POST', '/api/notes', { token: t, body: { title: ' Groceries ', items: [{ text: 'milk' }], role: 'admin' } });
    assert.equal(created.status, 201);
    assert.equal(created.data.title, 'Groceries');
    const id = created.data.id;

    assert.equal(created.data.version, 0);
    const done = { title: 'Groceries', items: [{ text: 'milk', is_done: true }] };
    assert.equal((await call('PUT', `/api/notes/${id}`, { token: t, body: done })).status, 400); // version required
    const upd = await call('PUT', `/api/notes/${id}`, { token: t, body: { ...done, version: 0 } });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.version, 1);
    // Saving the same content again is not a 404.
    assert.equal((await call('PUT', `/api/notes/${id}`, { token: t, body: { ...done, version: 1 } })).status, 200);

    const notes = (await call('GET', '/api/notes', { token: t })).data;
    assert.equal(notes.length, 1);
    assert.equal(notes[0].items[0].is_done, true);

    assert.equal((await call('PUT', '/api/notes/not-an-id', { token: t, body: { title: 'x', version: 0 } })).status, 404);
    assert.equal((await call('DELETE', `/api/notes/${id}`, { token: t })).status, 200);
    assert.equal((await call('DELETE', `/api/notes/${id}`, { token: t })).status, 404);
});

test('sharing: read-only users cannot edit, strangers cannot see', async () => {
    const owner = await signup('owner1');
    const reader = await signup('reader1');
    const writer = await signup('writer1');
    const stranger = await signup('stranger1');

    const id = (await call('POST', '/api/notes', { token: owner, body: { title: 'Plan', items: [{ text: 'step' }] } })).data.id;
    assert.equal((await call('POST', `/api/notes/${id}/share`, { token: owner, body: { username: 'reader1', permission: 'read' } })).status, 200);
    assert.equal((await call('POST', `/api/notes/${id}/share`, { token: owner, body: { username: 'writer1', permission: 'write' } })).status, 200);
    assert.equal((await call('POST', `/api/notes/${id}/share`, { token: owner, body: { username: 'owner1' } })).status, 400);
    assert.equal((await call('POST', `/api/notes/${id}/share`, { token: owner, body: { username: 'reader1', permission: 'admin' } })).status, 400);
    // Only the owner can share.
    assert.equal((await call('POST', `/api/notes/${id}/share`, { token: writer, body: { username: 'stranger1' } })).status, 404);

    const seen = (await call('GET', '/api/notes', { token: reader })).data;
    assert.equal(seen[0].owner_username, 'owner1');
    assert.equal(seen[0].user_permission, 'read');

    const edit = { title: 'Plan', items: [{ text: 'changed' }], version: 0 };
    assert.equal((await call('PUT', `/api/notes/${id}`, { token: reader, body: edit })).status, 403);
    assert.equal((await call('PUT', `/api/notes/${id}`, { token: stranger, body: edit })).status, 404);
    assert.equal((await call('PUT', `/api/notes/${id}`, { token: writer, body: edit })).status, 200);
    assert.equal((await call('DELETE', `/api/notes/${id}`, { token: writer })).status, 404);
    assert.equal((await call('GET', '/api/notes', { token: stranger })).data.length, 0);
});

test('admin routes: role check, no password hashes, delete cascades', async () => {
    const user = await signup('plainuser');
    assert.equal((await call('GET', '/api/admin/users', { token: user })).status, 403);

    await User.create({ username: 'boss', password_hash: await bcrypt.hash(PASSWORD, 4), role: 'admin' });
    const admin = (await call('POST', '/api/auth/login', { body: { username: 'boss', password: PASSWORD } })).data.token;

    const users = (await call('GET', '/api/admin/users', { token: admin })).data;
    assert.ok(users.length > 0);
    assert.ok(users.every(u => !('password_hash' in u)));
    const dir = (await call('GET', '/api/users', { token: user })).data;
    assert.ok(dir.every(u => Object.keys(u).sort().join() === 'id,username'));

    await call('POST', '/api/notes', { token: user, body: { title: 'mine', items: [] } });
    const target = users.find(u => u.username === 'plainuser');
    assert.equal((await call('DELETE', `/api/admin/users/${target.id}`, { token: admin })).status, 200);
    assert.equal(await mongoose.model('Note').countDocuments({ user_id: target.id }), 0);

    const bossId = users.find(u => u.username === 'boss')?.id
        || (await User.findOne({ username: 'boss' }))._id.toString();
    assert.equal((await call('DELETE', `/api/admin/users/${bossId}`, { token: admin })).status, 400);
});

test('uploads accept images only and set security headers', async () => {
    const t = await signup('uploader');
    const png = Buffer.from('89504e470d0a1a0a', 'hex');

    const html = new FormData();
    html.append('image', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'x.html');
    assert.equal((await call('POST', '/api/upload', { token: t, form: html })).status, 400);

    const big = new FormData();
    big.append('image', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'big.png');
    assert.equal((await call('POST', '/api/upload', { token: t, form: big })).status, 413);

    const ok = new FormData();
    ok.append('image', new Blob([png], { type: 'image/png' }), 'photo.svg');
    const r = await call('POST', '/api/upload', { token: t, form: ok });
    assert.equal(r.status, 200);
    assert.match(r.data.url, /^\/api\/images\/[0-9a-f]{32}$/);

    // Served back with the checked type (not the client's .svg name), and storable on a note.
    const img = await fetch(url + r.data.url);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
    assert.equal((await fetch(url + '/api/images/' + '0'.repeat(32))).status, 404);
    const note = await call('POST', '/api/notes', { token: t, body: { title: 'pic', items: [{ text: 'a', images: [r.data.url] }] } });
    assert.equal(note.status, 201);

    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await call('POST', '/api/upload', { form: ok })).status, 401);
});

test('concurrent edits: the second save with a stale version gets 409 and the latest note', async () => {
    const owner = await signup('conf_owner');
    const editor = await signup('conf_editor');
    const id = (await call('POST', '/api/notes', { token: owner, body: { title: 'Shared', items: [{ text: 'a' }] } })).data.id;
    await call('POST', `/api/notes/${id}/share`, { token: owner, body: { username: 'conf_editor', permission: 'write' } });

    // Both opened the note at version 0.
    const first = await call('PUT', `/api/notes/${id}`, { token: editor, body: { title: 'Shared', items: [{ text: 'editor wins' }], version: 0 } });
    assert.equal(first.status, 200);
    const second = await call('PUT', `/api/notes/${id}`, { token: owner, body: { title: 'Shared', items: [{ text: 'owner loses' }], version: 0 } });
    assert.equal(second.status, 409);
    assert.equal(second.data.note.version, 1);
    assert.equal(second.data.note.items[0].text, 'editor wins');

    // Retrying with the version from the conflict is a deliberate overwrite and succeeds.
    const retry = await call('PUT', `/api/notes/${id}`, { token: owner, body: { title: 'Shared', items: [{ text: 'owner overwrites' }], version: 1 } });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.version, 2);

    // Simultaneous saves from the same version: exactly one wins.
    const results = await Promise.all([0, 1, 2, 3, 4].map(n =>
        call('PUT', `/api/notes/${id}`, { token: owner, body: { title: 'Race', items: [{ text: `w${n}` }], version: 2 } })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409, 409, 409, 409]);
});

function connect(token) {
    return new Promise((resolve, reject) => {
        const s = ioClient(url, { auth: { token }, transports: ['websocket'], reconnection: false });
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
    });
}

function nextEvent(socket, ms = 1000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        socket.once('note:changed', (e) => { clearTimeout(timer); resolve(e); });
    });
}

test('live updates reach collaborators, not strangers or the sender', async () => {
    await assert.rejects(connect('bad-token'), /unauthorized/);

    const owner = await signup('live_owner');
    const friend = await signup('live_friend');
    const stranger = await signup('live_stranger');
    const [ownerSock, friendSock, strangerSock] = await Promise.all([connect(owner), connect(friend), connect(stranger)]);
    try {
        const id = (await call('POST', '/api/notes', { token: owner, body: { title: 'Live', items: [] } })).data.id;

        let got = nextEvent(friendSock);
        await call('POST', `/api/notes/${id}/share`, { token: owner, body: { username: 'live_friend', permission: 'write' } });
        assert.deepEqual(await got, { id, type: 'shared' });

        const friendGot = nextEvent(friendSock);
        const ownerGot = nextEvent(ownerSock, 300);
        const strangerGot = nextEvent(strangerSock, 300);
        await call('PUT', `/api/notes/${id}`, { token: owner, socketId: ownerSock.id, body: { title: 'Live', items: [{ text: 'new' }], version: 0 } });
        assert.deepEqual(await friendGot, { id, type: 'updated', version: 1 });
        assert.equal(await ownerGot, null, 'sender is not echoed');
        assert.equal(await strangerGot, null, 'stranger hears nothing');

        got = nextEvent(friendSock);
        await call('DELETE', `/api/notes/${id}`, { token: owner });
        assert.deepEqual(await got, { id, type: 'deleted' });
    } finally {
        [ownerSock, friendSock, strangerSock].forEach(s => s.close());
    }
});

test('health check and demo seed', async () => {
    assert.deepEqual((await call('GET', '/healthz')).data, { status: 'ok' });

    const demo = require('../src/demo');
    await demo.seed();
    await demo.seed(); // second run must not duplicate anything
    const cfg = (await call('GET', '/api/config')).data;
    assert.equal(cfg.demo, true);

    const login = await call('POST', '/api/auth/login', { body: cfg.demoLogin });
    assert.equal(login.status, 200);
    const notes = (await call('GET', '/api/notes', { token: login.data.token })).data;
    assert.equal(notes.length, 3);
    assert.equal(notes.filter(n => n.owner_username === 'teammate').length, 1);
});
