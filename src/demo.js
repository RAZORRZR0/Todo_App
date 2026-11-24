// DEMO_MODE=true seeds a public demo login and a teammate who shares notes with it,
// so visitors can try sharing and live sync without registering.
const bcrypt = require('bcrypt');
const { User, Note } = require('./db/models');

const enabled = process.env.DEMO_MODE === 'true';
const LOGIN = { username: 'demo', password: 'demo-pass-2026' };
const TEAMMATE = { username: 'teammate', password: 'teammate-pass-2026' };

async function upsertUser({ username, password }) {
    const existing = await User.findOne({ username });
    if (existing) return existing._id.toString();
    const user = await User.create({ username, password_hash: await bcrypt.hash(password, 10) });
    return user._id.toString();
}

// Idempotent: only adds the sample notes the first time.
// shortcut: visitors can edit the demo data freely; add a nightly reset if it gets messy.
async function seed() {
    if (!enabled) return;
    const demoId = await upsertUser(LOGIN);
    const mateId = await upsertUser(TEAMMATE);
    if (await Note.exists({ user_id: demoId })) return;

    const item = (text, is_done = false) => ({ text, is_done, images: [] });
    await Note.create([
        { user_id: demoId, title: 'Release checklist', items: [item('Run tests'), item('Update changelog'), item('Tag v1.0'), item('Write notes', true)] },
        { user_id: demoId, title: 'Groceries', items: [item('Milk'), item('Eggs'), item('Spinach'), item('Bread', true)] },
        {
            user_id: mateId, title: 'Team offsite', items: [item('Book venue'), item('Collect dietary needs'), item('Send agenda', true)],
            shared_with: [{ user_id: demoId, username: LOGIN.username, permission: 'write' }]
        },
    ]);
    console.log('Demo data seeded.');
}

module.exports = { enabled, LOGIN, TEAMMATE, seed };
