require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const mongoose = require('mongoose');
const logger = require('./utils/logger');
const connectDB = require('./config/database');

// Controllers
const BotController = require('./controllers/BotController');
const AdminController = require('./controllers/adminController');
const PaymentController = require('./controllers/PaymentController');
const OrderController = require('./controllers/OrderController');

// Middlewares
const errorHandler = require('./middlewares/errorHandler');
const rateLimiter = require('./middlewares/rateLimiter');
const sessionHandler = require('./middlewares/sessionHandler');
const securityMiddleware = require('./middlewares/securityMiddleware');

class TelegramShopBot {
    constructor() {
        this.bot = new Telegraf(process.env.BOT_TOKEN);
        this.initializeBot();
    }

    async initializeBot() {
        try {
            // Connexion à la base de données
            await connectDB();
            logger.info('Base de données connectée');

            // Configuration des middlewares
            this.setupMiddlewares();

            // Initialisation des contrôleurs
            this.setupControllers();

            // Gestion des erreurs globale
            this.setupErrorHandling();

            // Démarrage du bot
            await this.startBot();

            logger.info('Bot démarré avec succès');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation du bot:', error);
            process.exit(1);
        }
    }

    setupMiddlewares() {
        // Session middleware
        this.bot.use(session());
        this.bot.use(sessionHandler);

        // Rate limiting
        this.bot.use(rateLimiter);

        // Sécurité
        this.bot.use(securityMiddleware);

        logger.info('Middlewares configurés');
    }

    setupControllers() {
        // Initialiser les contrôleurs
        this.botController = new BotController(this.bot);
        this.adminController = new AdminController(this.bot);
        this.paymentController = new PaymentController(this.bot);
        this.orderController = new OrderController(this.bot);

        // Démarrer les tâches périodiques
        this.orderController.startPeriodicTasks();

        logger.info('Contrôleurs initialisés');
    }

    setupErrorHandling() {
        // Middleware de gestion des erreurs
        this.bot.use(errorHandler);

        // Gestion des erreurs non capturées
        process.on('uncaughtException', (error) => {
            logger.error('Erreur non capturée:', error);
        });

        process.on('unhandledRejection', (error) => {
            logger.error('Promesse rejetée non gérée:', error);
        });

        logger.info('Gestion des erreurs configurée');
    }

    async startBot() {
        // Configurer le webhook en production
        if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_URL) {
            await this.bot.telegram.setWebhook(process.env.WEBHOOK_URL);
            logger.info('Webhook configuré:', process.env.WEBHOOK_URL);
        } else {
            // Utiliser le long polling en développement
            await this.bot.launch();
            logger.info('Bot démarré en mode long polling');
        }

        // Gestion de l'arrêt gracieux
        this.setupGracefulShutdown();
    }

    setupGracefulShutdown() {
        // Gestion de l'arrêt gracieux
        const gracefulShutdown = async (signal) => {
            logger.info(`Signal ${signal} reçu. Arrêt gracieux...`);
            
            try {
                // Arrêter le bot
                await this.bot.stop(signal);
                logger.info('Bot arrêté');

                // Fermer la connexion à MongoDB
                await mongoose.connection.close();
                logger.info('Connexion MongoDB fermée');

                // Sortir proprement
                process.exit(0);
            } catch (error) {
                logger.error('Erreur lors de l\'arrêt:', error);
                process.exit(1);
            }
        };

        // Écouter les signaux d'arrêt
        process.once('SIGINT', () => gracefulShutdown('SIGINT'));
        process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

        logger.info('Gestionnaire d\'arrêt gracieux configuré');
    }
}

// Créer et démarrer le bot
const bot = new TelegramShopBot();

// Exporter l'instance pour les tests
module.exports = bot;