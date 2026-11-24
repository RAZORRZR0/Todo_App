
// Page Transition
document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.remove('opacity-0');
});

// Intercept About Link
document.querySelector('a[href="/about.html"]').addEventListener('click', (e) => {
    e.preventDefault();
    document.body.classList.add('opacity-0');
    setTimeout(() => {
        window.location.href = '/about.html';
    }, 100);
});

const API_URL = '/api';
let token = localStorage.getItem('token');
let allNotes = []; // Store fetched notes for edit access
let editingNoteId = null; // ID of note currently being edited
let isLoginMode = true; // State for Auth Modal

let isNoteReadOnly = false; // Modal is in view mode
let currentListItems = []; // Items being edited in the modal

// Escape text before putting it into innerHTML (titles, items and usernames are user input).
function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Guest notes live in this browser only.
let localNotes = [];
try { localNotes = JSON.parse(localStorage.getItem('guestNotes')) || []; } catch { localNotes = []; }
function saveGuestNotes() {
    try { localStorage.setItem('guestNotes', JSON.stringify(localNotes)); } catch { /* storage full or blocked */ }
}

// --- Auth & State Management ---
// Determines if user is authenticated or guest.
// Handles "Optimistic UI" updates for smoother experience.

async function checkAuth() {
    if (token) {
        // Optimistic UI: Show App immediately to authenticated user
        showApp(true);

        // Restore Admin UI state
        const role = localStorage.getItem('role');
        if (role === 'admin') {
            document.getElementById('admin-btn').classList.remove('hidden');
            document.getElementById('mobile-admin-btn').classList.remove('hidden');
        }

        fetchNotes();
    } else {
        // Guest Mode: Show app with local data
        showApp(false);
        renderNotes(localNotes);
    }

}

async function login() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const errEl = document.getElementById('auth-error');

    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();

        if (res.ok) {
            token = data.token;
            localStorage.setItem('token', token);
            localStorage.setItem('username', data.username);
            localStorage.setItem('role', data.role); // Persist role

            // Check role
            if (data.role === 'admin') {
                document.getElementById('admin-btn').classList.remove('hidden');
                document.getElementById('mobile-admin-btn').classList.remove('hidden');
            } else {
                document.getElementById('admin-btn').classList.add('hidden');
                document.getElementById('mobile-admin-btn').classList.add('hidden');
            }

            showApp(true);
            fetchNotes();
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            errEl.classList.add('hidden');
        } else {
            errEl.innerText = data.error;
            errEl.classList.remove('hidden');
        }
    } catch (e) {
        errEl.innerText = 'Connection error';
        errEl.classList.remove('hidden');
    }
}

async function register() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const errEl = document.getElementById('auth-error');

    try {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();

        if (res.ok) {
            // Auto login after register
            login();
        } else {
            errEl.innerText = data.error;
            errEl.classList.remove('hidden');
        }
    } catch (e) {
        errEl.innerText = 'Connection error';
        errEl.classList.remove('hidden');
    }
}

function logout() {
    token = null;
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');

    // Reset Admin Panel State
    adminPanelVisible = false;
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('user-list').innerHTML = '';

    // Reset to Guest Mode
    showApp(false);
    renderNotes(localNotes);
}

function cancelLogin() {
    document.getElementById('auth-screen').classList.add('hidden');
    const app = document.getElementById('app-screen');
    app.classList.remove('hidden');
    app.classList.remove('opacity-0');
}


// --- Auth Mode Toggle ---

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    updateAuthUI();
}

function updateAuthUI() {
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleBtn = document.getElementById('auth-toggle-btn');
    const errorMsg = document.getElementById('auth-error');

    errorMsg.classList.add('hidden'); // Clear errors on toggle

    if (isLoginMode) {
        title.textContent = 'Welcome';
        subtitle.textContent = 'Sign in to continue';
        submitBtn.textContent = 'Log In';
        toggleBtn.textContent = 'Create an account';
    } else {
        title.textContent = 'Create Account';
        subtitle.textContent = 'Join us today';
        submitBtn.textContent = 'Sign Up';
        toggleBtn.textContent = 'Already have an account? Log In';
    }
}

function handleAuthSubmit() {
    if (isLoginMode) {
        login();
    } else {
        register();
    }
}

