const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
    try {
        const mongoOptions = {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            autoIndex: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            maxPoolSize: 50
        };

        // Ajouter des listeners pour les événements de connexion
        mongoose.connection.on('connected', () => {
            logger.info('MongoDB connecté');
        });

        mongoose.connection.on('error', (err) => {
            logger.error('Erreur MongoDB:', err);
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('MongoDB déconnecté');
        });

        // Se connecter à la base de données
        await mongoose.connect(process.env.MONGODB_URI, mongoOptions);

        // Activer le débogage en développement
        if (process.env.NODE_ENV === 'development') {
            mongoose.set('debug', (collectionName, method, query, doc) => {
                logger.debug(`MongoDB ${collectionName}.${method}`, {
                    query,
                    doc
                });
            });
        }

        return mongoose.connection;
    } catch (error) {
        logger.error('Erreur de connexion MongoDB:', error);
        process.exit(1);
    }
};

module.exports = connectDB;