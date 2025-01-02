const logger = require('./logger');
const config = require('./config');
const queue = require('./queue');
const bot = require('../bot');
const i18n = require('./i18n');

class Notifications {
    constructor() {
        this.types = {
            ORDER_CREATED: 'order_created',
            ORDER_PAID: 'order_paid',
            ORDER_PROCESSED: 'order_processed',
            ORDER_COMPLETED: 'order_completed',
            ORDER_CANCELLED: 'order_cancelled',
            PAYMENT_PENDING: 'payment_pending',
            PAYMENT_RECEIVED: 'payment_received',
            PAYMENT_FAILED: 'payment_failed',
            ADMIN_ALERT: 'admin_alert',
            USER_ALERT: 'user_alert'
        };

        this.templates = {
            [this.types.ORDER_CREATED]: {
                title: 'Nouvelle commande',
                template: '📦 Commande {orderId} créée\n\nMontant: {amount}€\nProduits: {products}'
            },
            [this.types.ORDER_PAID]: {
                title: 'Commande payée',
                template: '✅ Le paiement pour la commande {orderId} a été reçu\n\nMontant: {amount}€'
            },
            [this.types.ORDER_PROCESSED]: {
                title: 'Commande en traitement',
                template: '🔄 Votre commande {orderId} est en cours de traitement'
            },
            [this.types.ORDER_COMPLETED]: {
                title: 'Commande terminée',
                template: '✨ Votre commande {orderId} est terminée!\n\nMerci de votre confiance.'
            },
            [this.types.ORDER_CANCELLED]: {
                title: 'Commande annulée',
                template: '❌ La commande {orderId} a été annulée\n\nRaison: {reason}'
            },
            [this.types.PAYMENT_PENDING]: {
                title: 'Paiement en attente',
                template: '⏳ En attente du paiement pour la commande {orderId}\n\nMontant: {amount}€'
            },
            [this.types.PAYMENT_RECEIVED]: {
                title: 'Paiement reçu',
                template: '💰 Paiement reçu pour la commande {orderId}\n\nMontant: {amount}€'
            },
            [this.types.PAYMENT_FAILED]: {
                title: 'Paiement échoué',
                template: '❌ Le paiement pour la commande {orderId} a échoué\n\nRaison: {reason}'
            },
            [this.types.ADMIN_ALERT]: {
                title: 'Alerte Admin',
                template: '🚨 {message}'
            },
            [this.types.USER_ALERT]: {
                title: 'Notification',
                template: 'ℹ️ {message}'
            }
        };

        // Initialiser les écouteurs d'événements
        this.initializeEventListeners();
    }

    // Initialiser les écouteurs d'événements
    initializeEventListeners() {
        // Écouter les événements de commande
        this.listenToOrderEvents();
        
        // Écouter les événements de paiement
        this.listenToPaymentEvents();
    }

    // Écouter les événements de commande
    listenToOrderEvents() {
        const Order = require('../models/Order');

        Order.schema.post('save', async (doc) => {
            try {
                switch (doc.status) {
                    case 'created':
                        await this.notifyOrderCreated(doc);
                        break;
                    case 'processing':
                        await this.notifyOrderProcessing(doc);
                        break;
                    case 'completed':
                        await this.notifyOrderCompleted(doc);
                        break;
                    case 'cancelled':
                        await this.notifyOrderCancelled(doc);
                        break;
                }
            } catch (error) {
                logger.error('Erreur lors de la notification de commande:', error);
            }
        });
    }

    // Écouter les événements de paiement
    listenToPaymentEvents() {
        const Transaction = require('../models/Transaction');

        Transaction.schema.post('save', async (doc) => {
            try {
                switch (doc.status) {
                    case 'pending':
                        await this.notifyPaymentPending(doc);
                        break;
                    case 'completed':
                        await this.notifyPaymentReceived(doc);
                        break;
                    case 'failed':
                        await this.notifyPaymentFailed(doc);
                        break;
                }
            } catch (error) {
                logger.error('Erreur lors de la notification de paiement:', error);
            }
        });
    }

    // Formater un message de notification
    formatMessage(type, data) {
        try {
            const template = this.templates[type];
            if (!template) {
                throw new Error(`Template non trouvé pour le type: ${type}`);
            }

            let message = template.template;

            // Remplacer les variables dans le template
            Object.entries(data).forEach(([key, value]) => {
                message = message.replace(new RegExp(`{${key}}`, 'g'), value);
            });

            return {
                title: template.title,
                message
            };
        } catch (error) {
            logger.error('Erreur lors du formatage du message:', error);
            return {
                title: 'Notification',
                message: 'Une erreur est survenue'
            };
        }
    }

    // Envoyer une notification Telegram
    async sendTelegramNotification(userId, type, data) {
        try {
            const { title, message } = this.formatMessage(type, data);

            // Ajouter à la queue de messages
            await queue.add('telegram_notifications', {
                userId,
                type,
                title,
                message,
                data
            });

            logger.debug('Notification Telegram ajoutée à la queue:', {
                userId,
                type
            });
        } catch (error) {
            logger.error('Erreur lors de l\'envoi de la notification Telegram:', error);
        }
    }