function showAuth(mode = 'login') {
    const app = document.getElementById('app-screen');
    app.classList.add('hidden', 'opacity-0');
    document.getElementById('auth-screen').classList.remove('hidden');

    // Set mode
    isLoginMode = (mode === 'login');
    updateAuthUI();
}

// --- UI State Management ---

function showApp(isAuthenticated) {
    document.getElementById('auth-screen').classList.add('hidden');
    const app = document.getElementById('app-screen');
    app.classList.remove('hidden');
    // Trigger reflow for transition
    void app.offsetWidth;
    app.classList.remove('opacity-0');

    if (isAuthenticated) {
        const username = localStorage.getItem('username');
        if (username) {
            // Update Desktop
            const display = document.getElementById('user-display');
            display.textContent = `Hi, ${username}`;
            display.classList.remove('hidden');

            // Update Mobile Header Display
            const mobileDisplay = document.getElementById('mobile-header-user-display');
            mobileDisplay.textContent = `Hi, ${username}`;
            mobileDisplay.classList.remove('hidden');
        }
        // Desktop
        document.getElementById('login-btn').classList.add('hidden');
        document.getElementById('logout-btn').classList.remove('hidden');

        // Mobile
        document.getElementById('mobile-login-btn').classList.add('hidden');
        document.getElementById('mobile-logout-btn').classList.remove('hidden');

    } else {
        // Desktop
        document.getElementById('user-display').classList.add('hidden');
        document.getElementById('login-btn').classList.remove('hidden');
        document.getElementById('logout-btn').classList.add('hidden');
        document.getElementById('admin-btn').classList.add('hidden');

        // Mobile
        document.getElementById('mobile-header-user-display').classList.add('hidden');
        document.getElementById('mobile-login-btn').classList.remove('hidden');
        document.getElementById('mobile-logout-btn').classList.add('hidden');
        document.getElementById('mobile-admin-btn').classList.add('hidden');
    }
}

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    menu.classList.toggle('hidden');
}

// --- Notes Logic ---
// Handles CRUD operations for notes.
// Syncs with backend if logged in, uses local state if guest.


async function fetchNotes() {
    try {
        const res = await fetch(`${API_URL}/notes`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 401 || res.status === 403) {
            return logout();
        }

        if (res.ok) {
            allNotes = await res.json();
            renderNotes(allNotes);
        }
    } catch (error) {
        console.error("Failed to fetch notes", error);
    }
}

