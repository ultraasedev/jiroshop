// controllers/AdminController.js
const { Markup } = require('telegraf');
const logger = require('../utils/logger');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Order = require('../models/Order');
const PaymentMethod = require('../models/PaymentMethod');

class AdminController {
    constructor(bot) {
        this.bot = bot;
        this.initializeAdminCommands();
    }

    initializeAdminCommands() {
        // Commande d'accès au panel admin
        this.bot.command('admin', this.showAdminPanel.bind(this));

        // Gestion des catégories
        this.bot.action('admin_categories', this.showCategoryManagement.bind(this));
        this.bot.action('add_category', this.startAddCategory.bind(this));
        this.bot.action(/^edit_category_(.+)$/, this.startEditCategory.bind(this));
        this.bot.action(/^delete_category_(.+)$/, this.confirmDeleteCategory.bind(this));

        // Gestion des produits
        this.bot.action('admin_products', this.showProductManagement.bind(this));
        this.bot.action('add_product', this.startAddProduct.bind(this));
        this.bot.action(/^edit_product_(.+)$/, this.startEditProduct.bind(this));
        this.bot.action(/^delete_product_(.+)$/, this.confirmDeleteProduct.bind(this));

        // Gestion des paiements
        this.bot.action('admin_payments', this.showPaymentManagement.bind(this));
        this.bot.action('add_payment_method', this.startAddPaymentMethod.bind(this));
        this.bot.action(/^edit_payment_(.+)$/, this.startEditPaymentMethod.bind(this));
        this.bot.action(/^delete_payment_(.+)$/, this.confirmDeletePaymentMethod.bind(this));

        // Gestion des commandes
        this.bot.action('admin_orders', this.showOrderManagement.bind(this));
        this.bot.action(/^view_order_(.+)$/, this.viewOrder.bind(this));
        this.bot.action(/^approve_order_(.+)$/, this.approveOrder.bind(this));
        this.bot.action(/^reject_order_(.+)$/, this.rejectOrder.bind(this));

        // Statistiques et rapports
        this.bot.action('admin_stats', this.showStatistics.bind(this));
        this.bot.action('generate_report', this.generateReport.bind(this));

        // Gestion des utilisateurs
        this.bot.action('admin_users', this.showUserManagement.bind(this));
        this.bot.action(/^view_user_(.+)$/, this.viewUser.bind(this));
        this.bot.action(/^ban_user_(.+)$/, this.banUser.bind(this));
        this.bot.action(/^unban_user_(.+)$/, this.unbanUser.bind(this));
    }

    // Vérification des permissions admin
    async isAdmin(ctx) {
        try {
            const user = await User.findOne({ telegramId: ctx.from.id });
            return user && (user.role === 'admin' || user.role === 'superadmin');
        } catch (error) {
            logger.error('Erreur vérification admin:', error);
            return false;
        }
    }

