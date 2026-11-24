// API tests. Needs a MongoDB server: MONGO_URL (default mongodb://127.0.0.1:27017).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const base = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
process.env.MONGO_URI = `${base}/notes_test_${process.pid}`;
process.env.JWT_SECRET = 'test-secret';

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const app = require('../server');
const { User } = require('../src/db/models');

const PASSWORD = 'correct-horse-1';
let server, url;

async function call(method, path, { token, body, form } = {}) {
    const headers = {};
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
    server = app.listen(0);
    url = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
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

    const upd = await call('PUT', `/api/notes/${id}`, { token: t, body: { title: 'Groceries', items: [{ text: 'milk', is_done: true }] } });
    assert.equal(upd.status, 200);
    // Saving the same content again is not a 404.
    assert.equal((await call('PUT', `/api/notes/${id}`, { token: t, body: { title: 'Groceries', items: [{ text: 'milk', is_done: true }] } })).status, 200);

    const notes = (await call('GET', '/api/notes', { token: t })).data;
    assert.equal(notes.length, 1);
    assert.equal(notes[0].items[0].is_done, true);

    assert.equal((await call('PUT', '/api/notes/not-an-id', { token: t, body: { title: 'x' } })).status, 404);
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

    const edit = { title: 'Plan', items: [{ text: 'changed' }] };
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
    assert.match(r.data.url, /^\/uploads\/[\d-]+\.png$/); // extension from the type, not the client's name
    require('fs').rmSync(require('path').join(__dirname, '..', 'public', r.data.url));

    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await call('POST', '/api/upload', { form: ok })).status, 401);
});
