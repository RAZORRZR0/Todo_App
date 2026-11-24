const { Note, User } = require('../db/models');

const NoteRepository = {
    async createNote(noteData) {
        const note = await Note.create(noteData);
        return { ...note.toObject(), id: note._id };
    },

    // Notes the user owns plus notes shared with them, newest first.
    async getNotes(userId) {
        const notes = await Note.find({
            $or: [{ user_id: userId }, { 'shared_with.user_id': userId }]
        }).sort({ created_at: -1 }).lean();

        const ownerIds = [...new Set(notes.filter(n => n.user_id !== userId).map(n => n.user_id))];
        const owners = await User.find({ _id: { $in: ownerIds } }, 'username').lean();
        const ownerName = Object.fromEntries(owners.map(o => [o._id.toString(), o.username]));

        return notes.map(note => {
            const out = { ...note, id: note._id, version: note.version ?? 0 };
            if (note.user_id !== userId) {
                out.owner_username = ownerName[note.user_id] || 'unknown';
                const share = note.shared_with.find(s => s.user_id === userId);
                out.user_permission = share ? share.permission : 'read';
            }
            return out;
        });
    },

    // Everyone who can see a note: the owner plus everyone it is shared with.
    audience(note) {
        return [note.user_id, ...note.shared_with.map(s => s.user_id)];
    },

    // Compare-and-set update. Owners and 'write' shares may edit.
    // Returns { status: 'ok' | 'not_found' | 'forbidden' | 'conflict', note }.
    async updateNote(id, userId, updates, version) {
        const note = await Note.findById(id).lean();
        if (!note) return { status: 'not_found' };

        const isOwner = note.user_id === userId;
        const isWriter = note.shared_with.some(s => s.user_id === userId && s.permission === 'write');
        if (!isOwner && !isWriter) {
            return { status: note.shared_with.some(s => s.user_id === userId) ? 'forbidden' : 'not_found' };
        }

        // Notes saved before versioning have no field yet; treat them as version 0.
        const versionMatch = version === 0 ? { $in: [0, null] } : version;
        const updated = await Note.findOneAndUpdate(
            { _id: id, version: versionMatch },
            { $set: updates, $inc: { version: 1 } },
            { returnDocument: 'after', lean: true }
        );
        if (!updated) return { status: 'conflict', note: { ...note, id: note._id, version: note.version ?? 0 } };
        return { status: 'ok', note: { ...updated, id: updated._id } };
    },

    // Only the owner can delete. Returns the deleted note, or null.
    async deleteNote(id, userId) {
        return Note.findOneAndDelete({ _id: id, user_id: userId }).lean();
    },

    // Returns the updated note, or false if it does not exist or the caller is not its owner.
    async shareNote(noteId, ownerId, targetUser, permission) {
        const note = await Note.findOne({ _id: noteId, user_id: ownerId });
        if (!note) return false;

        const targetId = targetUser.id.toString();
        const existing = note.shared_with.find(s => s.user_id === targetId);
        if (existing) {
            existing.permission = permission;
        } else {
            note.shared_with.push({ user_id: targetId, username: targetUser.username, permission });
        }
        await note.save();
        return note.toObject();
    },

    // Called when a user is deleted: drop their notes and their access to others' notes.
    async removeUser(userId) {
        await Note.deleteMany({ user_id: userId });
        await Note.updateMany({}, { $pull: { shared_with: { user_id: userId } } });
    }
};

module.exports = NoteRepository;