    // Panel d'administration principal
    async showAdminPanel(ctx) {
        try {
            if (!await this.isAdmin(ctx)) {
                return ctx.reply('⛔ Accès non autorisé');
            }

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('📦 Produits', 'admin_products'),
                    Markup.button.callback('📑 Catégories', 'admin_categories')
                ],
                [
                    Markup.button.callback('💳 Paiements', 'admin_payments'),
                    Markup.button.callback('📦 Commandes', 'admin_orders')
                ],
                [
                    Markup.button.callback('👥 Utilisateurs', 'admin_users'),
                    Markup.button.callback('📊 Statistiques', 'admin_stats')
                ],
                [
                    Markup.button.callback('⚙️ Configuration', 'admin_config')
                ]
            ]);

            await ctx.reply('🔧 Panel Administrateur', keyboard);
        } catch (error) {
            logger.error('Erreur affichage panel admin:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gestion des catégories
    async showCategoryManagement(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categories = await Category.find().sort({ order: 1 });
            const categoryButtons = categories.map(cat => [
                Markup.button.callback(`📝 ${cat.name}`, `edit_category_${cat._id}`),
                Markup.button.callback('🗑️', `delete_category_${cat._id}`)
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...categoryButtons,
                [Markup.button.callback('➕ Nouvelle Catégorie', 'add_category')],
                [Markup.button.callback('🔙 Retour', 'admin_panel')]
            ]);

            await ctx.reply('📑 Gestion des Catégories', keyboard);
        } catch (error) {
            logger.error('Erreur gestion catégories:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gestion des produits
    async showProductManagement(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const products = await Product.find()
                .populate('category')
                .sort({ createdAt: -1 })
                .limit(10);

            const productButtons = products.map(prod => [
                Markup.button.callback(
                    `📝 ${prod.name} (${prod.category.name})`,
                    `edit_product_${prod._id}`
                ),
                Markup.button.callback('🗑️', `delete_product_${prod._id}`)
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...productButtons,
                [Markup.button.callback('➕ Nouveau Produit', 'add_product')],
                [Markup.button.callback('🔍 Rechercher', 'search_products')],
                [Markup.button.callback('🔙 Retour', 'admin_panel')]
            ]);

            await ctx.reply('📦 Gestion des Produits', keyboard);
        } catch (error) {
            logger.error('Erreur gestion produits:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gestion des méthodes de paiement
    async showPaymentManagement(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const paymentMethods = await PaymentMethod.find()
                .sort({ displayOrder: 1 });

            const methodButtons = paymentMethods.map(method => [
                Markup.button.callback(
                    `${method.status === 'active' ? '✅' : '❌'} ${method.name}`,
                    `edit_payment_${method._id}`
                ),
                Markup.button.callback('🗑️', `delete_payment_${method._id}`)
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...methodButtons,
                [Markup.button.callback('➕ Nouvelle Méthode', 'add_payment_method')],
                [Markup.button.callback('🔙 Retour', 'admin_panel')]
            ]);

            await ctx.reply('💳 Gestion des Paiements', keyboard);
        } catch (error) {
            logger.error('Erreur gestion paiements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gestion des commandes
    async showOrderManagement(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const pendingOrders = await Order.find({
                status: { $in: ['pending', 'processing'] }
            })
            .populate('user payment.method')
            .sort({ createdAt: -1 })
            .limit(10);

            const orderButtons = pendingOrders.map(order => [
                Markup.button.callback(
                    `📦 ${order.orderNumber} (${order.status})`,
                    `view_order_${order._id}`
                )
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...orderButtons,
                [
                    Markup.button.callback('🔍 Rechercher', 'search_orders'),
                    Markup.button.callback('📊 Stats', 'order_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_panel')]
            ]);

            await ctx.reply('📦 Gestion des Commandes', keyboard);
        } catch (error) {
            logger.error('Erreur gestion commandes:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Voir les détails d'une commande
    async viewOrder(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId)
                .populate('user products.product payment.method');

            if (!order) {
                return ctx.reply('Commande non trouvée');
            }

            let message = `📦 Commande ${order.orderNumber}\n\n`;
            message += `👤 Client: ${order.user.username}\n`;
            message += `📅 Date: ${order.createdAt.toLocaleDateString()}\n`;
            message += `📊 Statut: ${order.status}\n\n`;
            message += `🛍️ Produits:\n`;

            order.products.forEach(item => {
                message += `- ${item.product.name} x${item.quantity}\n`;
                message += `  Prix: ${item.price}€\n`;
            });

            message += `\n💰 Total: ${order.payment.amount.total}€\n`;
            message += `💳 Paiement: ${order.payment.method.name}\n`;
            message += `📊 Statut paiement: ${order.payment.status}\n`;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Approuver', `approve_order_${order._id}`),
                    Markup.button.callback('❌ Rejeter', `reject_order_${order._id}`)
                ],
                [Markup.button.callback('🔙 Retour', 'admin_orders')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur affichage commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Approuver une commande
    async approveOrder(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('Commande non trouvée');
            }

            await order.updateStatus('completed', 'Commande approuvée par admin', ctx.from.id);
            await ctx.reply(`✅ Commande ${order.orderNumber} approuvée`);
            await this.showOrderManagement(ctx);
        } catch (error) {
            logger.error('Erreur approbation commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Rejeter une commande
    async rejectOrder(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('Commande non trouvée');
            }

            await order.updateStatus('cancelled', 'Commande rejetée par admin', ctx.from.id);
            await ctx.reply(`❌ Commande ${order.orderNumber} rejetée`);
            await this.showOrderManagement(ctx);
        } catch (error) {
            logger.error('Erreur rejet commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gestion des statistiques
    async showStatistics(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const stats = {
                orders: await Order.getStats(),
                users: await User.getStats(),
                revenue: await this.calculateRevenue()
            };

            let message = '📊 Statistiques\n\n';
            message += '📦 Commandes:\n';
            stats.orders.forEach(stat => {
                message += `${stat._id}: ${stat.count} (${stat.totalAmount}€)\n`;
            });

            message += '\n👥 Utilisateurs:\n';
            message += `Total: ${stats.users.totalUsers}\n`;
            message += `Actifs: ${stats.users.activeUsers}\n`;

            message += '\n💰 Revenus:\n';
            message += `Aujourd'hui: ${stats.revenue.daily}€\n`;
            message += `Cette semaine: ${stats.revenue.weekly}€\n`;
            message += `Ce mois: ${stats.revenue.monthly}€\n`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('📊 Rapport détaillé', 'generate_report')],
                [Markup.button.callback('🔙 Retour', 'admin_panel')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur affichage statistiques:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Calcul des revenus
    async calculateRevenue() {
        const now = new Date();
        const startOfDay = new Date(now.setHours(0, 0, 0, 0));
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfMonth = new Date(now.setDate(1));

        const [daily, weekly, monthly] = await Promise.all([
            Order.aggregate([
                {
                    $match: {
                        status: 'completed',
                        createdAt: { $gte: startOfDay }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$payment.amount.total' }
                    }
                }
            ]),
            Order.aggregate([
                {
                    $match: {
                        status: 'completed',
                        createdAt: { $gte: startOfWeek }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$payment.amount.total' }
                    }
                }
            ]),
            Order.aggregate([
                {
                    $match: {
                        status: 'completed',
                        createdAt: { $gte: startOfMonth }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$payment.amount.total' }
                    }
                }
            ])
        ]);

        return {
            daily: daily[0]?.total || 0,
            weekly: weekly[0]?.total || 0,
            monthly: monthly[0]?.total || 0
        };
    }

    // Génération de rapport
    async generateReport(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const endDate = new Date();
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);

            const report = await Order.generateReport({
                startDate,
                endDate,
                groupBy: 'day'
            });

            let message = '📊 Rapport du dernier mois\n\n';
            report.forEach(day => {
                message += `📅 ${day._id}:\n`;
                message += `- Commandes: ${day.totalOrders}\n`;
                message += `- Complétées: ${day.completedOrders}\n`;
                message += `- Revenus: ${day.totalRevenue}€\n`;
                message += `- Panier moyen: ${Math.round(day.avgOrderValue)}€\n\n`;
            });

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('📩 Envoyer par email', 'email_report')],
                [Markup.button.callback('🔙 Retour', 'admin_stats')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur génération rapport:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gestion des utilisateurs
    async showUserManagement(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const users = await User.find()
                .sort({ createdAt: -1 })
                .limit(10);

            const userButtons = users.map(user => [
                Markup.button.callback(
                    `${user.status === 'active' ? '✅' : '❌'} ${user.username}`,
                    `view_user_${user._id}`
                )
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...userButtons,
                [
                    Markup.button.callback('🔍 Rechercher', 'search_users'),
                    Markup.button.callback('📊 Stats', 'user_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_panel')]
            ]);

            await ctx.reply('👥 Gestion des Utilisateurs', keyboard);
        } catch (error) {
            logger.error('Erreur gestion utilisateurs:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Voir les détails d'un utilisateur
    async viewUser(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const userId = ctx.match[1];
            const user = await User.findById(userId)
                .populate('stats.favoriteCategories.category');

            if (!user) {
                return ctx.reply('Utilisateur non trouvé');
            }

            let message = `👤 Utilisateur: ${user.username}\n`;
            message += `📱 Telegram ID: ${user.telegramId}\n`;
            message += `📊 Statut: ${user.status}\n`;
            message += `👑 Rôle: ${user.role}\n\n`;
            
            message += `📈 Statistiques:\n`;
            message += `- Commandes totales: ${user.stats.totalOrders}\n`;
            message += `- Montant total: ${user.stats.totalSpent}€\n`;
            
            if (user.stats.favoriteCategories.length > 0) {
                message += `\n🏷️ Catégories préférées:\n`;
                user.stats.favoriteCategories.forEach(fc => {
                    message += `- ${fc.category.name} (${fc.count} achats)\n`;
                });
            }

            const keyboard = Markup.inlineKeyboard([
                [
                    user.status === 'active'
                        ? Markup.button.callback('🚫 Bannir', `ban_user_${user._id}`)
                        : Markup.button.callback('✅ Débannir', `unban_user_${user._id}`)
                ],
                [
                    Markup.button.callback('📝 Notes', `user_notes_${user._id}`),
                    Markup.button.callback('📦 Commandes', `user_orders_${user._id}`)
                ],
                [Markup.button.callback('🔙 Retour', 'admin_users')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur affichage utilisateur:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Bannir un utilisateur
    async banUser(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const userId = ctx.match[1];
            const user = await User.findById(userId);

            if (!user) {
                return ctx.reply('Utilisateur non trouvé');
            }

            user.status = 'banned';
            await user.save();

            await ctx.reply(`🚫 L'utilisateur ${user.username} a été banni`);
            await this.viewUser(ctx);
        } catch (error) {
            logger.error('Erreur bannissement utilisateur:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Débannir un utilisateur
    async unbanUser(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const userId = ctx.match[1];
            const user = await User.findById(userId);

            if (!user) {
                return ctx.reply('Utilisateur non trouvé');
            }

            user.status = 'active';
            await user.save();

            await ctx.reply(`✅ L'utilisateur ${user.username} a été débanni`);
            await this.viewUser(ctx);
        } catch (error) {
            logger.error('Erreur débannissement utilisateur:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Ajout d'une catégorie
    async startAddCategory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            ctx.session.adminState = {
                action: 'add_category',
                step: 'name'
            };

            await ctx.reply('📝 Entrez le nom de la nouvelle catégorie:');
        } catch (error) {
            logger.error('Erreur début ajout catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Modification d'une catégorie
    async startEditCategory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('Catégorie non trouvée');
            }

            ctx.session.adminState = {
                action: 'edit_category',
                categoryId: categoryId,
                step: 'menu'
            };

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('📝 Nom', `edit_category_name_${categoryId}`),
                    Markup.button.callback('📋 Description', `edit_category_desc_${categoryId}`)
                ],
                [
                    Markup.button.callback('🖼️ Image', `edit_category_image_${categoryId}`),
                    Markup.button.callback('🔢 Ordre', `edit_category_order_${categoryId}`)
                ],
                [Markup.button.callback('🔙 Retour', 'admin_categories')]
            ]);

            await ctx.reply(
                `📑 Modification de la catégorie: ${category.name}\n` +
                `Description actuelle: ${category.description}`,
                keyboard
            );
        } catch (error) {
            logger.error('Erreur début modification catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // État global pour gérer les sessions d'édition
    handleAdminInput(ctx) {
        if (!ctx.session.adminState) return false;

        switch (ctx.session.adminState.action) {
            case 'add_category':
                return this.handleAddCategoryInput(ctx);
            case 'edit_category':
                return this.handleEditCategoryInput(ctx);
            case 'add_product':
                return this.handleAddProductInput(ctx);
            case 'edit_product':
                return this.handleEditProductInput(ctx);
            default:
                return false;
        }
    }

    // Nettoyage des dialogues admin
    clearAdminState(ctx) {
        if (ctx.session.adminState) {
            delete ctx.session.adminState;
        }
    }
     // Gestion de l'ajout d'une catégorie
     async handleAddCategoryInput(ctx) {
        try {
            const { step } = ctx.session.adminState;

            switch (step) {
                case 'name':
                    const name = ctx.message.text;
                    const category = await Category.create({
                        name,
                        active: true
                    });

                    this.clearAdminState(ctx);
                    await ctx.reply(`✅ Catégorie "${name}" créée avec succès!`);
                    await this.showCategoryManagement(ctx);
                    return true;
            }
        } catch (error) {
            logger.error('Erreur ajout catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
            return true;
        }
    }

    // Gestion de la modification d'une catégorie
    async handleEditCategoryInput(ctx) {
        try {
            const { step, categoryId } = ctx.session.adminState;
            const category = await Category.findById(categoryId);

            if (!category) {
                this.clearAdminState(ctx);
                await ctx.reply('Catégorie non trouvée');
                return true;
            }

            switch (step) {
                case 'name':
                    category.name = ctx.message.text;
                    await category.save();
                    break;
                
                case 'description':
                    category.description = ctx.message.text;
                    await category.save();
                    break;
                
                case 'order':
                    const order = parseInt(ctx.message.text);
                    if (isNaN(order)) {
                        await ctx.reply('Veuillez entrer un nombre valide');
                        return true;
                    }
                    category.order = order;
                    await category.save();
                    break;
            }

            this.clearAdminState(ctx);
            await ctx.reply('✅ Catégorie mise à jour avec succès!');
            await this.showCategoryManagement(ctx);
            return true;

        } catch (error) {
            logger.error('Erreur modification catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
            return true;
        }
    }

    // Confirmation de suppression d'une catégorie
    async confirmDeleteCategory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('Catégorie non trouvée');
            }

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Confirmer', `delete_category_confirm_${categoryId}`),
                    Markup.button.callback('❌ Annuler', 'admin_categories')
                ]
            ]);

            await ctx.reply(
                `⚠️ Êtes-vous sûr de vouloir supprimer la catégorie "${category.name}" ?`,
                keyboard
            );
        } catch (error) {
            logger.error('Erreur confirmation suppression:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Supprimer une catégorie
    async deleteCategory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('Catégorie non trouvée');
            }

            await Category.deleteOne({ _id: categoryId });
            await ctx.reply(`✅ Catégorie "${category.name}" supprimée avec succès`);
            await this.showCategoryManagement(ctx);
        } catch (error) {
            logger.error('Erreur suppression catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
}

module.exports = AdminController;