require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function initializeDatabase() {
    try {
        // Connexion à MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        logger.info('✅ Connecté à MongoDB');

        // Supprimer TOUS les index de toutes les collections
        const collections = Object.keys(mongoose.connection.collections);
        for (const collectionName of collections) {
            try {
                await mongoose.connection.collections[collectionName].dropIndexes();
            } catch (error) {
                // Ignorer les erreurs de drop index pour les nouvelles collections
                if (error.code !== 26) {
                    logger.warn(`⚠️ Warning dropping indexes for ${collectionName}:`, error.message);
                }
            }
        }
        logger.info('✅ Tous les index ont été supprimés');

        // Créer les indexes un par un
        const User = require('../models/User');
        const Category = require('../models/Category');
        const Product = require('../models/Product');
        const Order = require('../models/Order');
        const Conversation = require('../models/Conversation');

        await User.collection.createIndex({ telegramId: 1 }, { unique: true });
        await User.collection.createIndex({ username: 1 });
        await Order.collection.createIndex({ orderNumber: 1 }, { unique: true });
        await Order.collection.createIndex({ 'user.id': 1 });
        await Conversation.collection.createIndex({ orderId: 1 }, { unique: true });
        await Conversation.collection.createIndex({ channelId: 1 }, { unique: true });

        logger.info('✅ Nouveaux index créés');

        // Nettoyer la collection des catégories
        await Category.deleteMany({});

        // Créer les catégories par défaut avec descriptions et slugs
        const defaultCategories = [
            {
                name: 'Vehicules',
                description: 'Tous types de véhicules et moyens de transport',
                slug: 'vehicules',
                active: true
            },
            {
                name: 'Papiers',
                description: 'Services et documents administratifs',
                slug: 'papiers',
                active: true
            },
            {
                name: 'Tech',
                description: 'Produits et services technologiques',
                slug: 'tech',
                active: true
            },
            {
                name: 'Contact',
                description: 'Moyens de contact et support',
                slug: 'contact',
                active: true
            }
        ];

        for (const catData of defaultCategories) {
            await Category.create(catData);
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
        }

        logger.info('✅ Initialisation réussie');
        process.exit(0);
    } catch (error) {
        logger.error('❌ Erreur lors de l\'initialisation:', error);
        process.exit(1);
    }
}

initializeDatabase();