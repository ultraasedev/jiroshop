const logger = require('./logger');
const config = require('./config');
const notifications = require('./notifications');

class ErrorHandler {
    constructor() {
        this.errorTypes = {
            VALIDATION: 'ValidationError',
            DATABASE: 'DatabaseError',
            PAYMENT: 'PaymentError',
            AUTHENTICATION: 'AuthenticationError',
            AUTHORIZATION: 'AuthorizationError',
            TELEGRAM: 'TelegramError',
            FILE: 'FileError',
            NETWORK: 'NetworkError',
            RATE_LIMIT: 'RateLimitError',
            BUSINESS: 'BusinessError',
            SYSTEM: 'SystemError'
        };

        this.errorCodes = {
            // Codes de validation (1xxx)
            INVALID_INPUT: 1001,
            MISSING_FIELD: 1002,
            INVALID_FORMAT: 1003,
            DUPLICATE_ENTRY: 1004,

            // Codes de base de données (2xxx)
            DB_CONNECTION: 2001,
            DB_QUERY: 2002,
            DB_CONSTRAINT: 2003,
            DB_TIMEOUT: 2004,

            // Codes de paiement (3xxx)
            PAYMENT_FAILED: 3001,
            PAYMENT_EXPIRED: 3002,
            PAYMENT_CANCELLED: 3003,
            INSUFFICIENT_FUNDS: 3004,

            // Codes d'authentification (4xxx)
            INVALID_CREDENTIALS: 4001,
            TOKEN_EXPIRED: 4002,
            INVALID_TOKEN: 4003,
            SESSION_EXPIRED: 4004,

            // Codes d'autorisation (5xxx)
            UNAUTHORIZED: 5001,
            FORBIDDEN: 5002,
            ROLE_REQUIRED: 5003,
            INSUFFICIENT_PERMISSIONS: 5004,

            // Codes Telegram (6xxx)
            TELEGRAM_API: 6001,
            BOT_BLOCKED: 6002,
            CHAT_NOT_FOUND: 6003,
            MESSAGE_TOO_LONG: 6004,

            // Codes fichiers (7xxx)
            FILE_NOT_FOUND: 7001,
            INVALID_FILE_TYPE: 7002,
            FILE_TOO_LARGE: 7003,
            FILE_UPLOAD_FAILED: 7004,

            // Codes réseau (8xxx)
            NETWORK_TIMEOUT: 8001,
            API_UNAVAILABLE: 8002,
            RATE_LIMITED: 8003,
            BAD_GATEWAY: 8004,

            // Codes métier (9xxx)
            INSUFFICIENT_STOCK: 9001,
            ORDER_NOT_FOUND: 9002,
            INVALID_STATUS: 9003,
            OPERATION_FAILED: 9004
        };
    }

    // Créer une nouvelle erreur
    createError(type, code, message, details = null) {
        const error = new Error(message);
        error.type = type;
        error.code = code;
        error.details = details;
        error.timestamp = new Date();

        Error.captureStackTrace(error, this.createError);
        return error;
    }

    // Gérer une erreur
    async handleError(error, ctx = null) {
        try {
            // Logger l'erreur
            this.logError(error);

            // Notifier les administrateurs si nécessaire
            await this.notifyAdmins(error);

            // Répondre à l'utilisateur si un contexte est fourni
            if (ctx) {
                await this.respondToUser(error, ctx);
            }

            // Enregistrer l'erreur dans la base de données
            await this.saveError(error);

            // Exécuter des actions spécifiques selon le type d'erreur
            await this.handleSpecificError(error);

            return true;
        } catch (handlingError) {
            logger.error('Erreur lors de la gestion de l\'erreur:', handlingError);
            return false;
        }
    }

    // Logger une erreur
    logError(error) {
        const errorInfo = {
            type: error.type || 'UnknownError',
            code: error.code,
            message: error.message,
            details: error.details,
            timestamp: error.timestamp || new Date(),
            stack: error.stack
        };

        if (error.type === this.errorTypes.SYSTEM) {
            logger.error('Erreur système:', errorInfo);
        } else {
            logger.error(`Erreur ${error.type}:`, errorInfo);
        }
    }

    // Notifier les administrateurs
    async notifyAdmins(error) {
        try {
            // Ne notifier que pour les erreurs importantes
            if (this.shouldNotifyAdmins(error)) {
                const message = this.formatErrorForAdmin(error);
                await notifications.sendAdminAlert(message, {
                    type: error.type,
                    code: error.code
                });
            }
        } catch (notifyError) {
            logger.error('Erreur lors de la notification des admins:', notifyError);
        }
    }

    // Déterminer si une erreur nécessite une notification admin
    shouldNotifyAdmins(error) {
        // Erreurs système toujours notifiées
        if (error.type === this.errorTypes.SYSTEM) return true;

        // Erreurs de paiement importantes
        if (error.type === this.errorTypes.PAYMENT && 
            [this.errorCodes.PAYMENT_FAILED, this.errorCodes.INSUFFICIENT_FUNDS].includes(error.code)) {
            return true;
        }

        // Erreurs de base de données critiques
        if (error.type === this.errorTypes.DATABASE && 
            [this.errorCodes.DB_CONNECTION, this.errorCodes.DB_TIMEOUT].includes(error.code)) {
            return true;
        }

        // Erreurs d'authentification suspectes
        if (error.type === this.errorTypes.AUTHENTICATION && 
            error.code === this.errorCodes.INVALID_CREDENTIALS) {
            return true;
        }

        return false;
    }

