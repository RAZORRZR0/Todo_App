require('dotenv').config({ quiet: true });
require('../src/db/database');
const { User } = require('../src/db/models');
const bcrypt = require('bcrypt');

const [, , username, password] = process.argv;

if (!username || !password) {
    console.error('Usage: node create_admin.js <username> <password>');
    process.exit(1);
}

async function createAdmin() {
    try {
        console.log(`Creating admin '${username}'...`);
        const hashedPassword = await bcrypt.hash(password, 10);

        // Check if user exists
        const existing = await User.findOne({ username });
        if (existing) {
            console.log(`User '${username}' already exists. Updating credentials...`);
            existing.password_hash = hashedPassword;
            existing.role = 'admin'; // Ensure role is admin
            await existing.save();
            console.log(`Admin user '${username}' updated successfully.`);
            process.exit(0);
        }

        const admin = await User.create({
            username,
            password_hash: hashedPassword,
            role: 'admin'
        });

        console.log(`Admin user '${username}' created successfully (ID: ${admin._id}).`);
        process.exit(0);

    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

createAdmin(); // Mongoose buffers queries until connected
