const { Markup } = require('telegraf');
const logger = require('../utils/logger');
const PaymentMethod = require('../models/PaymentMethod');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const Cart = require('../models/Cart');
const crypto = require('crypto');
const QRCode = require('qrcode');

class PaymentController {
    constructor(bot) {
        this.bot = bot;
        this.initializePaymentHandlers();
    }

    initializePaymentHandlers() {
        // Démarrage du processus de paiement
        this.bot.action('checkout', this.startCheckout.bind(this));
        
        // Sélection de la méthode de paiement
        this.bot.action(/^select_payment_(.+)$/, this.selectPaymentMethod.bind(this));
        
        // Confirmation du paiement
        this.bot.action(/^confirm_payment_(.+)$/, this.confirmPayment.bind(this));
        
        // Vérification manuelle du paiement
        this.bot.action(/^verify_payment_(.+)$/, this.verifyManualPayment.bind(this));
        
        // Annulation du paiement
        this.bot.action('cancel_payment', this.cancelPayment.bind(this));
    }

    // Démarrer le processus de paiement
    async startCheckout(ctx) {
        try {
            const cart = await Cart.getOrCreate(ctx.from.id);
            await cart.populate('items.product');

            if (cart.items.length === 0) {
                return ctx.reply('Votre panier est vide.');
            }

            // Calculer le total
            await cart.updateTotals();

            // Obtenir les méthodes de paiement disponibles
            const availableMethods = await PaymentMethod.getAvailableMethods(
                cart.summary.total,
                ctx.from.id
            );

            if (availableMethods.length === 0) {
                return ctx.reply('Aucune méthode de paiement disponible pour le moment.');
            }

            let message = '💳 Choisissez votre méthode de paiement:\n\n';
            message += `💰 Total à payer: ${cart.summary.total}€\n`;
            
            if (cart.summary.fees > 0) {
                message += `📝 Frais inclus: ${cart.summary.fees}€\n`;
            }

            const keyboard = Markup.inlineKeyboard([
                ...availableMethods.map(method => ([
                    Markup.button.callback(
                        `${method.name} ${method.fees.percentage > 0 ? `(+${method.fees.percentage}%)` : ''}`,
                        `select_payment_${method._id}`
                    )
                ])),
                [Markup.button.callback('❌ Annuler', 'cancel_payment')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur début paiement:', error);
            ctx.reply('Une erreur est survenue lors du paiement.').catch(console.error);
        }
    }

    // Sélection de la méthode de paiement
    async selectPaymentMethod(ctx) {
        try {
            const methodId = ctx.match[1];
            const paymentMethod = await PaymentMethod.findById(methodId);
            const cart = await Cart.getOrCreate(ctx.from.id);

            if (!paymentMethod || !cart) {
                return ctx.reply('Une erreur est survenue.');
            }

            // Créer la commande
            const order = await this.createOrder(ctx.from.id, cart, paymentMethod);

            // Générer les instructions de paiement
            const instructions = paymentMethod.getPaymentInstructions(
                order.payment.amount.total,
                order.orderNumber
            );

            let message = '💳 Instructions de paiement:\n\n';
            message += `📦 Commande: ${order.orderNumber}\n`;
            message += `💰 Montant: ${order.payment.amount.total}€\n\n`;

            switch (paymentMethod.type) {
                case 'crypto':
                    message += `🔗 Réseau: ${instructions.network}\n`;
                    message += `📝 Adresse: ${instructions.address}\n`;
                    message += `ℹ️ Confirmations requises: ${instructions.confirmationsRequired}\n`;
                    
                    // Générer QR code pour l'adresse crypto
                    const qrBuffer = await QRCode.toBuffer(instructions.address);
                    await ctx.replyWithPhoto({ source: qrBuffer });
                    break;

                case 'pcs':
                case 'transcash':
                case 'paysafecard':
                    message += `📝 Référence à indiquer: ${instructions.reference}\n\n`;
                    message += instructions.instructions;
                    break;

                case 'manual':
                    message += instructions.instructions + '\n\n';
                    message += `📝 Référence: ${instructions.reference}\n`;
                    if (instructions.contactInfo) {
                        message += `📞 Contact: ${instructions.contactInfo}\n`;
                    }
                    break;
            }

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('✅ J\'ai payé', `confirm_payment_${order._id}`)],
                [Markup.button.callback('❌ Annuler', 'cancel_payment')]
            ]);

            await ctx.reply(message, keyboard);

            // Démarrer le timer d'expiration
            this.startPaymentTimer(order._id);
        } catch (error) {
            logger.error('Erreur sélection méthode de paiement:', error);
            ctx.reply('Une erreur est survenue.').catch(console.error);
        }
    }

