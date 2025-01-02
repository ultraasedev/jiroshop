// scripts/init-db.js
require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Importer tous les modèles
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Conversation = require('../models/Conversation');

async function dropIndexes() {
    try {
        // Supprimer tous les indexes existants sauf _id
        await User.collection.dropIndexes();
        await Category.collection.dropIndexes();
        await Product.collection.dropIndexes();
        await Order.collection.dropIndexes();
        await Conversation.collection.dropIndexes();
        logger.info('✅ Indexes supprimés');
    } catch (error) {
        logger.warn('⚠️ Erreur lors de la suppression des indexes (normal pour la première exécution)');
    }
}

async function initializeDatabase() {
    try {
        // Connexion à MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            // Retirer les options dépréciées
            autoIndex: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            maxPoolSize: 50
        });
        logger.info('✅ Connecté à MongoDB');

        // Supprimer les indexes existants
        await dropIndexes();

        // Recréer les indexes
        await Promise.all([
            User.createIndexes(),
            Category.createIndexes(),
            Product.createIndexes(),
            Order.createIndexes(),
            Conversation.createIndexes()
        ]);
        logger.info('✅ Indexes recréés');

        // Créer les catégories par défaut
        const defaultCategories = ['Vehicules', 'Papiers', 'Tech', 'Contact'];
        for (const catName of defaultCategories) {
            await Category.findOneAndUpdate(
                { name: catName },
                { name: catName, active: true },
                { upsert: true, new: true }
            );
        }
        logger.info('✅ Catégories par défaut créées');

        // Créer l'admin par défaut
        if (process.env.ADMIN_ID) {
            await User.findOneAndUpdate(
                { telegramId: process.env.ADMIN_ID },
                {
                    telegramId: process.env.ADMIN_ID,
                    username: 'admin',
                    role: 'admin',
                    status: 'active'
                },
                { upsert: true, new: true }
            );
            logger.info('✅ Admin par défaut créé');
        } else {
            logger.warn('⚠️ ADMIN_ID non défini dans .env');
        }

        logger.info('✅ Initialisation terminée');
        process.exit(0);
    } catch (error) {
        logger.error('❌ Erreur lors de l\'initialisation:', error);
        process.exit(1);
    }
}

initializeDatabase();