function renderNotes(notes) {
    if (!token) {
        allNotes = notes;
        saveGuestNotes();
    }

    const grid = document.getElementById('notes-grid');
    const empty = document.getElementById('empty-state');
    grid.innerHTML = '';

    if (notes.length === 0) {
        empty.classList.remove('hidden');
    } else {
        empty.classList.add('hidden');
        notes.forEach(note => {
            const card = document.createElement('div');
            // Changed min-h-[180px] to min-h-0 or a smaller value like min-h-[140px]
            // Removing flex-col stretch behavior by letting height be auto
            card.className = `note-card bg-white p-5 rounded-[20px] border border-gray-100 flex flex-col relative group cursor-default transition-all min-h-[140px]`;

            // Migrate content to items if needed (Frontend Migration)
            // Fix: Assign to note.items to ensure persistence in memory for toggleItem
            if ((!note.items || note.items.length === 0) && note.content) {
                note.items = note.content.split('\n').filter(t => t.trim()).map(text => ({ text, is_done: false }));
            }
            const items = note.items || [];

            // Separation of Checked/Unchecked
            const uncheckedItems = items.filter(i => !i.is_done);
            const checkedItems = items.filter(i => i.is_done);

            // Re-calculate indices safely? 
            // To ensure `toggleItemCompletion` works, we need the exact index in `note.items`.
            // Let's pass the index of the item within the original `items` array.
            // Map items to include original index before filtering.
            const mappedItems = items.map((it, idx) => ({ ...it, originalIdx: idx }));
            const uItems = mappedItems.filter(i => !i.is_done);
            const cItems = mappedItems.filter(i => i.is_done);

            const renderListHtml = (list) => {
                return list.map(item => `
                            <!-- Removed mb-2, relying on gap/space-y in container -->
                            <div class="flex flex-col mb-1 group/item">
                                <div class="flex items-start gap-3">
                                     <div class="relative flex items-center justify-center w-5 h-5 mt-0.5 flex-shrink-0">
                                        <input type="checkbox" 
                                            ${item.is_done ? 'checked' : ''} 
                                            onclick="toggleItem('${note.id}', ${item.originalIdx}, event)" 
                                            class="peer appearance-none w-5 h-5 border-2 border-gray-300 rounded-md cursor-pointer checked:bg-primary checked:border-primary transition-all">
                                        <svg class="w-3.5 h-3.5 text-white absolute opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
                                    </div>
                                    <span class="text-[15px] flex-1 leading-snug ${item.is_done ? 'line-through text-gray-400 decoration-gray-300' : 'text-gray-700'} break-words transition-colors duration-200">
                                        ${esc(item.text)}
                                    </span>
                                </div>
                                ${item.images && item.images.length > 0 ? `
                                    <div class="flex flex-wrap gap-2 pl-8 mt-1.5">
                                        ${item.images.map(url => `
                                            <div class="relative group/img overflow-hidden rounded-lg">
                                                <img src="${esc(url)}" 
                                                    onclick="event.stopPropagation(); openImageViewer(this.src)" 
                                                    class="w-16 h-16 object-cover border border-gray-100 hover:scale-105 transition-transform cursor-pointer bg-gray-50">
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                         `).join('');
            };




            card.innerHTML = `
                        <!-- Shared Badge -->
                        ${note.owner_username ? `
                            <div class="mb-3">
                                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-100 text-xs font-medium text-gray-600 border border-gray-200">
                                    <svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                                    Shared by <span class="text-gray-900 font-semibold">${esc(note.owner_username)}</span>
                                    <span class="w-1 h-1 rounded-full bg-gray-400"></span>
                                    <span class="uppercase tracking-wider text-[10px]">${esc(note.user_permission)}</span>
                                </span>
                            </div>
                        ` : ''}

                        <!-- Title/Header -->
                        <div class="flex justify-between items-start mb-3 gap-2 click-target" onclick="openModal('${note.id}', 'view')">
                            <h3 class="font-medium text-lg text-gray-800 leading-tight ${!note.title ? 'text-gray-400 italic' : ''}">
                                ${esc(note.title || 'Untitled')}
                            </h3>
                            ${note.is_done ? '<span class="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full flex-shrink-0">Done</span>' : ''}
                        </div>

                        <!-- List Items Preview -->
                        <div class="space-y-3 mb-4 click-target" onclick="openModal('${note.id}', 'view')">
                            ${uItems.length > 0 ? `
                                <div class="space-y-0.5">
                                    ${renderListHtml(uItems.slice(0, 3))}
                                    ${uItems.length > 3 ? `<div class="text-xs text-gray-400 pl-8 mt-1">+ ${uItems.length - 3} more items</div>` : ''}
                                </div>
                            ` : ''}
                            
                            ${cItems.length > 0 ? `
                                <div class="pt-2 border-t border-gray-100">
                                     <div class="text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Completed</div>
                                     <div class="space-y-0.5 opacity-60">
                                        ${renderListHtml(cItems.slice(0, 2))}
                                        ${cItems.length > 2 ? `<div class="text-xs text-gray-400 pl-8">+ ${cItems.length - 2} more</div>` : ''}
                                     </div>
                                </div>
                            ` : ''}

                            ${items.length === 0 ? '<p class="text-gray-400 text-sm italic">Empty note</p>' : ''}
                        </div>

                        <!-- Footer Actions (Hide if Read Only) -->
                        ${note.user_permission !== 'read' ? `
                        <div class="flex justify-between items-center pt-3 border-t border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity mt-2">
                            <span class="text-xs text-gray-400">${new Date(note.created_at).toLocaleDateString()}</span>
                            <div class="flex gap-2">
                                <button onclick="openShareModal('${note.id}')" class="p-2 text-gray-400 hover:text-primary hover:bg-primary/5 rounded-full transition-colors" title="Share Note">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
                                </button>
                                <button onclick="openModal('${note.id}')" class="p-2 text-gray-400 hover:text-primary hover:bg-primary/5 rounded-full transition-colors" title="Edit Note">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                </button>
                                <button onclick="deleteNote('${note.id}', event)" class="p-2 text-gray-400 hover:text-error hover:bg-error/5 rounded-full transition-colors" title="Delete">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                </button>
                            </div>
                        </div>
                        ` : '<div class="mt-auto pt-3"></div>'}
                    `;
            grid.appendChild(card);
        });
    }
}

// --- List Editor UI Logic ---

let activeUploadItemIdx = null; // Track which item is receiving an upload

function renderListEditor() {
    const container = document.getElementById('list-editor');
    container.innerHTML = '';

    currentListItems.forEach((item, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col gap-2 mb-2 p-2 bg-gray-50 rounded-lg group';

        // Item Header
        const header = document.createElement('div');
        header.className = 'flex items-center gap-2';

        // Use real checkbox if in modal
        const checkbox = document.createElement('div');
        checkbox.className = 'relative flex items-center justify-center w-5 h-5 flex-shrink-0';
        checkbox.innerHTML = `
            <input type="checkbox" 
                ${item.is_done ? 'checked' : ''} 
                onchange="toggleModalItem(${idx})"
                class="peer appearance-none w-5 h-5 border-2 border-gray-300 rounded-md cursor-pointer checked:bg-primary checked:border-primary transition-all">
            <svg class="w-3.5 h-3.5 text-white absolute opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
        `;

        header.appendChild(checkbox);
        header.innerHTML += `<span class="flex-1 text-gray-700 ${item.is_done ? 'line-through text-gray-400' : ''} break-all">${esc(item.text)}</span>`;

        // Actions (Hide if Read Only)
        if (!isNoteReadOnly) {
            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-1';
            actions.innerHTML = `
                        <button onclick="triggerUpload(${idx})" class="p-1 px-2 text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition-colors text-xs font-medium" title="Add Image">
                            + Image
                        </button>
                        <button onclick="removeListItem(${idx})" class="p-1 text-gray-400 hover:text-error transition-colors" title="Remove Item">×</button>
                    `;
            header.appendChild(actions);
        }

        wrapper.appendChild(header);

        // Thumbnails
        if (item.images && item.images.length > 0) {
            const thumbContainer = document.createElement('div');
            thumbContainer.className = 'flex flex-wrap gap-2 pl-6';
            item.images.forEach(imgUrl => {
                const img = document.createElement('img');
                img.src = imgUrl;
                img.className = 'w-12 h-12 object-cover rounded-lg border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity';
                img.onclick = () => openImageViewer(imgUrl);
                thumbContainer.appendChild(img);
            });
            wrapper.appendChild(thumbContainer);
        }

        container.appendChild(wrapper);
    });
}

function triggerUpload(idx) {
    activeUploadItemIdx = idx;
    document.getElementById('hidden-file-input').click();
}

// Initialize file input listener
document.getElementById('hidden-file-input').addEventListener('change', async (e) => {
    if (activeUploadItemIdx === null || !e.target.files.length) return;
    if (!token) {
        e.target.value = '';
        return openAlertModal('Log in to attach images. Guest notes are stored only in this browser.', 'Login needed');
    }

    const files = Array.from(e.target.files);
    const item = currentListItems[activeUploadItemIdx];
    if (!item.images) item.images = [];

    // Upload each file
    for (const file of files) {
        const formData = new FormData();
        formData.append('image', file);

        try {
            const res = await fetch(`${API_URL}/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                item.images.push(data.url);
            } else {
                const errData = await res.json().catch(() => ({}));
                console.error('Upload failed', res.status, errData);
                openAlertModal(`Failed to upload image: ${errData.error || res.statusText}`, 'Upload Failed');
            }
        } catch (err) {
            console.error('Upload error', err);
            openAlertModal(`Error uploading image: ${err.message}`, 'Upload Failed');
        }
    }

    renderListEditor();
    e.target.value = ''; // Reset input
    activeUploadItemIdx = null;
});

// --- Image Viewer Logic ---
function openImageViewer(url) {
    const modal = document.getElementById('image-viewer-modal');
    const img = document.getElementById('full-image');
    img.src = url;
    modal.classList.remove('hidden');
    // Animate in
    requestAnimationFrame(() => {
        img.classList.remove('scale-95', 'opacity-0');
        img.classList.add('scale-100', 'opacity-100');
    });
}

function closeImageViewer() {
    const modal = document.getElementById('image-viewer-modal');
    const img = document.getElementById('full-image');
    img.classList.remove('scale-100', 'opacity-100');
    img.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        img.src = '';
    }, 300);
}


function handleAddItem(e) {
    if (e.key === 'Enter') {
        addItemFromInput();
    }
}

function addItemFromInput() {
    const input = document.getElementById('new-item-input');
    const text = input.value.trim();
    if (text) {
        currentListItems.push({ text, is_done: false, images: [] });
        input.value = '';
        renderListEditor();
    }
}

function removeListItem(idx) {
    currentListItems.splice(idx, 1);
    renderListEditor();
}

// --- Toggle Logic ---

async function toggleItem(noteId, itemOriginalIdx, event) {
    if (event) event.stopPropagation();

    const note = token ? allNotes.find(n => n.id === noteId) : localNotes.find(n => n.id === noteId);
    if (!note) return;

    // Ensure items exist
    if (!note.items) note.items = [];

    // Toggle status of specific item
    if (note.items[itemOriginalIdx]) {
        const wasDone = note.items[itemOriginalIdx].is_done;
        note.items[itemOriginalIdx].is_done = !wasDone;

        // If using token, we need to Optimistically Update then Sync
        if (token) {
            renderNotes(allNotes); // Immediate visual feedback

            await syncNote(note);
        } else {
            renderNotes(localNotes);
        }
    }
}

// --- Confirmation Modal Logic ---

let confirmAction = null;

function openConfirmationModal(title, message, action) {
    const modal = document.getElementById('confirmation-modal');
    const content = document.getElementById('confirmation-modal-content');

    document.getElementById('confirmation-title').textContent = title;
    document.getElementById('confirmation-message').textContent = message;

    confirmAction = action;

    const confirmBtn = document.getElementById('confirm-btn');
    confirmBtn.onclick = () => {
        if (confirmAction) confirmAction();
        closeConfirmationModal();
    };

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });
}

function closeConfirmationModal() {
    const modal = document.getElementById('confirmation-modal');
    const content = document.getElementById('confirmation-modal-content');

    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.add('hidden');
        confirmAction = null;
    }, 200);
}

async function deleteNote(id, event) {
    if (event) event.stopPropagation();

    openConfirmationModal(
        'Delete Note?',
        'Are you sure you want to delete this note? This action cannot be undone.',
        async () => {
            if (token) {
                const res = await fetch(`${API_URL}/notes/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) openAlertModal('Only the owner can delete this note.', 'Not deleted');
                fetchNotes();
            } else {
                localNotes = localNotes.filter(n => n.id !== id);
                renderNotes(localNotes);
            }

            // If deleting from within a modal (View/Edit mode), close it too
            if (editingNoteId === id) {
                closeModal();
            }
        }
    );
}

// --- Alert Modal Logic ---

function openAlertModal(message, title = 'Notice') {
    const modal = document.getElementById('alert-modal');
    const content = document.getElementById('alert-modal-content');

    document.getElementById('alert-title').textContent = title;
    document.getElementById('alert-message').textContent = message;

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });
}

