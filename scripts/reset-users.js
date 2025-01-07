// Créez un fichier reset-users.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function resetUsers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        
        // Supprimer tous les utilisateurs sauf les admins
        await User.deleteMany({ role: 'user' });
        
        // Réinitialiser les compteurs de sécurité
        await User.updateMany({}, {
            $set: {
                'security.loginAttempts': 0,
                'security.lastLoginAttempt': null,
                status: 'active'
            }
        });

        console.log('Base utilisateurs réinitialisée');
        process.exit(0);
    } catch (error) {
        console.error('Erreur:', error);
        process.exit(1);
    }
}

resetUsers();