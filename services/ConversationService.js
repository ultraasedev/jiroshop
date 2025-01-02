// services/ConversationService.js
const { Telegram } = require('telegraf');
const Category = require('../models/Category');
const Order = require('../models/Order');

class ConversationService {
    constructor(token) {
        this.telegram = new Telegram(token);
        this.categoryGroups = new Map();
    }

    async initializeCategoryGroups() {
        const categories = await Category.find();
        for (const category of categories) {
            const chatId = await this.createCategoryGroup(category.name);
            this.categoryGroups.set(category._id.toString(), chatId);
        }
    }

    async createCategoryGroup(categoryName) {
        try {
            // Créer un nouveau groupe pour la catégorie
            const group = await this.telegram.createChannel(
                `Support - ${categoryName}`,
                `Canal de support pour ${categoryName}`
            );

            return group.id;
        } catch (error) {
            console.error('Erreur création groupe:', error);
            throw error;
        }
    }

    async createOrderThread(order) {
        try {
            // Créer un nouveau groupe pour la commande
            const chatTitle = `Commande ${order.orderNumber} - ${order.user.username}`;
            const chat = await this.telegram.createChannel(chatTitle, {
                description: `Support pour la commande ${order.orderNumber}`
            });

            // Ajouter les administrateurs
            const admins = await User.find({ role: 'admin' });
            for (const admin of admins) {
                await this.telegram.addChatMember(chat.id, admin.telegramId);
            }

            // Ajouter l'utilisateur
            await this.telegram.addChatMember(chat.id, order.user.id);

            // Message initial
            const initialMessage = this.formatOrderMessage(order);
            await this.telegram.sendMessage(chat.id, initialMessage);

            // Organiser dans les groupes de catégories
            for (const item of order.products) {
                const product = await Product.findById(item.product)
                    .populate('category');
                
                const categoryGroupId = this.categoryGroups.get(product.category._id.toString());
                if (categoryGroupId) {
                    await this.telegram.forwardMessage(
                        categoryGroupId,
                        chat.id,
                        initialMessage.message_id
                    );
                }
            }

            return chat.id;
        } catch (error) {
            console.error('Erreur création thread:', error);
            throw error;
        }
    }

    async handleNewMessage(chatId, message) {
        try {
            const order = await Order.findOne({ conversationId: chatId });
            if (!order) return;

            // Mettre à jour le statut de lecture
            const isAdmin = await User.findOne({
                telegramId: message.from.id,
                role: { $in: ['admin', 'superadmin'] }
            });

            await Order.updateOne(
                { _id: order._id },
                {
                    $set: {
                        lastMessageAt: new Date(),
                        lastMessageBy: message.from.id,
                        unreadByUser: isAdmin,
                        unreadByAdmin: !isAdmin
                    }
                }
            );

            // Retransmettre dans les groupes de catégories
            const categories = new Set();
            for (const item of order.products) {
                const product = await Product.findById(item.product);
                if (product) {
                    categories.add(product.category.toString());
                }
            }

            for (const categoryId of categories) {
                const groupId = this.categoryGroups.get(categoryId);
                if (groupId) {
                    await this.telegram.forwardMessage(
                        groupId,
                        chatId,
                        message.message_id
                    );
                }
            }
        } catch (error) {
            console.error('Erreur traitement message:', error);
        }
    }

    formatOrderMessage(order) {
        let message = `📦 Nouvelle commande : ${order.orderNumber}\n\n`;
        message += `👤 Client: ${order.user.username}\n`;
        message += `📅 Date: ${order.createdAt.toLocaleString()}\n\n`;
        
        message += `🛍️ Produits:\n`;
        order.products.forEach(item => {
            message += `- ${item.product.name} x${item.quantity}\n`;
            message += `  Prix: ${item.price}€\n`;
        });

        message += `\n💰 Total: ${order.payment.amount.total}€\n`;
        message += `💳 Paiement: ${order.payment.method.name}\n`;

        return message;
    }

    async markAsRead(chatId, userId) {
        try {
            const order = await Order.findOne({ conversationId: chatId });
            if (!order) return;

            const isAdmin = await User.findOne({
                telegramId: userId,
                role: { $in: ['admin', 'superadmin'] }
            });

            const update = isAdmin
                ? { unreadByAdmin: false }
                : { unreadByUser: false };

            await Order.updateOne(
                { _id: order._id },
                { $set: update }
            );
        } catch (error) {
            console.error('Erreur marquage lecture:', error);
        }
    }

    async getUnreadCount(userId, isAdmin = false) {
        try {
            const query = isAdmin
                ? { unreadByAdmin: true }
                : { 
                    'user.id': userId,
                    unreadByUser: true
                };

            return await Order.countDocuments(query);
        } catch (error) {
            console.error('Erreur comptage non lus:', error);
            return 0;
        }
    }
}

module.exports = new ConversationService(process.env.BOT_TOKEN);