function closeAlertModal() {
    const modal = document.getElementById('alert-modal');
    const content = document.getElementById('alert-modal-content');

    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.add('hidden');
    }, 200);
}

// --- Admin Logic ---

let adminPanelVisible = false;

function toggleAdminPanel() {
    adminPanelVisible = !adminPanelVisible;
    const panel = document.getElementById('admin-panel');
    if (adminPanelVisible) {
        panel.classList.remove('hidden');
        fetchUsers();
    } else {
        panel.classList.add('hidden');
    }
}

// --- Sharing Logic ---
let shareNoteId = null;

async function openShareModal(noteId) {
    shareNoteId = noteId;
    const modal = document.getElementById('share-modal');
    const content = document.getElementById('share-modal-content');
    const select = document.getElementById('share-username');

    // Show modal immediately
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });

    // Fetch users
    select.innerHTML = '<option value="" disabled selected>Loading users...</option>';
    try {
        const res = await fetch(`${API_URL}/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const users = await res.json();
            if (users.length === 0) {
                select.innerHTML = '<option value="" disabled>No other users found</option>';
            } else {
                select.innerHTML = '<option value="" disabled selected>Select a user</option>' +
                    users.map(u => `<option value="${esc(u.username)}">${esc(u.username)}</option>`).join('');
            }
        } else {
            select.innerHTML = '<option value="" disabled>Failed to load users</option>';
        }
    } catch (err) {
        console.error(err);
        select.innerHTML = '<option value="" disabled>Connection error</option>';
    }
}

function closeShareModal() {
    const modal = document.getElementById('share-modal');
    const content = document.getElementById('share-modal-content');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        document.getElementById('share-username').value = '';
        shareNoteId = null;
    }, 200);
}

async function submitShare() {
    const username = document.getElementById('share-username').value.trim();
    const permission = document.querySelector('input[name="permission"]:checked').value;

    if (!username) return openAlertModal('Please enter a username', 'Wait a sec');

    try {
        const res = await fetch(`${API_URL}/notes/${shareNoteId}/share`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ username, permission })
        });

        const data = await res.json();
        if (res.ok) {
            closeShareModal();
            openAlertModal('Note shared successfully!', 'Success');
            fetchNotes();
        } else {
            openAlertModal(data.error || 'Failed to share note', 'Error');
        }
    } catch (err) {
        console.error(err);
        openAlertModal('Failed to share note. Please try again.', 'Connection Error');
    }
}

// --- End Sharing Logic ---

async function fetchUsers() {
    const res = await fetch(`${API_URL}/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        const users = await res.json();
        renderUsers(users);
    }
}