    // Formater l'erreur pour l'administrateur
    formatErrorForAdmin(error) {
        let message = `🚨 *Erreur ${error.type}*\n\n`;
        message += `Code: ${error.code}\n`;
        message += `Message: ${error.message}\n`;
        
        if (error.details) {
            message += `\nDétails:\n${JSON.stringify(error.details, null, 2)}`;
        }

        message += `\nTimestamp: ${error.timestamp.toISOString()}`;
        
        if (error.stack && config.get('app.env') === 'development') {
            message += `\n\nStack:\n\`\`\`\n${error.stack}\n\`\`\``;
        }

        return message;
    }

    // Répondre à l'utilisateur
    async respondToUser(error, ctx) {
        try {
            const response = this.getUserResponse(error);
            
            if (ctx.callbackQuery) {
                await ctx.answerCbQuery(response.short);
                if (response.detailed) {
                    await ctx.reply(response.detailed);
                }
            } else {
                await ctx.reply(response.detailed || response.short);
            }
        } catch (responseError) {
            logger.error('Erreur lors de la réponse à l\'utilisateur:', responseError);
        }
    }

    // Obtenir la réponse appropriée pour l'utilisateur
    getUserResponse(error) {
        const responses = {
            [this.errorTypes.VALIDATION]: {
                short: '❌ Données invalides',
                detailed: 'Les données fournies ne sont pas valides. Veuillez vérifier et réessayer.'
            },
            [this.errorTypes.PAYMENT]: {
                short: '❌ Erreur de paiement',
                detailed: 'Une erreur est survenue lors du paiement. Veuillez réessayer ultérieurement.'
            },
            [this.errorTypes.AUTHENTICATION]: {
                short: '🔒 Accès refusé',
                detailed: 'Vous n\'êtes pas autorisé à effectuer cette action.'
            },
            [this.errorTypes.FILE]: {
                short: '❌ Erreur fichier',
                detailed: 'Une erreur est survenue avec le fichier. Veuillez réessayer.'
            },
            [this.errorTypes.RATE_LIMIT]: {
                short: '⏳ Trop de requêtes',
                detailed: 'Vous avez effectué trop de requêtes. Veuillez patienter.'
            },
            [this.errorTypes.BUSINESS]: {
                short: '❌ Opération impossible',
                detailed: error.message
            }
        };

        return responses[error.type] || {
            short: '❌ Une erreur est survenue',
            detailed: 'Une erreur inattendue est survenue. Veuillez réessayer ultérieurement.'
        };
    }

    // Sauvegarder l'erreur dans la base de données
    async saveError(error) {
        try {
            const ErrorLog = require('../models/ErrorLog');
            await ErrorLog.create({
                type: error.type,
                code: error.code,
                message: error.message,
                details: error.details,
                stack: error.stack,
                timestamp: error.timestamp
            });
        } catch (saveError) {
            logger.error('Erreur lors de la sauvegarde de l\'erreur:', saveError);
        }
    }

    // Gérer des erreurs spécifiques
    async handleSpecificError(error) {
        try {
            switch (error.type) {
                case this.errorTypes.PAYMENT:
                    await this.handlePaymentError(error);
                    break;
                    
                case this.errorTypes.DATABASE:
                    await this.handleDatabaseError(error);
                    break;
                    
                case this.errorTypes.TELEGRAM:
                    await this.handleTelegramError(error);
                    break;
            }
        } catch (specificError) {
            logger.error('Erreur lors du traitement spécifique:', specificError);
        }
    }

    // Gérer les erreurs de paiement
    async handlePaymentError(error) {
        // Annuler la transaction si nécessaire
        if (error.details?.transactionId) {
            const Transaction = require('../models/Transaction');
            await Transaction.findByIdAndUpdate(
                error.details.transactionId,
                {
                    status: 'failed',
                    error: {
                        code: error.code,
                        message: error.message
                    }
                }
            );
        }

        // Annuler la commande si nécessaire
        if (error.details?.orderId) {
            const Order = require('../models/Order');
            await Order.findByIdAndUpdate(
                error.details.orderId,
                {
                    status: 'cancelled',
                    cancellationReason: 'Erreur de paiement'
                }
            );
        }
    }

    // Gérer les erreurs de base de données
    async handleDatabaseError(error) {
        // Tentative de reconnexion si nécessaire
        if (error.code === this.errorCodes.DB_CONNECTION) {
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState === 0) {
                try {
                    await mongoose.connect(config.get('database.uri'), config.get('database.options'));
                } catch (reconnectError) {
                    logger.error('Échec de la reconnexion à la base de données:', reconnectError);
                }
            }
        }
    }

    // Gérer les erreurs Telegram
    async handleTelegramError(error) {
        // Gérer les bots bloqués
        if (error.code === this.errorCodes.BOT_BLOCKED && error.details?.userId) {
            const User = require('../models/User');
            await User.findOneAndUpdate(
                { telegramId: error.details.userId },
                { botBlocked: true }
            );
        }
    }

    // Middleware de gestion des erreurs pour Express
    expressErrorHandler() {
        return async (err, req, res, next) => {
            await this.handleError(err);
            
            // Envoyer une réponse appropriée
            res.status(this.getHttpStatus(err)).json({
                error: {
                    type: err.type,
                    code: err.code,
                    message: this.getUserResponse(err).detailed
                }
            });
        };
    }

    // Obtenir le code HTTP approprié
    getHttpStatus(error) {
        const statusMap = {
            [this.errorTypes.VALIDATION]: 400,
            [this.errorTypes.AUTHENTICATION]: 401,
            [this.errorTypes.AUTHORIZATION]: 403,
            [this.errorTypes.BUSINESS]: 400,
            [this.errorTypes.RATE_LIMIT]: 429,
            [this.errorTypes.DATABASE]: 500,
            [this.errorTypes.SYSTEM]: 500
        };

        return statusMap[error.type] || 500;
    }
}

module.exports = new ErrorHandler();