    // Notifier une nouvelle commande
    async notifyOrderCreated(order) {
        const data = {
            orderId: order.orderNumber,
            amount: order.payment.amount.total,
            products: order.products
                .map(p => `${p.quantity}x ${p.product.name}`)
                .join(', ')
        };

        // Notifier l'utilisateur
        await this.sendTelegramNotification(
            order.user.id,
            this.types.ORDER_CREATED,
            data
        );

        // Notifier les admins
        await this.notifyAdmins(
            this.types.ORDER_CREATED,
            data
        );
    }

    // Notifier une commande en traitement
    async notifyOrderProcessing(order) {
        const data = {
            orderId: order.orderNumber
        };

        await this.sendTelegramNotification(
            order.user.id,
            this.types.ORDER_PROCESSED,
            data
        );
    }

    // Notifier une commande terminée
    async notifyOrderCompleted(order) {
        const data = {
            orderId: order.orderNumber
        };

        await this.sendTelegramNotification(
            order.user.id,
            this.types.ORDER_COMPLETED,
            data
        );
    }

    // Notifier une commande annulée
    async notifyOrderCancelled(order) {
        const data = {
            orderId: order.orderNumber,
            reason: order.cancellationReason || 'Aucune raison spécifiée'
        };

        await this.sendTelegramNotification(
            order.user.id,
            this.types.ORDER_CANCELLED,
            data
        );
    }

    // Notifier un paiement en attente
    async notifyPaymentPending(transaction) {
        const data = {
            orderId: transaction.order.orderNumber,
            amount: transaction.amount.total
        };

        await this.sendTelegramNotification(
            transaction.user,
            this.types.PAYMENT_PENDING,
            data
        );
    }

    // Notifier un paiement reçu
    async notifyPaymentReceived(transaction) {
        const data = {
            orderId: transaction.order.orderNumber,
            amount: transaction.amount.total
        };

        await this.sendTelegramNotification(
            transaction.user,
            this.types.PAYMENT_RECEIVED,
            data
        );
    }

    // Notifier un paiement échoué
    async notifyPaymentFailed(transaction) {
        const data = {
            orderId: transaction.order.orderNumber,
            amount: transaction.amount.total,
            reason: transaction.failureReason || 'Erreur de paiement'
        };

        await this.sendTelegramNotification(
            transaction.user,
            this.types.PAYMENT_FAILED,
            data
        );
    }

    // Notifier les admins
    async notifyAdmins(type, data) {
        try {
            const adminIds = config.get('bot.adminIds', []);
            
            for (const adminId of adminIds) {
                await this.sendTelegramNotification(adminId, type, data);
            }
        } catch (error) {
            logger.error('Erreur lors de la notification des admins:', error);
        }
    }

    // Envoyer une alerte admin
    async sendAdminAlert(message, data = {}) {
        await this.notifyAdmins(this.types.ADMIN_ALERT, {
            message,
            ...data
        });
    }

    // Envoyer une alerte utilisateur
    async sendUserAlert(userId, message, data = {}) {
        await this.sendTelegramNotification(
            userId,
            this.types.USER_ALERT,
            {
                message,
                ...data
            }
        );
    }

    // Gérer les réponses aux notifications
    async handleNotificationResponse(ctx) {
        try {
            const callbackData = ctx.callbackQuery.data;
            if (!callbackData.startsWith('notification:')) return false;

            const [, type, action, id] = callbackData.split(':');

            switch (action) {
                case 'view':
                    await this.handleViewNotification(ctx, type, id);
                    break;
                case 'dismiss':
                    await this.handleDismissNotification(ctx, type, id);
                    break;
                default:
                    logger.warn('Action de notification inconnue:', action);
            }

            return true;
        } catch (error) {
            logger.error('Erreur lors du traitement de la réponse de notification:', error);
            return false;
        }
    }

    // Gérer l'affichage d'une notification
    async handleViewNotification(ctx, type, id) {
        try {
            // Logique spécifique selon le type
            switch (type) {
                case 'order':
                    await ctx.scene.enter('view_order', { orderId: id });
                    break;
                case 'payment':
                    await ctx.scene.enter('view_payment', { paymentId: id });
                    break;
                default:
                    await ctx.answerCbQuery('Détails non disponibles');
            }
        } catch (error) {
            logger.error('Erreur lors de l\'affichage de la notification:', error);
            await ctx.answerCbQuery('Une erreur est survenue');
        }
    }

    // Gérer le rejet d'une notification
    async handleDismissNotification(ctx, type, id) {
        try {
            await ctx.deleteMessage();
            await ctx.answerCbQuery('Notification supprimée');
        } catch (error) {
            logger.error('Erreur lors du rejet de la notification:', error);
            await ctx.answerCbQuery('Une erreur est survenue');
        }
    }
}

module.exports = new Notifications();