const { User } = require('../db/models');

// Public shape of a user: never includes the password hash.
const toPublic = (u) => ({ id: u._id.toString(), username: u.username, role: u.role, created_at: u.created_at });

const UserRepository = {
    async createUser(username, passwordHash, role = 'user') {
        const user = await User.create({ username, password_hash: passwordHash, role });
        return toPublic(user);
    },

    // Includes password_hash, for login only.
    async findUserByUsername(username) {
        const user = await User.findOne({ username: String(username) });
        return user ? { ...toPublic(user), password_hash: user.password_hash } : null;
    },

    async getAllUsers() {
        const users = await User.find().sort({ created_at: -1 });
        return users.map(toPublic);
    },

    async findById(id) {
        const user = await User.findById(id);
        return user ? toPublic(user) : null;
    },

    async deleteUser(id) {
        const result = await User.deleteOne({ _id: id });
        return result.deletedCount > 0;
    }
};

module.exports = UserRepository;