function renderUsers(users) {
    const list = document.getElementById('user-list');
    list.innerHTML = '';

    users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-xl';
        div.innerHTML = `
                    <div class="flex flex-col">
                        <span class="font-medium text-gray-800">${esc(u.username)} <span class="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full ml-2">${esc(u.role)}</span></span>
                        <span class="text-xs text-gray-500">Joined: ${new Date(u.created_at).toLocaleDateString()}</span>
                    </div>
                    ${u.role !== 'admin' ? `
                    <button onclick="deleteUser('${u.id}')" class="text-error hover:bg-error/10 px-3 py-1 rounded-full text-sm font-medium transition-colors">
                        Delete
                    </button>
                    ` : ''}
                `;
        list.appendChild(div);
    });
}

function deleteUser(id) {
    openConfirmationModal('Delete user?', 'This deletes the user and all of their notes. This cannot be undone.', async () => {
        const res = await fetch(`${API_URL}/admin/users/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) return fetchUsers();
        const data = await res.json().catch(() => ({}));
        openAlertModal(data.error || 'Failed to delete user', 'Error');
    });
}

// --- Modal Logic ---

let currentModalMode = 'view'; // 'view' or 'edit'

function openModal(noteId = null, mode = 'view') { // mode: 'view' | 'edit' | boolean (legacy readOnly)
    editingNoteId = noteId;

    // Handle legacy boolean arg if passed
    if (typeof mode === 'boolean') mode = mode ? 'view' : 'edit';
    currentModalMode = mode;
    isNoteReadOnly = (mode === 'view'); // Generally view mode is "read only" for title/structure

    const modal = document.getElementById('note-modal');
    const modalContent = document.getElementById('modal-content');

    // UI Elements
    const titleInput = document.getElementById('note-title');
    const addItemForm = document.getElementById('add-item-form');
    const footerEdit = document.getElementById('modal-footer-edit');
    const footerView = document.getElementById('modal-footer-view');
    const modalDate = document.getElementById('modal-date');

    // Reset Input
    titleInput.value = '';
    document.getElementById('new-item-input').value = '';

    if (noteId) {
        // Fetch Data
        const note = token ? allNotes.find(n => n.id === noteId) : localNotes.find(n => n.id === noteId);
        if (note) {
            titleInput.value = note.title || '';
            currentListItems = JSON.parse(JSON.stringify(note.items || []));
            // Migration fallback
            if (currentListItems.length === 0 && note.content) {
                currentListItems = note.content.split('\n').filter(t => t.trim()).map(text => ({ text, is_done: false }));
            }
            if (modalDate) modalDate.innerText = new Date(note.created_at).toLocaleDateString();
        }
    } else {
        // New Note -> Always Edit
        currentModalMode = 'edit';
        isNoteReadOnly = false;
        currentListItems = [];
        document.getElementById('modal-title').innerText = 'New Note';
        if (modalDate) modalDate.innerText = new Date().toLocaleDateString();
    }

    // Apply Mode Styles
    if (currentModalMode === 'view') {
        document.getElementById('modal-title').innerText = 'View Note';
        titleInput.disabled = true;
        titleInput.classList.add('bg-transparent');
        addItemForm.classList.add('hidden');
        footerEdit.classList.add('hidden');
        footerView.classList.remove('hidden');
    } else {
        document.getElementById('modal-title').innerText = noteId ? 'Edit Note' : 'New Note';
        titleInput.disabled = false;
        titleInput.classList.remove('bg-transparent');
        addItemForm.classList.remove('hidden');
        footerEdit.classList.remove('hidden');
        footerView.classList.add('hidden');
    }

    renderListEditor();

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modalContent.classList.remove('scale-95', 'opacity-0');
        modalContent.classList.add('scale-100', 'opacity-100');
    });
}

function switchToEditMode() {
    openModal(editingNoteId, 'edit');
}

function triggerShareFromModal() {
    if (editingNoteId) {
        // close modal first? or stack?
        // Sharing modal is stacked on top usually.
        openShareModal(editingNoteId);
    }
}

function triggerDeleteFromModal() {
    if (editingNoteId) {
        // Reuse the same deleteNote function which now handles the modal
        deleteNote(editingNoteId);
    }
}

async function toggleModalItem(idx) {
    if (!currentListItems[idx]) return;

    // Toggle state
    currentListItems[idx].is_done = !currentListItems[idx].is_done;

    // Re-render immediately to show check state
    renderListEditor();

    // If in View Mode, auto-save the change
    if (currentModalMode === 'view' && editingNoteId) {
        // Sync with main list (silent)
        if (token) {
            const note = allNotes.find(n => n.id === editingNoteId);
            if (note) {
                note.items = JSON.parse(JSON.stringify(currentListItems));
                renderNotes(allNotes);
                await syncNote(note);
            }
        } else {
            const noteIdx = localNotes.findIndex(n => n.id === editingNoteId);
            if (noteIdx !== -1) {
                localNotes[noteIdx].items = currentListItems;
                renderNotes(localNotes);
            }
        }
    }
}

function closeModal() {
    const modal = document.getElementById('note-modal');
    const content = document.getElementById('modal-content');

    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.add('hidden');
        editingNoteId = null;
        currentListItems = [];
        isNoteReadOnly = false; // Reset read-only state
    }, 200);
}

async function saveNote() {
    if (isNoteReadOnly) return closeModal();

    const title = document.getElementById('note-title').value;
    const content = currentListItems.map(i => i.text).join('\n');
    const items = currentListItems;

    if (!title && items.length === 0) return closeModal();

    if (token) {
        try {
            const res = await fetch(editingNoteId ? `${API_URL}/notes/${editingNoteId}` : `${API_URL}/notes`, {
                method: editingNoteId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ title, items })
            });
            if (res.status === 401) return logout();
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                return openAlertModal(data.error || 'Failed to save note.', 'Not saved');
            }
            fetchNotes();
        } catch (err) {
            return openAlertModal('Connection error. Your note was not saved.', 'Not saved');
        }
    } else {
        if (editingNoteId) {
            const idx = localNotes.findIndex(n => n.id === editingNoteId);
            if (idx !== -1) localNotes[idx] = { ...localNotes[idx], title, content, items };
        } else {
            localNotes.unshift({
                id: Date.now().toString(),
                title,
                content,
                items,
                is_done: false,
                created_at: new Date().toISOString()
            });
        }
        renderNotes(localNotes);
    }
    closeModal();
}

// Sends a note's items to the server; on failure reloads the server copy so the UI does not lie.
async function syncNote(note) {
    try {
        const res = await fetch(`${API_URL}/notes/${note.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ title: note.title, items: note.items, is_done: note.is_done })
        });
        if (res.ok) return true;
        const data = await res.json().catch(() => ({}));
        openAlertModal(data.error || 'Change not saved.', 'Not saved');
    } catch (err) {
        openAlertModal('Connection error. Change not saved.', 'Not saved');
    }
    fetchNotes();
    return false;
}

// Init
checkAuth();
