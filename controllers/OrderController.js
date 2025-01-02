// controllers/OrderController.js
const { Markup } = require('telegraf');
const logger = require('../utils/logger');
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const ConversationService = require('../services/ConversationService');

class OrderController {
    constructor(bot) {
        this.bot = bot;
        this.initializeOrderHandlers();
    }

    initializeOrderHandlers() {
        // Gestionnaire des commandes de base
        this.bot.command('checkout', this.startCheckout.bind(this));
        this.bot.command('orders', this.showUserOrders.bind(this));

        // Gestionnaire des actions de boutique
        this.bot.action('view_cart', this.viewCart.bind(this));
        this.bot.action('start_purchase', this.startPurchase.bind(this));
        this.bot.action(/^select_payment_(.+)$/, this.selectPayment.bind(this));

        // Gestionnaire des commandes
        this.bot.action(/^view_order_(.+)$/, this.viewOrderDetails.bind(this));
        this.bot.action(/^track_order_(.+)$/, this.trackOrder.bind(this));
        this.bot.action(/^cancel_order_(.+)$/, this.cancelOrder.bind(this));

        // Gestionnaire des paiements
        this.bot.action(/^pay_order_(.+)$/, this.handlePayment.bind(this));
        this.bot.action(/^confirm_payment_(.+)$/, this.confirmPayment.bind(this));
        this.bot.action(/^reject_payment_(.+)$/, this.rejectPayment.bind(this));

        // Gestionnaire des documents et photos
        this.bot.on('document', this.handleDocument.bind(this));
        this.bot.on('photo', this.handlePhoto.bind(this));

        // Gestionnaire des conversations
        this.bot.on('message', this.handleOrderMessage.bind(this));
        this.bot.on('channel_post', this.handleChannelPost.bind(this));
    }

