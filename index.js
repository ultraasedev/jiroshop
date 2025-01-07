// index.js
require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const mongoose = require('mongoose');
const logger = require('./utils/logger');
const connectDB = require('./config/database');

// Controllers
const BotController = require('./controllers/BotController');
const AdminController = require('./controllers/AdminController');
const PaymentController = require('./controllers/PaymentController');
const OrderController = require('./controllers/OrderController');

// Middlewares
const errorHandler = require('./middlewares/errorHandler');
const rateLimiter = require('./middlewares/rateLimiter');
const sessionHandler = require('./middlewares/sessionHandler');
const securityMiddleware = require('./middlewares/securityMiddleware');

// Services
const ConversationService = require('./services/ConversationService');

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

            // Configuration de la commande setup
            this.setupAdminCommands();

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
        // Middleware de debug pour logger toutes les updates
        this.bot.use(async (ctx, next) => {
            const updateType = ctx.updateType;
            logger.debug('Update reçue:', {
                type: updateType,
                from: ctx.from,
                chat: ctx.chat,
                channelPost: ctx.channelPost,
                message: ctx.message,
                callbackQuery: ctx.callbackQuery
            });
            return next();
        });
    
        // Session middleware
        this.bot.use(session({
            defaultSession: () => ({
                adminState: null,
                lastActivity: new Date()
            })
        }));
        this.bot.use(sessionHandler);
    
        // Rate limiting
        this.bot.use(rateLimiter);
    
        // Sécurité
        this.bot.use(securityMiddleware);
    
        logger.info('Middlewares configurés');
    }

    setupControllers() {
        try {
            // Initialiser les contrôleurs
            this.botController = new BotController(this.bot);
            logger.info('BotController initialisé');
    
            this.adminController = new AdminController(this.bot);
            logger.info('AdminController initialisé');
    
            this.paymentController = new PaymentController(this.bot);
            logger.info('PaymentController initialisé');
    
            this.orderController = new OrderController(this.bot);
            logger.info('OrderController initialisé');
    
            // Démarrer les tâches périodiques
            this.orderController.startPeriodicTasks();
    
            // Vérifier que les commandes sont bien enregistrées
            const commands = this.bot.telegram.getMyCommands()
                .then(commands => {
                    logger.info('Commandes enregistrées:', commands);
                })
                .catch(error => {
                    logger.error('Erreur lors de la récupération des commandes:', error);
                });
    
            logger.info('Contrôleurs initialisés avec succès');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation des contrôleurs:', error);
            throw error;
        }
    }

    setupAdminCommands() {
        // Commande de configuration initiale
        this.bot.command('setup', async (ctx) => {
            if (!ctx.from.id === parseInt(process.env.ADMIN_ID)) {
                return ctx.reply('❌ Commande réservée aux administrateurs');
            }

            try {
                // Créer le canal principal s'il n'existe pas
                const mainChannel = await ctx.telegram.createChannel(
                    'ChangerShop Support',
                    'Canal de support principal'
                );

                // Sauvegarder l'ID du canal principal
                await ConversationService.setMainChannel(mainChannel.id);

                // Configurer les catégories de base
                const categories = [
                    'Vehicules', 'Papiers', 'Tech', 'Contact'
                ];

                for (const cat of categories) {
                    await ConversationService.createCategoryChannel(cat);
                }

                await ctx.reply(
                    '✅ Configuration initiale terminée!\n\n' +
                    'Canal principal et canaux de catégories créés.'
                );
            } catch (error) {
                logger.error('Erreur setup:', error);
                await ctx.reply('❌ Erreur lors de la configuration');
            }
        });

        logger.info('Commandes administrateur configurées');
    }

    setupErrorHandling() {
    try {
        // Middleware de gestion des erreurs
        this.bot.use(errorHandler);

        // Gestionnaire d'erreurs global pour le bot
        this.bot.catch((err, ctx) => {
            logger.error('Erreur globale bot:', {
                error: err,
                context: {
                    updateType: ctx?.updateType,
                    update: ctx?.update,
                    from: ctx?.from,
                    chat: ctx?.chat,
                    channelPost: ctx?.channelPost
                }
            });
        });

        // Gestion des erreurs non capturées
        process.on('uncaughtException', (error) => {
            logger.error('Erreur non capturée:', {
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                }
            });
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Promesse rejetée non gérée:', {
                reason: reason,
                promise: promise
            });
        });

        logger.info('Gestion des erreurs configurée');
    } catch (error) {
        logger.error('Erreur lors de la configuration de la gestion des erreurs:', error);
    }
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