    // Créer une nouvelle commande
    async createOrder(userId, cart, paymentMethod) {
        const order = new Order({
            orderNumber: this.generateOrderNumber(),
            user: {
                id: userId
            },
            products: cart.items.map(item => ({
                product: item.product,
                quantity: item.quantity,
                price: item.price.final,
                customFields: item.customFields,
                status: 'pending',
                deliveryMethod: item.product.delivery.type
            })),
            payment: {
                method: paymentMethod._id,
                amount: cart.summary,
                status: 'pending'
            }
        });

        await order.save();
        return order;
    }

    // Générer un numéro de commande unique
    generateOrderNumber() {
        const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
        const random = crypto.randomBytes(2).toString('hex').toUpperCase();
        return `ORD-${date}-${random}`;
    }

    // Démarrer le timer d'expiration du paiement
    async startPaymentTimer(orderId) {
        const PAYMENT_TIMEOUT = 30 * 60 * 1000; // 30 minutes

        setTimeout(async () => {
            try {
                const order = await Order.findById(orderId);
                if (order && order.status === 'pending_payment') {
                    await order.updateStatus('cancelled', 'Paiement expiré');
                    
                    // Notifier l'utilisateur
                    this.bot.telegram.sendMessage(
                        order.user.id,
                        `⚠️ Le délai de paiement pour la commande ${order.orderNumber} a expiré.`
                    ).catch(console.error);
                }
            } catch (error) {
                logger.error('Erreur timer paiement:', error);
            }
        }, PAYMENT_TIMEOUT);
    }