    // Démarrer une nouvelle commande
    async startCheckout(ctx) {
        try {
            const cart = await Cart.getOrCreate(ctx.from.id);
            if (cart.items.length === 0) {
                return ctx.reply('Votre panier est vide!');
            }

            // Créer un nouveau canal pour la commande
            const channelId = await ConversationService.createOrderChannel({
                userId: ctx.from.id,
                username: ctx.from.username
            });

            // Créer la commande
            const order = await Order.create({
                user: {
                    id: ctx.from.id,
                    username: ctx.from.username
                },
                items: cart.items,
                channelId,
                status: 'pending'
            });

            // Message initial dans le canal
            await this.sendInitialChannelMessage(order, channelId);

            // Message à l'utilisateur
            await ctx.reply(
                `🛍️ Commande ${order.orderNumber} créée!\n` +
                `Vous avez été ajouté au canal de support dédié.`
            );

            // Notifier les admins
            await this.notifyAdmins(
                `📦 Nouvelle commande:\n` +
                `ID: ${order.orderNumber}\n` +
                `Client: @${ctx.from.username}`
            );

            return this.showPaymentOptions(ctx, order._id);
        } catch (error) {
            logger.error('Erreur création commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Afficher les commandes d'un utilisateur
    async showUserOrders(ctx) {
        try {
            const orders = await Order.find({ 
                'user.id': ctx.from.id 
            }).sort({ createdAt: -1 });

            if (orders.length === 0) {
                return ctx.reply('Vous n\'avez pas encore de commandes.');
            }

            const buttons = orders.map(order => {
                const statusEmoji = this.getStatusEmoji(order.status);
                return [Markup.button.callback(
                    `${statusEmoji} ${order.orderNumber}`,
                    `view_order_${order._id}`
                )];
            });

            await ctx.reply('Vos commandes:', 
                Markup.inlineKeyboard([...buttons])
            );
        } catch (error) {
            logger.error('Erreur affichage commandes:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Voir les détails d'une commande
    async viewOrderDetails(ctx) {
        try {
            const orderId = ctx.match[1];
            const order = await Order.findById(orderId)
                .populate('items.product');

            if (!order || order.user.id !== ctx.from.id) {
                return ctx.reply('Commande non trouvée');
            }

            let message = `📦 Commande: ${order.orderNumber}\n`;
            message += `📅 Date: ${order.createdAt.toLocaleString()}\n`;
            message += `📊 Statut: ${this.getStatusEmoji(order.status)} ${order.status}\n\n`;

            message += '🛍️ Produits:\n';
            order.items.forEach(item => {
                message += `- ${item.product.name} x${item.quantity}\n`;
                message += `  Prix: ${item.price}€\n`;
            });

            message += `\n💰 Total: ${order.total}€\n`;

            const buttons = [];

            // Ajouter les boutons selon le statut
            if (order.status === 'pending') {
                buttons.push([
                    Markup.button.callback('💳 Payer', `pay_order_${order._id}`),
                    Markup.button.callback('❌ Annuler', `cancel_order_${order._id}`)
                ]);
            }

            if (order.channelId) {
                buttons.push([
                    Markup.button.url('💬 Discussion', `https://t.me/${order.channelId}`)
                ]);
            }

            await ctx.reply(message, Markup.inlineKeyboard(buttons));
        } catch (error) {
            logger.error('Erreur affichage détails:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer les messages dans le canal de commande
    async handleOrderMessage(ctx) {
        try {
            // Vérifier si le message est dans un canal de commande
            const order = await Order.findOne({ channelId: ctx.chat.id });
            if (!order) return;

            // Mettre à jour les statistiques de message
            await Order.updateOne(
                { _id: order._id },
                {
                    $set: {
                        lastMessageAt: new Date(),
                        lastMessageBy: ctx.from.id
                    }
                }
            );

            // Gérer les marqueurs de lecture
            const isAdmin = await this.isAdmin(ctx.from.id);
            await ConversationService.updateReadStatus(
                ctx.chat.id,
                ctx.from.id,
                isAdmin
            );

            // Rediriger le message vers les groupes de catégories
            for (const item of order.items) {
                const product = await Product.findById(item.product)
                    .populate('category');
                
                if (product?.category?.channelId) {
                    await ctx.telegram.forwardMessage(
                        product.category.channelId,
                        ctx.chat.id,
                        ctx.message.message_id
                    );
                }
            }
        } catch (error) {
            logger.error('Erreur traitement message:', error);
        }
    }

    // Traiter un paiement
    async handlePayment(ctx) {
        try {
            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order || order.user.id !== ctx.from.id) {
                return ctx.reply('Commande non trouvée');
            }

            if (order.status !== 'pending') {
                return ctx.reply('Cette commande ne peut plus être payée');
            }

            // Afficher les options de paiement
            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('💳 PayPal', `payment_paypal_${order._id}`),
                    Markup.button.callback('💰 Crypto', `payment_crypto_${order._id}`)
                ],
                [
                    Markup.button.callback('💳 PCS', `payment_pcs_${order._id}`),
                    Markup.button.callback('💳 Transcash', `payment_transcash_${order._id}`)
                ],
                [
                    Markup.button.callback('👤 En main propre', `payment_cash_${order._id}`)
                ]
            ]);

            await ctx.reply(
                `💳 Choisissez votre méthode de paiement:\n` +
                `Montant à payer: ${order.total}€`,
                keyboard
            );
        } catch (error) {
            logger.error('Erreur traitement paiement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Confirmer un paiement (Admin)
    async confirmPayment(ctx) {
        try {
            if (!await this.isAdmin(ctx.from.id)) {
                return ctx.reply('Action non autorisée');
            }

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('Commande non trouvée');
            }

            // Mettre à jour le statut
            await order.updateStatus('processing', 'Paiement confirmé');

            // Notifier le client
            await ctx.telegram.sendMessage(
                order.user.id,
                `✅ Votre paiement pour la commande ${order.orderNumber} a été confirmé\n` +
                `Nous allons traiter votre commande dans les plus brefs délais.`
            );

            // Message dans le canal
            if (order.channelId) {
                await ctx.telegram.sendMessage(
                    order.channelId,
                    `💳 Paiement confirmé par ${ctx.from.username}`
                );
            }

            await ctx.reply('✅ Paiement confirmé');
        } catch (error) {
            logger.error('Erreur confirmation paiement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer l'envoi d'un document
    async handleDocument(ctx) {
        try {
            // Vérifier si c'est un document de paiement
            const order = await Order.findOne({
                channelId: ctx.chat.id,
                status: 'pending'
            });

            if (!order) return;

            // Sauvegarder le document
            const file = ctx.message.document;
            const fileLink = await ctx.telegram.getFile(file.file_id);

            // Mettre à jour l'ordre avec la preuve de paiement
            await Order.updateOne(
                { _id: order._id },
                {
                    $set: {
                        'payment.proof': fileLink.file_path,
                        'payment.proofType': 'document',
                        'payment.status': 'pending_verification'
                    }
                }
            );

            // Notifier les admins
            await this.notifyAdmins(
                `📎 Nouvelle preuve de paiement\n` +
                `Commande: ${order.orderNumber}\n` +
                `Client: @${ctx.from.username}`
            );

            await ctx.reply(
                '✅ Document reçu! Notre équipe va vérifier votre paiement.\n' +
                'Nous vous notifierons dès que celui-ci sera confirmé.'
            );
        } catch (error) {
            logger.error('Erreur traitement document:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer l'envoi d'une photo
    async handlePhoto(ctx) {
        try {
            const order = await Order.findOne({
                channelId: ctx.chat.id,
                status: 'pending'
            });

            if (!order) return;

            // Sauvegarder la photo
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const fileLink = await ctx.telegram.getFile(photo.file_id);

            // Mettre à jour l'ordre avec la preuve de paiement
            await Order.updateOne(
                { _id: order._id },
                {
                    $set: {
                        'payment.proof': fileLink.file_path,
                        'payment.proofType': 'photo',
                        'payment.status': 'pending_verification'
                    }
                }
            );

            // Notifier les admins
            await this.notifyAdmins(
                `📸 Nouvelle preuve de paiement (photo)\n` +
                `Commande: ${order.orderNumber}\n` +
                `Client: @${ctx.from.username}`
            );

            await ctx.reply(
                '✅ Photo reçue! Notre équipe va vérifier votre paiement.\n' +
                'Nous vous notifierons dès que celui-ci sera confirmé.'
            );
        } catch (error) {
            logger.error('Erreur traitement photo:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Annuler une commande
    async cancelOrder(ctx) {
        try {
            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order || order.user.id !== ctx.from.id) {
                return ctx.reply('Commande non trouvée');
            }

            if (!['pending', 'pending_payment'].includes(order.status)) {
                return ctx.reply('Cette commande ne peut plus être annulée');
            }

            // Mettre à jour le statut
            await order.updateStatus('cancelled', 'Annulée par le client');

            // Notifier dans le canal
            if (order.channelId) {
                await ctx.telegram.sendMessage(
                    order.channelId,
                    `❌ Commande annulée par le client`
                );
            }

            await ctx.reply('✅ Commande annulée');
        } catch (error) {
            logger.error('Erreur annulation commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Envoyer le message initial dans le canal
    async sendInitialChannelMessage(order, channelId) {
        try {
            let message = `🆕 Nouvelle commande: #${order.orderNumber}\n\n`;
            message += `👤 Client: @${order.user.username}\n`;
            message += `📅 Date: ${order.createdAt.toLocaleString()}\n\n`;
            
            message += '🛍️ Produits:\n';
            for (const item of order.items) {
                message += `• ${item.product.name} x${item.quantity}\n`;
                message += `  Prix: ${item.price}€\n`;
            }

            message += `\n💰 Total: ${order.total}€`;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Accepter', `accept_order_${order._id}`),
                    Markup.button.callback('❌ Refuser', `reject_order_${order._id}`)
                ]
            ]);

            await this.bot.telegram.sendMessage(channelId, message, keyboard);
            
            // Catégoriser dans les canaux appropriés
            for (const item of order.items) {
                const product = await Product.findById(item.product)
                    .populate('category');
                
                if (product?.category?.channelId) {
                    await this.bot.telegram.forwardMessage(
                        product.category.channelId,
                        channelId,
                        message.message_id
                    );
                }
            }
        } catch (error) {
            logger.error('Erreur envoi message initial:', error);
            throw error;
        }
    }

    // Accepter une commande (Admin)
    async acceptOrder(ctx) {
        try {
            if (!await this.isAdmin(ctx.from.id)) {
                return ctx.reply('Action non autorisée');
            }

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('Commande non trouvée');
            }

            // Mettre à jour le statut
            await order.updateStatus('processing', 'Acceptée par ' + ctx.from.username);

            // Notifier le client
            await this.bot.telegram.sendMessage(
                order.user.id,
                `✅ Votre commande ${order.orderNumber} a été acceptée\n` +
                'Notre équipe va la traiter dans les plus brefs délais.'
            );

            // Message dans le canal
            await this.bot.telegram.sendMessage(
                order.channelId,
                `✅ Commande acceptée par @${ctx.from.username}`
            );

            // Rediriger vers les groupes de catégories
            for (const item of order.items) {
                const product = await Product.findById(item.product)
                    .populate('category');
                
                if (product?.category?.channelId) {
                    await this.bot.telegram.sendMessage(
                        product.category.channelId,
                        `📦 Nouvelle commande dans votre catégorie!\n` +
                        `#${order.orderNumber} - ${product.name}`
                    );
                }
            }
        } catch (error) {
            logger.error('Erreur acceptation commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Refuser une commande (Admin)
    async rejectOrder(ctx) {
        try {
            if (!await this.isAdmin(ctx.from.id)) {
                return ctx.reply('Action non autorisée');
            }

            // Demander la raison du refus
            ctx.scene.enter('reject_order_reason', { 
                orderId: ctx.match[1] 
            });
        } catch (error) {
            logger.error('Erreur refus commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Valider la raison du refus
    async handleRejectReason(ctx) {
        try {
            const { orderId } = ctx.scene.state;
            const reason = ctx.message.text;

            const order = await Order.findById(orderId);
            if (!order) {
                return ctx.reply('Commande non trouvée');
            }

            // Mettre à jour le statut
            await order.updateStatus('rejected', reason);

            // Notifier le client
            await this.bot.telegram.sendMessage(
                order.user.id,
                `❌ Votre commande ${order.orderNumber} a été refusée\n` +
                `Raison: ${reason}`
            );

            // Message dans le canal
            await this.bot.telegram.sendMessage(
                order.channelId,
                `❌ Commande refusée par @${ctx.from.username}\n` +
                `Raison: ${reason}`
            );

            await ctx.reply('Commande refusée');
            ctx.scene.leave();
        } catch (error) {
            logger.error('Erreur traitement raison refus:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Mettre à jour le statut d'une commande
    async updateOrderStatus(orderId, status, note) {
        try {
            const order = await Order.findById(orderId);
            if (!order) throw new Error('Commande non trouvée');

            // Mettre à jour le statut
            await order.updateStatus(status, note);

            // Message dans le canal
            if (order.channelId) {
                await this.bot.telegram.sendMessage(
                    order.channelId,
                    `📊 Statut mis à jour: ${status}\n` +
                    `📝 Note: ${note}`
                );
            }

            // Notifications spécifiques selon le statut
            switch (status) {
                case 'processing':
                    await this.notifyProcessingOrder(order);
                    break;
                case 'ready':
                    await this.notifyOrderReady(order);
                    break;
                case 'completed':
                    await this.notifyOrderCompleted(order);
                    break;
                case 'delivered':
                    await this.notifyOrderDelivered(order);
                    break;
            }

            return order;
        } catch (error) {
            logger.error('Erreur mise à jour statut:', error);
            throw error;
        }
    }

    // Notifications selon les statuts
    async notifyProcessingOrder(order) {
        await this.bot.telegram.sendMessage(
            order.user.id,
            `🔄 Votre commande ${order.orderNumber} est en cours de traitement\n` +
            'Nous vous notifierons dès qu\'elle sera prête.'
        );
    }

    async notifyOrderReady(order) {
        await this.bot.telegram.sendMessage(
            order.user.id,
            `✅ Votre commande ${order.orderNumber} est prête!\n` +
            'Suivez les instructions pour la réception.'
        );
    }

    async notifyOrderCompleted(order) {
        await this.bot.telegram.sendMessage(
            order.user.id,
            `🎉 Votre commande ${order.orderNumber} a été complétée avec succès!\n` +
            'Merci de votre confiance.'
        );

        // Archiver le canal après un délai
        setTimeout(async () => {
            try {
                if (order.channelId) {
                    await ConversationService.archiveChannel(order.channelId);
                }
            } catch (error) {
                logger.error('Erreur archivage canal:', error);
            }
        }, 24 * 60 * 60 * 1000); // 24h
    }

    async notifyOrderDelivered(order) {
        await this.bot.telegram.sendMessage(
            order.user.id,
            `📦 Votre commande ${order.orderNumber} a été livrée!\n` +
            'N\'oubliez pas de confirmer la bonne réception.'
        );
    }

    // Vérifier si un utilisateur est admin
    async isAdmin(userId) {
        const user = await User.findOne({ telegramId: userId });
        return user && ['admin', 'superadmin'].includes(user.role);
    }

    // Obtenir l'emoji du statut
    getStatusEmoji(status) {
        const emojis = {
            'pending': '⏳',
            'processing': '🔄',
            'ready': '✅',
            'delivered': '📦',
            'completed': '🎉',
            'cancelled': '❌',
            'rejected': '⛔',
            'refunded': '💰'
        };
        return emojis[status] || '❓';
    }

    // Démarrer la surveillance des commandes
    startMonitoring() {
        // Vérifier les commandes en attente
        setInterval(async () => {
            try {
                const pendingOrders = await Order.find({
                    status: 'pending',
                    createdAt: { 
                        $lt: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes
                    }
                });

                for (const order of pendingOrders) {
                    await this.notifyAdmins(
                        `⚠️ Commande en attente depuis 30 minutes\n` +
                        `#${order.orderNumber} - @${order.user.username}`
                    );
                }
            } catch (error) {
                logger.error('Erreur monitoring commandes:', error);
            }
        }, 15 * 60 * 1000); // Toutes les 15 minutes

        // Vérifier les messages non lus
        setInterval(async () => {
            try {
                const channels = await ConversationService.getChannelsWithUnreadMessages();
                for (const channel of channels) {
                    await this.notifyAdmins(
                        `📨 Messages non lus dans le canal ${channel.name}`
                    );
                }
            } catch (error) {
                logger.error('Erreur vérification messages:', error);
            }
        }, 30 * 60 * 1000); // Toutes les 30 minutes
    }

    // Notifier les administrateurs
    async notifyAdmins(message) {
        try {
            const admins = await User.find({
                role: { $in: ['admin', 'superadmin'] },
                status: 'active'
            });

            for (const admin of admins) {
                await this.bot.telegram.sendMessage(
                    admin.telegramId,
                    message,
                    { parse_mode: 'HTML' }
                );
            }
        } catch (error) {
            logger.error('Erreur notification admins:', error);
        }
    }
}

module.exports = OrderController;