// Input checks for request bodies. Each returns { value } or { error }.

const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/;
const LIMITS = { title: 200, itemText: 1000, items: 200, images: 10 };

function credentials(body) {
    const { username, password } = body || {};
    if (typeof username !== 'string' || !USERNAME.test(username)) {
        return { error: 'Username must be 3-32 letters, digits, _ . or -' };
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return { error: 'Password must be 8-128 characters' };
    }
    return { value: { username, password } };
}

// Builds a clean note update from untrusted input; only known fields survive.
function note(body) {
    const { title = '', items = [], is_done } = body || {};
    if (typeof title !== 'string' || title.length > LIMITS.title) {
        return { error: `Title must be text up to ${LIMITS.title} characters` };
    }
    if (!Array.isArray(items) || items.length > LIMITS.items) {
        return { error: `A note can have up to ${LIMITS.items} items` };
    }
    const clean = [];
    for (const it of items) {
        if (!it || typeof it.text !== 'string' || !it.text.trim() || it.text.length > LIMITS.itemText) {
            return { error: `Each item needs text up to ${LIMITS.itemText} characters` };
        }
        const images = it.images ?? [];
        if (!Array.isArray(images) || images.length > LIMITS.images ||
            !images.every(u => typeof u === 'string' && UPLOAD_URL.test(u))) {
            return { error: 'Item images must be files uploaded to this app' };
        }
        clean.push({ text: it.text.trim(), is_done: it.is_done === true, images });
    }
    const value = { title: title.trim(), items: clean, content: clean.map(i => i.text).join('\n') };
    if (typeof is_done === 'boolean') value.is_done = is_done;
    return { value };
}

module.exports = { credentials, note, USERNAME };