    // Confirmation du paiement
    async confirmPayment(ctx) {
        try {
            const orderId = ctx.match[1];
            const order = await Order.findById(orderId)
                .populate('payment.method');

            if (!order) {
                return ctx.reply('Commande non trouvée.');
            }

            const paymentMethod = order.payment.method;

            if (['crypto', 'pcs', 'transcash', 'paysafecard', 'manual'].includes(paymentMethod.type)) {
                // Pour les méthodes nécessitant une preuve de paiement
                ctx.session.paymentProof = {
                    orderId: order._id,
                    step: 'waiting_proof'
                };

                let message = '📝 Veuillez envoyer une preuve de paiement:\n\n';
                
                switch (paymentMethod.type) {
                    case 'crypto':
                        message += '- ID de transaction (hash)\n';
                        break;
                    case 'pcs':
                    case 'transcash':
                    case 'paysafecard':
                        message += '- Photo du ticket/reçu\n';
                        message += '- Code du ticket\n';
                        break;
                    case 'manual':
                        message += paymentMethod.config.manual.verificationProcess;
                        break;
                }

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Annuler', 'cancel_payment')]
                ]);

                await ctx.reply(message, keyboard);
            } else {
                // Pour les méthodes automatiques (PayPal, etc.)
                await this.processAutomaticPayment(ctx, order);
            }
        } catch (error) {
            logger.error('Erreur confirmation paiement:', error);
            ctx.reply('Une erreur est survenue.').catch(console.error);
        }
    }

    // Traitement des paiements automatiques
    async processAutomaticPayment(ctx, order) {
        try {
            const paymentMethod = order.payment.method;
            
            switch (paymentMethod.type) {
                case 'paypal':
                    // Implémenter la logique PayPal
                    break;
                case 'stripe':
                    // Implémenter la logique Stripe
                    break;
                default:
                    throw new Error('Méthode de paiement non supportée');
            }
        } catch (error) {
            logger.error('Erreur paiement automatique:', error);
            ctx.reply('Une erreur est survenue lors du paiement.').catch(console.error);
        }
    }

    // Vérification manuelle du paiement
    async verifyManualPayment(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId)
                .populate('payment.method');

            if (!order) {
                return ctx.reply('Commande non trouvée.');
            }

            ctx.session.verifyPayment = {
                orderId: order._id,
                step: 'confirm'
            };

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Approuver', `approve_payment_${order._id}`),
                    Markup.button.callback('❌ Rejeter', `reject_payment_${order._id}`)
                ],
                [Markup.button.callback('🔙 Retour', 'admin_orders')]
            ]);

            let message = `🔍 Vérification de paiement\n\n`;
            message += `📦 Commande: ${order.orderNumber}\n`;
            message += `💰 Montant: ${order.payment.amount.total}€\n`;
            message += `🔄 Méthode: ${order.payment.method.name}\n`;
            if (order.payment.details?.paymentProof) {
                message += `\n📝 Preuve de paiement:\n${order.payment.details.paymentProof}`;
            }

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur vérification paiement:', error);
            ctx.reply('Une erreur est survenue.').catch(console.error);
        }
    }

    // Annulation du paiement
    async cancelPayment(ctx) {
        try {
            if (ctx.session.paymentProof) {
                const order = await Order.findById(ctx.session.paymentProof.orderId);
                if (order) {
                    await order.updateStatus('cancelled', 'Annulé par l\'utilisateur');
                }
                delete ctx.session.paymentProof;
            }

            await ctx.reply('❌ Paiement annulé.');
            await this.showMainMenu(ctx);
        } catch (error) {
            logger.error('Erreur annulation paiement:', error);
            ctx.reply('Une erreur est survenue.').catch(console.error);
        }
    }

    // Gérer les webhooks de paiement
    async handlePaymentWebhook(type, data) {
        try {
            switch (type) {
                case 'crypto':
                    await this.handleCryptoWebhook(data);
                    break;
                case 'paypal':
                    await this.handlePayPalWebhook(data);
                    break;
                case 'stripe':
                    await this.handleStripeWebhook(data);
                    break;
                default:
                    logger.warn('Type de webhook non supporté:', type);
            }
        } catch (error) {
            logger.error('Erreur webhook paiement:', error);
        }
    }

    // Traiter les webhooks crypto
    async handleCryptoWebhook(data) {
        try {
            const { txHash, address, amount, confirmations } = data;
            
            // Trouver la transaction correspondante
            const transaction = await Transaction.findOne({
                'paymentDetails.walletAddress': address,
                status: 'pending'
            }).populate('order');

            if (!transaction) return;

            // Vérifier les confirmations
            const requiredConfirmations = transaction.order.payment.method.config.crypto.confirmationsRequired;
            
            if (confirmations >= requiredConfirmations) {
                await transaction.updateStatus('completed', 'Paiement crypto confirmé');
                await transaction.order.updateStatus('processing');

                // Notifier l'utilisateur
                this.bot.telegram.sendMessage(
                    transaction.order.user.id,
                    `✅ Paiement reçu pour la commande ${transaction.order.orderNumber} !`
                ).catch(console.error);
            }
        } catch (error) {
            logger.error('Erreur webhook crypto:', error);
        }
    }

    // Gérer les remboursements
    async processRefund(orderId, amount, reason, adminId) {
        try {
            const order = await Order.findById(orderId)
                .populate('payment.method');

            if (!order) {
                throw new Error('Commande non trouvée');
            }

            // Créer la transaction de remboursement
            const refund = await Transaction.create({
                order: order._id,
                user: order.user.id,
                paymentMethod: order.payment.method._id,
                amount: {
                    total: amount,
                    fees: 0,
                    subtotal: amount
                },
                type: 'refund',
                status: 'processing',
                paymentDetails: {
                    refundReason: reason,
                    originalTransactionId: order.payment.details.transactionId
                },
                metadata: {
                    initiatedBy: adminId
                }
            });

            // Traiter le remboursement selon la méthode de paiement
            switch (order.payment.method.type) {
                case 'paypal':
                    await this.processPayPalRefund(refund);
                    break;
                case 'stripe':
                    await this.processStripeRefund(refund);
                    break;
                case 'crypto':
                    await this.processCryptoRefund(refund);
                    break;
                default:
                    await this.processManualRefund(refund);
            }

            // Mettre à jour le statut de la commande
            await order.updateStatus('refunded', `Remboursement effectué: ${reason}`);

            return refund;
        } catch (error) {
            logger.error('Erreur lors du remboursement:', error);
            throw error;
        }
    }

    // Gérer le remboursement PayPal
    async processPayPalRefund(refund) {
        try {
            // Implémenter la logique de remboursement PayPal
            const paypal = require('@paypal/checkout-server-sdk');
            const paypalClient = this.createPayPalClient();

            const request = new paypal.payments.RefundsCreateRequest(refund.paymentDetails.originalTransactionId);
            request.requestBody({
                amount: {
                    currency_code: 'EUR',
                    value: refund.amount.total.toString()
                }
            });

            const response = await paypalClient.execute(request);

            if (response.result.status === 'COMPLETED') {
                await refund.updateStatus('completed', 'Remboursement PayPal effectué');
                return true;
            }

            throw new Error('Échec du remboursement PayPal');
        } catch (error) {
            logger.error('Erreur remboursement PayPal:', error);
            await refund.updateStatus('failed', error.message);
            throw error;
        }
    }

    // Gérer le remboursement Stripe
    async processStripeRefund(refund) {
        try {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

            const response = await stripe.refunds.create({
                payment_intent: refund.paymentDetails.originalTransactionId,
                amount: Math.round(refund.amount.total * 100) // Stripe utilise les centimes
            });

            if (response.status === 'succeeded') {
                await refund.updateStatus('completed', 'Remboursement Stripe effectué');
                return true;
            }

            throw new Error('Échec du remboursement Stripe');
        } catch (error) {
            logger.error('Erreur remboursement Stripe:', error);
            await refund.updateStatus('failed', error.message);
            throw error;
        }
    }

    // Gérer le remboursement Crypto
    async processCryptoRefund(refund) {
        // Pour les remboursements crypto, on génère généralement une transaction manuelle
        try {
            await refund.updateStatus('pending', 'En attente de traitement manuel');
            
            // Notifier les administrateurs
            this.notifyAdmins(
                `🔄 Nouveau remboursement crypto à traiter:\n` +
                `Commande: ${refund.order}\n` +
                `Montant: ${refund.amount.total}€\n` +
                `Raison: ${refund.paymentDetails.refundReason}`
            );

            return true;
        } catch (error) {
            logger.error('Erreur remboursement crypto:', error);
            throw error;
        }
    }

    // Gérer le remboursement manuel
    async processManualRefund(refund) {
        try {
            await refund.updateStatus('pending', 'En attente de traitement manuel');
            
            // Notifier les administrateurs
            this.notifyAdmins(
                `🔄 Nouveau remboursement manuel à traiter:\n` +
                `Commande: ${refund.order}\n` +
                `Montant: ${refund.amount.total}€\n` +
                `Raison: ${refund.paymentDetails.refundReason}`
            );

            return true;
        } catch (error) {
            logger.error('Erreur remboursement manuel:', error);
            throw error;
        }
    }

    // Vérifier les transactions en attente
    async checkPendingTransactions() {
        try {
            const pendingTransactions = await Transaction.find({
                status: 'pending',
                createdAt: { 
                    $lt: new Date(Date.now() - 30 * 60 * 1000) // Plus de 30 minutes
                }
            }).populate('order payment.method');

            for (const transaction of pendingTransactions) {
                // Vérifier le statut selon la méthode de paiement
                switch (transaction.order.payment.method.type) {
                    case 'crypto':
                        await this.checkCryptoTransaction(transaction);
                        break;
                    case 'paypal':
                        await this.checkPayPalTransaction(transaction);
                        break;
                    case 'stripe':
                        await this.checkStripeTransaction(transaction);
                        break;
                }
            }
        } catch (error) {
            logger.error('Erreur vérification transactions:', error);
        }
    }

    // Vérifier une transaction crypto
    async checkCryptoTransaction(transaction) {
        try {
            const { address, network } = transaction.paymentDetails;
            // Implémenter la vérification blockchain selon le réseau
            // Cette partie dépend de l'API blockchain utilisée
        } catch (error) {
            logger.error('Erreur vérification transaction crypto:', error);
        }
    }

    // Vérifier une transaction PayPal
    async checkPayPalTransaction(transaction) {
        try {
            const paypal = require('@paypal/checkout-server-sdk');
            const paypalClient = this.createPayPalClient();

            const request = new paypal.orders.OrdersGetRequest(transaction.paymentDetails.orderId);
            const response = await paypalClient.execute(request);

            if (response.result.status === 'COMPLETED') {
                await transaction.updateStatus('completed', 'Paiement PayPal confirmé');
                await transaction.order.updateStatus('processing');
            }
        } catch (error) {
            logger.error('Erreur vérification transaction PayPal:', error);
        }
    }

    // Vérifier une transaction Stripe
    async checkStripeTransaction(transaction) {
        try {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            const paymentIntent = await stripe.paymentIntents.retrieve(
                transaction.paymentDetails.paymentIntentId
            );

            if (paymentIntent.status === 'succeeded') {
                await transaction.updateStatus('completed', 'Paiement Stripe confirmé');
                await transaction.order.updateStatus('processing');
            }
        } catch (error) {
            logger.error('Erreur vérification transaction Stripe:', error);
        }
    }

    // Notifier les administrateurs
    async notifyAdmins(message) {
        try {
            const admins = await User.find({
                role: { $in: ['admin', 'superadmin'] },
                status: 'active'
            });

            for (const admin of admins) {
                this.bot.telegram.sendMessage(admin.telegramId, message)
                    .catch(err => logger.error('Erreur notification admin:', err));
            }
        } catch (error) {
            logger.error('Erreur notification admins:', error);
        }
    }

    // Créer le client PayPal
    createPayPalClient() {
        const paypal = require('@paypal/checkout-server-sdk');
        
        const environment = process.env.NODE_ENV === 'production'
            ? new paypal.core.LiveEnvironment(
                process.env.PAYPAL_CLIENT_ID,
                process.env.PAYPAL_CLIENT_SECRET
            )
            : new paypal.core.SandboxEnvironment(
                process.env.PAYPAL_CLIENT_ID,
                process.env.PAYPAL_CLIENT_SECRET
            );

        return new paypal.core.PayPalHttpClient(environment);
    }
}

module.exports = PaymentController;