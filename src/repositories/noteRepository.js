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
            const out = { ...note, id: note._id };
            if (note.user_id !== userId) {
                out.owner_username = ownerName[note.user_id] || 'unknown';
                const share = note.shared_with.find(s => s.user_id === userId);
                out.user_permission = share ? share.permission : 'read';
            }
            return out;
        });
    },

    // Returns 'ok', 'not_found' or 'forbidden'. Owners and 'write' shares may edit.
    async updateNote(id, userId, updates) {
        const note = await Note.findById(id);
        if (!note) return 'not_found';

        const isOwner = note.user_id === userId;
        const isWriter = note.shared_with.some(s => s.user_id === userId && s.permission === 'write');
        if (!isOwner && !isWriter) {
            return note.shared_with.some(s => s.user_id === userId) ? 'forbidden' : 'not_found';
        }

        await Note.updateOne({ _id: id }, { $set: updates });
        return 'ok';
    },

    // Only the owner can delete. Returns true if a note was deleted.
    async deleteNote(id, userId) {
        const result = await Note.deleteOne({ _id: id, user_id: userId });
        return result.deletedCount > 0;
    },

    // Returns false if the note does not exist or the caller is not its owner.
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
        return true;
    },

    // Called when a user is deleted: drop their notes and their access to others' notes.
    async removeUser(userId) {
        await Note.deleteMany({ user_id: userId });
        await Note.updateMany({}, { $pull: { shared_with: { user_id: userId } } });
    }
};

module.exports = NoteRepository;
