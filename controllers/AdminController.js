// controllers/AdminController.js
const { Markup } = require('telegraf');
const logger = require('../utils/logger');
const i18n = require('../utils/i18n');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Order = require('../models/Order');
const PaymentMethod = require('../models/PaymentMethod');
const AdminLog = require('../models/AdminLog');
const Config = require('../models/Config');
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');

class AdminController {
    constructor(bot) {
        if (!bot) {
            throw new Error('Bot instance is required');
        }
        this.bot = bot;

        // Middleware pour les commandes admin
        this.bot.use(async (ctx, next) => {
            const updateType = ctx.updateType;
            if (updateType === 'channel_post' ||
                updateType === 'callback_query' ||
                (ctx.message?.text && ctx.message.text.startsWith('/admin'))) {

                logger.debug('Commande admin détectée:', {
                    type: updateType,
                    from: ctx.from,
                    chat: ctx.chat,
                    channelPost: ctx.channelPost,
                    message: ctx.message,
                    callbackQuery: ctx.callbackQuery,
                    session: ctx.session
                });
            }
            return next();
        });

        this.bot.on('channel_post', (ctx) => {
            if (ctx.channelPost?.text?.startsWith('/admin')) {
                return this.handleChannelAdminCommand(ctx);
            }
        });

        this.initializeChannelHandlers();
        this.initializeAdminCommands();
    }

    async handleChannelAdminCommand(ctx) {
        try {
            const chatId = ctx.channelPost.chat.id;
            logger.debug('Commande admin de canal reçue:', {
                chatId,
                text: ctx.channelPost.text
            });

            // Vérifier si c'est un administrateur
            if (!await this.isAdmin(ctx)) {
                await ctx.telegram.sendMessage(chatId, '⛔ Accès non autorisé');
                return;
            }

            // Traiter la commande
            if (ctx.channelPost.text === '/admin') {
                await this.showAdminPanel(ctx);
            }
        } catch (error) {
            logger.error('Erreur traitement commande admin canal:', error);
            const chatId = ctx.channelPost.chat.id;
            await ctx.telegram.sendMessage(chatId, 'Une erreur est survenue').catch(console.error);
        }
    }

    // Ajout de la méthode pour gérer les messages de canal
    initializeChannelHandlers() {
        this.bot.on('channel_post', async (ctx) => {
            try {
                // Vérifier si c'est une commande admin
                if (ctx.channelPost.text === '/admin') {
                    // Vérifier les permissions
                    const adminIds = process.env.ADMIN_ID.split(',').map(id => parseInt(id));
                    const senderChatId = ctx.channelPost.sender_chat.id;

                    if (adminIds.includes(senderChatId)) {
                        await this.showAdminPanel(ctx);
                    }
                }
            } catch (error) {
                logger.error('Erreur gestion message canal:', error);
            }
        });
    }

    initializeAdminCommands() {
        try {
            console.log('Initialisation des commandes admin...');

            // Panel admin principal
            this.bot.command('admin', async (ctx) => {
                console.log('Commande /admin reçue');
                await this.showAdminPanel(ctx);
            });

            this.bot.action('admin_panel', async (ctx) => {
                console.log('Action admin_panel reçue');
                await this.showAdminPanel(ctx);
            });

            // Pour les messages de canal
            this.bot.on('channel_post', async (ctx) => {
                console.log('Message de canal reçu:', ctx.channelPost);
                if (ctx.channelPost.text === '/admin') {
                    await this.showAdminPanel(ctx);
                }
            });

            // Gestion des catégories
            this.bot.action('admin_categories', (ctx) => this.showCategoryManagement(ctx));
            this.bot.action('add_category', (ctx) => this.startAddCategory(ctx));
            this.bot.action(/^edit_category_(.+)$/, (ctx) => this.startEditCategory(ctx));
            this.bot.action(/^delete_category_(.+)$/, (ctx) => this.confirmDeleteCategory(ctx));
            this.bot.action(/^delete_category_confirm_(.+)$/, (ctx) => this.deleteCategory(ctx));
            this.bot.action(/^edit_category_name_(.+)$/, (ctx) => this.editCategoryName(ctx));
            this.bot.action(/^edit_category_desc_(.+)$/, (ctx) => this.editCategoryDescription(ctx));
            this.bot.action(/^edit_category_image_(.+)$/, (ctx) => this.editCategoryImage(ctx));
            this.bot.action(/^edit_category_order_(.+)$/, (ctx) => this.editCategoryOrder(ctx));
            this.bot.action(/^toggle_category_(.+)$/, (ctx) => this.toggleCategory(ctx));

            // Gestion des produits
            this.bot.action('admin_products', (ctx) => this.showProductManagement(ctx));
            this.bot.action('add_product', (ctx) => this.startAddProduct(ctx));
            this.bot.action(/^edit_product_(.+)$/, (ctx) => this.startEditProduct(ctx));
            this.bot.action(/^delete_product_(.+)$/, (ctx) => this.confirmDeleteProduct(ctx));
            this.bot.action(/^delete_product_confirm_(.+)$/, (ctx) => this.deleteProduct(ctx));
            this.bot.action('search_products', (ctx) => this.searchProducts(ctx));
            this.bot.action(/^edit_product_name_(.+)$/, (ctx) => this.editProductName(ctx));
            this.bot.action(/^edit_product_price_(.+)$/, (ctx) => this.editProductPrice(ctx));
            this.bot.action(/^edit_product_desc_(.+)$/, (ctx) => this.editProductDescription(ctx));
            this.bot.action(/^edit_product_category_(.+)$/, (ctx) => this.editProductCategory(ctx));
            this.bot.action(/^toggle_product_(.+)$/, (ctx) => this.toggleProduct(ctx));
            this.bot.action(/^select_category_(.+)$/, (ctx) => this.selectProductCategory(ctx));

            // Gestion des paiements
            this.bot.action('admin_payments', (ctx) => this.showPaymentManagement(ctx));
            this.bot.action('add_payment_method', (ctx) => this.startAddPaymentMethod(ctx));
            this.bot.action(/^edit_payment_(.+)$/, (ctx) => this.startEditPaymentMethod(ctx));
            this.bot.action(/^delete_payment_(.+)$/, (ctx) => this.confirmDeletePaymentMethod(ctx));
            this.bot.action(/^toggle_payment_(.+)$/, (ctx) => this.togglePaymentMethod(ctx));
            this.bot.action(/^edit_payment_fees_(.+)$/, (ctx) => this.editPaymentFees(ctx));
            this.bot.action(/^edit_payment_config_(.+)$/, (ctx) => this.editPaymentConfig(ctx));

            // Méthodes de paiement spécifiques
            this.bot.action('add_payment_paypal', (ctx) => this.addPaymentPaypal(ctx));
            this.bot.action('add_payment_crypto', (ctx) => this.addPaymentCrypto(ctx));
            this.bot.action('add_payment_pcs', (ctx) => this.addPaymentPcs(ctx));
            this.bot.action('add_payment_transcash', (ctx) => this.addPaymentTranscash(ctx));
            this.bot.action('add_payment_paysafecard', (ctx) => this.addPaymentPaysafecard(ctx));
            this.bot.action('add_payment_cash', (ctx) => this.addPaymentCash(ctx));

            // Gestion des commandes
            this.bot.action('admin_orders', (ctx) => this.showOrderManagement(ctx));
            this.bot.action(/^view_order_(.+)$/, (ctx) => this.viewOrder(ctx));
            this.bot.action('search_orders', (ctx) => this.searchOrders(ctx));
            this.bot.action('order_stats', (ctx) => this.showOrderStats(ctx));
            this.bot.action('order_stats_details', (ctx) => this.showOrderStatsDetails(ctx));
            this.bot.action('order_stats_graphs', (ctx) => this.showOrderStatsGraphs(ctx));
            this.bot.action('export_order_stats', (ctx) => this.exportOrderStats(ctx));

            // Actions sur les commandes
            this.bot.action(/^approve_order_(.+)$/, (ctx) => this.approveOrder(ctx));
            this.bot.action(/^reject_order_(.+)$/, (ctx) => this.rejectOrder(ctx));
            this.bot.action(/^mark_delivered_(.+)$/, (ctx) => this.markOrderAsDelivered(ctx));
            this.bot.action(/^complete_order_(.+)$/, (ctx) => this.completeOrder(ctx));
            this.bot.action(/^cancel_order_(.+)$/, (ctx) => this.cancelOrder(ctx));
            this.bot.action(/^refund_order_(.+)$/, (ctx) => this.refundOrder(ctx));

            // Gestion des utilisateurs
            this.bot.action('admin_users', (ctx) => this.showUserManagement(ctx));
            this.bot.action(/^view_user_(.+)$/, (ctx) => this.viewUser(ctx));
            this.bot.action(/^ban_user_(.+)$/, (ctx) => this.banUser(ctx));
            this.bot.action(/^unban_user_(.+)$/, (ctx) => this.unbanUser(ctx));
            this.bot.action('search_users', (ctx) => this.searchUsers(ctx));
            this.bot.action('user_stats', (ctx) => this.showUserStats(ctx));
            this.bot.action(/^user_notes_(.+)$/, (ctx) => this.showUserNotes(ctx));
            this.bot.action(/^add_user_note_(.+)$/, (ctx) => this.addUserNote(ctx));
            this.bot.action(/^contact_user_(.+)$/, (ctx) => this.contactUser(ctx));

            // Configuration
            this.bot.action('admin_config', (ctx) => this.showAdminConfig(ctx));
            this.bot.action('edit_bot_settings', (ctx) => this.editBotSettings(ctx));
            this.bot.action('edit_bot_name', (ctx) => this.editBotName(ctx));
            this.bot.action('edit_bot_language', (ctx) => this.editBotLanguage(ctx));
            this.bot.action('edit_security_settings', (ctx) => this.editSecuritySettings(ctx));
            this.bot.action('edit_notification_settings', (ctx) => this.editNotificationSettings(ctx));
            this.bot.action('edit_payment_settings', (ctx) => this.editPaymentSettings(ctx));

            // Backup et logs
            this.bot.action('manage_backup', (ctx) => this.manageBackup(ctx));
            this.bot.action('view_logs', (ctx) => this.viewLogs(ctx));
            this.bot.action('create_backup', (ctx) => this.createNewBackup(ctx));
            this.bot.action('restore_backup', (ctx) => this.restoreFromBackup(ctx));
            this.bot.action('view_error_logs', (ctx) => this.viewErrorLogs(ctx));
            this.bot.action('view_admin_logs', (ctx) => this.viewAdminLogs(ctx));
            this.bot.action('download_logs', (ctx) => this.downloadLogs(ctx));
            this.bot.action('clear_logs', (ctx) => this.clearLogs(ctx));

            //Gestion de la langue 
            this.bot.action(/^set_language_(.+)$/, async (ctx) => {
                try {
                    const language = ctx.match[1];
                    const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;

                    if (!chatId) {
                        console.error('Chat ID non trouvé');
                        return;
                    }

                    // Mettre à jour la configuration
                    const config = await Config.findOne() || new Config();
                    const oldLanguage = config.language;
                    config.language = language;
                    await config.save();

                    // Logger l'action
                    await this.logAdminAction(
                        ctx.from.id,
                        'edit_bot_language',
                        {
                            entityType: 'system',
                            entityId: config._id,
                            details: {
                                oldLanguage,
                                newLanguage: language
                            },
                            changes: {
                                before: { language: oldLanguage },
                                after: { language }
                            }
                        }
                    );

                    // Nettoyage de l'état
                    if (ctx.session) {
                        ctx.session.adminState = null;
                    }

                    // Confirmation
                    await ctx.telegram.sendMessage(
                        chatId,
                        `✅ Langue du bot modifiée en : ${language}`
                    );

                    // Retour aux paramètres
                    await this.editBotSettings(ctx);
                } catch (error) {
                    console.error('Erreur changement langue:', error);
                    if (ctx.chat?.id) {
                        await ctx.telegram.sendMessage(
                            ctx.chat.id,
                            '❌ Une erreur est survenue lors du changement de langue'
                        ).catch(console.error);
                    }
                }
            });

            // Gestionnaire global de texte
            this.bot.on('text', async (ctx) => {
                try {
                    if (await this.handleTextInput(ctx)) {
                        return; // Le texte a été traité par un gestionnaire spécifique
                    }
                    // Entrée texte pour l'édition du nom du bot
                    if (ctx.session?.adminState?.action === 'edit_bot_name') {
                        await this.handleBotNameEdit(ctx);
                        return;
                    }
                    // Si le texte n'a pas été traité, vous pouvez ajouter une logique par défaut ici
                } catch (error) {
                    console.error('Erreur gestionnaire texte:', error);
                }
            });

            //Gestion du Fuseau Horaires :
            this.bot.action('edit_bot_timezone', (ctx) => this.editBotTimezone(ctx));
            this.bot.action(/^set_timezone_(.+)$/, (ctx) => {
                const timezone = ctx.match[1];
                return this.setBotTimezone(ctx, timezone);
            });
            console.log('Commandes admin initialisées avec succès');
        } catch (error) {
            console.error('Erreur initialisation commandes admin:', error);
        }
    }
    // Ajouter cette méthode à votre AdminController
    clearAdminState(ctx) {
        if (ctx.session) {
            ctx.session.adminState = null;
        }
    }

    async handleTextInput(ctx) {
        try {
            if (!ctx.session?.adminState) return false;

            const { action, step } = ctx.session.adminState;
            console.log('Traitement entrée texte:', { action, step });

            switch (action) {
                case 'edit_bot_name':
                    await this.handleBotNameEdit(ctx);
                    return true;

                case 'add_category':
                    await this.handleAddCategoryInput(ctx);
                    return true;

                case 'edit_category':
                    await this.handleEditCategoryInput(ctx);
                    return true;

                case 'add_product':
                    await this.handleAddProductInput(ctx);
                    return true;

                case 'edit_product':
                    await this.handleEditProductInput(ctx);
                    return true;

                case 'add_payment':
                    await this.handleAddPaymentInput(ctx);
                    return true;

                case 'edit_payment':
                    await this.handleEditPaymentInput(ctx);
                    return true;

                default:
                    return false;
            }
        } catch (error) {
            console.error('Erreur traitement texte:', error);
            return false;
        }
    }
    // Vérification des permissions admin

    async isAdmin(ctx) {
        try {
            console.log('Vérification des permissions admin pour:', {
                from: ctx.from,
                chat: ctx.chat,
                channelPost: ctx.channelPost
            });

            // Récupérer l'ID admin depuis les variables d'environnement
            const adminIds = process.env.ADMIN_ID.split(',').map(id => id.trim());

            // Récupérer l'ID de l'utilisateur ou du canal
            let userId;
            if (ctx.from?.id) {
                userId = ctx.from.id.toString();
            } else if (ctx.channelPost?.chat?.id) {
                userId = ctx.channelPost.chat.id.toString();
            } else {
                console.log('Pas d\'ID utilisateur trouvé dans le contexte');
                return false;
            }

            console.log('Comparaison des IDs:', {
                userId,
                adminIds,
                isAdmin: adminIds.includes(userId)
            });

            return adminIds.includes(userId);
        } catch (error) {
            console.error('Erreur lors de la vérification admin:', error);
            return false;
        }
    }
    async handleChannelPost(ctx) {
        try {
            const chatId = ctx.channelPost.chat.id;
            console.log('Message de canal reçu:', {
                chatId,
                text: ctx.channelPost.text,
                from: ctx.channelPost.sender_chat
            });

            if (ctx.channelPost.text === '/admin') {
                if (await this.isAdmin(ctx)) {
                    await this.showAdminPanel(ctx);
                } else {
                    await ctx.telegram.sendMessage(chatId, '⛔ Accès non autorisé');
                }
            }
        } catch (error) {
            console.error('Erreur traitement message canal:', error);
        }
    }

    // Panel d'administration principal
    async showAdminPanel(ctx) {
        try {
            console.log('Affichage du panel admin pour:', {
                from: ctx.from,
                chat: ctx.chat,
                updateType: ctx.updateType
            });

            // Obtenir le chat ID de manière robuste
            const chatId = ctx.chat?.id || ctx.channelPost?.chat?.id;

            if (!chatId) {
                console.error('Pas de chat ID trouvé pour le panel admin');
                return;
            }

            // Vérifier les permissions admin
            if (!await this.isAdmin(ctx)) {
                await ctx.telegram.sendMessage(chatId, '⛔ Accès non autorisé');
                return;
            }

            // Construction du clavier
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📦 Produits', callback_data: 'admin_products' },
                        { text: '📑 Catégories', callback_data: 'admin_categories' }
                    ],
                    [
                        { text: '💳 Paiements', callback_data: 'admin_payments' },
                        { text: '📦 Commandes', callback_data: 'admin_orders' }
                    ],
                    [
                        { text: '👥 Utilisateurs', callback_data: 'admin_users' },
                        { text: '📊 Statistiques', callback_data: 'admin_stats' }
                    ],
                    [
                        { text: '⚙️ Configuration', callback_data: 'admin_config' }
                    ]
                ]
            };

            // Envoi du message avec le clavier
            console.log('Envoi du panel admin à:', chatId);
            await ctx.telegram.sendMessage(
                chatId,
                '🔧 Panel Administrateur',
                { reply_markup: keyboard }
            );

            console.log('Panel admin envoyé avec succès');
        } catch (error) {
            console.error('Erreur affichage panel admin:', {
                error: error,
                errorMessage: error.message,
                stack: error.stack
            });

            // Tenter d'envoyer un message d'erreur
            const chatId = ctx.chat?.id || ctx.channelPost?.chat?.id;
            if (chatId) {
                await ctx.telegram.sendMessage(
                    chatId,
                    'Une erreur est survenue lors de l\'affichage du panel administrateur'
                ).catch(e => console.error('Erreur envoi message erreur:', e));
            }
        }
    }
    //===================== GESTION DES CATÉGORIES =====================

    // Afficher la gestion des catégories
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

    // Démarrer l'ajout d'une catégorie
    async startAddCategory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            ctx.session.adminState = {
                action: 'add_category',
                step: 'name'
            };

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', 'admin_categories')]
            ]);

            await ctx.reply('📝 Entrez le nom de la nouvelle catégorie:', keyboard);
        } catch (error) {
            logger.error('Erreur début ajout catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer l'ajout d'une catégorie
    async handleAddCategoryInput(ctx) {
        try {
            const { step } = ctx.session.adminState;

            switch (step) {
                case 'name':
                    const name = ctx.message.text.trim();

                    if (name.length < 2 || name.length > 50) {
                        await ctx.reply('❌ Le nom doit contenir entre 2 et 50 caractères.');
                        return true;
                    }

                    // Vérifier si la catégorie existe déjà
                    const existingCategory = await Category.findOne({
                        name: { $regex: new RegExp(`^${name}$`, 'i') }
                    });

                    if (existingCategory) {
                        await ctx.reply('❌ Une catégorie avec ce nom existe déjà.');
                        return true;
                    }

                    // Créer la nouvelle catégorie
                    const category = await Category.create({
                        name,
                        description: '',
                        active: true,
                        order: await Category.countDocuments() + 1,
                        createdBy: ctx.from.id,
                        createdAt: new Date()
                    });

                    await this.logAdminAction(ctx.from.id, 'add_category', {
                        categoryId: category._id,
                        categoryName: name
                    });

                    this.clearAdminState(ctx);
                    await ctx.reply(`✅ Catégorie "${name}" créée avec succès !`);
                    await this.showCategoryManagement(ctx);
                    return true;
            }
        } catch (error) {
            logger.error('Erreur ajout catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
            return true;
        }
    }

    // Démarrer la modification d'une catégorie
    async startEditCategory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('❌ Catégorie non trouvée');
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
                [
                    Markup.button.callback(
                        category.active ? '❌ Désactiver' : '✅ Activer',
                        `toggle_category_${categoryId}`
                    )
                ],
                [Markup.button.callback('🔙 Retour', 'admin_categories')]
            ]);

            let message = `📑 Modification de la catégorie: ${category.name}\n\n`;
            message += `📋 Description: ${category.description || 'Non définie'}\n`;
            message += `🔢 Ordre: ${category.order}\n`;
            message += `📊 Statut: ${category.active ? '✅ Active' : '❌ Inactive'}\n`;
            message += `📅 Créée le: ${category.createdAt.toLocaleDateString()}\n`;

            const productsCount = await Product.countDocuments({ category: categoryId });
            message += `📦 Produits: ${productsCount}`;

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur début modification catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer la modification d'une catégorie
    async handleEditCategoryInput(ctx) {
        try {
            const { step, categoryId } = ctx.session.adminState;
            const category = await Category.findById(categoryId);

            if (!category) {
                this.clearAdminState(ctx);
                await ctx.reply('❌ Catégorie non trouvée');
                return true;
            }

            switch (step) {
                case 'name':
                    const newName = ctx.message.text.trim();

                    if (newName.length < 2 || newName.length > 50) {
                        await ctx.reply('❌ Le nom doit contenir entre 2 et 50 caractères.');
                        return true;
                    }

                    // Vérifier si le nom existe déjà
                    const existingCategory = await Category.findOne({
                        name: { $regex: new RegExp(`^${newName}$`, 'i') },
                        _id: { $ne: categoryId }
                    });

                    if (existingCategory) {
                        await ctx.reply('❌ Une catégorie avec ce nom existe déjà.');
                        return true;
                    }

                    const oldName = category.name;
                    category.name = newName;
                    category.updatedAt = new Date();
                    category.updatedBy = ctx.from.id;

                    await this.logAdminAction(ctx.from.id, 'edit_category_name', {
                        categoryId: category._id,
                        oldName,
                        newName
                    });
                    break;

                case 'description':
                    const description = ctx.message.text.trim();

                    if (description.length > 500) {
                        await ctx.reply('❌ La description ne doit pas dépasser 500 caractères.');
                        return true;
                    }

                    category.description = description;
                    category.updatedAt = new Date();
                    category.updatedBy = ctx.from.id;

                    await this.logAdminAction(ctx.from.id, 'edit_category_description', {
                        categoryId: category._id,
                        description
                    });
                    break;

                case 'order':
                    const order = parseInt(ctx.message.text);
                    if (isNaN(order) || order < 1) {
                        await ctx.reply('❌ Veuillez entrer un nombre valide supérieur à 0');
                        return true;
                    }

                    const oldOrder = category.order;
                    category.order = order;
                    category.updatedAt = new Date();
                    category.updatedBy = ctx.from.id;

                    // Réorganiser les autres catégories si nécessaire
                    if (oldOrder !== order) {
                        await this.reorderCategories(category._id, oldOrder, order);
                    }

                    await this.logAdminAction(ctx.from.id, 'edit_category_order', {
                        categoryId: category._id,
                        oldOrder,
                        newOrder: order
                    });
                    break;
            }

            await category.save();
            this.clearAdminState(ctx);
            await ctx.reply('✅ Catégorie mise à jour avec succès !');
            await this.showCategoryManagement(ctx);
            return true;

        } catch (error) {
            logger.error('Erreur modification catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
            return true;
        }
    }

    // Réorganiser les catégories
    async reorderCategories(categoryId, oldOrder, newOrder) {
        try {
            if (oldOrder < newOrder) {
                // Déplacer vers le bas
                await Category.updateMany(
                    {
                        _id: { $ne: categoryId },
                        order: { $gt: oldOrder, $lte: newOrder }
                    },
                    { $inc: { order: -1 } }
                );
            } else if (oldOrder > newOrder) {
                // Déplacer vers le haut
                await Category.updateMany(
                    {
                        _id: { $ne: categoryId },
                        order: { $gte: newOrder, $lt: oldOrder }
                    },
                    { $inc: { order: 1 } }
                );
            }
        } catch (error) {
            logger.error('Erreur réorganisation catégories:', error);
            throw error;
        }
    }

    // Modifier le nom d'une catégorie
    async editCategoryName(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('❌ Catégorie non trouvée');
            }

            ctx.session.adminState = {
                action: 'edit_category',
                categoryId: categoryId,
                step: 'name'
            };

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', `edit_category_${categoryId}`)]
            ]);

            await ctx.reply(
                `📝 Entrez le nouveau nom pour la catégorie "${category.name}":`,
                keyboard
            );
        } catch (error) {
            logger.error('Erreur modification nom catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Modifier la description d'une catégorie
    async editCategoryDescription(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('❌ Catégorie non trouvée');
            }

            ctx.session.adminState = {
                action: 'edit_category',
                categoryId: categoryId,
                step: 'description'
            };

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', `edit_category_${categoryId}`)]
            ]);

            await ctx.reply(
                '📝 Entrez la nouvelle description :\n' +
                `Description actuelle: ${category.description || 'Non définie'}`,
                keyboard
            );
        } catch (error) {
            logger.error('Erreur modification description catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Modifier l'image d'une catégorie
    async editCategoryImage(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('❌ Catégorie non trouvée');
            }

            ctx.session.adminState = {
                action: 'edit_category',
                categoryId: categoryId,
                step: 'image'
            };

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', `edit_category_${categoryId}`)]
            ]);

            await ctx.reply(
                '🖼️ Envoyez la nouvelle image pour cette catégorie\n' +
                '(Formats acceptés: JPG, PNG - Max: 5MB)',
                keyboard
            );
        } catch (error) {
            logger.error('Erreur modification image catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer l'upload d'image
    async handleCategoryImageUpload(ctx) {
        try {
            const { categoryId } = ctx.session.adminState;
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('❌ Catégorie non trouvée');
            }

            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const file = await ctx.telegram.getFile(photo.file_id);

            // Sauvegarder l'image
            category.image = {
                fileId: photo.file_id,
                width: photo.width,
                height: photo.height,
                size: file.file_size,
                updatedAt: new Date()
            };

            await category.save();

            await this.logAdminAction(ctx.from.id, 'edit_category_image', {
                categoryId: category._id,
                imageId: photo.file_id
            });

            this.clearAdminState(ctx);
            await ctx.reply('✅ Image mise à jour avec succès !');
            await this.startEditCategory(ctx);
        } catch (error) {
            logger.error('Erreur upload image catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Modifier l'ordre d'une catégorie
    async editCategoryOrder(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('❌ Catégorie non trouvée');
            }

            ctx.session.adminState = {
                action: 'edit_category',
                categoryId: categoryId,
                step: 'order'
            };

            const totalCategories = await Category.countDocuments();
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', `edit_category_${categoryId}`)]
            ]);

            await ctx.reply(
                `🔢 Entrez le nouvel ordre pour la catégorie "${category.name}"\n` +
                `Ordre actuel: ${category.order}\n` +
                `(Valeur entre 1 et ${totalCategories})`,
                keyboard
            );
        } catch (error) {
            logger.error('Erreur modification ordre catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Confirmer la suppression d'une catégorie
    async confirmDeleteCategory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('❌ Catégorie non trouvée');
            }

            const productsCount = await Product.countDocuments({ category: categoryId });

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Confirmer', `delete_category_confirm_${categoryId}`),
                    Markup.button.callback('❌ Annuler', 'admin_categories')
                ]
            ]);

            let message = `⚠️ Êtes-vous sûr de vouloir supprimer la catégorie "${category.name}" ?\n\n`;
            message += `Cette catégorie contient ${productsCount} produit(s).\n`;
            message += `\n⚠️ Cette action est irréversible !`;

            if (productsCount > 0) {
                message += `\n\n❗ Attention: La suppression de cette catégorie rendra les produits associés inaccessibles.`;
            }

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur confirmation suppression catégorie:', error);
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
                return ctx.reply('❌ Catégorie non trouvée');
            }

            // Récupérer l'ordre avant suppression
            const oldOrder = category.order;

            // Supprimer la catégorie
            await Category.deleteOne({ _id: categoryId });

            // Réorganiser l'ordre des catégories restantes
            await Category.updateMany(
                { order: { $gt: oldOrder } },
                { $inc: { order: -1 } }
            );

            // Logger l'action
            await this.logAdminAction(ctx.from.id, 'delete_category', {
                categoryId: category._id,
                categoryName: category.name,
                productsAffected: await Product.countDocuments({ category: categoryId })
            });

            await ctx.reply(`✅ Catégorie "${category.name}" supprimée avec succès`);
            await this.showCategoryManagement(ctx);
        } catch (error) {
            logger.error('Erreur suppression catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Activer/désactiver une catégorie
    async toggleCategory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('❌ Catégorie non trouvée');
            }

            // Inverser le statut
            category.active = !category.active;
            category.updatedAt = new Date();
            category.updatedBy = ctx.from.id;
            await category.save();

            // Logger l'action
            await this.logAdminAction(ctx.from.id, 'toggle_category', {
                categoryId: category._id,
                categoryName: category.name,
                newStatus: category.active ? 'active' : 'inactive'
            });

            await ctx.reply(
                `✅ Catégorie "${category.name}" ${category.active ? 'activée' : 'désactivée'} avec succès`
            );
            await this.startEditCategory(ctx);
        } catch (error) {
            logger.error('Erreur toggle catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    //===================== GESTION DES PRODUITS =====================

    // Afficher la gestion des produits
    async showProductManagement(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const products = await Product.find()
                .populate('category')
                .sort({ createdAt: -1 })
                .limit(10);

            const productButtons = products.map(prod => [
                Markup.button.callback(
                    `📝 ${prod.name} (${prod.category?.name || 'Sans catégorie'})`,
                    `edit_product_${prod._id}`
                ),
                Markup.button.callback('🗑️', `delete_product_${prod._id}`)
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...productButtons,
                [
                    Markup.button.callback('➕ Nouveau Produit', 'add_product'),
                    Markup.button.callback('🔍 Rechercher', 'search_products')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_panel')]
            ]);

            // Stats rapides des produits
            const totalProducts = await Product.countDocuments();
            const activeProducts = await Product.countDocuments({ active: true });
            const outOfStock = await Product.countDocuments({ stock: 0 });

            let message = '📦 Gestion des Produits\n\n';
            message += `📊 Total produits: ${totalProducts}\n`;
            message += `✅ Produits actifs: ${activeProducts}\n`;
            message += `❌ En rupture: ${outOfStock}\n`;
            message += '\n📝 Derniers produits:';

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur gestion produits:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Démarrer l'ajout d'un produit
    async startAddProduct(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categories = await Category.find({ active: true }).sort({ order: 1 });
            if (categories.length === 0) {
                return ctx.reply('❌ Veuillez d\'abord créer une catégorie');
            }

            ctx.session.adminState = {
                action: 'add_product',
                step: 'category',
                data: {}
            };

            const categoryButtons = categories.map(cat => [
                Markup.button.callback(cat.name, `select_category_${cat._id}`)
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...categoryButtons,
                [Markup.button.callback('❌ Annuler', 'admin_products')]
            ]);

            await ctx.reply('📝 Sélectionnez une catégorie pour le nouveau produit:', keyboard);
        } catch (error) {
            logger.error('Erreur début ajout produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Sélectionner une catégorie pour un produit
    async selectProductCategory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('❌ Catégorie non trouvée');
            }

            ctx.session.adminState.data.category = categoryId;
            ctx.session.adminState.step = 'name';

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', 'admin_products')]
            ]);

            await ctx.reply('📝 Entrez le nom du produit:', keyboard);
        } catch (error) {
            logger.error('Erreur sélection catégorie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer l'ajout d'un produit
    async handleAddProductInput(ctx) {
        try {
            const { step, data } = ctx.session.adminState;

            switch (step) {
                case 'name':
                    const name = ctx.message.text.trim();

                    if (name.length < 2 || name.length > 100) {
                        await ctx.reply('❌ Le nom doit contenir entre 2 et 100 caractères.');
                        return true;
                    }

                    // Vérifier si le produit existe déjà
                    const existingProduct = await Product.findOne({
                        name: { $regex: new RegExp(`^${name}$`, 'i') },
                        category: data.category
                    });

                    if (existingProduct) {
                        await ctx.reply('❌ Un produit avec ce nom existe déjà dans cette catégorie.');
                        return true;
                    }

                    data.name = name;
                    ctx.session.adminState.step = 'description';
                    await ctx.reply('📝 Entrez la description du produit:');
                    return true;

                case 'description':
                    const description = ctx.message.text.trim();

                    if (description.length > 1000) {
                        await ctx.reply('❌ La description ne doit pas dépasser 1000 caractères.');
                        return true;
                    }

                    data.description = description;
                    ctx.session.adminState.step = 'price';
                    await ctx.reply('💰 Entrez le prix du produit (en €):');
                    return true;

                case 'price':
                    const price = parseFloat(ctx.message.text.replace(',', '.'));
                    if (isNaN(price) || price <= 0) {
                        await ctx.reply('❌ Veuillez entrer un prix valide supérieur à 0');
                        return true;
                    }

                    data.price = price;
                    ctx.session.adminState.step = 'stock';
                    await ctx.reply('📦 Entrez la quantité en stock (ou -1 pour stock illimité):');
                    return true;

                case 'stock':
                    const stock = parseInt(ctx.message.text);
                    if (isNaN(stock) || (stock < -1)) {
                        await ctx.reply('❌ Veuillez entrer un nombre valide (-1 pour illimité)');
                        return true;
                    }

                    data.stock = stock;
                    ctx.session.adminState.step = 'delivery_type';

                    const deliveryKeyboard = Markup.inlineKeyboard([
                        [
                            Markup.button.callback('🚀 Instantanée', 'delivery_instant'),
                            Markup.button.callback('⏳ Manuelle', 'delivery_manual')
                        ]
                    ]);

                    await ctx.reply('🚚 Choisissez le type de livraison:', deliveryKeyboard);
                    return true;
            }
        } catch (error) {
            logger.error('Erreur ajout produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
            return true;
        }
    }

    // Finaliser l'ajout du produit
    async finalizeAddProduct(ctx, deliveryType) {
        try {
            const { data } = ctx.session.adminState;

            // Créer le produit
            const product = await Product.create({
                name: data.name,
                description: data.description,
                price: data.price,
                stock: data.stock,
                category: data.category,
                delivery: {
                    type: deliveryType
                },
                active: true,
                createdBy: ctx.from.id,
                createdAt: new Date()
            });

            // Logger l'action
            await this.logAdminAction(ctx.from.id, 'add_product', {
                productId: product._id,
                productName: product.name,
                category: data.category,
                price: product.price
            });

            this.clearAdminState(ctx);
            await ctx.reply(`✅ Produit "${product.name}" créé avec succès !`);
            await this.showProductManagement(ctx);
        } catch (error) {
            logger.error('Erreur finalisation ajout produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    // Démarrer la modification d'un produit
    async startEditProduct(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const productId = ctx.match[1];
            const product = await Product.findById(productId).populate('category');

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            ctx.session.adminState = {
                action: 'edit_product',
                productId: productId,
                step: 'menu'
            };

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('📝 Nom', `edit_product_name_${productId}`),
                    Markup.button.callback('💰 Prix', `edit_product_price_${productId}`)
                ],
                [
                    Markup.button.callback('📋 Description', `edit_product_desc_${productId}`),
                    Markup.button.callback('🚚 Livraison', `edit_product_delivery_${productId}`)
                ],
                [
                    Markup.button.callback('📦 Stock', `edit_product_stock_${productId}`),
                    Markup.button.callback('🏷️ Catégorie', `edit_product_category_${productId}`)
                ],
                [
                    Markup.button.callback('❓ Questions', `edit_product_questions_${productId}`),
                    Markup.button.callback('🖼️ Images', `edit_product_images_${productId}`)
                ],
                [
                    Markup.button.callback(
                        product.active ? '❌ Désactiver' : '✅ Activer',
                        `toggle_product_${productId}`
                    )
                ],
                [Markup.button.callback('🔙 Retour', 'admin_products')]
            ]);

            let message = `📦 Produit: ${product.name}\n\n`;
            message += `📝 Description: ${product.description}\n`;
            message += `💰 Prix: ${product.price}€\n`;
            message += `📦 Stock: ${product.stock === -1 ? 'Illimité' : product.stock}\n`;
            message += `🏷️ Catégorie: ${product.category?.name || 'Non définie'}\n`;
            message += `🚚 Livraison: ${product.delivery.type === 'instant' ? '🚀 Instantanée' : '⏳ Manuelle'}\n`;
            message += `📊 Statut: ${product.active ? '✅ Actif' : '❌ Inactif'}\n\n`;

            if (product.customFields && product.customFields.length > 0) {
                message += '❓ Questions:\n';
                product.customFields.forEach((field, index) => {
                    message += `${index + 1}. ${field.question}\n`;
                });
            }

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur début modification produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Modifier le nom d'un produit
    async editProductName(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const productId = ctx.match[1];
            const product = await Product.findById(productId);

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            ctx.session.adminState = {
                action: 'edit_product',
                productId: productId,
                step: 'name'
            };

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', `edit_product_${productId}`)]
            ]);

            await ctx.reply(
                `📝 Entrez le nouveau nom pour le produit "${product.name}":`,
                keyboard
            );
        } catch (error) {
            logger.error('Erreur modification nom produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Modifier le prix d'un produit
    async editProductPrice(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const productId = ctx.match[1];
            const product = await Product.findById(productId);

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            ctx.session.adminState = {
                action: 'edit_product',
                productId: productId,
                step: 'price'
            };

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', `edit_product_${productId}`)]
            ]);

            await ctx.reply(
                `💰 Entrez le nouveau prix pour "${product.name}"\n` +
                `Prix actuel: ${product.price}€`,
                keyboard
            );
        } catch (error) {
            logger.error('Erreur modification prix produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Modifier le stock d'un produit
    async editProductStock(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const productId = ctx.match[1];
            const product = await Product.findById(productId);

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            ctx.session.adminState = {
                action: 'edit_product',
                productId: productId,
                step: 'stock'
            };

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('♾️ Illimité', `set_stock_unlimited_${productId}`),
                    Markup.button.callback('❌ Annuler', `edit_product_${productId}`)
                ]
            ]);

            await ctx.reply(
                `📦 Entrez la nouvelle quantité en stock pour "${product.name}"\n` +
                `Stock actuel: ${product.stock === -1 ? 'Illimité' : product.stock}\n` +
                'Entrez -1 ou cliquez sur "Illimité" pour un stock illimité',
                keyboard
            );
        } catch (error) {
            logger.error('Erreur modification stock produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer l'édition d'un produit
    async handleEditProductInput(ctx) {
        try {
            const { step, productId } = ctx.session.adminState;
            const product = await Product.findById(productId);

            if (!product) {
                this.clearAdminState(ctx);
                await ctx.reply('❌ Produit non trouvé');
                return true;
            }

            switch (step) {
                case 'name':
                    const newName = ctx.message.text.trim();

                    if (newName.length < 2 || newName.length > 100) {
                        await ctx.reply('❌ Le nom doit contenir entre 2 et 100 caractères.');
                        return true;
                    }

                    // Vérifier si le nom existe déjà
                    const existingProduct = await Product.findOne({
                        name: { $regex: new RegExp(`^${newName}$`, 'i') },
                        category: product.category,
                        _id: { $ne: productId }
                    });

                    if (existingProduct) {
                        await ctx.reply('❌ Un produit avec ce nom existe déjà dans cette catégorie.');
                        return true;
                    }

                    const oldName = product.name;
                    product.name = newName;
                    await this.logAdminAction(ctx.from.id, 'edit_product_name', {
                        productId,
                        oldName,
                        newName
                    });
                    break;

                case 'price':
                    const newPrice = parseFloat(ctx.message.text.replace(',', '.'));
                    if (isNaN(newPrice) || newPrice <= 0) {
                        await ctx.reply('❌ Veuillez entrer un prix valide supérieur à 0');
                        return true;
                    }

                    const oldPrice = product.price;
                    product.price = newPrice;
                    await this.logAdminAction(ctx.from.id, 'edit_product_price', {
                        productId,
                        oldPrice,
                        newPrice
                    });
                    break;

                case 'description':
                    const description = ctx.message.text.trim();
                    if (description.length > 1000) {
                        await ctx.reply('❌ La description ne doit pas dépasser 1000 caractères.');
                        return true;
                    }

                    product.description = description;
                    await this.logAdminAction(ctx.from.id, 'edit_product_description', {
                        productId,
                        description
                    });
                    break;

                case 'stock':
                    const stock = parseInt(ctx.message.text);
                    if (isNaN(stock) || (stock < -1)) {
                        await ctx.reply('❌ Veuillez entrer un nombre valide (-1 pour illimité)');
                        return true;
                    }

                    const oldStock = product.stock;
                    product.stock = stock;
                    await this.logAdminAction(ctx.from.id, 'edit_product_stock', {
                        productId,
                        oldStock,
                        newStock: stock
                    });
                    break;
            }

            product.updatedAt = new Date();
            product.updatedBy = ctx.from.id;
            await product.save();

            this.clearAdminState(ctx);
            await ctx.reply('✅ Produit mis à jour avec succès !');
            await this.startEditProduct(ctx);
            return true;

        } catch (error) {
            logger.error('Erreur modification produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
            return true;
        }
    }

    // Modifier la catégorie d'un produit
    async editProductCategory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const productId = ctx.match[1];
            const product = await Product.findById(productId);

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            const categories = await Category.find({ active: true }).sort({ order: 1 });
            const categoryButtons = categories.map(cat => [
                Markup.button.callback(
                    `${cat._id.equals(product.category) ? '✅ ' : ''}${cat.name}`,
                    `set_product_category_${productId}_${cat._id}`
                )
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...categoryButtons,
                [Markup.button.callback('❌ Annuler', `edit_product_${productId}`)]
            ]);

            await ctx.reply(
                `🏷️ Sélectionnez la nouvelle catégorie pour "${product.name}":`,
                keyboard
            );
        } catch (error) {
            logger.error('Erreur modification catégorie produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Activer/désactiver un produit
    async toggleProduct(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const productId = ctx.match[1];
            const product = await Product.findById(productId);

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            product.active = !product.active;
            product.updatedAt = new Date();
            product.updatedBy = ctx.from.id;
            await product.save();

            await this.logAdminAction(ctx.from.id, 'toggle_product', {
                productId,
                productName: product.name,
                newStatus: product.active ? 'active' : 'inactive'
            });

            await ctx.reply(
                `✅ Produit "${product.name}" ${product.active ? 'activé' : 'désactivé'} avec succès`
            );
            await this.startEditProduct(ctx);
        } catch (error) {
            logger.error('Erreur toggle produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    // Gérer les questions personnalisées
    async editProductQuestions(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const productId = ctx.match[1];
            const product = await Product.findById(productId);

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            ctx.session.adminState = {
                action: 'edit_product_questions',
                productId: productId,
                step: 'menu'
            };

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('➕ Ajouter Question', `add_question_${productId}`),
                    Markup.button.callback('🗑️ Supprimer', `remove_question_${productId}`)
                ],
                [Markup.button.callback('🔙 Retour', `edit_product_${productId}`)]
            ]);

            let message = '❓ Questions personnalisées\n\n';
            if (product.customFields && product.customFields.length > 0) {
                product.customFields.forEach((field, index) => {
                    message += `${index + 1}. ${field.question}\n`;
                    message += `   Required: ${field.required ? '✅' : '❌'}\n`;
                });
            } else {
                message += 'Aucune question configurée.';
            }

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur édition questions:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Ajouter une question
    async addProductQuestion(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const productId = ctx.match[1];
            const product = await Product.findById(productId);

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            ctx.session.adminState = {
                action: 'add_question',
                productId: productId,
                step: 'question'
            };

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', `edit_product_questions_${productId}`)]
            ]);

            await ctx.reply('📝 Entrez la question à ajouter:', keyboard);
        } catch (error) {
            logger.error('Erreur ajout question:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer l'ajout de question
    async handleAddQuestionInput(ctx) {
        try {
            const { step, productId } = ctx.session.adminState;
            const product = await Product.findById(productId);

            if (!product) {
                this.clearAdminState(ctx);
                await ctx.reply('❌ Produit non trouvé');
                return true;
            }

            switch (step) {
                case 'question':
                    const question = ctx.message.text.trim();
                    if (question.length < 3 || question.length > 200) {
                        await ctx.reply('❌ La question doit contenir entre 3 et 200 caractères.');
                        return true;
                    }

                    // Ajouter la question
                    if (!product.customFields) {
                        product.customFields = [];
                    }

                    product.customFields.push({
                        question: question,
                        required: true,
                        order: product.customFields.length + 1
                    });

                    await product.save();

                    await this.logAdminAction(ctx.from.id, 'add_product_question', {
                        productId,
                        question
                    });

                    this.clearAdminState(ctx);
                    await ctx.reply('✅ Question ajoutée avec succès !');
                    await this.editProductQuestions(ctx);
                    return true;
            }
        } catch (error) {
            logger.error('Erreur traitement ajout question:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
            return true;
        }
    }

    // Supprimer une question
    async removeProductQuestion(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const [productId, questionIndex] = ctx.match[1].split('_');
            const product = await Product.findById(productId);

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            const index = parseInt(questionIndex);
            if (isNaN(index) || index < 0 || index >= product.customFields.length) {
                return ctx.reply('❌ Question non trouvée');
            }

            // Supprimer la question
            const removedQuestion = product.customFields[index];
            product.customFields.splice(index, 1);

            // Réorganiser l'ordre des questions
            product.customFields.forEach((field, i) => {
                field.order = i + 1;
            });

            await product.save();

            await this.logAdminAction(ctx.from.id, 'remove_product_question', {
                productId,
                question: removedQuestion.question
            });

            await ctx.reply('✅ Question supprimée avec succès !');
            await this.editProductQuestions(ctx);
        } catch (error) {
            logger.error('Erreur suppression question:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Rechercher des produits
    async searchProducts(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            ctx.session.adminState = {
                action: 'search_products',
                step: 'query'
            };

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('🏷️ Par catégorie', 'search_by_category'),
                    Markup.button.callback('💰 Par prix', 'search_by_price')
                ],
                [
                    Markup.button.callback('📊 Par statut', 'search_by_status'),
                    Markup.button.callback('📦 Par stock', 'search_by_stock')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_products')]
            ]);

            await ctx.reply(
                '🔍 Recherche de produits\n\n' +
                'Vous pouvez:\n' +
                '- Entrer un terme de recherche\n' +
                '- Utiliser les filtres ci-dessous\n' +
                '- Utiliser la syntaxe "prix<100" ou "prix>50"\n' +
                '- Combiner avec "catégorie:nom"',
                keyboard
            );
        } catch (error) {
            logger.error('Erreur recherche produits:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer la recherche de produits
    async handleProductSearch(ctx) {
        try {
            const query = ctx.message.text.trim();
            let filter = {};

            // Analyser la requête
            if (query.includes('prix<') || query.includes('prix>')) {
                const priceMatch = query.match(/prix([<>])(\d+)/);
                if (priceMatch) {
                    const [, operator, value] = priceMatch;
                    filter.price = operator === '<'
                        ? { $lt: parseInt(value) }
                        : { $gt: parseInt(value) };
                }
            } else if (query.includes('catégorie:')) {
                const categoryName = query.split('catégorie:')[1].trim();
                const category = await Category.findOne({
                    name: { $regex: new RegExp(categoryName, 'i') }
                });
                if (category) {
                    filter.category = category._id;
                }
            } else {
                filter.$or = [
                    { name: { $regex: query, $options: 'i' } },
                    { description: { $regex: query, $options: 'i' } }
                ];
            }

            const products = await Product.find(filter)
                .populate('category')
                .sort({ createdAt: -1 })
                .limit(10);

            if (products.length === 0) {
                return ctx.reply('❌ Aucun produit trouvé');
            }

            const productButtons = products.map(prod => [
                Markup.button.callback(
                    `📝 ${prod.name} (${prod.category?.name || 'Sans catégorie'})`,
                    `edit_product_${prod._id}`
                )
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...productButtons,
                [Markup.button.callback('🔍 Nouvelle recherche', 'search_products')],
                [Markup.button.callback('🔙 Retour', 'admin_products')]
            ]);

            let message = `🔍 Résultats de recherche pour "${query}"\n\n`;
            message += `📊 ${products.length} produit(s) trouvé(s)`;

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur traitement recherche:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Confirmer la suppression d'un produit
    async confirmDeleteProduct(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const productId = ctx.match[1];
            const product = await Product.findById(productId).populate('category');

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            // Vérifier si le produit a des commandes
            const orderCount = await Order.countDocuments({
                'products.product': productId
            });

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Confirmer', `delete_product_confirm_${productId}`),
                    Markup.button.callback('❌ Annuler', 'admin_products')
                ]
            ]);

            let message = `⚠️ Êtes-vous sûr de vouloir supprimer le produit "${product.name}" ?\n\n`;
            message += `Catégorie: ${product.category?.name || 'Sans catégorie'}\n`;
            message += `Ce produit a été commandé ${orderCount} fois.\n\n`;
            message += '⚠️ Cette action est irréversible !';

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur confirmation suppression produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Supprimer un produit
    async deleteProduct(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const productId = ctx.match[1];
            const product = await Product.findById(productId);

            if (!product) {
                return ctx.reply('❌ Produit non trouvé');
            }

            await this.logAdminAction(ctx.from.id, 'delete_product', {
                productId: product._id,
                productName: product.name,
                category: product.category
            });

            await Product.deleteOne({ _id: productId });

            await ctx.reply(`✅ Produit "${product.name}" supprimé avec succès`);
            await this.showProductManagement(ctx);
        } catch (error) {
            logger.error('Erreur suppression produit:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    //===================== GESTION DES COMMANDES =====================

    // Afficher la gestion des commandes
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
                    `📦 ${this.getStatusEmoji(order.status)} ${order.orderNumber}`,
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

            // Compter les commandes par statut
            const orderCounts = await Order.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]);

            let message = '📦 Gestion des Commandes\n\n';
            message += '📊 Vue d\'ensemble:\n';
            orderCounts.forEach(({ _id, count }) => {
                message += `${this.getStatusEmoji(_id)} ${_id}: ${count}\n`;
            });

            await ctx.reply(message, keyboard);
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
                .populate('products.product payment.method')
                .populate('user');

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            let message = `📦 Commande ${order.orderNumber}\n\n`;
            message += `👤 Client: @${order.user.username}\n`;
            message += `📅 Date: ${order.createdAt.toLocaleString()}\n`;
            message += `📊 Statut: ${this.getStatusEmoji(order.status)} ${order.status}\n\n`;

            message += '🛍️ Produits:\n';
            order.products.forEach((item, index) => {
                message += `${index + 1}. ${item.product.name}\n`;
                message += `   Quantité: ${item.quantity}\n`;
                message += `   Prix: ${item.price}€\n`;

                if (item.customFields?.length > 0) {
                    message += '   📝 Informations personnalisées:\n';
                    item.customFields.forEach(field => {
                        message += `   - ${field.question}: ${field.answer || 'Non renseigné'}\n`;
                    });
                }
                message += '\n';
            });

            message += `\n💰 Total: ${order.payment.amount.total}€\n`;
            message += `💳 Paiement: ${order.payment.method.name}\n`;
            message += `💰 Statut paiement: ${this.getStatusEmoji(order.payment.status)} ${order.payment.status}\n`;

            // Timeline de la commande
            if (order.timeline && order.timeline.length > 0) {
                message += '\n📅 Historique:\n';
                order.timeline.forEach(event => {
                    const date = new Date(event.timestamp).toLocaleString();
                    message += `${this.getStatusEmoji(event.status)} ${date}: ${event.status}\n`;
                    if (event.notes) message += `   📝 ${event.notes}\n`;
                });
            }

            // Générer les boutons d'action selon le statut
            const buttons = [];

            // Boutons de paiement
            if (order.payment.status === 'pending') {
                buttons.push([
                    Markup.button.callback('✅ Valider paiement', `approve_payment_${order._id}`),
                    Markup.button.callback('❌ Rejeter paiement', `reject_payment_${order._id}`)
                ]);
            }

            // Boutons de commande selon le statut
            switch (order.status) {
                case 'pending':
                    buttons.push([
                        Markup.button.callback('✅ Accepter', `approve_order_${order._id}`),
                        Markup.button.callback('❌ Refuser', `reject_order_${order._id}`)
                    ]);
                    break;

                case 'processing':
                    buttons.push([
                        Markup.button.callback('📦 Marquer comme livré', `mark_delivered_${order._id}`)
                    ]);
                    break;

                case 'delivered':
                    buttons.push([
                        Markup.button.callback('✅ Finaliser', `complete_order_${order._id}`)
                    ]);
                    break;
            }

            // Boutons généraux
            buttons.push([
                Markup.button.callback('💬 Contacter client', `contact_user_${order.user.telegramId}`),
                Markup.button.callback('📝 Ajouter note', `add_note_${order._id}`)
            ]);
            buttons.push([Markup.button.callback('🔙 Retour', 'admin_orders')]);

            const keyboard = Markup.inlineKeyboard(buttons);
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
                return ctx.reply('❌ Commande non trouvée');
            }

            // Vérifier si la commande peut être approuvée
            if (order.payment.status !== 'completed') {
                return ctx.reply('❌ Le paiement doit être validé avant d\'approuver la commande');
            }

            // Mettre à jour le statut
            await order.updateStatus('processing', 'Approuvée par admin', ctx.from.id);

            // Envoyer les notifications
            await ctx.telegram.sendMessage(
                order.user.telegramId,
                `✅ Votre commande ${order.orderNumber} a été approuvée.\n` +
                'Elle va être traitée dans les plus brefs délais.'
            );

            // Si la commande contient des produits à livraison instantanée
            const instantProducts = order.products.filter(
                item => item.product.delivery.type === 'instant'
            );

            if (instantProducts.length > 0) {
                await this.processInstantDelivery(order);
            }

            await this.logAdminAction(ctx.from.id, 'approve_order', {
                orderId: order._id,
                orderNumber: order.orderNumber
            });

            await ctx.reply(`✅ Commande ${order.orderNumber} approuvée`);
            await this.showOrderManagement(ctx);
        } catch (error) {
            logger.error('Erreur approbation commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Livraison instantanée
    async processInstantDelivery(order) {
        try {
            const instantProducts = order.products.filter(
                item => item.product.delivery.type === 'instant'
            );

            for (const item of instantProducts) {
                const product = await Product.findById(item.product);
                if (!product || product.delivery.type !== 'instant') continue;

                // Préparer le contenu de livraison
                const deliveryContent = {
                    files: product.delivery.files,
                    text: product.delivery.instructions,
                    deliveredAt: new Date()
                };

                // Envoyer le contenu au client
                if (deliveryContent.text) {
                    await this.bot.telegram.sendMessage(
                        order.user.telegramId,
                        `📦 Livraison pour ${product.name}:\n\n${deliveryContent.text}`
                    );
                }

                if (deliveryContent.files?.length > 0) {
                    for (const file of deliveryContent.files) {
                        await this.bot.telegram.sendDocument(
                            order.user.telegramId,
                            file.fileId,
                            { caption: file.caption }
                        );
                    }
                }

                // Mettre à jour le statut du produit
                item.deliveryStatus = 'delivered';
                item.deliveredContent = deliveryContent;
            }

            // Vérifier si tous les produits ont été livrés
            const allDelivered = order.products.every(
                item => item.deliveryStatus === 'delivered'
            );

            if (allDelivered) {
                await order.updateStatus('delivered', 'Livraison automatique complétée');
            }

            await order.save();
        } catch (error) {
            logger.error('Erreur livraison instantanée:', error);
            throw error;
        }
    }

    // Rejeter une commande
    async rejectOrder(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            ctx.session.adminState = {
                action: 'reject_order',
                orderId: orderId
            };

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', `view_order_${orderId}`)]
            ]);

            await ctx.reply(
                '📝 Veuillez indiquer la raison du rejet:\n' +
                'Cette raison sera communiquée au client.',
                keyboard
            );
        } catch (error) {
            logger.error('Erreur rejet commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Traiter le rejet d'une commande
    async handleRejectOrder(ctx) {
        try {
            const { orderId } = ctx.session.adminState;
            const reason = ctx.message.text.trim();
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            // Mettre à jour le statut
            await order.updateStatus('rejected', reason, ctx.from.id);

            // Notifier le client
            await this.bot.telegram.sendMessage(
                order.user.telegramId,
                `❌ Votre commande ${order.orderNumber} a été rejetée.\n` +
                `Raison: ${reason}`
            );

            await this.logAdminAction(ctx.from.id, 'reject_order', {
                orderId: order._id,
                orderNumber: order.orderNumber,
                reason
            });

            this.clearAdminState(ctx);
            await ctx.reply(`❌ Commande ${order.orderNumber} rejetée`);
            await this.showOrderManagement(ctx);
        } catch (error) {
            logger.error('Erreur traitement rejet commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    // Marquer une commande comme livrée
    async markOrderAsDelivered(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            if (order.status !== 'processing') {
                return ctx.reply('❌ Cette commande ne peut pas être marquée comme livrée');
            }

            await order.updateStatus('delivered', 'Marquée comme livrée par admin', ctx.from.id);

            // Notifier le client
            await this.bot.telegram.sendMessage(
                order.user.telegramId,
                `📦 Votre commande ${order.orderNumber} a été livrée!\n` +
                'Veuillez confirmer la bonne réception en utilisant le menu des commandes (/orders)'
            );

            await this.logAdminAction(ctx.from.id, 'mark_delivered', {
                orderId: order._id,
                orderNumber: order.orderNumber
            });

            await ctx.reply(`✅ Commande ${order.orderNumber} marquée comme livrée`);
            await this.viewOrder(ctx);
        } catch (error) {
            logger.error('Erreur marquage livraison:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Finaliser une commande
    async completeOrder(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            if (order.status !== 'delivered') {
                return ctx.reply('❌ Cette commande ne peut pas être finalisée');
            }

            await order.updateStatus('completed', 'Finalisée par admin', ctx.from.id);

            // Mettre à jour les statistiques de l'utilisateur
            await this.updateUserStats(order.user.telegramId, order);

            await this.logAdminAction(ctx.from.id, 'complete_order', {
                orderId: order._id,
                orderNumber: order.orderNumber
            });

            // Notifier le client
            await this.bot.telegram.sendMessage(
                order.user.telegramId,
                `✅ Votre commande ${order.orderNumber} est maintenant finalisée.\n` +
                'Merci pour votre confiance!'
            );

            await ctx.reply(`✅ Commande ${order.orderNumber} finalisée`);
            await this.viewOrder(ctx);
        } catch (error) {
            logger.error('Erreur finalisation commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Annuler une commande
    async cancelOrder(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            ctx.session.adminState = {
                action: 'cancel_order',
                orderId: orderId
            };

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', `view_order_${orderId}`)]
            ]);

            await ctx.reply(
                '📝 Veuillez indiquer la raison de l\'annulation:\n' +
                'Cette raison sera communiquée au client.',
                keyboard
            );
        } catch (error) {
            logger.error('Erreur annulation commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Rembourser une commande
    async refundOrder(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            if (!['completed', 'delivered', 'processing'].includes(order.status)) {
                return ctx.reply('❌ Cette commande ne peut pas être remboursée');
            }

            ctx.session.adminState = {
                action: 'refund_order',
                orderId: orderId,
                step: 'amount'
            };

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('💯 Remboursement total', `refund_full_${orderId}`),
                    Markup.button.callback('❌ Annuler', `view_order_${orderId}`)
                ]
            ]);

            await ctx.reply(
                '💰 Remboursement de commande\n\n' +
                `Montant total: ${order.payment.amount.total}€\n\n` +
                'Entrez le montant à rembourser ou cliquez sur "Remboursement total"',
                keyboard
            );
        } catch (error) {
            logger.error('Erreur remboursement commande:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Approuver un paiement
    async approvePayment(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            if (order.payment.status !== 'pending') {
                return ctx.reply('❌ Ce paiement ne peut pas être approuvé');
            }

            // Mettre à jour le statut du paiement
            order.payment.status = 'completed';
            order.payment.confirmedAt = new Date();
            order.payment.confirmedBy = ctx.from.id;
            await order.save();

            await this.logAdminAction(ctx.from.id, 'approve_payment', {
                orderId: order._id,
                orderNumber: order.orderNumber,
                amount: order.payment.amount.total
            });

            // Notifier le client
            await this.bot.telegram.sendMessage(
                order.user.telegramId,
                `✅ Le paiement pour votre commande ${order.orderNumber} a été validé.`
            );

            await ctx.reply(`✅ Paiement pour la commande ${order.orderNumber} approuvé`);
            await this.viewOrder(ctx);
        } catch (error) {
            logger.error('Erreur approbation paiement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Rejeter un paiement
    async rejectPayment(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId);

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            ctx.session.adminState = {
                action: 'reject_payment',
                orderId: orderId
            };

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', `view_order_${orderId}`)]
            ]);

            await ctx.reply(
                '📝 Veuillez indiquer la raison du rejet du paiement:\n' +
                'Cette raison sera communiquée au client.',
                keyboard
            );
        } catch (error) {
            logger.error('Erreur rejet paiement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Vérifier un paiement
    async verifyPayment(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId)
                .populate('payment.method');

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            // Vérifier selon le type de paiement
            switch (order.payment.method.type) {
                case 'crypto':
                    await this.verifyCryptoPayment(ctx, order);
                    break;
                case 'paypal':
                    await this.verifyPaypalPayment(ctx, order);
                    break;
                case 'card':
                    await this.verifyCardPayment(ctx, order);
                    break;
                default:
                    await ctx.reply('❌ Type de paiement non supporté pour la vérification automatique');
            }
        } catch (error) {
            logger.error('Erreur vérification paiement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Rechercher des commandes
    async searchOrders(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            ctx.session.adminState = {
                action: 'search_orders',
                step: 'criteria'
            };

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('📅 Par date', 'search_orders_date'),
                    Markup.button.callback('👤 Par client', 'search_orders_user')
                ],
                [
                    Markup.button.callback('📊 Par statut', 'search_orders_status'),
                    Markup.button.callback('💳 Par paiement', 'search_orders_payment')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_orders')]
            ]);

            await ctx.reply(
                '🔍 Recherche de commandes\n\n' +
                'Choisissez un critère de recherche ou entrez:\n' +
                '- Un numéro de commande\n' +
                '- Un nom d\'utilisateur (@username)\n' +
                '- Une date (JJ/MM/AAAA)\n' +
                '- Un montant (>100 ou <50)',
                keyboard
            );
        } catch (error) {
            logger.error('Erreur recherche commandes:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Afficher les statistiques des commandes
    async showOrderStats(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            // Stats globales
            const totalOrders = await Order.countDocuments();
            const totalRevenue = await Order.aggregate([
                {
                    $match: { 'payment.status': 'completed' }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$payment.amount.total' }
                    }
                }
            ]);

            // Stats par statut
            const ordersByStatus = await Order.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        revenue: { $sum: '$payment.amount.total' }
                    }
                }
            ]);

            // Stats par période
            const now = new Date();
            const todayStart = new Date(now.setHours(0, 0, 0, 0));
            const weekStart = new Date(now.setDate(now.getDate() - 7));
            const monthStart = new Date(now.setDate(1));

            const periodStats = await Order.aggregate([
                {
                    $match: {
                        createdAt: { $gte: monthStart }
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                        },
                        count: { $sum: 1 },
                        revenue: { $sum: '$payment.amount.total' }
                    }
                },
                { $sort: { '_id': -1 } }
            ]);

            let message = '📊 Statistiques des commandes\n\n';

            message += '📈 Vue d\'ensemble:\n';
            message += `Total commandes: ${totalOrders}\n`;
            message += `Chiffre d'affaires: ${totalRevenue[0]?.total || 0}€\n\n`;

            message += '📊 Par statut:\n';
            ordersByStatus.forEach(stat => {
                message += `${this.getStatusEmoji(stat._id)} ${stat._id}: ${stat.count} (${stat.revenue}€)\n`;
            });

            message += '\n📅 Derniers 30 jours:\n';
            const last30Days = periodStats.slice(0, 30);
            let totalLast30Days = 0;
            let countLast30Days = 0;
            last30Days.forEach(day => {
                totalLast30Days += day.revenue;
                countLast30Days += day.count;
            });

            message += `Commandes: ${countLast30Days}\n`;
            message += `Chiffre d'affaires: ${totalLast30Days}€\n`;
            message += `Moyenne par jour: ${(totalLast30Days / 30).toFixed(2)}€\n`;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('📊 Détails', 'order_stats_details'),
                    Markup.button.callback('📈 Graphiques', 'order_stats_graphs')
                ],
                [
                    Markup.button.callback('📥 Exporter', 'export_order_stats'),
                    Markup.button.callback('📧 Rapport par email', 'email_order_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_orders')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur statistiques commandes:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    // Afficher les détails des statistiques des commandes
    async showOrderStatsDetails(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            // Stats par méthode de paiement
            const paymentStats = await Order.aggregate([
                {
                    $lookup: {
                        from: 'paymentmethods',
                        localField: 'payment.method',
                        foreignField: '_id',
                        as: 'paymentMethod'
                    }
                },
                {
                    $group: {
                        _id: { $first: '$paymentMethod.name' },
                        count: { $sum: 1 },
                        revenue: { $sum: '$payment.amount.total' },
                        avgAmount: { $avg: '$payment.amount.total' }
                    }
                },
                { $sort: { revenue: -1 } }
            ]);

            // Stats par produit
            const productStats = await Order.aggregate([
                { $unwind: '$products' },
                {
                    $lookup: {
                        from: 'products',
                        localField: 'products.product',
                        foreignField: '_id',
                        as: 'productInfo'
                    }
                },
                {
                    $group: {
                        _id: {
                            productId: '$products.product',
                            name: { $first: '$productInfo.name' }
                        },
                        totalSold: { $sum: '$products.quantity' },
                        revenue: { $sum: { $multiply: ['$products.price', '$products.quantity'] } }
                    }
                },
                { $sort: { totalSold: -1 } }
            ]);

            // Stats par heure
            const hourlyStats = await Order.aggregate([
                {
                    $group: {
                        _id: { $hour: '$createdAt' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id': 1 } }
            ]);

            // Stats des temps de traitement
            const processingTimeStats = await Order.aggregate([
                {
                    $match: {
                        status: 'completed',
                        'timeline.status': 'completed'
                    }
                },
                {
                    $project: {
                        processingTime: {
                            $subtract: [
                                { $arrayElemAt: ['$timeline.timestamp', -1] },
                                '$createdAt'
                            ]
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgTime: { $avg: '$processingTime' },
                        minTime: { $min: '$processingTime' },
                        maxTime: { $max: '$processingTime' }
                    }
                }
            ]);

            let message = '📊 Détails des statistiques\n\n';

            // Statistiques de paiement
            message += '💳 Par méthode de paiement:\n';
            paymentStats.forEach(stat => {
                message += `${stat._id}: ${stat.count} commandes\n`;
                message += `   💰 CA: ${stat.revenue.toFixed(2)}€\n`;
                message += `   📊 Moyenne: ${stat.avgAmount.toFixed(2)}€\n\n`;
            });

            // Top produits
            message += '📦 Top produits:\n';
            productStats.slice(0, 5).forEach((stat, index) => {
                message += `${index + 1}. ${stat._id.name}\n`;
                message += `   Vendus: ${stat.totalSold}\n`;
                message += `   CA: ${stat.revenue.toFixed(2)}€\n\n`;
            });

            // Temps de traitement
            if (processingTimeStats.length > 0) {
                const stats = processingTimeStats[0];
                message += '⏱️ Temps de traitement:\n';
                message += `Moyen: ${(stats.avgTime / (1000 * 60 * 60)).toFixed(1)}h\n`;
                message += `Min: ${(stats.minTime / (1000 * 60 * 60)).toFixed(1)}h\n`;
                message += `Max: ${(stats.maxTime / (1000 * 60 * 60)).toFixed(1)}h\n\n`;
            }

            // Heures populaires
            message += '🕒 Heures les plus actives:\n';
            const topHours = hourlyStats
                .sort((a, b) => b.count - a.count)
                .slice(0, 3);
            topHours.forEach(stat => {
                message += `${stat._id}h: ${stat.count} commandes\n`;
            });

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('📈 Graphiques', 'order_stats_graphs'),
                    Markup.button.callback('📥 Exporter', 'export_order_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'order_stats')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur détails statistiques:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Afficher les graphiques des statistiques
    async showOrderStatsGraphs(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            // Récupérer les données pour les graphiques
            const monthlyData = await Order.aggregate([
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' }
                        },
                        count: { $sum: 1 },
                        revenue: { $sum: '$payment.amount.total' }
                    }
                },
                { $sort: { '_id.year': 1, '_id.month': 1 } }
            ]);

            // Création du graphique avec recharts dans un composant React
            ctx.session.adminState = {
                action: 'show_stats_graph',
                data: {
                    monthly: monthlyData
                }
            };

            const graphComponent = `
            import React from 'react';
            import {
                LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
                ResponsiveContainer, BarChart, Bar
            } from 'recharts';

            const OrderStatsGraphs = () => {
                const data = ${JSON.stringify(monthlyData)}.map(item => ({
                    date: \`\${item._id.year}-\${String(item._id.month).padStart(2, '0')}\`,
                    commandes: item.count,
                    revenu: item.revenue
                }));

                return (
                    <div className="w-full space-y-8">
                        <div className="h-96">
                            <ResponsiveContainer>
                                <LineChart data={data}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="date" />
                                    <YAxis yAxisId="left" />
                                    <YAxis yAxisId="right" orientation="right" />
                                    <Tooltip />
                                    <Legend />
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="commandes"
                                        stroke="#8884d8"
                                    />
                                    <Line
                                        yAxisId="right"
                                        type="monotone"
                                        dataKey="revenu"
                                        stroke="#82ca9d"
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                );
            };

            export default OrderStatsGraphs;
            `;

            // Créer l'artifact pour le graphique
            await ctx.reply('📈 Graphiques des statistiques');

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('📊 Vue détaillée', 'order_stats_details'),
                    Markup.button.callback('📥 Exporter', 'export_order_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'order_stats')]
            ]);

            // Créer l'artifact pour le composant React
            await this.createReactArtifact(ctx, 'order-stats-graphs', graphComponent);
            await ctx.reply('Utilisez les boutons ci-dessous pour plus d\'options:', keyboard);
        } catch (error) {
            logger.error('Erreur graphiques statistiques:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Exporter les statistiques des commandes
    async exportOrderStats(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            // Récupérer toutes les commandes des 30 derniers jours
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const orders = await Order.find({
                createdAt: { $gte: thirtyDaysAgo }
            })
                .populate('products.product payment.method')
                .populate('user')
                .sort({ createdAt: -1 });

            // Générer le CSV
            let csv = 'Numéro de commande,Date,Client,Statut,Produits,Total,Méthode de paiement,Statut paiement\n';

            orders.forEach(order => {
                const products = order.products
                    .map(p => `${p.product.name} (x${p.quantity})`)
                    .join('; ');

                csv += `${order.orderNumber},`;
                csv += `${order.createdAt.toISOString()},`;
                csv += `${order.user.username},`;
                csv += `${order.status},`;
                csv += `"${products}",`;
                csv += `${order.payment.amount.total},`;
                csv += `${order.payment.method.name},`;
                csv += `${order.payment.status}\n`;
            });

            // Envoyer le fichier
            const buffer = Buffer.from(csv, 'utf-8');
            const date = new Date().toISOString().slice(0, 10);

            await ctx.replyWithDocument({
                source: buffer,
                filename: `commandes_${date}.csv`
            });

            await this.logAdminAction(ctx.from.id, 'export_order_stats', {
                dateRange: '30 jours',
                ordersCount: orders.length
            });
        } catch (error) {
            logger.error('Erreur export statistiques:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer les méthodes de paiement
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

            // Stats des paiements
            const stats = await Order.aggregate([
                {
                    $lookup: {
                        from: 'paymentmethods',
                        localField: 'payment.method',
                        foreignField: '_id',
                        as: 'paymentMethod'
                    }
                },
                {
                    $group: {
                        _id: {
                            methodId: '$payment.method',
                            methodName: { $first: '$paymentMethod.name' },
                            status: '$payment.status'
                        },
                        count: { $sum: 1 },
                        total: { $sum: '$payment.amount.total' }
                    }
                }
            ]);

            let message = '💳 Gestion des Méthodes de Paiement\n\n';
            message += '📊 Statistiques par méthode:\n\n';

            paymentMethods.forEach(method => {
                const methodStats = stats.filter(s => s._id.methodId.equals(method._id));
                const totalCount = methodStats.reduce((sum, s) => sum + s.count, 0);
                const totalAmount = methodStats.reduce((sum, s) => sum + s.total, 0);

                message += `${method.name}:\n`;
                message += `- Transactions: ${totalCount}\n`;
                message += `- Volume: ${totalAmount.toFixed(2)}€\n`;
                methodStats.forEach(s => {
                    message += `- ${s._id.status}: ${s.count} (${s.total.toFixed(2)}€)\n`;
                });
                message += '\n';
            });

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur gestion paiements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    //===================== CONFIGURATION DES PAIEMENTS =====================

    // Afficher les paramètres de paiement
    async editPaymentSettings(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('💳 Méthodes', 'edit_payment_methods'),
                    Markup.button.callback('💰 Devises', 'edit_currencies')
                ],
                [
                    Markup.button.callback('🏦 Comptes', 'edit_payment_accounts'),
                    Markup.button.callback('📊 Rapports', 'payment_reports')
                ],
                [
                    Markup.button.callback('⚙️ Paramètres', 'payment_settings'),
                    Markup.button.callback('🔒 Sécurité', 'payment_security')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            const config = await Config.findOne() || {};

            let message = '💳 Paramètres des Paiements\n\n';
            message += `🔒 Montant minimum: ${config.minPaymentAmount || '0'}€\n`;
            message += `💰 Montant maximum: ${config.maxPaymentAmount || 'Illimité'}€\n`;
            message += `⏳ Délai d'expiration: ${config.paymentTimeout || '30'} minutes\n`;
            message += `🔄 Tentatives max: ${config.maxPaymentAttempts || '3'}\n`;
            message += `✅ Confirmation automatique: ${config.autoConfirmPayments ? 'Activée' : 'Désactivée'}\n`;

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur paramètres paiements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer les paramètres généraux de paiement
    async handlePaymentSettings(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('💰 Montants Min/Max', 'edit_payment_limits'),
                    Markup.button.callback('⏳ Délais', 'edit_payment_timeouts')
                ],
                [
                    Markup.button.callback('✅ Confirmation Auto', 'toggle_auto_confirm'),
                    Markup.button.callback('🔄 Tentatives', 'edit_payment_attempts')
                ],
                [Markup.button.callback('🔙 Retour', 'edit_payment_settings')]
            ]);

            const config = await Config.findOne() || new Config();

            let message = '⚙️ Configuration des Paiements\n\n';
            message += '🔧 Paramètres actuels:\n\n';
            message += `💰 Montant minimum: ${config.minPaymentAmount || '0'}€\n`;
            message += `💰 Montant maximum: ${config.maxPaymentAmount || 'Illimité'}€\n`;
            message += `⏳ Délai d'expiration: ${config.paymentTimeout || '30'} minutes\n`;
            message += `🔄 Tentatives max: ${config.maxPaymentAttempts || '3'}\n`;
            message += `✅ Confirmation automatique: ${config.autoConfirmPayments ? 'Activée' : 'Désactivée'}\n`;

            if (config.autoConfirmPayments) {
                message += `💰 Montant max auto-confirm: ${config.autoConfirmLimit || '100'}€\n`;
            }

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur gestion paramètres paiements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Editer les limites de paiement
    async editPaymentLimits(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            ctx.session.adminState = {
                action: 'edit_payment_limits',
                step: 'min'
            };

            await ctx.reply(
                '💰 Configuration des limites de paiement\n\n' +
                'Veuillez entrer le montant minimum de paiement (en €):\n' +
                '(0 pour désactiver)'
            );
        } catch (error) {
            logger.error('Erreur édition limites:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer l'édition des limites
    async handlePaymentLimitsInput(ctx) {
        try {
            const { step } = ctx.session.adminState;
            const config = await Config.findOne() || new Config();

            switch (step) {
                case 'min':
                    const minAmount = parseFloat(ctx.message.text.replace(',', '.'));
                    if (isNaN(minAmount) || minAmount < 0) {
                        await ctx.reply('❌ Veuillez entrer un montant valide');
                        return true;
                    }

                    config.minPaymentAmount = minAmount;
                    ctx.session.adminState.step = 'max';

                    await ctx.reply(
                        '💰 Veuillez entrer le montant maximum de paiement (en €):\n' +
                        '(0 pour illimité)'
                    );
                    return true;

                case 'max':
                    const maxAmount = parseFloat(ctx.message.text.replace(',', '.'));
                    if (isNaN(maxAmount) || maxAmount < 0) {
                        await ctx.reply('❌ Veuillez entrer un montant valide');
                        return true;
                    }

                    config.maxPaymentAmount = maxAmount;
                    await config.save();

                    await this.logAdminAction(ctx.from.id, 'edit_payment_limits', {
                        minAmount: config.minPaymentAmount,
                        maxAmount: config.maxPaymentAmount
                    });

                    this.clearAdminState(ctx);
                    await ctx.reply('✅ Limites de paiement mises à jour');
                    await this.handlePaymentSettings(ctx);
                    return true;
            }
        } catch (error) {
            logger.error('Erreur traitement limites:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
            return true;
        }
    }

    // Gérer les délais de paiement
    async editPaymentTimeouts(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            ctx.session.adminState = {
                action: 'edit_payment_timeouts',
                step: 'timeout'
            };

            await ctx.reply(
                '⏳ Configuration des délais de paiement\n\n' +
                'Veuillez entrer le délai d\'expiration (en minutes):'
            );
        } catch (error) {
            logger.error('Erreur édition délais:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Activer/désactiver la confirmation automatique
    async toggleAutoConfirm(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const config = await Config.findOne() || new Config();
            config.autoConfirmPayments = !config.autoConfirmPayments;
            await config.save();

            await this.logAdminAction(ctx.from.id, 'toggle_auto_confirm', {
                newStatus: config.autoConfirmPayments
            });

            await ctx.reply(
                `✅ Confirmation automatique ${config.autoConfirmPayments ? 'activée' : 'désactivée'}`
            );
            await this.handlePaymentSettings(ctx);
        } catch (error) {
            logger.error('Erreur toggle confirmation auto:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Éditer le nombre maximum de tentatives
    async editPaymentAttempts(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            ctx.session.adminState = {
                action: 'edit_payment_attempts',
                step: 'attempts'
            };

            await ctx.reply(
                '🔄 Configuration des tentatives de paiement\n\n' +
                'Veuillez entrer le nombre maximum de tentatives autorisées:'
            );
        } catch (error) {
            logger.error('Erreur édition tentatives:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer le nombre de tentatives
    async handlePaymentAttemptsInput(ctx) {
        try {
            const attempts = parseInt(ctx.message.text);
            if (isNaN(attempts) || attempts < 1) {
                await ctx.reply('❌ Veuillez entrer un nombre valide supérieur à 0');
                return true;
            }

            const config = await Config.findOne() || new Config();
            config.maxPaymentAttempts = attempts;
            await config.save();

            await this.logAdminAction(ctx.from.id, 'edit_payment_attempts', {
                attempts
            });

            this.clearAdminState(ctx);
            await ctx.reply('✅ Nombre de tentatives mis à jour');
            await this.handlePaymentSettings(ctx);
            return true;
        } catch (error) {
            logger.error('Erreur traitement tentatives:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
            return true;
        }
    }
    //===================== MÉTHODES DE PAIEMENT =====================

    // Ajouter une méthode de paiement
    async startAddPaymentMethod(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('PayPal', 'add_payment_paypal'),
                    Markup.button.callback('Crypto', 'add_payment_crypto')
                ],
                [
                    Markup.button.callback('PCS', 'add_payment_pcs'),
                    Markup.button.callback('Transcash', 'add_payment_transcash')
                ],
                [Markup.button.callback('Paysafecard', 'add_payment_paysafecard')],
                [Markup.button.callback('Main propre', 'add_payment_cash')],
                [Markup.button.callback('🔙 Retour', 'admin_payments')]
            ]);

            await ctx.reply(
                '💳 Ajout d\'une méthode de paiement\n\n' +
                'Sélectionnez le type de paiement à ajouter:',
                keyboard
            );
        } catch (error) {
            logger.error('Erreur ajout méthode paiement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Ajouter PayPal
    async addPaymentPaypal(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            ctx.session.adminState = {
                action: 'add_payment_paypal',
                step: 'email'
            };

            await ctx.reply(
                '📧 Configuration PayPal\n\n' +
                'Veuillez entrer l\'email PayPal:'
            );
        } catch (error) {
            logger.error('Erreur ajout PayPal:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer l'ajout PayPal
    async handleAddPaypalInput(ctx) {
        try {
            const { step } = ctx.session.adminState;

            switch (step) {
                case 'email':
                    const email = ctx.message.text.trim();
                    if (!email.includes('@')) {
                        await ctx.reply('❌ Email invalide');
                        return true;
                    }

                    const paymentMethod = await PaymentMethod.create({
                        name: 'PayPal',
                        type: 'paypal',
                        status: 'active',
                        config: {
                            email: email,
                            sandbox: false
                        },
                        fees: {
                            percentage: 3.4,
                            fixed: 0.49
                        },
                        limits: {
                            min: 1,
                            max: 10000
                        },
                        displayOrder: await PaymentMethod.countDocuments() + 1
                    });

                    await this.logAdminAction(ctx.from.id, 'add_payment_method', {
                        type: 'paypal',
                        email: email
                    });

                    this.clearAdminState(ctx);
                    await ctx.reply('✅ Méthode PayPal ajoutée avec succès');
                    await this.showPaymentManagement(ctx);
                    return true;
            }
        } catch (error) {
            logger.error('Erreur traitement PayPal:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
            return true;
        }
    }

    // Ajouter Crypto
    async addPaymentCrypto(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            ctx.session.adminState = {
                action: 'add_payment_crypto',
                step: 'networks',
                data: {}
            };

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('Bitcoin', 'crypto_btc'),
                    Markup.button.callback('Ethereum', 'crypto_eth')
                ],
                [
                    Markup.button.callback('USDT', 'crypto_usdt'),
                    Markup.button.callback('Monero', 'crypto_xmr')
                ],
                [Markup.button.callback('✅ Terminer', 'crypto_done')]
            ]);

            await ctx.reply(
                '🪙 Configuration Crypto\n\n' +
                'Sélectionnez les réseaux à activer:',
                keyboard
            );
        } catch (error) {
            logger.error('Erreur ajout Crypto:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Ajouter une adresse crypto
    async handleCryptoAddress(ctx, network) {
        try {
            const data = ctx.session.adminState.data;
            if (!data.networks) data.networks = [];

            ctx.session.adminState.step = 'address';
            ctx.session.adminState.currentNetwork = network;

            await ctx.reply(
                `🏦 Entrez l'adresse ${network.toUpperCase()}:`
            );
        } catch (error) {
            logger.error('Erreur adresse crypto:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Finaliser l'ajout crypto
    async finalizeCryptoSetup(ctx) {
        try {
            const { data } = ctx.session.adminState;
            if (!data.networks || data.networks.length === 0) {
                await ctx.reply('❌ Veuillez sélectionner au moins un réseau');
                return;
            }

            const paymentMethod = await PaymentMethod.create({
                name: 'Crypto',
                type: 'crypto',
                status: 'active',
                config: {
                    networks: data.networks,
                    confirmations: {
                        BTC: 3,
                        ETH: 12,
                        USDT: 12,
                        XMR: 10
                    }
                },
                fees: {
                    percentage: 1,
                    fixed: 0
                },
                limits: {
                    min: 10,
                    max: 100000
                },
                displayOrder: await PaymentMethod.countDocuments() + 1
            });

            await this.logAdminAction(ctx.from.id, 'add_payment_method', {
                type: 'crypto',
                networks: data.networks.map(n => n.network)
            });

            this.clearAdminState(ctx);
            await ctx.reply('✅ Méthode Crypto ajoutée avec succès');
            await this.showPaymentManagement(ctx);
        } catch (error) {
            logger.error('Erreur finalisation crypto:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Ajouter PCS/Transcash
    async addPaymentVoucher(ctx, type) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const methodName = type === 'pcs' ? 'PCS' : 'Transcash';
            const paymentMethod = await PaymentMethod.create({
                name: methodName,
                type: type,
                status: 'active',
                config: {
                    verificationRequired: true,
                    maxAmount: 1000,
                    instructions: 'Envoyez une photo du ticket'
                },
                fees: {
                    percentage: 10,
                    fixed: 0
                },
                limits: {
                    min: 20,
                    max: 1000
                },
                displayOrder: await PaymentMethod.countDocuments() + 1
            });

            await this.logAdminAction(ctx.from.id, 'add_payment_method', {
                type: type
            });

            await ctx.reply(`✅ Méthode ${methodName} ajoutée avec succès`);
            await this.showPaymentManagement(ctx);
        } catch (error) {
            logger.error('Erreur ajout méthode voucher:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Éditer une méthode de paiement
    async startEditPaymentMethod(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const methodId = ctx.match[1];
            const method = await PaymentMethod.findById(methodId);

            if (!method) {
                return ctx.reply('❌ Méthode de paiement non trouvée');
            }

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback(
                        method.status === 'active' ? '❌ Désactiver' : '✅ Activer',
                        `toggle_payment_${method._id}`
                    )
                ],
                [
                    Markup.button.callback('💰 Frais', `edit_payment_fees_${method._id}`),
                    Markup.button.callback('⚙️ Configuration', `edit_payment_config_${method._id}`)
                ],
                [
                    Markup.button.callback('💳 Limites', `edit_payment_limits_${method._id}`),
                    Markup.button.callback('📝 Instructions', `edit_payment_instructions_${method._id}`)
                ],
                [Markup.button.callback('🔙 Retour', 'admin_payments')]
            ]);

            let message = `💳 ${method.name}\n\n`;
            message += `📊 Statut: ${method.status === 'active' ? '✅ Active' : '❌ Inactive'}\n`;
            message += `💰 Frais: ${method.fees.percentage}% + ${method.fees.fixed}€\n`;
            message += `💳 Limites: ${method.limits.min}€ - ${method.limits.max}€\n\n`;

            message += '⚙️ Configuration:\n';
            Object.entries(method.config).forEach(([key, value]) => {
                message += `${key}: ${JSON.stringify(value)}\n`;
            });

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur modification méthode paiement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Éditer les frais d'une méthode
    async editPaymentFees(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const methodId = ctx.match[1];
            const method = await PaymentMethod.findById(methodId);

            if (!method) {
                return ctx.reply('❌ Méthode de paiement non trouvée');
            }

            ctx.session.adminState = {
                action: 'edit_payment_fees',
                methodId: methodId,
                step: 'percentage'
            };

            await ctx.reply(
                `💰 Configuration des frais pour ${method.name}\n\n` +
                `Frais actuels: ${method.fees.percentage}% + ${method.fees.fixed}€\n\n` +
                'Entrez le nouveau pourcentage (0-100):'
            );
        } catch (error) {
            logger.error('Erreur modification frais:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    //===================== GESTION DES TRANSACTIONS =====================

    // Traiter un nouveau paiement
    async processPayment(ctx, order, paymentInfo) {
        try {
            const paymentMethod = await PaymentMethod.findById(order.payment.method);

            if (!paymentMethod || paymentMethod.status !== 'active') {
                return {
                    success: false,
                    error: 'Méthode de paiement non disponible'
                };
            }

            // Vérifier les limites
            if (order.payment.amount.total < paymentMethod.limits.min ||
                order.payment.amount.total > paymentMethod.limits.max) {
                return {
                    success: false,
                    error: `Montant hors limites (${paymentMethod.limits.min}€ - ${paymentMethod.limits.max}€)`
                };
            }

            // Créer la transaction
            const transaction = await Transaction.create({
                orderId: order._id,
                userId: order.user.telegramId,
                paymentMethod: paymentMethod._id,
                amount: order.payment.amount.total,
                status: 'pending',
                paymentInfo: paymentInfo,
                createdAt: new Date()
            });

            // Mettre à jour la commande
            order.payment.transactionId = transaction._id;
            order.payment.status = 'pending';
            await order.save();

            // Traitement selon le type de paiement
            switch (paymentMethod.type) {
                case 'crypto':
                    return await this.processCryptoPayment(ctx, order, transaction, paymentMethod);
                case 'paypal':
                    return await this.processPaypalPayment(ctx, order, transaction, paymentMethod);
                case 'pcs':
                case 'transcash':
                    return await this.processVoucherPayment(ctx, order, transaction, paymentMethod);
                case 'cash':
                    return await this.processCashPayment(ctx, order, transaction, paymentMethod);
                default:
                    throw new Error('Type de paiement non supporté');
            }
        } catch (error) {
            logger.error('Erreur traitement paiement:', error);
            return {
                success: false,
                error: 'Erreur interne'
            };
        }
    }

    // Vérifier un paiement
    async verifyPayment(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const orderId = ctx.match[1];
            const order = await Order.findById(orderId)
                .populate('payment.method');

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            const transaction = await Transaction.findById(order.payment.transactionId);
            if (!transaction) {
                return ctx.reply('❌ Transaction non trouvée');
            }

            let verificationResult = false;

            // Vérifier selon le type de paiement
            switch (order.payment.method.type) {
                case 'crypto':
                    verificationResult = await this.verifyCryptoTransaction(transaction);
                    break;
                case 'paypal':
                    verificationResult = await this.verifyPaypalTransaction(transaction);
                    break;
                case 'pcs':
                case 'transcash':
                    verificationResult = await this.verifyVoucherTransaction(transaction);
                    break;
            }

            if (verificationResult) {
                // Mettre à jour le statut
                transaction.status = 'completed';
                transaction.verifiedAt = new Date();
                transaction.verifiedBy = ctx.from.id;
                await transaction.save();

                // Mettre à jour la commande
                order.payment.status = 'completed';
                order.payment.confirmedAt = new Date();
                order.payment.confirmedBy = ctx.from.id;
                await order.save();

                await this.logAdminAction(ctx.from.id, 'verify_payment', {
                    orderId: order._id,
                    transactionId: transaction._id,
                    amount: transaction.amount
                });

                await ctx.reply('✅ Paiement vérifié avec succès');
            } else {
                await ctx.reply('❌ La vérification a échoué');
            }

            await this.viewOrder(ctx);
        } catch (error) {
            logger.error('Erreur vérification paiement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer un remboursement
    async handleRefund(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const [orderId, amount] = ctx.match[1].split('_');
            const order = await Order.findById(orderId)
                .populate('payment.method');

            if (!order) {
                return ctx.reply('❌ Commande non trouvée');
            }

            const refundAmount = parseFloat(amount);
            if (isNaN(refundAmount) || refundAmount <= 0 ||
                refundAmount > order.payment.amount.total) {
                return ctx.reply('❌ Montant de remboursement invalide');
            }

            // Créer le remboursement
            const refund = await Refund.create({
                orderId: order._id,
                userId: order.user.telegramId,
                amount: refundAmount,
                reason: ctx.session.adminState?.refundReason || 'Non spécifié',
                status: 'pending',
                initiatedBy: ctx.from.id,
                createdAt: new Date()
            });

            // Processus de remboursement selon la méthode
            let refundResult = false;
            switch (order.payment.method.type) {
                case 'crypto':
                    refundResult = await this.processCryptoRefund(order, refund);
                    break;
                case 'paypal':
                    refundResult = await this.processPaypalRefund(order, refund);
                    break;
                default:
                    refundResult = true; // Pour les méthodes manuelles
            }

            if (refundResult) {
                refund.status = 'completed';
                refund.completedAt = new Date();
                await refund.save();

                // Mettre à jour la commande
                if (refundAmount === order.payment.amount.total) {
                    await order.updateStatus('refunded', 'Remboursement total', ctx.from.id);
                } else {
                    order.payment.refundedAmount = (order.payment.refundedAmount || 0) + refundAmount;
                    await order.save();
                }

                await this.logAdminAction(ctx.from.id, 'refund_order', {
                    orderId: order._id,
                    amount: refundAmount,
                    reason: refund.reason
                });

                // Notifier le client
                await this.bot.telegram.sendMessage(
                    order.user.telegramId,
                    `💰 Un remboursement de ${refundAmount}€ a été effectué pour votre commande ${order.orderNumber}.`
                );

                await ctx.reply('✅ Remboursement effectué avec succès');
            } else {
                await ctx.reply('❌ Le remboursement a échoué');
            }

            await this.viewOrder(ctx);
        } catch (error) {
            logger.error('Erreur remboursement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Voir l'historique des transactions
    async viewTransactionHistory(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const transactions = await Transaction.find()
                .populate('orderId')
                .populate('paymentMethod')
                .sort({ createdAt: -1 })
                .limit(10);

            let message = '📊 Historique des Transactions\n\n';

            transactions.forEach(trans => {
                const order = trans.orderId;
                message += `🔹 ${trans._id}\n`;
                message += `📦 Commande: ${order?.orderNumber || 'N/A'}\n`;
                message += `💳 Méthode: ${trans.paymentMethod?.name || 'N/A'}\n`;
                message += `💰 Montant: ${trans.amount}€\n`;
                message += `📊 Statut: ${this.getStatusEmoji(trans.status)} ${trans.status}\n`;
                message += `📅 Date: ${trans.createdAt.toLocaleString()}\n\n`;
            });

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('🔍 Rechercher', 'search_transactions'),
                    Markup.button.callback('📊 Stats', 'transaction_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_payments')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur historique transactions:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Gérer les logs de transactions
    async viewTransactionLogs(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const logs = await TransactionLog.find()
                .sort({ timestamp: -1 })
                .limit(20);

            let message = '📝 Logs de Transactions\n\n';

            logs.forEach(log => {
                message += `🕒 ${log.timestamp.toLocaleString()}\n`;
                message += `📝 Action: ${log.action}\n`;
                message += `👤 Admin: ${log.adminId}\n`;
                if (log.details) message += `ℹ️ Détails: ${JSON.stringify(log.details)}\n`;
                message += '\n';
            });

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('🔍 Filtrer', 'filter_transaction_logs'),
                    Markup.button.callback('📥 Exporter', 'export_transaction_logs')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_payments')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur logs transactions:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    //===================== STATISTIQUES DES PAIEMENTS =====================

    // Afficher les statistiques des paiements
    async showPaymentStats(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            // Statistiques générales
            const stats = await Transaction.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount' }
                    }
                }
            ]);

            // Statistiques par méthode
            const methodStats = await Transaction.aggregate([
                {
                    $lookup: {
                        from: 'paymentmethods',
                        localField: 'paymentMethod',
                        foreignField: '_id',
                        as: 'method'
                    }
                },
                {
                    $group: {
                        _id: {
                            methodId: '$paymentMethod',
                            methodName: { $first: '$method.name' }
                        },
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount' },
                        successRate: {
                            $avg: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                        }
                    }
                }
            ]);

            // Tendances sur 30 jours
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const dailyStats = await Transaction.aggregate([
                {
                    $match: {
                        createdAt: { $gte: thirtyDaysAgo }
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                        },
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount' }
                    }
                },
                { $sort: { '_id': 1 } }
            ]);

            let message = '📊 Statistiques des Paiements\n\n';

            // Vue d'ensemble
            message += '📈 Vue d\'ensemble:\n';
            let totalTransactions = 0;
            let totalAmount = 0;
            stats.forEach(stat => {
                totalTransactions += stat.count;
                totalAmount += stat.totalAmount;
                message += `${this.getStatusEmoji(stat._id)} ${stat._id}: ${stat.count} (${stat.totalAmount.toFixed(2)}€)\n`;
            });
            message += `\nTotal: ${totalTransactions} transactions (${totalAmount.toFixed(2)}€)\n\n`;

            // Par méthode de paiement
            message += '💳 Par méthode de paiement:\n';
            methodStats.forEach(stat => {
                message += `${stat._id.methodName}:\n`;
                message += `- Transactions: ${stat.count}\n`;
                message += `- Volume: ${stat.totalAmount.toFixed(2)}€\n`;
                message += `- Taux de succès: ${(stat.successRate * 100).toFixed(1)}%\n\n`;
            });

            // Tendances
            const recentStats = dailyStats.slice(-7);
            message += '📅 Derniers 7 jours:\n';
            recentStats.forEach(day => {
                message += `${day._id}: ${day.count} trans. (${day.totalAmount.toFixed(2)}€)\n`;
            });

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('📊 Détails', 'payment_stats_details'),
                    Markup.button.callback('📈 Graphiques', 'payment_stats_graphs')
                ],
                [
                    Markup.button.callback('📥 Exporter', 'export_payment_stats'),
                    Markup.button.callback('📧 Rapport', 'email_payment_stats')
                ],
                [
                    Markup.button.callback('🔄 Actualiser', 'refresh_payment_stats'),
                    Markup.button.callback('🔙 Retour', 'admin_payments')
                ]
            ]);

            await ctx.reply(message, keyboard);

            // Créer un graphique avec les tendances
            await this.createPaymentStatsGraph(ctx, dailyStats);

        } catch (error) {
            logger.error('Erreur statistiques paiements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Créer un graphique des statistiques
    async createPaymentStatsGraph(ctx, dailyStats) {
        const graphComponent = `
        import React from 'react';
        import {
            LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
            ResponsiveContainer, BarChart, Bar
        } from 'recharts';

        const PaymentStatsGraph = () => {
            const data = ${JSON.stringify(dailyStats)}.map(item => ({
                date: item._id,
                transactions: item.count,
                montant: item.totalAmount
            }));

            return (
                <div className="w-full space-y-8">
                    <div className="h-96">
                        <ResponsiveContainer>
                            <LineChart data={data}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" />
                                <YAxis yAxisId="left" />
                                <YAxis yAxisId="right" orientation="right" />
                                <Tooltip />
                                <Legend />
                                <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="transactions"
                                    stroke="#8884d8"
                                    name="Transactions"
                                />
                                <Line
                                    yAxisId="right"
                                    type="monotone"
                                    dataKey="montant"
                                    stroke="#82ca9d"
                                    name="Montant (€)"
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            );
        };

        export default PaymentStatsGraph;`;

        // Créer l'artifact pour le graphique
        await this.createReactArtifact(ctx, 'payment-stats-graph', graphComponent);
    }

    // Afficher les détails des statistiques
    async showPaymentStatsDetails(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            // Analyses avancées par méthode
            const methodAnalysis = await Transaction.aggregate([
                {
                    $lookup: {
                        from: 'paymentmethods',
                        localField: 'paymentMethod',
                        foreignField: '_id',
                        as: 'method'
                    }
                },
                {
                    $group: {
                        _id: {
                            methodId: '$paymentMethod',
                            methodName: { $first: '$method.name' }
                        },
                        transactions: { $sum: 1 },
                        totalAmount: { $sum: '$amount' },
                        avgAmount: { $avg: '$amount' },
                        minAmount: { $min: '$amount' },
                        maxAmount: { $max: '$amount' },
                        successCount: {
                            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                        },
                        failureCount: {
                            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                        }
                    }
                }
            ]);

            // Analyse des temps de traitement
            const processingTimes = await Transaction.aggregate([
                {
                    $match: {
                        status: 'completed'
                    }
                },
                {
                    $lookup: {
                        from: 'paymentmethods',
                        localField: 'paymentMethod',
                        foreignField: '_id',
                        as: 'method'
                    }
                },
                {
                    $group: {
                        _id: { $first: '$method.name' },
                        avgProcessingTime: {
                            $avg: {
                                $subtract: ['$updatedAt', '$createdAt']
                            }
                        },
                        minProcessingTime: {
                            $min: {
                                $subtract: ['$updatedAt', '$createdAt']
                            }
                        },
                        maxProcessingTime: {
                            $max: {
                                $subtract: ['$updatedAt', '$createdAt']
                            }
                        }
                    }
                }
            ]);

            let message = '📊 Détails des Statistiques de Paiement\n\n';

            // Détails par méthode
            message += '💳 Analyse par méthode de paiement:\n\n';
            methodAnalysis.forEach(method => {
                message += `${method._id.methodName}:\n`;
                message += `- Transactions: ${method.transactions}\n`;
                message += `- Volume total: ${method.totalAmount.toFixed(2)}€\n`;
                message += `- Montant moyen: ${method.avgAmount.toFixed(2)}€\n`;
                message += `- Plage: ${method.minAmount.toFixed(2)}€ - ${method.maxAmount.toFixed(2)}€\n`;
                const successRate = (method.successCount / method.transactions * 100).toFixed(1);
                message += `- Taux de succès: ${successRate}%\n\n`;
            });

            // Temps de traitement
            message += '⏱️ Temps de traitement moyens:\n\n';
            processingTimes.forEach(timing => {
                const avgMinutes = Math.round(timing.avgProcessingTime / 1000 / 60);
                const minMinutes = Math.round(timing.minProcessingTime / 1000 / 60);
                const maxMinutes = Math.round(timing.maxProcessingTime / 1000 / 60);

                message += `${timing._id}:\n`;
                message += `- Moyen: ${avgMinutes} minutes\n`;
                message += `- Min: ${minMinutes} minutes\n`;
                message += `- Max: ${maxMinutes} minutes\n\n`;
            });

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('📈 Graphiques', 'payment_stats_graphs'),
                    Markup.button.callback('📥 Exporter', 'export_payment_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'payment_stats')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur détails statistiques paiements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Exporter les statistiques
    async exportPaymentStats(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            // Récupérer les données
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const transactions = await Transaction.find({
                createdAt: { $gte: thirtyDaysAgo }
            })
                .populate('paymentMethod')
                .populate('orderId')
                .sort({ createdAt: -1 });

            // Générer le CSV
            let csv = 'Date,ID Transaction,Méthode,Montant,Statut,ID Commande\n';

            transactions.forEach(trans => {
                csv += `${trans.createdAt.toISOString()},`;
                csv += `${trans._id},`;
                csv += `${trans.paymentMethod?.name || 'N/A'},`;
                csv += `${trans.amount},`;
                csv += `${trans.status},`;
                csv += `${trans.orderId?._id || 'N/A'}\n`;
            });

            // Envoyer le fichier
            const buffer = Buffer.from(csv, 'utf-8');
            const date = new Date().toISOString().slice(0, 10);

            await ctx.replyWithDocument({
                source: buffer,
                filename: `transactions_${date}.csv`
            });

            await this.logAdminAction(ctx.from.id, 'export_payment_stats', {
                dateRange: '30 jours',
                transactionCount: transactions.length
            });
        } catch (error) {
            logger.error('Erreur export statistiques paiements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // ===================== GESTION DE LA CONFIGURATION =====================

    /**
     * Affiche le panneau principal de configuration administrative
     * Ce panneau donne accès à toutes les sections de configuration
     * @param {object} ctx - Contexte Telegraf
     */
    async showAdminConfig(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier avec les différentes options de configuration
            const keyboard = Markup.inlineKeyboard([
                [
                    // Paramètres du bot et de sécurité
                    Markup.button.callback('🤖 Bot', 'edit_bot_settings'),
                    Markup.button.callback('🔒 Sécurité', 'edit_security_settings')
                ],
                [
                    // Notifications et paiements
                    Markup.button.callback('🔔 Notifications', 'edit_notification_settings'),
                    Markup.button.callback('💳 Paiements', 'edit_payment_settings')
                ],
                [
                    // Backup et logs système
                    Markup.button.callback('💾 Backup', 'manage_backup'),
                    Markup.button.callback('📝 Logs', 'view_logs')
                ],
                [
                    // Gestion des admins et API
                    Markup.button.callback('👥 Rôles Admin', 'manage_admin_roles'),
                    Markup.button.callback('🔌 API', 'manage_api_settings')
                ],
                [
                    // Bouton retour
                    Markup.button.callback('🔙 Retour', 'admin_panel')
                ]
            ]);

            // Récupération de la configuration actuelle
            const config = await Config.findOne() || {};

            // Construction du message avec les informations de configuration
            let message = '⚙️ Configuration\n\n';
            message += `🤖 Nom du bot: ${config.botName || 'Non défini'}\n`;
            message += `🌐 Langue: ${config.language || 'FR'}\n`;
            message += `⏰ Fuseau horaire: ${config.timezone || 'Europe/Paris'}\n`;
            message += `🔒 Mode maintenance: ${config.maintenanceMode ? '✅' : '❌'}\n`;
            message += `🔄 Version: ${config.version || '1.0.0'}\n`;
            message += `📅 Dernière mise à jour: ${config.lastUpdate ? new Date(config.lastUpdate).toLocaleDateString() : 'Jamais'}\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur affichage configuration:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // -------------------- PARAMÈTRES DU BOT --------------------

    /**
     * Gestion du changement de langue du bot
     * Affiche les langues disponibles et permet leur sélection
     * @param {object} ctx - Contexte Telegraf
     */
    async editBotLanguage(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) {
                return;
            }

            const chatId = ctx.chat?.id || ctx.channelPost?.chat?.id;
            if (!chatId) {
                console.error('Chat ID non trouvé');
                return;
            }

            // Définition de l'état pour suivre l'action en cours
            ctx.session.adminState = {
                action: 'edit_bot_language',
                step: 'select'
            };

            // Liste des langues disponibles
            const languages = [
                ['FR', 'Français'],
                ['EN', 'English'],
                ['ES', 'Español'],
                ['DE', 'Deutsch']
            ];

            // Construction du clavier
            const keyboard = {
                inline_keyboard: [
                    ...languages.map(([code, name]) => [{
                        text: name,
                        callback_data: `set_language_${code}`
                    }]),
                    [{
                        text: '❌ Annuler',
                        callback_data: 'edit_bot_settings'
                    }]
                ]
            };

            // Récupération de la configuration actuelle
            const config = await Config.findOne() || new Config();

            await ctx.telegram.sendMessage(
                chatId,
                `🌐 Configuration de la Langue\n\n` +
                `Langue actuelle: ${config.language || 'FR'}\n\n` +
                `Sélectionnez la nouvelle langue :`,
                { reply_markup: keyboard }
            );
        } catch (error) {
            console.error('Erreur édition langue:', error);
            if (ctx.chat?.id) {
                await ctx.telegram.sendMessage(
                    ctx.chat.id,
                    '❌ Une erreur est survenue'
                ).catch(console.error);
            }
        }
    }

    /**
     * Applique le changement de langue sélectionné
     * @param {object} ctx - Contexte Telegraf
     * @param {string} langCode - Code de la langue sélectionnée
     */
    async setBotLanguage(ctx, langCode) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
            if (!chatId) return;

            logger.debug('Mise à jour de la langue vers:', langCode);

            // Mise à jour de la configuration
            const result = await Config.findOneAndUpdate(
                {},
                {
                    $set: {
                        language: langCode,
                        lastUpdate: new Date()
                    }
                },
                { new: true, upsert: true }
            );

            // Mettre à jour la langue dans i18n
            i18n.setDefaultLocale(langCode);

            // Journalisation
            await this.logAdminAction(ctx.from.id, 'change_language', {
                oldLang: result.language,
                newLang: langCode
            });

            // Message de confirmation
            await ctx.telegram.sendMessage(
                chatId,
                i18n.t('success.languageChanged', { lang: langCode }, langCode)
            );

            // Rafraîchir l'affichage des paramètres avec la nouvelle langue
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.editBotSettings(ctx, langCode);

        } catch (error) {
            logger.error('Erreur changement langue:', error);
            if (chatId) {
                await ctx.telegram.sendMessage(
                    chatId,
                    i18n.t('errors.general')
                ).catch(console.error);
            }
        }
    }
    /**
     * Gestion du fuseau horaire du bot
     * @param {object} ctx - Contexte Telegraf
     */
    async editBotTimezone(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Liste des fuseaux horaires principaux
            const timezones = [
                ['Europe/Paris', 'Paris (UTC+1)'],
                ['Europe/London', 'Londres (UTC)'],
                ['America/New_York', 'New York (UTC-5)'],
                ['Asia/Tokyo', 'Tokyo (UTC+9)'],
                ['Australia/Sydney', 'Sydney (UTC+10)']
            ];

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                // Création d'un bouton pour chaque fuseau horaire
                ...timezones.map(([code, name]) => [
                    Markup.button.callback(name, `set_timezone_${code}`)
                ]),
                // Option de recherche pour les autres fuseaux horaires
                [Markup.button.callback('🔍 Rechercher autre fuseau', 'search_timezone')],
                // Bouton retour
                [Markup.button.callback('🔙 Retour', 'edit_bot_settings')]
            ]);

            // Récupération de la configuration actuelle
            const config = await Config.findOne() || {};

            // Construction du message
            let message = '⏰ Configuration du Fuseau Horaire\n\n';
            message += `Fuseau actuel: ${config.timezone || 'Europe/Paris'}\n\n`;
            message += 'Sélectionnez le nouveau fuseau horaire:';

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur sélection fuseau horaire:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    // Pour gérer l'édition du fuseau horaire
    async editBotTimezone(ctx) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const timezones = [
                ['Europe/Paris', 'Paris (UTC+1)'],
                ['Europe/London', 'Londres (UTC)'],
                ['America/New_York', 'New York (UTC-5)'],
                ['Asia/Tokyo', 'Tokyo (UTC+9)'],
                ['Australia/Sydney', 'Sydney (UTC+10)']
            ];

            // Construction du clavier avec les fuseaux horaires
            const keyboard = Markup.inlineKeyboard([
                ...timezones.map(([zone, label]) => [
                    Markup.button.callback(label, `set_timezone_${zone}`)
                ]),
                [Markup.button.callback('🔙 Retour', 'edit_bot_settings')]
            ]);

            // Récupérer la configuration actuelle
            const config = await Config.findOne();
            const currentTimezone = config?.timezone || 'Europe/Paris';

            // Message avec le fuseau horaire actuel
            await ctx.reply(
                `⏰ Fuseau horaire actuel: ${currentTimezone}\n\nChoisissez un nouveau fuseau horaire:`,
                keyboard
            );
        } catch (error) {
            logger.error('Erreur édition fuseau horaire:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    // Pour définir le nouveau fuseau horaire
    async setBotTimezone(ctx, timezone) {
        try {
            if (!await this.isAdmin(ctx)) return;

            // Vérifier que le fuseau horaire est valide
            try {
                Intl.DateTimeFormat(undefined, { timeZone: timezone });
            } catch (e) {
                return ctx.reply('❌ Fuseau horaire invalide');
            }

            // Mise à jour de la configuration
            const result = await Config.findOneAndUpdate(
                {},
                {
                    $set: {
                        timezone: timezone,
                        lastUpdate: new Date()
                    }
                },
                { new: true, upsert: true }
            );

            // Logger l'action
            await this.logAdminAction(ctx.from.id, 'edit_timezone', {
                oldTimezone: result.timezone,
                newTimezone: timezone
            });

            // Message de confirmation
            await ctx.reply(`✅ Fuseau horaire modifié: ${timezone}`);

            // Rafraîchir les paramètres
            await this.editBotSettings(ctx);

        } catch (error) {
            logger.error('Erreur changement fuseau horaire:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Applique le changement de fuseau horaire
     * @param {object} ctx - Contexte Telegraf
     * @param {string} timezone - Nouveau fuseau horaire
     */
    async setBotTimezone(ctx, timezone) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Validation du fuseau horaire
            if (!this.isValidTimezone(timezone)) {
                return ctx.reply('❌ Fuseau horaire invalide');
            }

            // Mise à jour de la configuration
            const config = await Config.findOne() || new Config();
            const oldTimezone = config.timezone; // Sauvegarde pour les logs
            config.timezone = timezone;
            config.lastUpdate = new Date();
            await config.save();

            // Journalisation du changement
            await this.logAdminAction(ctx.from.id, 'change_timezone', {
                oldTimezone,
                newTimezone: timezone
            });

            // Confirmation et retour
            await ctx.reply(`✅ Fuseau horaire modifié: ${timezone}`);
            await this.editBotSettings(ctx);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur changement fuseau horaire:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Validation d'un fuseau horaire
     * @param {string} timezone - Fuseau horaire à valider
     * @returns {boolean} - True si valide, false sinon
     */
    isValidTimezone(timezone) {
        try {
            // Tente de créer une date avec le fuseau horaire
            Intl.DateTimeFormat(undefined, { timeZone: timezone });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Gestion du mode maintenance
     * Active ou désactive le mode maintenance du bot
     * @param {object} ctx - Contexte Telegraf
     */
    async toggleMaintenance(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Récupération et mise à jour de la configuration
            const config = await Config.findOne() || new Config();
            config.maintenanceMode = !config.maintenanceMode;
            config.lastUpdate = new Date();

            // Si on active le mode maintenance, on enregistre la date de début
            if (config.maintenanceMode) {
                config.maintenanceStartedAt = new Date();
            } else {
                // Si on désactive, on calcule la durée totale
                const duration = config.maintenanceStartedAt
                    ? Math.floor((Date.now() - config.maintenanceStartedAt) / 1000 / 60)
                    : 0;
                config.lastMaintenanceDuration = duration;
            }

            await config.save();

            // Journalisation du changement
            await this.logAdminAction(ctx.from.id, 'toggle_maintenance', {
                status: config.maintenanceMode ? 'enabled' : 'disabled',
                duration: config.lastMaintenanceDuration
            });

            // Si le mode maintenance est activé, notification des utilisateurs
            if (config.maintenanceMode) {
                await this.notifyMaintenanceMode(true);
            }

            // Confirmation du changement
            await ctx.reply(
                `🔧 Mode maintenance ${config.maintenanceMode ? 'activé' : 'désactivé'}`
            );

            // Retour au menu des paramètres
            await this.editBotSettings(ctx);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur toggle maintenance:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Notifie les utilisateurs du changement de statut maintenance
     * @param {boolean} enabled - True si maintenance activée, false si désactivée
     */
    async notifyMaintenanceMode(enabled) {
        try {
            // Récupération des utilisateurs actifs
            const users = await User.find({ status: 'active' });

            // Message de notification
            const message = enabled
                ? '🔧 Le bot entre en maintenance. Certaines fonctionnalités seront indisponibles.'
                : '✅ La maintenance est terminée. Le bot est à nouveau pleinement opérationnel.';

            // Envoi des notifications
            for (const user of users) {
                try {
                    await this.bot.telegram.sendMessage(user.telegramId, message);
                } catch (error) {
                    logger.error(`Erreur notification maintenance utilisateur ${user.telegramId}:`, error);
                }
            }
        } catch (error) {
            logger.error('Erreur notification maintenance:', error);
        }
    }
    /**
     * Gestion principale des paramètres du bot
     * @param {object} ctx - Contexte Telegraf
     */
    async editBotSettings(ctx, forcedLocale = null) {
        try {
            if (!await this.isAdmin(ctx)) return;

            const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
            if (!chatId) return;

            // Récupérer la configuration
            const config = await Config.findOne().lean();

            // Utiliser la langue forcée ou celle de la config
            const locale = forcedLocale || config?.language || 'fr';

            // Mettre à jour la langue globale
            i18n.setDefaultLocale(locale);

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback(i18n.t('admin.editBotName', {}, locale), 'edit_bot_name'),
                    Markup.button.callback(i18n.t('admin.editLanguage', {}, locale), 'edit_bot_language')
                ],
                [
                    Markup.button.callback(i18n.t('admin.editTimezone', {}, locale), 'edit_bot_timezone'),
                    Markup.button.callback(i18n.t('admin.editTheme', {}, locale), 'edit_bot_theme')
                ],
                [
                    Markup.button.callback(i18n.t('admin.toggleMaintenance', {}, locale), 'toggle_maintenance'),
                    Markup.button.callback(i18n.t('admin.viewStats', {}, locale), 'view_bot_stats')
                ],
                [Markup.button.callback(i18n.t('common.back', {}, locale), 'admin_config')]
            ]);

            // Construction du message avec i18n
            let message = `${i18n.t('admin.botSettings', {}, locale)}\n\n`;
            message += `${i18n.t('admin.currentName', {}, locale)}: ${config?.botName || i18n.t('admin.undefined', {}, locale)}\n`;
            message += `${i18n.t('admin.currentLanguage', {}, locale)}: ${config?.language || 'FR'}\n`;
            message += `${i18n.t('admin.currentTimezone', {}, locale)}: ${config?.timezone || 'Europe/Paris'}\n`;
            message += `${i18n.t('admin.currentTheme', {}, locale)}: ${config?.theme || 'Default'}\n`;
            message += `${i18n.t('admin.maintenanceMode', {}, locale)}: ${config?.maintenanceMode ? '✅' : '❌'}\n`;
            message += `${i18n.t('admin.version', {}, locale)}: ${config?.version || '1.0.0'}\n`;

            // Envoi ou mise à jour du message
            if (ctx.callbackQuery) {
                await ctx.editMessageText(message, { reply_markup: keyboard.reply_markup });
            } else {
                await ctx.reply(message, keyboard);
            }

        } catch (error) {
            logger.error('Erreur affichage paramètres bot:', error);
            const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
            if (chatId) {
                await ctx.telegram.sendMessage(
                    chatId,
                    i18n.t('errors.general', {}, config?.language)
                ).catch(console.error);
            }
        }
    }
    /**
     * Lance le processus de modification du nom du bot
     * @param {object} ctx - Contexte Telegraf
     */
    async editBotName(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Définition de l'état pour suivre l'action en cours
            ctx.session.adminState = {
                action: 'edit_bot_name'
            };

            // Clavier avec option d'annulation
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', 'edit_bot_settings')]
            ]);

            // Obtenir le chat ID approprié
            const chatId = ctx.chat?.id || ctx.channelPost?.chat?.id;
            if (!chatId) {
                logger.error('Chat ID non trouvé');
                return;
            }

            // Demande du nouveau nom
            await ctx.telegram.sendMessage(
                chatId,
                '📝 Entrez le nouveau nom du bot:',
                { reply_markup: keyboard }
            );
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur édition nom bot:', error);
            const chatId = ctx.chat?.id || ctx.channelPost?.chat?.id;
            if (chatId) {
                await ctx.telegram.sendMessage(chatId, 'Une erreur est survenue').catch(console.error);
            }
        }
    }

    /**
     * Traite la réponse de l'utilisateur pour le nouveau nom du bot
     * @param {object} ctx - Contexte Telegraf
     */
    async handleBotNameEdit(ctx) {
        try {
            const chatId = ctx.chat?.id;
            if (!chatId) return;

            const newName = ctx.message.text.trim();

            // Validation
            if (newName.length < 3 || newName.length > 32) {
                await ctx.reply('❌ Le nom doit contenir entre 3 et 32 caractères');
                return;
            }

            // Mise à jour de la configuration
            const config = await Config.findOne() || new Config();
            const oldName = config.botName;
            config.botName = newName;
            config.lastUpdate = new Date();
            await config.save();

            // Mise à jour du nom via l'API Telegram
            try {
                await ctx.telegram.setMyName(newName);
            } catch (telegramError) {
                logger.error('Erreur mise à jour nom Telegram:', telegramError);
            }

            // Journalisation
            await this.logAdminAction(ctx.from.id, 'edit_bot_name', {
                oldName,
                newName
            });

            // Nettoyage de l'état et confirmation
            this.clearAdminState(ctx);
            await ctx.reply(`✅ Nom du bot modifié: ${newName}`);

            // Mise à jour de l'affichage des paramètres
            setTimeout(() => this.editBotSettings(ctx), 500);

        } catch (error) {
            logger.error('Erreur modification nom bot:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    // -------------------- PARAMÈTRES DE SÉCURITÉ --------------------

    /**
     * Interface principale des paramètres de sécurité
     * Permet de gérer l'authentification, l'anti-spam et les restrictions
     * @param {object} ctx - Contexte Telegraf
     */
    async editSecuritySettings(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier des options de sécurité
            const keyboard = Markup.inlineKeyboard([
                [
                    // Authentification et anti-spam
                    Markup.button.callback('🔑 Authentification', 'edit_auth_settings'),
                    Markup.button.callback('🛡️ Anti-spam', 'edit_antispam_settings')
                ],
                [
                    // Bannissements et logs
                    Markup.button.callback('🚫 Bannissements', 'manage_bans'),
                    Markup.button.callback('📝 Logs', 'view_security_logs')
                ],
                [
                    // Alertes et restrictions
                    Markup.button.callback('⚠️ Alertes', 'edit_security_alerts'),
                    Markup.button.callback('🔒 Restrictions', 'edit_restrictions')
                ],
                // Retour au menu principal
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération de la configuration actuelle
            const config = await Config.findOne() || {};
            const securityConfig = config.security || {};

            // Construction du message avec l'état actuel des paramètres
            let message = '🔒 Paramètres de Sécurité\n\n';
            message += `🔑 2FA Admin: ${securityConfig.adminRequire2FA ? '✅' : '❌'}\n`;
            message += `⏳ Timeout session: ${securityConfig.sessionTimeout || '30'} minutes\n`;
            message += `🔄 Tentatives max: ${securityConfig.maxLoginAttempts || '3'}\n`;
            message += `🛡️ Anti-spam: ${securityConfig.antiSpamEnabled ? '✅' : '❌'}\n`;
            message += `⚠️ Alertes: ${securityConfig.securityAlertsEnabled ? '✅' : '❌'}\n`;
            message += `🔒 Restrictions IP: ${securityConfig.ipRestrictionEnabled ? '✅' : '❌'}\n\n`;

            // Ajout des statistiques de sécurité si disponibles
            if (securityConfig.stats) {
                message += '📊 Statistiques de sécurité (24h):\n';
                message += `- Tentatives bloquées: ${securityConfig.stats.blockedAttempts || 0}\n`;
                message += `- Alertes déclenchées: ${securityConfig.stats.triggeredAlerts || 0}\n`;
                message += `- Utilisateurs bannis: ${securityConfig.stats.bannedUsers || 0}\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur paramètres sécurité:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des paramètres d'authentification
     * Configure 2FA, timeouts de session, et politiques de mot de passe
     * @param {object} ctx - Contexte Telegraf
     */
    async editAuthSettings(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier des options d'authentification
            const keyboard = Markup.inlineKeyboard([
                [
                    // 2FA et timeout de session
                    Markup.button.callback('🔐 2FA Admin', 'toggle_2fa'),
                    Markup.button.callback('⏳ Timeout', 'edit_session_timeout')
                ],
                [
                    // Tentatives de connexion et politique de mot de passe
                    Markup.button.callback('🔄 Tentatives', 'edit_login_attempts'),
                    Markup.button.callback('🔑 Mots de passe', 'edit_password_policy')
                ],
                [
                    // Vérification IP et session
                    Markup.button.callback('🌐 Contrôle IP', 'edit_ip_control'),
                    Markup.button.callback('📱 Appareils', 'manage_devices')
                ],
                // Retour aux paramètres de sécurité
                [Markup.button.callback('🔙 Retour', 'edit_security_settings')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const authConfig = config.security?.authentication || {};
            const passwordPolicy = authConfig.passwordPolicy || {};

            // Construction du message
            let message = '🔐 Paramètres d\'Authentification\n\n';
            message += `2FA Admin: ${authConfig.adminRequire2FA ? '✅' : '❌'}\n`;
            message += `Timeout session: ${authConfig.sessionTimeout || '30'} minutes\n`;
            message += `Tentatives max: ${authConfig.maxLoginAttempts || '3'}\n\n`;

            // Affichage de la politique de mot de passe
            message += 'Politique de mot de passe:\n';
            message += `- Longueur min: ${passwordPolicy.minLength || '8'}\n`;
            message += `- Majuscules: ${passwordPolicy.requireUppercase ? '✅' : '❌'}\n`;
            message += `- Chiffres: ${passwordPolicy.requireNumbers ? '✅' : '❌'}\n`;
            message += `- Caractères spéciaux: ${passwordPolicy.requireSpecial ? '✅' : '❌'}\n`;
            message += `- Expiration: ${passwordPolicy.expirationDays || 'Jamais'} jours\n\n`;

            // Statistiques de session si disponibles
            if (authConfig.stats) {
                message += '📊 Statistiques d\'authentification:\n';
                message += `- Sessions actives: ${authConfig.stats.activeSessions || 0}\n`;
                message += `- Échecs aujourd'hui: ${authConfig.stats.failedAttempts || 0}\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur paramètres authentification:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Active/désactive l'authentification à deux facteurs pour les administrateurs
     * @param {object} ctx - Contexte Telegraf
     */
    async toggle2FA(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Récupération et mise à jour de la configuration
            const config = await Config.findOne() || new Config();
            if (!config.security) config.security = {};
            if (!config.security.authentication) config.security.authentication = {};

            // Inverse l'état actuel du 2FA
            const currentState = config.security.authentication.adminRequire2FA || false;
            config.security.authentication.adminRequire2FA = !currentState;

            // Si on active le 2FA, on génère les secrets pour tous les admins
            if (!currentState) {
                await this.setup2FAForAdmins();
            }

            config.lastUpdate = new Date();
            await config.save();

            // Journalisation du changement
            await this.logAdminAction(ctx.from.id, 'toggle_2fa', {
                enabled: !currentState
            });

            // Message de confirmation avec instructions si nécessaire
            const message = !currentState
                ? '✅ 2FA activé pour les administrateurs. Chaque admin doit configurer son authentificateur.'
                : '❌ 2FA désactivé pour les administrateurs';

            await ctx.reply(message);
            await this.editAuthSettings(ctx);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur toggle 2FA:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configure le 2FA pour tous les administrateurs
     * Génère et envoie les secrets 2FA aux admins
     * @private
     */
    async setup2FAForAdmins() {
        try {
            // Récupération de tous les administrateurs
            const admins = await User.find({
                role: { $in: ['admin', 'superadmin'] }
            });

            // Pour chaque admin
            for (const admin of admins) {
                // Génération d'un secret unique
                const secret = speakeasy.generateSecret({
                    length: 20,
                    name: `Bot_Admin_${admin.username}`
                });

                // Sauvegarde du secret dans le profil de l'admin
                admin.security = admin.security || {};
                admin.security.twoFactorSecret = secret.base32;
                await admin.save();

                // Génération du QR code
                const qrCode = await QRCode.toDataURL(secret.otpauth_url);

                // Envoi des instructions et du QR code à l'admin
                await this.bot.telegram.sendMessage(
                    admin.telegramId,
                    '🔐 Configuration 2FA requise\n\n' +
                    'Scannez le QR code suivant avec votre application d\'authentification ' +
                    '(Google Authenticator, Authy, etc.)'
                );

                // Envoi du QR code
                await this.bot.telegram.sendPhoto(admin.telegramId, {
                    source: Buffer.from(qrCode.split(',')[1], 'base64')
                });

                // Envoi du code en texte (backup)
                await this.bot.telegram.sendMessage(
                    admin.telegramId,
                    `Code secret (à conserver) : ${secret.base32}`
                );
            }
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur setup 2FA admins:', error);
            throw error;
        }
    }

    /**
     * Modifie le délai d'expiration des sessions
     * @param {object} ctx - Contexte Telegraf
     */
    async editSessionTimeout(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Initialisation de l'état pour la saisie du timeout
            ctx.session.adminState = {
                action: 'edit_session_timeout'
            };

            // Options de timeout prédéfinies
            const timeoutOptions = [
                ['15m', '15 minutes'],
                ['30m', '30 minutes'],
                ['1h', '1 heure'],
                ['2h', '2 heures'],
                ['4h', '4 heures'],
                ['8h', '8 heures']
            ];

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                // Création des boutons pour chaque option
                ...timeoutOptions.map(([value, label]) => [
                    Markup.button.callback(label, `set_timeout_${value}`)
                ]),
                // Option de saisie manuelle
                [Markup.button.callback('⌨️ Saisie manuelle', 'custom_timeout')],
                // Retour
                [Markup.button.callback('🔙 Retour', 'edit_auth_settings')]
            ]);

            // Configuration actuelle
            const config = await Config.findOne() || {};
            const currentTimeout = config.security?.authentication?.sessionTimeout || 30;

            // Envoi du message
            await ctx.reply(
                '⏳ Configuration du délai d\'expiration des sessions\n\n' +
                `Délai actuel: ${currentTimeout} minutes\n\n` +
                'Sélectionnez un nouveau délai ou choisissez "Saisie manuelle":',
                keyboard
            );
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur édition timeout:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    /**
     * Gestion des paramètres anti-spam
     * Configure les limites, délais et actions contre le spam
     * @param {object} ctx - Contexte Telegraf
     */
    async editAntispamSettings(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier des options anti-spam
            const keyboard = Markup.inlineKeyboard([
                [
                    // Activation/désactivation et limites
                    Markup.button.callback('🔄 Activer/Désactiver', 'toggle_antispam'),
                    Markup.button.callback('⚙️ Limites', 'edit_spam_limits')
                ],
                [
                    // Timeouts et actions
                    Markup.button.callback('⏳ Timeouts', 'edit_spam_timeouts'),
                    Markup.button.callback('🚫 Actions', 'edit_spam_actions')
                ],
                [
                    // Exceptions et liste noire
                    Markup.button.callback('✨ Exceptions', 'edit_spam_whitelist'),
                    Markup.button.callback('⛔ Liste noire', 'edit_spam_blacklist')
                ],
                [Markup.button.callback('🔙 Retour', 'edit_security_settings')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const antispam = config.security?.antispam || {};

            // Construction du message avec l'état actuel
            let message = '🛡️ Paramètres Anti-spam\n\n';
            message += `Statut: ${antispam.enabled ? '✅ Actif' : '❌ Inactif'}\n\n`;

            // Affichage des limites actuelles
            message += '📊 Limites actuelles:\n';
            message += `- Messages: ${antispam.messageLimit || '5'}/min\n`;
            message += `- Commandes: ${antispam.commandLimit || '10'}/min\n`;
            message += `- Media: ${antispam.mediaLimit || '3'}/min\n\n`;

            // Affichage des actions configurées
            message += '🚫 Actions:\n';
            message += `- 1ère violation: ${antispam.firstAction || 'Avertissement'}\n`;
            message += `- 2ème violation: ${antispam.secondAction || 'Mute temporaire'}\n`;
            message += `- 3ème violation: ${antispam.thirdAction || 'Ban'}\n\n`;

            // Statistiques si disponibles
            if (antispam.stats) {
                message += '📈 Statistiques (24h):\n';
                message += `- Violations détectées: ${antispam.stats.violations || 0}\n`;
                message += `- Utilisateurs avertis: ${antispam.stats.warnings || 0}\n`;
                message += `- Utilisateurs mutes: ${antispam.stats.mutes || 0}\n`;
                message += `- Utilisateurs bannis: ${antispam.stats.bans || 0}\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur paramètres antispam:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des limites anti-spam
     * Configure les seuils de messages, commandes et médias
     * @param {object} ctx - Contexte Telegraf
     */
    async editSpamLimits(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Définition de l'état pour la saisie des limites
            ctx.session.adminState = {
                action: 'edit_spam_limits',
                step: 'messages'
            };

            // Préparation des options prédéfinies
            const limitSets = [
                ['strict', 'Strict (3/5/2)'],
                ['normal', 'Normal (5/10/3)'],
                ['relaxed', 'Souple (10/15/5)']
            ];

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                // Options prédéfinies
                ...limitSets.map(([value, label]) => [
                    Markup.button.callback(label, `set_spam_limits_${value}`)
                ]),
                // Configuration manuelle
                [Markup.button.callback('⚙️ Configuration manuelle', 'custom_spam_limits')],
                // Retour
                [Markup.button.callback('🔙 Retour', 'edit_antispam_settings')]
            ]);

            // Configuration actuelle
            const config = await Config.findOne() || {};
            const antispam = config.security?.antispam || {};

            // Construction du message
            let message = '⚙️ Configuration des limites anti-spam\n\n';
            message += 'Limites actuelles:\n';
            message += `- Messages: ${antispam.messageLimit || '5'}/minute\n`;
            message += `- Commandes: ${antispam.commandLimit || '10'}/minute\n`;
            message += `- Médias: ${antispam.mediaLimit || '3'}/minute\n\n`;
            message += 'Choisissez un preset ou utilisez la configuration manuelle:';

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur édition limites spam:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des bannissements
     * Vue d'ensemble et gestion des utilisateurs bannis
     * @param {object} ctx - Contexte Telegraf
     */
    async manageBans(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions principales
                    Markup.button.callback('👤 Bannir utilisateur', 'ban_user'),
                    Markup.button.callback('✅ Débannir', 'unban_user')
                ],
                [
                    // Liste et historique
                    Markup.button.callback('📋 Liste bannis', 'view_banned_users'),
                    Markup.button.callback('📜 Historique', 'view_ban_history')
                ],
                [
                    // Paramètres et import/export
                    Markup.button.callback('⚙️ Paramètres', 'edit_ban_settings'),
                    Markup.button.callback('📤 Export/Import', 'manage_ban_list')
                ],
                [Markup.button.callback('🔙 Retour', 'edit_security_settings')]
            ]);

            // Récupération des statistiques de bannissement
            const bannedUsers = await User.countDocuments({ status: 'banned' });
            const temporaryBans = await User.countDocuments({
                status: 'banned',
                'ban.temporary': true,
                'ban.endDate': { $gt: new Date() }
            });

            // Construction du message
            let message = '🚫 Gestion des Bannissements\n\n';
            message += `Utilisateurs bannis: ${bannedUsers}\n`;
            message += `Bans temporaires: ${temporaryBans}\n\n`;

            // Récupération des derniers bannissements
            const recentBans = await User.find({ status: 'banned' })
                .sort({ 'ban.date': -1 })
                .limit(5);

            if (recentBans.length > 0) {
                message += 'Derniers bannissements:\n';
                recentBans.forEach(user => {
                    message += `- @${user.username} (${new Date(user.ban.date).toLocaleDateString()})\n`;
                    if (user.ban.reason) message += `  Raison: ${user.ban.reason}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion bans:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration du bannissement d'un utilisateur
     * @param {object} ctx - Contexte Telegraf
     */
    async banUser(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Initialisation de l'état pour le processus de bannissement
            ctx.session.adminState = {
                action: 'ban_user',
                step: 'user_input'
            };

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', 'manage_bans')]
            ]);

            // Message d'instruction
            await ctx.reply(
                '👤 Bannissement d\'utilisateur\n\n' +
                'Veuillez entrer l\'identifiant ou le @username de l\'utilisateur à bannir:',
                keyboard
            );
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur initiation bannissement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Traitement du bannissement d'un utilisateur
     * @param {object} ctx - Contexte Telegraf
     * @param {string} userInput - Identifiant ou username de l'utilisateur
     */
    async handleBanUser(ctx) {
        try {
            const userInput = ctx.message.text.trim();

            // Recherche de l'utilisateur
            let user;
            if (userInput.startsWith('@')) {
                user = await User.findOne({ username: userInput.substring(1) });
            } else {
                user = await User.findOne({ telegramId: userInput });
            }

            // Vérification de l'existence de l'utilisateur
            if (!user) {
                return ctx.reply('❌ Utilisateur non trouvé.');
            }

            // Vérification que l'utilisateur n'est pas déjà banni
            if (user.status === 'banned') {
                return ctx.reply('❌ Cet utilisateur est déjà banni.');
            }

            // Passage à l'étape de la raison du bannissement
            ctx.session.adminState = {
                action: 'ban_user',
                step: 'reason',
                targetUser: user.telegramId
            };

            // Clavier pour les raisons prédéfinies
            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('Spam', 'ban_reason_spam'),
                    Markup.button.callback('Abus', 'ban_reason_abuse')
                ],
                [
                    Markup.button.callback('Bot', 'ban_reason_bot'),
                    Markup.button.callback('Autre', 'ban_reason_custom')
                ],
                [Markup.button.callback('❌ Annuler', 'manage_bans')]
            ]);

            await ctx.reply(
                `🚫 Bannissement de @${user.username}\n\n` +
                'Sélectionnez une raison ou choisissez "Autre" pour saisir une raison personnalisée:',
                keyboard
            );
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur traitement bannissement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Finalisation du bannissement d'un utilisateur
     * @param {object} ctx - Contexte Telegraf
     * @param {string} reason - Raison du bannissement
     */
    async finalizeBanUser(ctx, reason) {
        try {
            // Récupération des informations de l'état
            const { targetUser } = ctx.session.adminState;
            const user = await User.findOne({ telegramId: targetUser });

            // Application du bannissement
            user.status = 'banned';
            user.ban = {
                date: new Date(),
                reason: reason,
                bannedBy: ctx.from.id,
                temporary: false
            };
            await user.save();

            // Journalisation
            await this.logAdminAction(ctx.from.id, 'ban_user', {
                targetUser: user.telegramId,
                username: user.username,
                reason: reason
            });

            // Notification à l'utilisateur banni
            try {
                await this.bot.telegram.sendMessage(
                    user.telegramId,
                    `🚫 Vous avez été banni\nRaison: ${reason}\n\n` +
                    'Si vous pensez qu\'il s\'agit d\'une erreur, contactez le support.'
                );
            } catch (error) {
                logger.warn('Impossible de notifier l\'utilisateur banni:', error);
            }

            // Confirmation à l'administrateur
            await ctx.reply(
                `✅ @${user.username} a été banni\n` +
                `Raison: ${reason}`
            );

            // Nettoyage de l'état et retour au menu
            this.clearAdminState(ctx);
            await this.manageBans(ctx);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur finalisation bannissement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    /**
     * Gestion des logs de sécurité
     * Permet de visualiser et gérer les logs de sécurité du système
     * @param {object} ctx - Contexte Telegraf
     */
    async viewSecurityLogs(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Filtres par type
                    Markup.button.callback('🔑 Auth', 'view_auth_logs'),
                    Markup.button.callback('🛡️ Anti-spam', 'view_spam_logs'),
                    Markup.button.callback('🚫 Bans', 'view_ban_logs')
                ],
                [
                    // Actions sur les logs
                    Markup.button.callback('📥 Exporter', 'export_security_logs'),
                    Markup.button.callback('🗑️ Nettoyer', 'clear_security_logs')
                ],
                [
                    // Paramètres et alertes
                    Markup.button.callback('⚙️ Paramètres', 'edit_log_settings'),
                    Markup.button.callback('⚠️ Alertes', 'edit_log_alerts')
                ],
                [Markup.button.callback('🔙 Retour', 'edit_security_settings')]
            ]);

            // Récupération des statistiques des logs
            const stats = await this.getSecurityLogStats();

            // Construction du message
            let message = '📝 Logs de Sécurité\n\n';
            message += '📊 Statistiques (24h):\n';
            message += `- Tentatives de connexion: ${stats.authAttempts}\n`;
            message += `- Violations anti-spam: ${stats.spamViolations}\n`;
            message += `- Bannissements: ${stats.bans}\n`;
            message += `- Alertes: ${stats.alerts}\n\n`;

            // Ajout des derniers événements
            const recentLogs = await this.getRecentSecurityLogs(5);
            if (recentLogs.length > 0) {
                message += '🕒 Derniers événements:\n';
                recentLogs.forEach(log => {
                    message += `${this.formatLogEvent(log)}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur affichage logs sécurité:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Récupère les statistiques des logs de sécurité
     * @returns {object} Statistiques des différents types de logs
     * @private
     */
    async getSecurityLogStats() {
        try {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

            // Agrégation des statistiques par type
            const stats = await SecurityLog.aggregate([
                {
                    $match: {
                        timestamp: { $gte: yesterday }
                    }
                },
                {
                    $group: {
                        _id: '$type',
                        count: { $sum: 1 }
                    }
                }
            ]);

            // Formatage des résultats
            return {
                authAttempts: stats.find(s => s._id === 'auth')?.count || 0,
                spamViolations: stats.find(s => s._id === 'spam')?.count || 0,
                bans: stats.find(s => s._id === 'ban')?.count || 0,
                alerts: stats.find(s => s._id === 'alert')?.count || 0
            };
        } catch (error) {
            logger.error('Erreur récupération stats logs:', error);
            return {
                authAttempts: 0,
                spamViolations: 0,
                bans: 0,
                alerts: 0
            };
        }
    }

    /**
     * Récupère les logs de sécurité récents
     * @param {number} limit - Nombre de logs à récupérer
     * @returns {Array} Liste des logs récents
     * @private
     */
    async getRecentSecurityLogs(limit = 5) {
        try {
            return await SecurityLog.find()
                .sort({ timestamp: -1 })
                .limit(limit)
                .populate('userId', 'username');
        } catch (error) {
            logger.error('Erreur récupération logs récents:', error);
            return [];
        }
    }

    /**
     * Formatage d'un événement de log
     * @param {object} log - Log à formater
     * @returns {string} Log formaté
     * @private
     */
    formatLogEvent(log) {
        const time = new Date(log.timestamp).toLocaleTimeString();
        const user = log.userId ? `@${log.userId.username}` : 'Système';

        let eventText;
        switch (log.type) {
            case 'auth':
                eventText = `🔑 ${log.success ? 'Connexion' : 'Échec connexion'}`;
                break;
            case 'spam':
                eventText = '🛡️ Violation anti-spam';
                break;
            case 'ban':
                eventText = '🚫 Bannissement';
                break;
            case 'alert':
                eventText = '⚠️ Alerte sécurité';
                break;
            default:
                eventText = log.action;
        }

        return `[${time}] ${eventText} - ${user}${log.details ? `: ${log.details}` : ''}`;
    }

    /**
     * Gestion des restrictions IP
     * Configure les règles de filtrage IP et les restrictions géographiques
     * @param {object} ctx - Contexte Telegraf
     */
    async editIpRestrictions(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Activation/Configuration
                    Markup.button.callback('🔄 Activer/Désactiver', 'toggle_ip_restrictions'),
                    Markup.button.callback('⚙️ Configurer', 'configure_ip_rules')
                ],
                [
                    // Listes IP
                    Markup.button.callback('✅ Liste blanche', 'edit_ip_whitelist'),
                    Markup.button.callback('❌ Liste noire', 'edit_ip_blacklist')
                ],
                [
                    // Restrictions géographiques
                    Markup.button.callback('🌍 Pays autorisés', 'edit_allowed_countries'),
                    Markup.button.callback('📊 Stats', 'view_ip_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'edit_security_settings')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const ipConfig = config.security?.ipRestrictions || {};

            // Construction du message
            let message = '🔒 Restrictions IP\n\n';
            message += `État: ${ipConfig.enabled ? '✅ Actif' : '❌ Inactif'}\n\n`;

            // Statistiques des règles
            message += '📊 Règles configurées:\n';
            message += `- IPs sur liste blanche: ${ipConfig.whitelist?.length || 0}\n`;
            message += `- IPs sur liste noire: ${ipConfig.blacklist?.length || 0}\n`;
            message += `- Pays autorisés: ${ipConfig.allowedCountries?.length || 0}\n\n`;

            // Statistiques de blocage
            if (ipConfig.stats) {
                message += '🚫 Blocages (24h):\n';
                message += `- Par liste noire: ${ipConfig.stats.blacklistBlocks || 0}\n`;
                message += `- Par pays: ${ipConfig.stats.countryBlocks || 0}\n`;
                message += `- Tentatives suspectes: ${ipConfig.stats.suspiciousAttempts || 0}\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration restrictions IP:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration des règles IP
     * @param {object} ctx - Contexte Telegraf 
     */
    async configureIpRules(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Récupération de la configuration actuelle
            const config = await Config.findOne() || {};
            const ipConfig = config.security?.ipRestrictions || {};

            // Configuration des options disponibles
            const ruleTypes = [
                ['rate_limit', 'Limite de requêtes'],
                ['proxy_check', 'Détection proxy/VPN'],
                ['geo_fence', 'Géo-restriction'],
                ['session_bind', 'Liaison session/IP']
            ];

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                // Création des boutons pour chaque type de règle
                ...ruleTypes.map(([type, label]) => [
                    Markup.button.callback(
                        `${ipConfig[type]?.enabled ? '✅' : '❌'} ${label}`,
                        `toggle_ip_rule_${type}`
                    )
                ]),
                [
                    // Configuration avancée
                    Markup.button.callback('⚙️ Paramètres avancés', 'advanced_ip_settings')
                ],
                [Markup.button.callback('🔙 Retour', 'edit_ip_restrictions')]
            ]);

            // Construction du message
            let message = '⚙️ Configuration des Règles IP\n\n';
            message += 'Règles disponibles:\n\n';

            // Description de chaque règle
            ruleTypes.forEach(([type, label]) => {
                const rule = ipConfig[type] || {};
                message += `${label}:\n`;
                message += `État: ${rule.enabled ? '✅ Actif' : '❌ Inactif'}\n`;

                // Détails spécifiques selon le type de règle
                switch (type) {
                    case 'rate_limit':
                        message += `Limite: ${rule.maxRequests || 100}/min\n`;
                        break;
                    case 'proxy_check':
                        message += `Mode: ${rule.strictMode ? 'Strict' : 'Normal'}\n`;
                        break;
                    case 'geo_fence':
                        message += `Pays autorisés: ${rule.countries?.length || 0}\n`;
                        break;
                    case 'session_bind':
                        message += `Durée liaison: ${rule.bindDuration || 30}min\n`;
                        break;
                }
                message += '\n';
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration règles IP:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    /**
     * Gestion du système de notifications et rapports
     * Configure les notifications automatiques et les rapports périodiques
     * @param {object} ctx - Contexte Telegraf
     */
    async editNotificationSystem(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des alertes et rapports
                    Markup.button.callback('🔔 Alertes', 'edit_alerts'),
                    Markup.button.callback('📊 Rapports', 'edit_reports')
                ],
                [
                    // Canaux et destinataires
                    Markup.button.callback('📨 Canaux', 'edit_notification_channels'),
                    Markup.button.callback('👥 Destinataires', 'edit_notification_recipients')
                ],
                [
                    // Templates et tests
                    Markup.button.callback('📝 Templates', 'edit_notification_templates'),
                    Markup.button.callback('🔄 Tester', 'test_notifications')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const notifConfig = config.notifications || {};

            // Construction du message
            let message = '📨 Système de Notifications\n\n';
            message += '📊 État des services:\n';
            message += `- Telegram: ${notifConfig.telegram?.enabled ? '✅' : '❌'}\n`;
            message += `- Email: ${notifConfig.email?.enabled ? '✅' : '❌'}\n`;
            message += `- Webhook: ${notifConfig.webhook?.enabled ? '✅' : '❌'}\n\n`;

            // Statistiques des notifications
            if (notifConfig.stats) {
                message += '📈 Statistiques (24h):\n';
                message += `- Alertes envoyées: ${notifConfig.stats.alertsSent || 0}\n`;
                message += `- Rapports générés: ${notifConfig.stats.reportsGenerated || 0}\n`;
                message += `- Taux de livraison: ${notifConfig.stats.deliveryRate || 0}%\n\n`;
            }

            // État des rapports programmés
            message += '⏰ Rapports programmés:\n';
            for (const report of (notifConfig.scheduledReports || [])) {
                message += `- ${report.name}: ${report.schedule}\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration notifications:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration des alertes système
     * @param {object} ctx - Contexte Telegraf
     */
    async editAlerts(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Types d'alertes
                    Markup.button.callback('🔒 Sécurité', 'edit_security_alerts'),
                    Markup.button.callback('💰 Paiements', 'edit_payment_alerts')
                ],
                [
                    // Alertes système et erreurs
                    Markup.button.callback('🤖 Système', 'edit_system_alerts'),
                    Markup.button.callback('❌ Erreurs', 'edit_error_alerts')
                ],
                [
                    // Configuration et tests
                    Markup.button.callback('⚙️ Configuration', 'configure_alerts'),
                    Markup.button.callback('🔄 Tester', 'test_alerts')
                ],
                [Markup.button.callback('🔙 Retour', 'edit_notification_system')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const alertConfig = config.notifications?.alerts || {};

            // Construction du message
            let message = '🔔 Configuration des Alertes\n\n';
            message += '📊 État des alertes:\n';

            // Liste des types d'alertes configurés
            const alertTypes = {
                security: '🔒 Sécurité',
                payment: '💰 Paiements',
                system: '🤖 Système',
                error: '❌ Erreurs'
            };

            for (const [key, label] of Object.entries(alertTypes)) {
                const alertType = alertConfig[key] || {};
                message += `${label}:\n`;
                message += `- État: ${alertType.enabled ? '✅' : '❌'}\n`;
                message += `- Priorité min: ${alertType.minPriority || 'Basse'}\n`;
                message += `- Destinataires: ${alertType.recipients?.length || 0}\n\n`;
            }

            // Statistiques des alertes
            if (alertConfig.stats) {
                message += '📈 Statistiques (24h):\n';
                for (const [key, label] of Object.entries(alertTypes)) {
                    message += `${label}: ${alertConfig.stats[key] || 0}\n`;
                }
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration alertes:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des rapports automatiques
     * @param {object} ctx - Contexte Telegraf
     */
    async editReports(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Types de rapports
                    Markup.button.callback('📊 Statistiques', 'edit_stats_reports'),
                    Markup.button.callback('💰 Financier', 'edit_financial_reports')
                ],
                [
                    // Rapports système et utilisateurs
                    Markup.button.callback('🤖 Système', 'edit_system_reports'),
                    Markup.button.callback('👥 Utilisateurs', 'edit_user_reports')
                ],
                [
                    // Planification et génération
                    Markup.button.callback('⏰ Planification', 'schedule_reports'),
                    Markup.button.callback('📥 Générer', 'generate_report')
                ],
                [Markup.button.callback('🔙 Retour', 'edit_notification_system')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const reportConfig = config.notifications?.reports || {};

            // Construction du message
            let message = '📊 Configuration des Rapports\n\n';

            // Liste des rapports configurés
            const reports = reportConfig.scheduledReports || [];
            if (reports.length > 0) {
                message += '📅 Rapports programmés:\n';
                for (const report of reports) {
                    message += `\n${report.name}:\n`;
                    message += `- Type: ${report.type}\n`;
                    message += `- Fréquence: ${report.schedule}\n`;
                    message += `- Format: ${report.format}\n`;
                    message += `- Destinataires: ${report.recipients.length}\n`;
                }
                message += '\n';
            } else {
                message += '❌ Aucun rapport programmé\n\n';
            }

            // Statistiques des rapports
            if (reportConfig.stats) {
                message += '📈 Statistiques (30j):\n';
                message += `- Rapports générés: ${reportConfig.stats.generated || 0}\n`;
                message += `- Taille moyenne: ${this.formatFileSize(reportConfig.stats.averageSize || 0)}\n`;
                message += `- Temps moyen: ${reportConfig.stats.averageTime || 0}s\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration rapports:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des canaux de notification
     * Configure les différents moyens d'envoi des notifications
     * @param {object} ctx - Contexte Telegraf
     */
    async editNotificationChannels(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Canaux principaux
                    Markup.button.callback('💬 Telegram', 'edit_telegram_channel'),
                    Markup.button.callback('📧 Email', 'edit_email_channel')
                ],
                [
                    // Canaux additionnels
                    Markup.button.callback('🌐 Webhook', 'edit_webhook_channel'),
                    Markup.button.callback('📱 Push', 'edit_push_channel')
                ],
                [
                    // Paramètres et tests
                    Markup.button.callback('⚙️ Paramètres', 'edit_channel_settings'),
                    Markup.button.callback('🔄 Tester', 'test_channels')
                ],
                [Markup.button.callback('🔙 Retour', 'edit_notification_system')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const channelConfig = config.notifications?.channels || {};

            // Construction du message
            let message = '📨 Canaux de Notification\n\n';

            // État des canaux
            const channels = {
                telegram: '💬 Telegram',
                email: '📧 Email',
                webhook: '🌐 Webhook',
                push: '📱 Push'
            };

            for (const [key, label] of Object.entries(channels)) {
                const channel = channelConfig[key] || {};
                message += `${label}:\n`;
                message += `- État: ${channel.enabled ? '✅' : '❌'}\n`;

                // Informations spécifiques selon le type
                switch (key) {
                    case 'telegram':
                        message += `- Groupes: ${channel.groups?.length || 0}\n`;
                        message += `- Bots: ${channel.bots?.length || 0}\n`;
                        break;
                    case 'email':
                        message += `- SMTP: ${channel.smtp ? '✅' : '❌'}\n`;
                        message += `- Templates: ${channel.templates?.length || 0}\n`;
                        break;
                    case 'webhook':
                        message += `- URLs: ${channel.urls?.length || 0}\n`;
                        message += `- Timeout: ${channel.timeout || 5}s\n`;
                        break;
                    case 'push':
                        message += `- Plateformes: ${Object.keys(channel.platforms || {}).length}\n`;
                        message += `- Devices: ${channel.devices?.length || 0}\n`;
                        break;
                }
                message += '\n';
            }

            // Statistiques d'envoi
            if (channelConfig.stats) {
                message += '📊 Performances (24h):\n';
                for (const [key, label] of Object.entries(channels)) {
                    const stats = channelConfig.stats[key] || {};
                    message += `${label}:\n`;
                    message += `- Envoyés: ${stats.sent || 0}\n`;
                    message += `- Succès: ${stats.delivered || 0}\n`;
                    message += `- Échecs: ${stats.failed || 0}\n\n`;
                }
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration canaux:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    /**
     * Gestion principale des API externes
     * Configuration des clés API, permissions et limites
     * @param {object} ctx - Contexte Telegraf
     */
    async manageApiSettings(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des clés et permissions
                    Markup.button.callback('🔑 Clés API', 'manage_api_keys'),
                    Markup.button.callback('🔒 Permissions', 'edit_api_permissions')
                ],
                [
                    // Limites et sécurité
                    Markup.button.callback('⚡ Rate Limits', 'edit_api_limits'),
                    Markup.button.callback('🛡️ Sécurité', 'edit_api_security')
                ],
                [
                    // Logs et documentation
                    Markup.button.callback('📝 Logs', 'view_api_logs'),
                    Markup.button.callback('📚 Documentation', 'manage_api_docs')
                ],
                [
                    // Webhooks et tests
                    Markup.button.callback('🔌 Webhooks', 'manage_webhooks'),
                    Markup.button.callback('🔄 Tests', 'test_api')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const apiConfig = config.api || {};

            // Construction du message
            let message = '🔌 Gestion des API\n\n';

            // État général
            message += '📊 État général:\n';
            message += `- Version API: ${apiConfig.version || 'v1'}\n`;
            message += `- Clés actives: ${await this.countActiveApiKeys()}\n`;
            message += `- Endpoints: ${Object.keys(apiConfig.endpoints || {}).length}\n`;
            message += `- Webhooks: ${apiConfig.webhooks?.length || 0}\n\n`;

            // Statistiques
            if (apiConfig.stats) {
                message += '📈 Statistiques (24h):\n';
                message += `- Requêtes: ${apiConfig.stats.requests || 0}\n`;
                message += `- Erreurs: ${apiConfig.stats.errors || 0}\n`;
                message += `- Taux succès: ${apiConfig.stats.successRate || 0}%\n`;
                message += `- Temps moyen: ${apiConfig.stats.avgResponseTime || 0}ms\n\n`;
            }

            // Limites actuelles
            message += '⚡ Limites actuelles:\n';
            message += `- Rate limit global: ${apiConfig.rateLimit?.global || 'Non défini'}/min\n`;
            message += `- Par IP: ${apiConfig.rateLimit?.perIp || 'Non défini'}/min\n`;
            message += `- Par clé: ${apiConfig.rateLimit?.perKey || 'Non défini'}/min\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion API:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des clés API
     * @param {object} ctx - Contexte Telegraf
     */
    async manageApiKeys(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions principales
                    Markup.button.callback('➕ Nouvelle clé', 'create_api_key'),
                    Markup.button.callback('❌ Révoquer', 'revoke_api_key')
                ],
                [
                    // Gestion des clés
                    Markup.button.callback('📋 Liste clés', 'list_api_keys'),
                    Markup.button.callback('🔄 Régénérer', 'regenerate_api_key')
                ],
                [
                    // Permissions et limites
                    Markup.button.callback('🔒 Permissions', 'edit_key_permissions'),
                    Markup.button.callback('⚡ Limites', 'edit_key_limits')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_api_settings')]
            ]);

            // Récupération des clés API actives
            const apiKeys = await ApiKey.find({ active: true })
                .sort({ createdAt: -1 })
                .limit(5);

            // Construction du message
            let message = '🔑 Gestion des Clés API\n\n';

            // Liste des dernières clés
            if (apiKeys.length > 0) {
                message += '📋 Dernières clés actives:\n\n';
                for (const key of apiKeys) {
                    message += `🔹 ${key.name || 'Sans nom'}\n`;
                    message += `  ID: ${this.maskApiKey(key.key)}\n`;
                    message += `  Créée: ${new Date(key.createdAt).toLocaleDateString()}\n`;
                    message += `  Permissions: ${key.permissions.length}\n`;
                    message += `  Utilisation (24h): ${await this.getKeyUsage(key._id)}\n\n`;
                }
            } else {
                message += '❌ Aucune clé API active\n\n';
            }

            // Statistiques globales
            message += '📊 Statistiques globales:\n';
            message += `- Total clés: ${await ApiKey.countDocuments()}\n`;
            message += `- Clés actives: ${await ApiKey.countDocuments({ active: true })}\n`;
            message += `- Clés révoquées: ${await ApiKey.countDocuments({ active: false })}\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion clés API:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Création d'une nouvelle clé API
     * @param {object} ctx - Contexte Telegraf
     */
    async createApiKey(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Définition de l'état pour la création
            ctx.session.adminState = {
                action: 'create_api_key',
                step: 'name'
            };

            // Construction du clavier d'annulation
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Annuler', 'manage_api_keys')]
            ]);

            // Message de demande du nom
            await ctx.reply(
                '🔑 Création d\'une nouvelle clé API\n\n' +
                'Veuillez entrer un nom pour cette clé:',
                keyboard
            );
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur création clé API:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Traitement de la création d'une clé API
     * @param {object} ctx - Contexte Telegraf
     */
    async handleApiKeyCreation(ctx) {
        try {
            const { step } = ctx.session.adminState;
            const input = ctx.message.text.trim();

            switch (step) {
                case 'name':
                    // Validation du nom
                    if (input.length < 3 || input.length > 50) {
                        return ctx.reply('❌ Le nom doit contenir entre 3 et 50 caractères');
                    }

                    // Sauvegarde du nom et passage aux permissions
                    ctx.session.adminState.data = { name: input };
                    ctx.session.adminState.step = 'permissions';

                    // Clavier des permissions disponibles
                    const permissionButtons = [
                        ['read', 'Lecture'],
                        ['write', 'Écriture'],
                        ['admin', 'Administration']
                    ].map(([value, label]) =>
                        Markup.button.callback(label, `api_perm_${value}`)
                    );

                    const keyboard = Markup.inlineKeyboard([
                        ..._.chunk(permissionButtons, 2),
                        [Markup.button.callback('✅ Valider', 'confirm_api_permissions')],
                        [Markup.button.callback('❌ Annuler', 'manage_api_keys')]
                    ]);

                    await ctx.reply(
                        '🔒 Sélectionnez les permissions pour cette clé:',
                        keyboard
                    );
                    break;

                case 'permissions':
                    // Traitement des permissions sélectionnées
                    const selectedPerms = ctx.session.adminState.data.permissions || [];

                    // Génération de la clé API
                    const apiKey = await ApiKey.create({
                        name: ctx.session.adminState.data.name,
                        key: this.generateApiKey(),
                        permissions: selectedPerms,
                        createdBy: ctx.from.id,
                        active: true
                    });

                    // Journalisation
                    await this.logAdminAction(ctx.from.id, 'create_api_key', {
                        keyId: apiKey._id,
                        name: apiKey.name,
                        permissions: selectedPerms
                    });

                    // Message de confirmation avec la clé
                    const message = '✅ Clé API créée avec succès!\n\n' +
                        `Nom: ${apiKey.name}\n` +
                        `Clé: \`${apiKey.key}\`\n` +
                        `Permissions: ${selectedPerms.join(', ')}\n\n` +
                        '⚠️ Conservez cette clé précieusement, elle ne sera plus affichée.';

                    // Nettoyage de l'état et retour au menu
                    this.clearAdminState(ctx);
                    await ctx.reply(message, { parse_mode: 'Markdown' });
                    await this.manageApiKeys(ctx);
                    break;
            }
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur traitement création clé API:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Génère une nouvelle clé API
     * @private
     * @returns {string} Clé API générée
     */
    generateApiKey() {
        const uuid = require('uuid');
        return `ak_${uuid.v4().replace(/-/g, '')}`;
    }

    /**
     * Masque une clé API pour l'affichage
     * @private
     * @param {string} key - Clé API à masquer
     * @returns {string} Clé API masquée
     */
    maskApiKey(key) {
        return `${key.substr(0, 8)}...${key.substr(-4)}`;
    }

    /**
     * Obtient l'utilisation d'une clé API sur les dernières 24h
     * @private
     * @param {string} keyId - ID de la clé API
     * @returns {Promise<number>} Nombre d'utilisations
     */
    async getKeyUsage(keyId) {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return await ApiLog.countDocuments({
            keyId,
            timestamp: { $gte: yesterday }
        });
    }
    /**
     * Gestion des permissions API
     * Configure les rôles et permissions pour les clés API
     * @param {object} ctx - Contexte Telegraf
     */
    async editApiPermissions(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des rôles et règles
                    Markup.button.callback('👥 Rôles', 'manage_api_roles'),
                    Markup.button.callback('📋 Règles', 'manage_api_rules')
                ],
                [
                    // Permissions par endpoint
                    Markup.button.callback('🎯 Endpoints', 'edit_endpoint_permissions'),
                    Markup.button.callback('📊 Scopes', 'manage_api_scopes')
                ],
                [
                    // Modèles et tests
                    Markup.button.callback('📝 Modèles', 'manage_permission_templates'),
                    Markup.button.callback('🔄 Tester', 'test_permissions')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_api_settings')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const permConfig = config.api?.permissions || {};

            // Construction du message
            let message = '🔒 Permissions API\n\n';

            // Rôles configurés
            message += '👥 Rôles définis:\n';
            if (permConfig.roles) {
                for (const [role, perms] of Object.entries(permConfig.roles)) {
                    message += `- ${role}: ${perms.length} permissions\n`;
                }
            }
            message += '\n';

            // Endpoints protégés
            message += '🎯 Endpoints protégés:\n';
            message += `Total: ${Object.keys(permConfig.endpoints || {}).length}\n`;
            message += `Publics: ${Object.values(permConfig.endpoints || {})
                .filter(e => e.public).length}\n`;
            message += `Protégés: ${Object.values(permConfig.endpoints || {})
                .filter(e => !e.public).length}\n\n`;

            // Statistiques d'utilisation
            if (permConfig.stats) {
                message += '📊 Statistiques (24h):\n';
                message += `- Accès refusés: ${permConfig.stats.denied || 0}\n`;
                message += `- Accès autorisés: ${permConfig.stats.allowed || 0}\n`;
                message += `- Taux d'acceptation: ${permConfig.stats.acceptanceRate || 0}%\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion permissions API:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des rate limits de l'API
     * @param {object} ctx - Contexte Telegraf
     */
    async editApiLimits(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Configuration des limites
                    Markup.button.callback('🌐 Globales', 'edit_global_limits'),
                    Markup.button.callback('🔑 Par clé', 'edit_key_limits')
                ],
                [
                    // Limites IP et endpoints
                    Markup.button.callback('🌍 Par IP', 'edit_ip_limits'),
                    Markup.button.callback('🎯 Par endpoint', 'edit_endpoint_limits')
                ],
                [
                    // Actions spéciales
                    Markup.button.callback('⚡ Burst', 'edit_burst_limits'),
                    Markup.button.callback('⏳ Timeouts', 'edit_timeout_limits')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_api_settings')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const limitConfig = config.api?.rateLimit || {};

            // Construction du message
            let message = '⚡ Rate Limits API\n\n';

            // Limites actuelles
            message += '📊 Limites actuelles:\n';
            message += `- Globales: ${limitConfig.global || 'Non définies'}/min\n`;
            message += `- Par clé: ${limitConfig.perKey || 'Non définies'}/min\n`;
            message += `- Par IP: ${limitConfig.perIp || 'Non définies'}/min\n`;
            message += `- Burst: ${limitConfig.burst || 'Non configuré'}\n\n`;

            // Timeouts configurés
            message += '⏳ Timeouts:\n';
            message += `- Requête: ${limitConfig.timeout?.request || '30'}s\n`;
            message += `- Connexion: ${limitConfig.timeout?.connection || '5'}s\n\n`;

            // Statistiques des limites
            if (limitConfig.stats) {
                message += '📈 Statistiques (24h):\n';
                message += `- Requêtes limitées: ${limitConfig.stats.limited || 0}\n`;
                message += `- IPs bloquées: ${limitConfig.stats.blockedIps || 0}\n`;
                message += `- Clés limitées: ${limitConfig.stats.limitedKeys || 0}\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration rate limits:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des webhooks
     * @param {object} ctx - Contexte Telegraf
     */
    async manageWebhooks(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions principales
                    Markup.button.callback('➕ Nouveau', 'create_webhook'),
                    Markup.button.callback('📋 Liste', 'list_webhooks')
                ],
                [
                    // Configuration et tests
                    Markup.button.callback('⚙️ Config', 'configure_webhooks'),
                    Markup.button.callback('🔄 Tester', 'test_webhook')
                ],
                [
                    // Logs et statistiques
                    Markup.button.callback('📝 Logs', 'view_webhook_logs'),
                    Markup.button.callback('📊 Stats', 'webhook_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_api_settings')]
            ]);

            // Récupération des webhooks
            const webhooks = await Webhook.find()
                .sort({ createdAt: -1 })
                .limit(5);

            // Construction du message
            let message = '🔌 Gestion des Webhooks\n\n';

            // Liste des webhooks récents
            if (webhooks.length > 0) {
                message += '📋 Webhooks récents:\n\n';
                for (const hook of webhooks) {
                    message += `🔹 ${hook.name}\n`;
                    message += `  URL: ${this.maskUrl(hook.url)}\n`;
                    message += `  Événements: ${hook.events.join(', ')}\n`;
                    message += `  État: ${hook.active ? '✅' : '❌'}\n\n`;
                }
            } else {
                message += '❌ Aucun webhook configuré\n\n';
            }

            // Statistiques
            const stats = await this.getWebhookStats();
            message += '📊 Statistiques (24h):\n';
            message += `- Total webhooks: ${stats.total}\n`;
            message += `- Webhooks actifs: ${stats.active}\n`;
            message += `- Événements envoyés: ${stats.eventsSent}\n`;
            message += `- Taux de succès: ${stats.successRate}%\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion webhooks:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Récupère les statistiques des webhooks
     * @private
     * @returns {Promise<object>} Statistiques des webhooks
     */
    async getWebhookStats() {
        try {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

            // Statistiques de base
            const total = await Webhook.countDocuments();
            const active = await Webhook.countDocuments({ active: true });

            // Statistiques d'envoi
            const logs = await WebhookLog.find({
                timestamp: { $gte: yesterday }
            });

            const eventsSent = logs.length;
            const successful = logs.filter(log => log.success).length;
            const successRate = eventsSent ? Math.round((successful / eventsSent) * 100) : 0;

            return {
                total,
                active,
                eventsSent,
                successRate
            };
        } catch (error) {
            logger.error('Erreur calcul stats webhooks:', error);
            return {
                total: 0,
                active: 0,
                eventsSent: 0,
                successRate: 0
            };
        }
    }

    /**
     * Masque une URL pour l'affichage
     * @private
     * @param {string} url - URL à masquer
     * @returns {string} URL masquée
     */
    maskUrl(url) {
        try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.hostname}/***`;
        } catch (error) {
            return 'URL invalide';
        }
    }
    /**
     * Gestion de la documentation API
     * Interface de gestion de la documentation interactive
     * @param {object} ctx - Contexte Telegraf
     */
    async manageApiDocs(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Édition et version
                    Markup.button.callback('📝 Éditer', 'edit_api_docs'),
                    Markup.button.callback('🔄 Versions', 'manage_doc_versions')
                ],
                [
                    // Endpoints et schémas
                    Markup.button.callback('🎯 Endpoints', 'edit_doc_endpoints'),
                    Markup.button.callback('📊 Schémas', 'edit_doc_schemas')
                ],
                [
                    // Exemples et tests
                    Markup.button.callback('💡 Exemples', 'edit_doc_examples'),
                    Markup.button.callback('🔄 Tests', 'edit_doc_tests')
                ],
                [
                    // Publication et export
                    Markup.button.callback('📤 Publier', 'publish_docs'),
                    Markup.button.callback('📥 Exporter', 'export_docs')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_api_settings')]
            ]);

            // Récupération de la configuration
            const config = await Config.findOne() || {};
            const docsConfig = config.api?.documentation || {};

            // Construction du message
            let message = '📚 Documentation API\n\n';

            // État actuel
            message += '📊 État actuel:\n';
            message += `Version: ${docsConfig.version || '1.0.0'}\n`;
            message += `Dernière mise à jour: ${docsConfig.lastUpdate ?
                new Date(docsConfig.lastUpdate).toLocaleDateString() : 'Jamais'}\n`;
            message += `Endpoints documentés: ${docsConfig.endpoints?.length || 0}\n`;
            message += `Schémas: ${Object.keys(docsConfig.schemas || {}).length}\n`;
            message += `Exemples: ${docsConfig.examples?.length || 0}\n\n`;

            // Statistiques d'utilisation
            if (docsConfig.stats) {
                message += '📈 Utilisation (30j):\n';
                message += `- Visites: ${docsConfig.stats.visits || 0}\n`;
                message += `- Téléchargements: ${docsConfig.stats.downloads || 0}\n`;
                message += `- Feedback positif: ${docsConfig.stats.positiveRatings || 0}\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion documentation:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des endpoints dans la documentation
     * @param {object} ctx - Contexte Telegraf
     */
    async editDocEndpoints(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Récupération des endpoints
            const endpoints = await ApiEndpoint.find().sort({ path: 1 });

            // Construction du clavier avec pagination
            const endpointButtons = endpoints.slice(0, 8).map(endpoint => [
                Markup.button.callback(
                    `${endpoint.method} ${endpoint.path}`,
                    `edit_endpoint_doc_${endpoint._id}`
                )
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...endpointButtons,
                [
                    // Navigation et actions
                    Markup.button.callback('⬅️ Précédent', 'prev_endpoints'),
                    Markup.button.callback('➡️ Suivant', 'next_endpoints')
                ],
                [
                    // Actions globales
                    Markup.button.callback('➕ Nouvel endpoint', 'add_endpoint_doc'),
                    Markup.button.callback('🔄 Actualiser', 'refresh_endpoints')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_api_docs')]
            ]);

            // Construction du message
            let message = '🎯 Documentation des Endpoints\n\n';

            // Statistiques des endpoints
            message += '📊 Vue d\'ensemble:\n';
            message += `Total endpoints: ${endpoints.length}\n`;
            message += `GET: ${endpoints.filter(e => e.method === 'GET').length}\n`;
            message += `POST: ${endpoints.filter(e => e.method === 'POST').length}\n`;
            message += `PUT: ${endpoints.filter(e => e.method === 'PUT').length}\n`;
            message += `DELETE: ${endpoints.filter(e => e.method === 'DELETE').length}\n\n`;

            // Statut de la documentation
            const documented = endpoints.filter(e => e.documentation?.complete).length;
            message += '📝 État de la documentation:\n';
            message += `Documentés: ${documented}/${endpoints.length}\n`;
            message += `Progression: ${Math.round((documented / endpoints.length) * 100)}%\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur édition endpoints:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Édition de la documentation d'un endpoint spécifique
     * @param {object} ctx - Contexte Telegraf
     * @param {string} endpointId - ID de l'endpoint
     */
    async editEndpointDoc(ctx, endpointId) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Récupération de l'endpoint
            const endpoint = await ApiEndpoint.findById(endpointId);
            if (!endpoint) {
                return ctx.reply('❌ Endpoint non trouvé');
            }

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Sections de documentation
                    Markup.button.callback('📝 Description', `edit_endpoint_desc_${endpointId}`),
                    Markup.button.callback('📥 Paramètres', `edit_endpoint_params_${endpointId}`)
                ],
                [
                    Markup.button.callback('📤 Réponses', `edit_endpoint_responses_${endpointId}`),
                    Markup.button.callback('💡 Exemples', `edit_endpoint_examples_${endpointId}`)
                ],
                [
                    Markup.button.callback('🔒 Sécurité', `edit_endpoint_security_${endpointId}`),
                    Markup.button.callback('⚡ Limites', `edit_endpoint_limits_${endpointId}`)
                ],
                [Markup.button.callback('🔙 Retour', 'edit_doc_endpoints')]
            ]);

            // Construction du message
            let message = `🎯 ${endpoint.method} ${endpoint.path}\n\n`;

            // Documentation actuelle
            const doc = endpoint.documentation || {};
            message += '📝 Documentation actuelle:\n\n';

            // Description
            message += '📄 Description:\n';
            message += doc.description ? doc.description : 'Non définie\n';
            message += '\n';

            // Paramètres
            message += '📥 Paramètres:\n';
            if (doc.parameters && doc.parameters.length > 0) {
                doc.parameters.forEach(param => {
                    message += `- ${param.name} (${param.type})`;
                    if (param.required) message += ' *requis*';
                    message += '\n';
                });
            } else {
                message += 'Aucun paramètre défini\n';
            }
            message += '\n';

            // Réponses
            message += '📤 Réponses:\n';
            if (doc.responses) {
                Object.entries(doc.responses).forEach(([code, resp]) => {
                    message += `- ${code}: ${resp.description}\n`;
                });
            } else {
                message += 'Aucune réponse définie\n';
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur édition doc endpoint:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des versions de la documentation
     * @param {object} ctx - Contexte Telegraf
     */
    async manageDocVersions(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Récupération des versions
            const versions = await ApiDocVersion.find()
                .sort({ createdAt: -1 })
                .limit(10);

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions principales
                    Markup.button.callback('➕ Nouvelle version', 'create_doc_version'),
                    Markup.button.callback('🔄 Migration', 'migrate_doc_version')
                ],
                [
                    // Comparaison et archivage
                    Markup.button.callback('🔍 Comparer', 'compare_doc_versions'),
                    Markup.button.callback('📦 Archiver', 'archive_doc_version')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_api_docs')]
            ]);

            // Construction du message
            let message = '🔄 Versions de la Documentation\n\n';

            // Version actuelle
            const currentVersion = versions.find(v => v.current);
            message += '📌 Version actuelle:\n';
            if (currentVersion) {
                message += `Version: ${currentVersion.version}\n`;
                message += `Publiée le: ${new Date(currentVersion.publishedAt).toLocaleDateString()}\n`;
                message += `Par: @${currentVersion.publishedBy}\n\n`;
            } else {
                message += 'Aucune version publiée\n\n';
            }

            // Liste des versions
            message += '📋 Historique des versions:\n';
            versions.forEach(version => {
                if (!version.current) {
                    message += `\n${version.version}:\n`;
                    message += `- Date: ${new Date(version.publishedAt).toLocaleDateString()}\n`;
                    message += `- Changements: ${version.changes.length}\n`;
                }
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion versions doc:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    /**
     * Gestion des tests automatisés d'API
     * Interface de configuration et exécution des tests
     * @param {object} ctx - Contexte Telegraf
     */
    async manageApiTests(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Tests et scénarios
                    Markup.button.callback('▶️ Exécuter', 'run_api_tests'),
                    Markup.button.callback('📝 Scénarios', 'edit_test_scenarios')
                ],
                [
                    // Configuration et résultats
                    Markup.button.callback('⚙️ Config', 'configure_tests'),
                    Markup.button.callback('📊 Résultats', 'view_test_results')
                ],
                [
                    // CI/CD et planification
                    Markup.button.callback('🔄 CI/CD', 'configure_test_cicd'),
                    Markup.button.callback('⏰ Planning', 'schedule_tests')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_api_settings')]
            ]);

            // Récupération des statistiques de test
            const testStats = await this.getApiTestStats();

            // Construction du message
            let message = '🧪 Tests API\n\n';

            // Dernière exécution
            message += '📊 Dernière exécution:\n';
            if (testStats.lastRun) {
                message += `Date: ${new Date(testStats.lastRun.date).toLocaleString()}\n`;
                message += `Succès: ${testStats.lastRun.passed}/${testStats.lastRun.total} tests\n`;
                message += `Durée: ${testStats.lastRun.duration}s\n\n`;
            } else {
                message += 'Aucune exécution récente\n\n';
            }

            // Couverture des tests
            message += '📈 Couverture:\n';
            message += `Endpoints couverts: ${testStats.coverage.endpoints}%\n`;
            message += `Scénarios: ${testStats.scenarios.total}\n`;
            message += `Tests automatisés: ${testStats.tests.total}\n\n`;

            // Planning
            if (testStats.schedule) {
                message += '⏰ Planning:\n';
                message += `Fréquence: ${testStats.schedule.frequency}\n`;
                message += `Prochaine exécution: ${new Date(testStats.schedule.nextRun).toLocaleString()}\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion tests API:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Monitoring et métriques de l'API
     * @param {object} ctx - Contexte Telegraf
     */
    async viewApiMonitoring(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Métriques et performances
                    Markup.button.callback('📊 Métriques', 'view_api_metrics'),
                    Markup.button.callback('⚡ Performance', 'view_api_performance')
                ],
                [
                    // Alertes et rapports
                    Markup.button.callback('🚨 Alertes', 'configure_api_alerts'),
                    Markup.button.callback('📋 Rapports', 'generate_api_report')
                ],
                [
                    // Historique et analyse
                    Markup.button.callback('📈 Historique', 'view_api_history'),
                    Markup.button.callback('🔍 Analyse', 'analyze_api_metrics')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_api_settings')]
            ]);

            // Récupération des métriques
            const metrics = await this.getApiMetrics();

            // Construction du message
            let message = '📊 Monitoring API\n\n';

            // Métriques en temps réel
            message += '⚡ Temps réel (dernière minute):\n';
            message += `Requêtes: ${metrics.realtime.requests}/min\n`;
            message += `Temps moyen: ${metrics.realtime.avgResponseTime}ms\n`;
            message += `Erreurs: ${metrics.realtime.errors}\n\n`;

            // Statistiques sur 24h
            message += '📈 Dernières 24h:\n';
            message += `Total requêtes: ${metrics.daily.totalRequests}\n`;
            message += `Taux de succès: ${metrics.daily.successRate}%\n`;
            message += `Temps moyen: ${metrics.daily.avgResponseTime}ms\n`;
            message += `Bande passante: ${this.formatSize(metrics.daily.bandwidth)}\n\n`;

            // État du système
            message += '🖥️ État système:\n';
            message += `CPU: ${metrics.system.cpu}%\n`;
            message += `Mémoire: ${metrics.system.memory}%\n`;
            message += `Cache hits: ${metrics.system.cacheHitRate}%\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur affichage monitoring:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des versions de l'API
     * @param {object} ctx - Contexte Telegraf
     */
    async manageApiVersions(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des versions
                    Markup.button.callback('➕ Nouvelle version', 'create_api_version'),
                    Markup.button.callback('📋 Versions', 'list_api_versions')
                ],
                [
                    // Migration et dépréciation
                    Markup.button.callback('🔄 Migration', 'manage_api_migration'),
                    Markup.button.callback('⚠️ Dépréciation', 'manage_api_deprecation')
                ],
                [
                    // Compatibilité et tests
                    Markup.button.callback('🔍 Compatibilité', 'check_api_compatibility'),
                    Markup.button.callback('🧪 Tests', 'test_api_version')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_api_settings')]
            ]);

            // Récupération des versions
            const versions = await ApiVersion.find()
                .sort({ releaseDate: -1 })
                .limit(5);

            // Construction du message
            let message = '🔄 Gestion des Versions API\n\n';

            // Version actuelle
            const currentVersion = versions.find(v => v.current);
            message += '📌 Version actuelle:\n';
            if (currentVersion) {
                message += `Version: ${currentVersion.version}\n`;
                message += `Publiée le: ${new Date(currentVersion.releaseDate).toLocaleDateString()}\n`;
                message += `État: ${this.getVersionStatus(currentVersion)}\n\n`;
            }

            // Liste des versions récentes
            message += '📋 Versions récentes:\n';
            versions.forEach(version => {
                if (!version.current) {
                    message += `\n${version.version}:\n`;
                    message += `- Date: ${new Date(version.releaseDate).toLocaleDateString()}\n`;
                    message += `- État: ${this.getVersionStatus(version)}\n`;
                    if (version.deprecatedDate) {
                        message += `- Fin de support: ${new Date(version.deprecatedDate).toLocaleDateString()}\n`;
                    }
                }
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion versions API:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Récupère les statistiques des tests API
     * @private
     * @returns {Promise<object>} Statistiques des tests
     */
    async getApiTestStats() {
        try {
            // Récupération des données de test
            const lastRun = await ApiTestRun.findOne().sort({ date: -1 });
            const scenarios = await ApiTestScenario.find();
            const tests = await ApiTest.find();

            // Calcul de la couverture
            const endpoints = await ApiEndpoint.find();
            const testedEndpoints = await ApiEndpoint.countDocuments({
                '_id': { $in: tests.map(t => t.endpoint) }
            });

            return {
                lastRun: lastRun ? {
                    date: lastRun.date,
                    passed: lastRun.passedTests,
                    total: lastRun.totalTests,
                    duration: lastRun.duration
                } : null,
                coverage: {
                    endpoints: Math.round((testedEndpoints / endpoints.length) * 100)
                },
                scenarios: {
                    total: scenarios.length
                },
                tests: {
                    total: tests.length
                },
                schedule: await this.getTestSchedule()
            };
        } catch (error) {
            logger.error('Erreur calcul stats tests:', error);
            return {
                lastRun: null,
                coverage: { endpoints: 0 },
                scenarios: { total: 0 },
                tests: { total: 0 },
                schedule: null
            };
        }
    }

    /**
     * Formatage de la taille en format lisible
     * @private
     * @param {number} bytes - Taille en bytes
     * @returns {string} Taille formatée
     */
    formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }
    /**
     * Gestion principale des paiements
     * Interface de configuration des paiements et transactions
     * @param {object} ctx - Contexte Telegraf
     */
    async managePaymentSettings(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Méthodes et transactions
                    Markup.button.callback('💳 Méthodes', 'manage_payment_methods'),
                    Markup.button.callback('💰 Transactions', 'view_transactions')
                ],
                [
                    // Rapports et configuration
                    Markup.button.callback('📊 Rapports', 'payment_reports'),
                    Markup.button.callback('⚙️ Configuration', 'payment_config')
                ],
                [
                    // Intégrations et sécurité
                    Markup.button.callback('🔌 Intégrations', 'payment_integrations'),
                    Markup.button.callback('🔒 Sécurité', 'payment_security')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération des statistiques de paiement
            const stats = await this.getPaymentStats();

            // Construction du message
            let message = '💰 Gestion des Paiements\n\n';

            // Statistiques globales
            message += '📊 Vue d\'ensemble (24h):\n';
            message += `Transactions: ${stats.daily.count}\n`;
            message += `Volume: ${stats.daily.volume.toFixed(2)}€\n`;
            message += `Taux de succès: ${stats.daily.successRate}%\n\n`;

            // Méthodes actives
            message += '💳 Méthodes de paiement:\n';
            Object.entries(stats.methods).forEach(([method, data]) => {
                message += `${this.getPaymentMethodEmoji(method)} ${method}: `;
                message += `${data.active ? '✅' : '❌'}\n`;
            });
            message += '\n';

            // Alertes et notifications
            if (stats.alerts.length > 0) {
                message += '⚠️ Alertes récentes:\n';
                stats.alerts.forEach(alert => {
                    message += `- ${alert.message}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion paiements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des méthodes de paiement
     * @param {object} ctx - Contexte Telegraf
     */
    async managePaymentMethods(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Ajout et configuration
                    Markup.button.callback('➕ Ajouter', 'add_payment_method'),
                    Markup.button.callback('⚙️ Configurer', 'configure_payment_method')
                ],
                [
                    // Gestion des frais et limites
                    Markup.button.callback('💰 Frais', 'manage_payment_fees'),
                    Markup.button.callback('⚡ Limites', 'manage_payment_limits')
                ],
                [
                    // Tests et documentation
                    Markup.button.callback('🧪 Tester', 'test_payment_method'),
                    Markup.button.callback('📝 Documentation', 'payment_method_docs')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération des méthodes de paiement
            const methods = await PaymentMethod.find().sort({ order: 1 });

            // Construction du message
            let message = '💳 Méthodes de Paiement\n\n';

            // Liste des méthodes
            methods.forEach(method => {
                message += `${this.getPaymentMethodEmoji(method.type)} ${method.name}\n`;
                message += `État: ${method.active ? '✅' : '❌'}\n`;
                message += `Frais: ${method.fees.fixed}€ + ${method.fees.percentage}%\n`;
                message += `Limites: ${method.limits.min}€ - ${method.limits.max}€\n\n`;
            });

            // Statistiques d'utilisation
            const stats = await this.getMethodStats();
            message += '📊 Utilisation (7j):\n';
            Object.entries(stats).forEach(([method, data]) => {
                message += `${this.getPaymentMethodEmoji(method)}: `;
                message += `${data.transactions} trans. (${data.volume.toFixed(2)}€)\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion méthodes:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Vue des transactions
     * @param {object} ctx - Contexte Telegraf
     */
    async viewTransactions(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Filtres et recherche
                    Markup.button.callback('🔍 Rechercher', 'search_transactions'),
                    Markup.button.callback('⚡ En cours', 'pending_transactions')
                ],
                [
                    // Export et rapports
                    Markup.button.callback('📤 Exporter', 'export_transactions'),
                    Markup.button.callback('📊 Statistiques', 'transaction_stats')
                ],
                [
                    // Remboursements et disputes
                    Markup.button.callback('↩️ Remboursements', 'view_refunds'),
                    Markup.button.callback('⚠️ Disputes', 'view_disputes')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération des dernières transactions
            const recentTransactions = await Transaction.find()
                .sort({ createdAt: -1 })
                .limit(5)
                .populate('user');

            // Construction du message
            let message = '💰 Transactions\n\n';

            // Statistiques du jour
            const todayStats = await this.getTodayTransactionStats();
            message += '📊 Aujourd\'hui:\n';
            message += `Transactions: ${todayStats.count}\n`;
            message += `Volume: ${todayStats.volume.toFixed(2)}€\n`;
            message += `Moyenne: ${todayStats.average.toFixed(2)}€\n\n`;

            // Dernières transactions
            message += '📝 Dernières transactions:\n\n';
            recentTransactions.forEach(transaction => {
                message += `${this.getTransactionEmoji(transaction.status)} `;
                message += `${transaction.reference}\n`;
                message += `💰 ${transaction.amount.toFixed(2)}€ `;
                message += `- @${transaction.user.username}\n`;
                message += `📅 ${new Date(transaction.createdAt).toLocaleString()}\n\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur affichage transactions:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Génération de rapports de paiement
     * @param {object} ctx - Contexte Telegraf
     */
    async paymentReports(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Types de rapports
                    Markup.button.callback('📅 Journalier', 'daily_report'),
                    Markup.button.callback('📅 Mensuel', 'monthly_report')
                ],
                [
                    // Rapports spéciaux
                    Markup.button.callback('💳 Par méthode', 'method_report'),
                    Markup.button.callback('👥 Par client', 'customer_report')
                ],
                [
                    // Export et planification
                    Markup.button.callback('📤 Exporter', 'export_report'),
                    Markup.button.callback('⏰ Planifier', 'schedule_reports')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Construction du message
            let message = '📊 Rapports de Paiement\n\n';

            // Récupération des statistiques
            const stats = await this.getReportStats();

            // Vue d'ensemble
            message += '📈 Vue d\'ensemble:\n';
            message += `CA Mensuel: ${stats.monthlyRevenue.toFixed(2)}€\n`;
            message += `Croissance: ${stats.growth > 0 ? '+' : ''}${stats.growth}%\n`;
            message += `Panier moyen: ${stats.avgOrderValue.toFixed(2)}€\n\n`;

            // Top méthodes de paiement
            message += '💳 Top méthodes:\n';
            stats.topMethods.forEach(method => {
                message += `${this.getPaymentMethodEmoji(method.type)} ${method.name}: `;
                message += `${method.percentage}%\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur rapports paiement:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Sécurité des paiements
     * @param {object} ctx - Contexte Telegraf
     */
    async paymentSecurity(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Règles et vérifications
                    Markup.button.callback('🛡️ Règles', 'security_rules'),
                    Markup.button.callback('✅ Vérifications', 'security_checks')
                ],
                [
                    // Fraude et logs
                    Markup.button.callback('🚫 Anti-fraude', 'fraud_settings'),
                    Markup.button.callback('📝 Logs', 'security_logs')
                ],
                [
                    // Alertes et rapports
                    Markup.button.callback('⚠️ Alertes', 'security_alerts'),
                    Markup.button.callback('📊 Rapports', 'security_reports')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération des statistiques de sécurité
            const securityStats = await this.getSecurityStats();

            // Construction du message
            let message = '🔒 Sécurité des Paiements\n\n';

            // Statistiques de sécurité
            message += '📊 Dernières 24h:\n';
            message += `Transactions suspectes: ${securityStats.suspicious}\n`;
            message += `Fraudes détectées: ${securityStats.fraud}\n`;
            message += `Score moyen: ${securityStats.avgScore}/100\n\n`;

            // Règles actives
            message += '🛡️ Règles actives:\n';
            securityStats.rules.forEach(rule => {
                message += `- ${rule.name}: ${rule.active ? '✅' : '❌'}\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur sécurité paiements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Récupère l'emoji correspondant à une méthode de paiement
     * @private
     * @param {string} method - Type de méthode de paiement
     * @returns {string} Emoji correspondant
     */
    getPaymentMethodEmoji(method) {
        const emojis = {
            'card': '💳',
            'paypal': '🅿️',
            'crypto': '🪙',
            'bank': '🏦',
            'cash': '💵',
            'wallet': '👛'
        };
        return emojis[method] || '💰';
    }

    /**
     * Récupère l'emoji correspondant à un statut de transaction
     * @private
     * @param {string} status - Statut de la transaction
     * @returns {string} Emoji correspondant
     */
    getTransactionEmoji(status) {
        const emojis = {
            'completed': '✅',
            'pending': '⏳',
            'failed': '❌',
            'refunded': '↩️',
            'disputed': '⚠️'
        };
        return emojis[status] || '❓';
    }
    /**
     * Gestion des intégrations de paiement
     * Configure les différentes passerelles de paiement
     * @param {object} ctx - Contexte Telegraf
     */
    async paymentIntegrations(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // PayPal et Stripe
                    Markup.button.callback('🅿️ PayPal', 'configure_paypal'),
                    Markup.button.callback('💳 Stripe', 'configure_stripe')
                ],
                [
                    // Crypto et virements
                    Markup.button.callback('🪙 Crypto', 'configure_crypto'),
                    Markup.button.callback('🏦 Virements', 'configure_bank')
                ],
                [
                    // Autres méthodes
                    Markup.button.callback('💰 Paysafecard', 'configure_paysafecard'),
                    Markup.button.callback('💵 Cash', 'configure_cash')
                ],
                [
                    // Tests et webhooks
                    Markup.button.callback('🧪 Tests', 'test_integrations'),
                    Markup.button.callback('🔌 Webhooks', 'configure_payment_webhooks')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération de l'état des intégrations
            const integrations = await PaymentIntegration.find();
            const stats = await this.getIntegrationStats();

            // Construction du message
            let message = '🔌 Intégrations de Paiement\n\n';

            // État des intégrations
            message += '📊 État des intégrations:\n\n';
            integrations.forEach(integration => {
                const emoji = this.getPaymentMethodEmoji(integration.type);
                message += `${emoji} ${integration.name}:\n`;
                message += `État: ${integration.active ? '✅' : '❌'}\n`;
                message += `Mode: ${integration.testMode ? '🧪 Test' : '🚀 Production'}\n`;
                message += `Succès 24h: ${stats[integration.type]?.successRate || 0}%\n\n`;
            });

            // Alertes et notifications
            const alerts = await this.getIntegrationAlerts();
            if (alerts.length > 0) {
                message += '⚠️ Alertes récentes:\n';
                alerts.forEach(alert => {
                    message += `- ${alert.message}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion intégrations:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration de PayPal
     * @param {object} ctx - Contexte Telegraf
     */
    async configurePaypal(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Configuration principale
                    Markup.button.callback('🔑 API Keys', 'edit_paypal_keys'),
                    Markup.button.callback('⚙️ Paramètres', 'edit_paypal_settings')
                ],
                [
                    // Mode et webhooks
                    Markup.button.callback('🔄 Mode', 'toggle_paypal_mode'),
                    Markup.button.callback('🔌 Webhooks', 'configure_paypal_webhooks')
                ],
                [
                    // Tests et logs
                    Markup.button.callback('🧪 Tester', 'test_paypal'),
                    Markup.button.callback('📝 Logs', 'view_paypal_logs')
                ],
                [Markup.button.callback('🔙 Retour', 'payment_integrations')]
            ]);

            // Récupération de la configuration
            const config = await PaymentIntegration.findOne({ type: 'paypal' });
            const stats = await this.getPaypalStats();

            // Construction du message
            let message = '🅿️ Configuration PayPal\n\n';

            // État actuel
            message += '📊 État actuel:\n';
            message += `Mode: ${config?.testMode ? '🧪 Sandbox' : '🚀 Production'}\n`;
            message += `État: ${config?.active ? '✅ Actif' : '❌ Inactif'}\n`;
            message += `Client ID: ${this.maskApiKey(config?.credentials?.clientId)}\n\n`;

            // Statistiques
            message += '📈 Statistiques (24h):\n';
            message += `Transactions: ${stats.transactions}\n`;
            message += `Volume: ${stats.volume.toFixed(2)}€\n`;
            message += `Taux de succès: ${stats.successRate}%\n\n`;

            // Webhooks
            message += '🔌 Webhooks:\n';
            message += `Configurés: ${stats.webhooks.configured}\n`;
            message += `Actifs: ${stats.webhooks.active}\n`;
            message += `Taux de succès: ${stats.webhooks.successRate}%\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration PayPal:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration des paiements crypto
     * @param {object} ctx - Contexte Telegraf
     */
    async configureCrypto(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Cryptomonnaies
                    Markup.button.callback('₿ Bitcoin', 'configure_btc'),
                    Markup.button.callback('Ξ Ethereum', 'configure_eth')
                ],
                [
                    // Stablecoins
                    Markup.button.callback('₮ USDT', 'configure_usdt'),
                    Markup.button.callback('💰 USDC', 'configure_usdc')
                ],
                [
                    // Configuration et sécurité
                    Markup.button.callback('⚙️ Config', 'crypto_settings'),
                    Markup.button.callback('🔒 Sécurité', 'crypto_security')
                ],
                [Markup.button.callback('🔙 Retour', 'payment_integrations')]
            ]);

            // Récupération de la configuration
            const config = await PaymentIntegration.findOne({ type: 'crypto' });
            const stats = await this.getCryptoStats();

            // Construction du message
            let message = '🪙 Configuration Crypto\n\n';

            // État des cryptomonnaies
            message += '📊 Cryptomonnaies configurées:\n';
            Object.entries(config?.currencies || {}).forEach(([currency, data]) => {
                message += `${this.getCryptoEmoji(currency)} ${currency}:\n`;
                message += `État: ${data.active ? '✅' : '❌'}\n`;
                message += `Adresse: ${this.maskAddress(data.address)}\n`;
                message += `Confirmations requises: ${data.confirmations}\n\n`;
            });

            // Statistiques
            if (stats) {
                message += '📈 Statistiques (24h):\n';
                Object.entries(stats.currencies).forEach(([currency, data]) => {
                    message += `${this.getCryptoEmoji(currency)}: `;
                    message += `${data.transactions} trans. (${data.volume} ${currency})\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration crypto:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration des devises et taux de change
     * @param {object} ctx - Contexte Telegraf
     */
    async configureCurrencies(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des devises
                    Markup.button.callback('➕ Ajouter', 'add_currency'),
                    Markup.button.callback('📝 Modifier', 'edit_currency')
                ],
                [
                    // Taux de change
                    Markup.button.callback('💱 Taux', 'exchange_rates'),
                    Markup.button.callback('🔄 Auto-update', 'configure_rates_update')
                ],
                [
                    // Configuration et historique
                    Markup.button.callback('⚙️ Paramètres', 'currency_settings'),
                    Markup.button.callback('📊 Historique', 'currency_history')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération des devises et taux
            const currencies = await Currency.find({ active: true });
            const rates = await ExchangeRate.find().sort({ updatedAt: -1 });

            // Construction du message
            let message = '💱 Gestion des Devises\n\n';

            // Devises actives
            message += '💰 Devises configurées:\n';
            currencies.forEach(currency => {
                const rate = rates.find(r => r.currency === currency.code);
                message += `${currency.symbol} ${currency.code}:\n`;
                message += `Taux: 1€ = ${rate?.rate || 'N/A'} ${currency.code}\n`;
                message += `Mise à jour: ${rate?.updatedAt ?
                    new Date(rate.updatedAt).toLocaleString() : 'Jamais'}\n\n`;
            });

            // Statistiques d'utilisation
            const stats = await this.getCurrencyStats();
            if (stats) {
                message += '📊 Utilisation (7j):\n';
                Object.entries(stats).forEach(([currency, data]) => {
                    message += `${currency}: ${data.percentage}% des transactions\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration devises:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Récupère l'emoji correspondant à une cryptomonnaie
     * @private
     * @param {string} currency - Code de la cryptomonnaie
     * @returns {string} Emoji correspondant
     */
    getCryptoEmoji(currency) {
        const emojis = {
            'BTC': '₿',
            'ETH': 'Ξ',
            'USDT': '₮',
            'USDC': '💰',
            'XRP': '✨',
            'BNB': '🔶'
        };
        return emojis[currency] || '🪙';
    }

    /**
     * Masque une adresse crypto
     * @private
     * @param {string} address - Adresse à masquer
     * @returns {string} Adresse masquée
     */
    maskAddress(address) {
        if (!address) return 'Non configurée';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    }
    /**
     * Gestion des automatisations de paiement
     * Configure les règles et actions automatiques
     * @param {object} ctx - Contexte Telegraf
     */
    async paymentAutomations(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des règles
                    Markup.button.callback('➕ Nouvelle règle', 'add_payment_rule'),
                    Markup.button.callback('📝 Modifier', 'edit_payment_rule')
                ],
                [
                    // Actions et conditions
                    Markup.button.callback('⚡ Actions', 'manage_auto_actions'),
                    Markup.button.callback('🎯 Conditions', 'manage_auto_conditions')
                ],
                [
                    // Planning et historique
                    Markup.button.callback('⏰ Planning', 'automation_schedule'),
                    Markup.button.callback('📊 Historique', 'automation_history')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération des automatisations
            const automations = await PaymentAutomation.find().populate('rules');
            const stats = await this.getAutomationStats();

            // Construction du message
            let message = '⚡ Automatisations de Paiement\n\n';

            // Liste des règles actives
            message += '📋 Règles actives:\n\n';
            automations.forEach(auto => {
                message += `${auto.active ? '✅' : '❌'} ${auto.name}\n`;
                message += `Déclencheur: ${auto.trigger}\n`;
                message += `Actions: ${auto.actions.length}\n`;
                message += `Exécutions (24h): ${stats[auto._id]?.executions || 0}\n\n`;
            });

            // Statistiques globales
            if (stats.global) {
                message += '📊 Statistiques globales (24h):\n';
                message += `Règles exécutées: ${stats.global.rulesExecuted}\n`;
                message += `Actions effectuées: ${stats.global.actionsPerformed}\n`;
                message += `Taux de succès: ${stats.global.successRate}%\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion automatisations:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des règles de facturation
     * @param {object} ctx - Contexte Telegraf
     */
    async manageBillingRules(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Règles de facturation
                    Markup.button.callback('💰 Tarifs', 'manage_pricing_rules'),
                    Markup.button.callback('🎯 Remises', 'manage_discount_rules')
                ],
                [
                    // Taxes et frais
                    Markup.button.callback('📑 Taxes', 'manage_tax_rules'),
                    Markup.button.callback('💳 Frais', 'manage_fee_rules')
                ],
                [
                    // Périodes et limites
                    Markup.button.callback('⏰ Périodes', 'billing_periods'),
                    Markup.button.callback('⚡ Limites', 'billing_limits')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération des règles
            const rules = await BillingRule.find().sort({ priority: 1 });
            const stats = await this.getBillingStats();

            // Construction du message
            let message = '📑 Règles de Facturation\n\n';

            // Catégories de règles
            const categories = {
                'pricing': '💰 Tarification',
                'discount': '🎯 Remises',
                'tax': '📑 Taxes',
                'fee': '💳 Frais'
            };

            // Liste des règles par catégorie
            Object.entries(categories).forEach(([category, label]) => {
                const categoryRules = rules.filter(r => r.type === category);
                if (categoryRules.length > 0) {
                    message += `${label}:\n`;
                    categoryRules.forEach(rule => {
                        message += `${rule.active ? '✅' : '❌'} ${rule.name}\n`;
                        message += `  Priorité: ${rule.priority}\n`;
                        message += `  Applications (24h): ${stats[rule._id]?.applications || 0}\n\n`;
                    });
                }
            });

            // Impact financier
            if (stats.financial) {
                message += '💹 Impact financier (24h):\n';
                message += `Remises: -${stats.financial.discounts.toFixed(2)}€\n`;
                message += `Taxes: +${stats.financial.taxes.toFixed(2)}€\n`;
                message += `Frais: +${stats.financial.fees.toFixed(2)}€\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion règles facturation:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des remboursements
     * @param {object} ctx - Contexte Telegraf
     */
    async manageRefunds(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions principales
                    Markup.button.callback('📝 En attente', 'pending_refunds'),
                    Markup.button.callback('✅ Approuver', 'approve_refund')
                ],
                [
                    // Historique et statistiques
                    Markup.button.callback('📊 Statistiques', 'refund_stats'),
                    Markup.button.callback('📋 Historique', 'refund_history')
                ],
                [
                    // Règles et rapports
                    Markup.button.callback('⚙️ Règles', 'refund_rules'),
                    Markup.button.callback('📄 Rapports', 'refund_reports')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération des remboursements
            const pendingRefunds = await Refund.find({ status: 'pending' })
                .populate('order')
                .populate('user')
                .sort({ createdAt: -1 })
                .limit(5);

            const stats = await this.getRefundStats();

            // Construction du message
            let message = '↩️ Gestion des Remboursements\n\n';

            // Statistiques
            message += '📊 Vue d\'ensemble (24h):\n';
            message += `Demandes: ${stats.requests}\n`;
            message += `Approuvés: ${stats.approved}\n`;
            message += `Montant total: ${stats.totalAmount.toFixed(2)}€\n\n`;

            // Remboursements en attente
            if (pendingRefunds.length > 0) {
                message += '⏳ Remboursements en attente:\n\n';
                pendingRefunds.forEach(refund => {
                    message += `🔹 Commande #${refund.order.number}\n`;
                    message += `👤 @${refund.user.username}\n`;
                    message += `💰 ${refund.amount.toFixed(2)}€\n`;
                    message += `📅 ${new Date(refund.createdAt).toLocaleString()}\n\n`;
                });
            } else {
                message += '✅ Aucun remboursement en attente\n\n';
            }

            // Statistiques par méthode
            message += '💳 Par méthode de paiement:\n';
            Object.entries(stats.byMethod).forEach(([method, data]) => {
                message += `${this.getPaymentMethodEmoji(method)}: `;
                message += `${data.count} (${data.amount.toFixed(2)}€)\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion remboursements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des rapports personnalisés
     * @param {object} ctx - Contexte Telegraf
     */
    async customReports(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des rapports
                    Markup.button.callback('➕ Nouveau', 'create_custom_report'),
                    Markup.button.callback('📋 Mes rapports', 'my_custom_reports')
                ],
                [
                    // Modèles et planification
                    Markup.button.callback('📝 Modèles', 'report_templates'),
                    Markup.button.callback('⏰ Planning', 'schedule_reports')
                ],
                [
                    // Partage et export
                    Markup.button.callback('🔗 Partager', 'share_report'),
                    Markup.button.callback('📤 Exporter', 'export_reports')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération des rapports personnalisés
            const reports = await CustomReport.find()
                .populate('creator')
                .sort({ lastRun: -1 })
                .limit(5);

            // Construction du message
            let message = '📊 Rapports Personnalisés\n\n';

            // Liste des derniers rapports
            if (reports.length > 0) {
                message += '📋 Derniers rapports:\n\n';
                reports.forEach(report => {
                    message += `📄 ${report.name}\n`;
                    message += `👤 Créé par: @${report.creator.username}\n`;
                    message += `🔄 Dernière exécution: ${report.lastRun ?
                        new Date(report.lastRun).toLocaleString() : 'Jamais'}\n`;
                    message += `⏰ Planification: ${report.schedule || 'Manuel'}\n\n`;
                });
            }

            // Statistiques d'utilisation
            const stats = await this.getCustomReportStats();
            message += '📊 Statistiques:\n';
            message += `Rapports créés: ${stats.totalReports}\n`;
            message += `Exécutions (24h): ${stats.dailyExecutions}\n`;
            message += `Temps moyen: ${stats.avgExecutionTime}s\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion rapports personnalisés:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    /**
     * Gestion des abonnements et paiements récurrents
     * Configure et gère les plans d'abonnement et les paiements récurrents
     * @param {object} ctx - Contexte Telegraf
     */
    async manageSubscriptions(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Plans et cycles
                    Markup.button.callback('📋 Plans', 'manage_subscription_plans'),
                    Markup.button.callback('🔄 Cycles', 'manage_billing_cycles')
                ],
                [
                    // Renouvellements et annulations
                    Markup.button.callback('🔁 Renouvellements', 'manage_renewals'),
                    Markup.button.callback('❌ Annulations', 'manage_cancellations')
                ],
                [
                    // Transitions et migrations
                    Markup.button.callback('⚡ Transitions', 'manage_plan_transitions'),
                    Markup.button.callback('📊 Analytics', 'subscription_analytics')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération des statistiques
            const stats = await this.getSubscriptionStats();
            const plans = await SubscriptionPlan.find({ active: true });

            // Construction du message
            let message = '🔄 Gestion des Abonnements\n\n';

            // Statistiques générales
            message += '📊 Vue d\'ensemble:\n';
            message += `Abonnés actifs: ${stats.activeSubscribers}\n`;
            message += `Revenu mensuel: ${stats.monthlyRevenue.toFixed(2)}€\n`;
            message += `Taux de rétention: ${stats.retentionRate}%\n\n`;

            // Plans disponibles
            message += '📋 Plans actifs:\n';
            plans.forEach(plan => {
                message += `\n${plan.name}:\n`;
                message += `💰 Prix: ${plan.price.toFixed(2)}€/${plan.interval}\n`;
                message += `👥 Abonnés: ${stats.planStats[plan._id]?.subscribers || 0}\n`;
                message += `📈 Croissance: ${stats.planStats[plan._id]?.growth || 0}%\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion abonnements:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des litiges et contestations
     * @param {object} ctx - Contexte Telegraf
     */
    async manageDisputes(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des litiges
                    Markup.button.callback('📝 Nouveaux', 'new_disputes'),
                    Markup.button.callback('⏳ En cours', 'ongoing_disputes')
                ],
                [
                    // Actions et résolution
                    Markup.button.callback('✅ Résoudre', 'resolve_dispute'),
                    Markup.button.callback('❌ Rejeter', 'reject_dispute')
                ],
                [
                    // Documentation et prévention
                    Markup.button.callback('📋 Documents', 'dispute_documents'),
                    Markup.button.callback('🛡️ Prévention', 'dispute_prevention')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_payment_settings')]
            ]);

            // Récupération des litiges
            const disputes = await Dispute.find()
                .populate('transaction')
                .populate('user')
                .sort({ createdAt: -1 })
                .limit(5);

            const stats = await this.getDisputeStats();

            // Construction du message
            let message = '⚠️ Gestion des Litiges\n\n';

            // Statistiques
            message += '📊 Statistiques (30j):\n';
            message += `Total litiges: ${stats.totalDisputes}\n`;
            message += `Taux de litiges: ${stats.disputeRate}%\n`;
            message += `Montant contesté: ${stats.disputedAmount.toFixed(2)}€\n`;
            message += `Taux de résolution: ${stats.resolutionRate}%\n\n`;

            // Litiges récents
            if (disputes.length > 0) {
                message += '📝 Litiges récents:\n\n';
                disputes.forEach(dispute => {
                    message += `🔸 #${dispute.reference}\n`;
                    message += `👤 @${dispute.user.username}\n`;
                    message += `💰 ${dispute.amount.toFixed(2)}€\n`;
                    message += `📅 ${new Date(dispute.createdAt).toLocaleString()}\n`;
                    message += `📊 Statut: ${this.getDisputeStatusEmoji(dispute.status)} `;
                    message += `${dispute.status}\n\n`;
                });
            }

            // Par motif
            message += '📋 Par motif:\n';
            Object.entries(stats.byReason).forEach(([reason, count]) => {
                message += `${this.getDisputeReasonEmoji(reason)}: ${count}\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion litiges:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji correspondant au statut d'un litige
     * @private
     * @param {string} status - Statut du litige
     * @returns {string} Emoji correspondant
     */
    getDisputeStatusEmoji(status) {
        const emojis = {
            'new': '🆕',
            'pending': '⏳',
            'investigating': '🔍',
            'resolved': '✅',
            'rejected': '❌',
            'escalated': '⚠️'
        };
        return emojis[status] || '❓';
    }

    /**
     * Obtient l'emoji correspondant au motif d'un litige
     * @private
     * @param {string} reason - Motif du litige
     * @returns {string} Emoji correspondant
     */
    getDisputeReasonEmoji(reason) {
        const emojis = {
            'fraud': '🚨',
            'product_not_received': '📦',
            'product_not_as_described': '❌',
            'subscription_issue': '🔄',
            'duplicate_charge': '🔄',
            'technical_error': '⚡',
            'other': '❓'
        };
        return emojis[reason] || '❓';
    }
    /**
     * Gestion principale des intégrations tierces
     * Interface de gestion des connexions aux services externes
     * @param {object} ctx - Contexte Telegraf
     */
    async manageIntegrations(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Services principaux
                    Markup.button.callback('☁️ Cloud', 'cloud_integrations'),
                    Markup.button.callback('📱 Apps', 'app_integrations')
                ],
                [
                    // Services de messagerie et analytics
                    Markup.button.callback('💬 Messaging', 'messaging_integrations'),
                    Markup.button.callback('📊 Analytics', 'analytics_integrations')
                ],
                [
                    // Services de marketing et CRM
                    Markup.button.callback('📢 Marketing', 'marketing_integrations'),
                    Markup.button.callback('👥 CRM', 'crm_integrations')
                ],
                [
                    // État et journaux
                    Markup.button.callback('📊 État', 'integration_status'),
                    Markup.button.callback('📝 Logs', 'integration_logs')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération des intégrations
            const integrations = await Integration.find();
            const stats = await this.getIntegrationStats();

            // Construction du message
            let message = '🔌 Gestion des Intégrations\n\n';

            // Vue d'ensemble
            message += '📊 Vue d\'ensemble:\n';
            message += `Total intégrations: ${integrations.length}\n`;
            message += `Actives: ${integrations.filter(i => i.active).length}\n`;
            message += `Connexions/min: ${stats.connectionsPerMinute}\n\n`;

            // Par catégorie
            const categories = {
                'cloud': '☁️ Cloud',
                'apps': '📱 Applications',
                'messaging': '💬 Messagerie',
                'analytics': '📊 Analytics',
                'marketing': '📢 Marketing',
                'crm': '👥 CRM'
            };

            message += '📋 État par catégorie:\n';
            Object.entries(categories).forEach(([key, label]) => {
                const categoryIntegrations = integrations.filter(i => i.category === key);
                message += `${label}:\n`;
                message += `- Actives: ${categoryIntegrations.filter(i => i.active).length}\n`;
                message += `- Erreurs (24h): ${stats.errors[key] || 0}\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion intégrations:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des intégrations cloud
     * @param {object} ctx - Contexte Telegraf
     */
    async manageCloudIntegrations(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Services de stockage
                    Markup.button.callback('📦 Google Drive', 'setup_gdrive'),
                    Markup.button.callback('☁️ Dropbox', 'setup_dropbox')
                ],
                [
                    // Services d'hébergement
                    Markup.button.callback('🌐 AWS', 'setup_aws'),
                    Markup.button.callback('☁️ Azure', 'setup_azure')
                ],
                [
                    // Configuration et test
                    Markup.button.callback('⚙️ Config', 'configure_cloud'),
                    Markup.button.callback('🔄 Test', 'test_cloud')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_integrations')]
            ]);

            // Récupération des intégrations cloud
            const cloudIntegrations = await Integration.find({ category: 'cloud' });
            const stats = await this.getCloudStats();

            // Construction du message
            let message = '☁️ Intégrations Cloud\n\n';

            // État des services
            cloudIntegrations.forEach(integration => {
                message += `${this.getCloudEmoji(integration.type)} ${integration.name}:\n`;
                message += `État: ${integration.active ? '✅' : '❌'}\n`;
                message += `Espace utilisé: ${this.formatSize(stats[integration._id]?.usage || 0)}\n`;
                message += `Dernier sync: ${integration.lastSync ?
                    new Date(integration.lastSync).toLocaleString() : 'Jamais'}\n\n`;
            });

            // Statistiques d'utilisation
            message += '📊 Statistiques (24h):\n';
            message += `Fichiers synchronisés: ${stats.syncedFiles || 0}\n`;
            message += `Données transférées: ${this.formatSize(stats.dataTransferred || 0)}\n`;
            message += `Erreurs: ${stats.errors || 0}\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion cloud:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des intégrations d'applications
     * @param {object} ctx - Contexte Telegraf
     */
    async manageAppIntegrations(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Apps principales
                    Markup.button.callback('🛍️ Shopify', 'setup_shopify'),
                    Markup.button.callback('📊 Analytics', 'setup_analytics')
                ],
                [
                    // Réseaux sociaux
                    Markup.button.callback('📱 Instagram', 'setup_instagram'),
                    Markup.button.callback('🐦 Twitter', 'setup_twitter')
                ],
                [
                    // Gestion et test
                    Markup.button.callback('⚙️ Paramètres', 'app_settings'),
                    Markup.button.callback('🔄 Synchroniser', 'sync_apps')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_integrations')]
            ]);

            // Récupération des intégrations d'apps
            const appIntegrations = await Integration.find({ category: 'apps' });
            const stats = await this.getAppStats();

            // Construction du message
            let message = '📱 Intégrations Applications\n\n';

            // État des intégrations
            appIntegrations.forEach(app => {
                message += `${this.getAppEmoji(app.type)} ${app.name}:\n`;
                message += `État: ${app.active ? '✅' : '❌'}\n`;
                message += `Connexions: ${stats[app._id]?.connections || 0}/min\n`;
                message += `Erreurs: ${stats[app._id]?.errors || 0}\n\n`;
            });

            // Synchronisation
            if (stats.sync) {
                message += '🔄 Dernière synchronisation:\n';
                message += `Date: ${new Date(stats.sync.lastSync).toLocaleString()}\n`;
                message += `Durée: ${stats.sync.duration}s\n`;
                message += `Éléments: ${stats.sync.items}\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion apps:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji pour un service cloud
     * @private
     * @param {string} type - Type de service cloud
     * @returns {string} Emoji correspondant
     */
    getCloudEmoji(type) {
        const emojis = {
            'gdrive': '📦',
            'dropbox': '☁️',
            'aws': '🌐',
            'azure': '☁️',
            'gcloud': '☁️'
        };
        return emojis[type] || '☁️';
    }

    /**
     * Obtient l'emoji pour une application
     * @private
     * @param {string} type - Type d'application
     * @returns {string} Emoji correspondant
     */
    getAppEmoji(type) {
        const emojis = {
            'shopify': '🛍️',
            'analytics': '📊',
            'instagram': '📱',
            'twitter': '🐦',
            'facebook': '👥',
            'linkedin': '💼'
        };
        return emojis[type] || '📱';
    }
    /**
     * Gestion des intégrations de messagerie
     * Configure les connexions avec les services de messagerie
     * @param {object} ctx - Contexte Telegraf
     */
    async manageMessagingIntegrations(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Services de messagerie
                    Markup.button.callback('📧 Email', 'setup_email_service'),
                    Markup.button.callback('💬 SMS', 'setup_sms_service')
                ],
                [
                    // Chat et notifications
                    Markup.button.callback('💭 WhatsApp', 'setup_whatsapp'),
                    Markup.button.callback('🔔 Push', 'setup_push')
                ],
                [
                    // Configuration et tests
                    Markup.button.callback('⚙️ Config', 'messaging_settings'),
                    Markup.button.callback('📤 Tester', 'test_messaging')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_integrations')]
            ]);

            // Récupération des services de messagerie
            const messagingServices = await Integration.find({ category: 'messaging' });
            const stats = await this.getMessagingStats();

            // Construction du message
            let message = '💬 Intégrations Messagerie\n\n';

            // État des services
            messagingServices.forEach(service => {
                message += `${this.getMessagingEmoji(service.type)} ${service.name}:\n`;
                message += `État: ${service.active ? '✅' : '❌'}\n`;
                message += `Messages (24h): ${stats[service._id]?.messages || 0}\n`;
                message += `Taux de livraison: ${stats[service._id]?.deliveryRate || 0}%\n\n`;
            });

            // Statistiques globales
            message += '📊 Performance globale (24h):\n';
            message += `Messages envoyés: ${stats.totalMessages || 0}\n`;
            message += `Taux de succès: ${stats.successRate || 0}%\n`;
            message += `Temps moyen: ${stats.avgDeliveryTime || 0}ms\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion messagerie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des intégrations analytics
     * @param {object} ctx - Contexte Telegraf
     */
    async manageAnalyticsIntegrations(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Services analytics
                    Markup.button.callback('📊 Google Analytics', 'setup_ga'),
                    Markup.button.callback('📈 Mixpanel', 'setup_mixpanel')
                ],
                [
                    // Tracking et conversion
                    Markup.button.callback('🎯 Tracking', 'setup_tracking'),
                    Markup.button.callback('💹 Conversions', 'setup_conversions')
                ],
                [
                    // Rapports et données
                    Markup.button.callback('📋 Rapports', 'analytics_reports'),
                    Markup.button.callback('📤 Export', 'export_analytics')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_integrations')]
            ]);

            // Récupération des intégrations analytics
            const analyticsServices = await Integration.find({ category: 'analytics' });
            const stats = await this.getAnalyticsStats();

            // Construction du message
            let message = '📊 Intégrations Analytics\n\n';

            // État des services
            analyticsServices.forEach(service => {
                message += `${this.getAnalyticsEmoji(service.type)} ${service.name}:\n`;
                message += `État: ${service.active ? '✅' : '❌'}\n`;
                message += `Événements/min: ${stats[service._id]?.eventsPerMinute || 0}\n`;
                message += `Dernière sync: ${service.lastSync ?
                    new Date(service.lastSync).toLocaleString() : 'Jamais'}\n\n`;
            });

            // Métriques principales
            if (stats.metrics) {
                message += '📈 Métriques principales (24h):\n';
                message += `Utilisateurs: ${stats.metrics.users || 0}\n`;
                message += `Sessions: ${stats.metrics.sessions || 0}\n`;
                message += `Conversions: ${stats.metrics.conversions || 0}\n`;
                message += `Taux de conversion: ${stats.metrics.conversionRate || 0}%\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion analytics:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des intégrations marketing et CRM
     * @param {object} ctx - Contexte Telegraf
     */
    async manageMarketingIntegrations(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Marketing automation
                    Markup.button.callback('📧 Mailchimp', 'setup_mailchimp'),
                    Markup.button.callback('🎯 SendGrid', 'setup_sendgrid')
                ],
                [
                    // CRM
                    Markup.button.callback('👥 HubSpot', 'setup_hubspot'),
                    Markup.button.callback('💼 Salesforce', 'setup_salesforce')
                ],
                [
                    // Campagnes et audiences
                    Markup.button.callback('📢 Campagnes', 'manage_campaigns'),
                    Markup.button.callback('👥 Audiences', 'manage_audiences')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_integrations')]
            ]);

            // Récupération des intégrations marketing
            const marketingServices = await Integration.find({
                category: { $in: ['marketing', 'crm'] }
            });
            const stats = await this.getMarketingStats();

            // Construction du message
            let message = '📢 Marketing & CRM\n\n';

            // État des services
            marketingServices.forEach(service => {
                message += `${this.getMarketingEmoji(service.type)} ${service.name}:\n`;
                message += `État: ${service.active ? '✅' : '❌'}\n`;
                message += `Contacts: ${stats[service._id]?.contacts || 0}\n`;
                message += `Campagnes actives: ${stats[service._id]?.activeCampaigns || 0}\n\n`;
            });

            // Métriques marketing
            if (stats.marketing) {
                message += '📈 Performance marketing:\n';
                message += `Emails envoyés: ${stats.marketing.emailsSent}\n`;
                message += `Taux d'ouverture: ${stats.marketing.openRate}%\n`;
                message += `Taux de clic: ${stats.marketing.clickRate}%\n`;
                message += `Leads générés: ${stats.marketing.leads}\n\n`;
            }

            // Métriques CRM
            if (stats.crm) {
                message += '👥 Métriques CRM:\n';
                message += `Contacts totaux: ${stats.crm.totalContacts}\n`;
                message += `Opportunités: ${stats.crm.opportunities}\n`;
                message += `Taux de conversion: ${stats.crm.conversionRate}%\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion marketing:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Surveillance des intégrations
     * @param {object} ctx - Contexte Telegraf
     */
    async monitorIntegrations(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Surveillance et alertes
                    Markup.button.callback('👀 Surveillance', 'integration_monitoring'),
                    Markup.button.callback('⚠️ Alertes', 'integration_alerts')
                ],
                [
                    // Performance et santé
                    Markup.button.callback('📊 Performance', 'integration_performance'),
                    Markup.button.callback('💪 Santé', 'integration_health')
                ],
                [
                    // Logs et diagnostics
                    Markup.button.callback('📝 Logs', 'integration_logs'),
                    Markup.button.callback('🔍 Diagnostics', 'integration_diagnostics')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_integrations')]
            ]);

            // Récupération des métriques de surveillance
            const monitoring = await this.getMonitoringMetrics();

            // Construction du message
            let message = '🔍 Surveillance des Intégrations\n\n';

            // État général
            message += '📊 État général du système:\n';
            message += `Santé globale: ${monitoring.overallHealth}%\n`;
            message += `Services actifs: ${monitoring.activeServices}/${monitoring.totalServices}\n`;
            message += `Alertes actives: ${monitoring.activeAlerts}\n\n`;

            // Performances
            message += '⚡ Performances:\n';
            message += `Temps de réponse moyen: ${monitoring.avgResponseTime}ms\n`;
            message += `Utilisation API: ${monitoring.apiUsage}%\n`;
            message += `Taux d'erreur: ${monitoring.errorRate}%\n\n`;

            // Derniers incidents
            if (monitoring.recentIncidents.length > 0) {
                message += '⚠️ Derniers incidents:\n';
                monitoring.recentIncidents.forEach(incident => {
                    message += `- ${incident.service}: ${incident.message}\n`;
                    message += `  ${new Date(incident.timestamp).toLocaleString()}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur surveillance intégrations:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji pour un service de messagerie
     * @private
     * @param {string} type - Type de service de messagerie
     * @returns {string} Emoji correspondant
     */
    getMessagingEmoji(type) {
        const emojis = {
            'email': '📧',
            'sms': '💬',
            'whatsapp': '💭',
            'push': '🔔',
            'telegram': '📱',
            'messenger': '💬'
        };
        return emojis[type] || '💬';
    }

    /**
     * Obtient l'emoji pour un service analytics
     * @private
     * @param {string} type - Type de service analytics
     * @returns {string} Emoji correspondant
     */
    getAnalyticsEmoji(type) {
        const emojis = {
            'ga': '📊',
            'mixpanel': '📈',
            'amplitude': '📊',
            'segment': '🔄',
            'firebase': '🔥'
        };
        return emojis[type] || '📊';
    }

    /**
     * Obtient l'emoji pour un service marketing/CRM
     * @private
     * @param {string} type - Type de service marketing
     * @returns {string} Emoji correspondant
     */
    getMarketingEmoji(type) {
        const emojis = {
            'mailchimp': '📧',
            'sendgrid': '🎯',
            'hubspot': '👥',
            'salesforce': '💼',
            'marketo': '📢',
            'intercom': '💬'
        };
        return emojis[type] || '📢';
    }
    /**
     * Configuration principale de la messagerie
     * Gestion des paramètres de communication du bot
     * @param {object} ctx - Contexte Telegraf
     */
    async manageMessaging(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Messages et templates
                    Markup.button.callback('💬 Messages', 'manage_messages'),
                    Markup.button.callback('📋 Templates', 'manage_templates')
                ],
                [
                    // Diffusion et planification
                    Markup.button.callback('📢 Diffusion', 'manage_broadcasts'),
                    Markup.button.callback('⏰ Planning', 'message_scheduling')
                ],
                [
                    // Réponses et filtres
                    Markup.button.callback('↩️ Réponses Auto', 'auto_responses'),
                    Markup.button.callback('🔍 Filtres', 'message_filters')
                ],
                [
                    // Statistiques et paramètres
                    Markup.button.callback('📊 Stats', 'message_stats'),
                    Markup.button.callback('⚙️ Paramètres', 'message_settings')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération des statistiques de messagerie
            const stats = await this.getMessagingStats();

            // Construction du message
            let message = '💬 Configuration de la Messagerie\n\n';

            // Statistiques générales
            message += '📊 Vue d\'ensemble (24h):\n';
            message += `Messages envoyés: ${stats.messagesSent}\n`;
            message += `Messages reçus: ${stats.messagesReceived}\n`;
            message += `Temps réponse moyen: ${stats.avgResponseTime}s\n`;
            message += `Taux d'engagement: ${stats.engagementRate}%\n\n`;

            // État des fonctionnalités
            const config = await Config.findOne() || {};
            const messagingConfig = config.messaging || {};

            message += '⚙️ État des fonctionnalités:\n';
            message += `Réponses auto: ${messagingConfig.autoResponses ? '✅' : '❌'}\n`;
            message += `Filtres spam: ${messagingConfig.spamFilters ? '✅' : '❌'}\n`;
            message += `File d'attente: ${messagingConfig.messageQueue ? '✅' : '❌'}\n`;
            message += `Limite/user: ${messagingConfig.rateLimit || 'Aucune'}/min\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration messagerie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des templates de messages
     * @param {object} ctx - Contexte Telegraf
     */
    async manageTemplates(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions principales
                    Markup.button.callback('➕ Nouveau', 'create_template'),
                    Markup.button.callback('📝 Modifier', 'edit_template')
                ],
                [
                    // Organisation
                    Markup.button.callback('📁 Catégories', 'template_categories'),
                    Markup.button.callback('🔍 Rechercher', 'search_templates')
                ],
                [
                    // Tests et variables
                    Markup.button.callback('🔄 Tester', 'test_template'),
                    Markup.button.callback('📋 Variables', 'template_variables')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_messaging')]
            ]);

            // Récupération des templates
            const templates = await MessageTemplate.find()
                .sort({ category: 1, name: 1 })
                .limit(10);

            // Construction du message
            let message = '📋 Templates de Messages\n\n';

            // Groupement par catégorie
            const byCategory = {};
            templates.forEach(template => {
                if (!byCategory[template.category]) {
                    byCategory[template.category] = [];
                }
                byCategory[template.category].push(template);
            });

            // Affichage des templates par catégorie
            Object.entries(byCategory).forEach(([category, categoryTemplates]) => {
                message += `📁 ${category || 'Sans catégorie'}:\n\n`;
                categoryTemplates.forEach(template => {
                    message += `📝 ${template.name}\n`;
                    message += `Usage: ${template.usageCount || 0} fois\n`;
                    message += `Variables: ${template.variables.length}\n\n`;
                });
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion templates:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des diffusions de messages
     * @param {object} ctx - Contexte Telegraf
     */
    async manageBroadcasts(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Nouvelle diffusion
                    Markup.button.callback('📢 Nouvelle', 'new_broadcast'),
                    Markup.button.callback('📋 Historique', 'broadcast_history')
                ],
                [
                    // Audiences et planification
                    Markup.button.callback('👥 Audiences', 'broadcast_audiences'),
                    Markup.button.callback('⏰ Planifier', 'schedule_broadcast')
                ],
                [
                    // Analyse et modèles
                    Markup.button.callback('📊 Analytics', 'broadcast_analytics'),
                    Markup.button.callback('💾 Modèles', 'broadcast_templates')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_messaging')]
            ]);

            // Récupération des diffusions récentes
            const broadcasts = await Broadcast.find()
                .sort({ scheduledFor: -1 })
                .limit(5);

            // Stats des diffusions
            const stats = await this.getBroadcastStats();

            // Construction du message
            let message = '📢 Diffusion de Messages\n\n';

            // Diffusions à venir
            const upcomingBroadcasts = broadcasts.filter(b =>
                b.scheduledFor && b.scheduledFor > new Date()
            );

            if (upcomingBroadcasts.length > 0) {
                message += '📅 Diffusions planifiées:\n\n';
                upcomingBroadcasts.forEach(broadcast => {
                    message += `📢 ${broadcast.name}\n`;
                    message += `⏰ ${new Date(broadcast.scheduledFor).toLocaleString()}\n`;
                    message += `👥 Audience: ${broadcast.audienceSize} utilisateurs\n\n`;
                });
            }

            // Statistiques
            message += '📊 Statistiques (30j):\n';
            message += `Diffusions envoyées: ${stats.totalBroadcasts}\n`;
            message += `Messages délivrés: ${stats.deliveredMessages}\n`;
            message += `Taux d'ouverture: ${stats.openRate}%\n`;
            message += `Taux de clic: ${stats.clickRate}%\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion diffusions:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration des réponses automatiques
     * @param {object} ctx - Contexte Telegraf
     */
    async manageAutoResponses(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des règles
                    Markup.button.callback('➕ Nouvelle règle', 'new_auto_response'),
                    Markup.button.callback('📝 Modifier', 'edit_auto_response')
                ],
                [
                    // Configuration et tests
                    Markup.button.callback('⚙️ Config', 'auto_response_settings'),
                    Markup.button.callback('🔄 Tester', 'test_auto_response')
                ],
                [
                    // Analyse et historique
                    Markup.button.callback('📊 Analytics', 'auto_response_stats'),
                    Markup.button.callback('📋 Historique', 'auto_response_history')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_messaging')]
            ]);

            // Récupération des règles
            const rules = await AutoResponse.find({ active: true });
            const stats = await this.getAutoResponseStats();

            // Construction du message
            let message = '↩️ Réponses Automatiques\n\n';

            // Liste des règles actives
            message += '📋 Règles actives:\n\n';
            rules.forEach(rule => {
                message += `🔹 ${rule.name}\n`;
                message += `Déclencheur: ${rule.trigger}\n`;
                message += `Priorité: ${rule.priority}\n`;
                message += `Utilisations: ${stats[rule._id]?.uses || 0}\n\n`;
            });

            // Statistiques globales
            message += '📊 Performance (24h):\n';
            message += `Messages traités: ${stats.processedMessages}\n`;
            message += `Réponses envoyées: ${stats.sentResponses}\n`;
            message += `Temps moyen: ${stats.avgResponseTime}ms\n`;
            message += `Précision: ${stats.accuracy}%\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion réponses auto:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    /**
     * Configuration des filtres et modération
     * Gestion des règles de filtrage et modération des messages
     * @param {object} ctx - Contexte Telegraf
     */
    async manageMessageFilters(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Filtres principaux
                    Markup.button.callback('🚫 Spam', 'spam_filters'),
                    Markup.button.callback('🔍 Contenu', 'content_filters')
                ],
                [
                    // Règles et mots-clés
                    Markup.button.callback('📝 Règles', 'filter_rules'),
                    Markup.button.callback('🔤 Mots-clés', 'keyword_filters')
                ],
                [
                    // Actions et journaux
                    Markup.button.callback('⚡ Actions', 'filter_actions'),
                    Markup.button.callback('📋 Logs', 'filter_logs')
                ],
                [
                    // Quarantaine et statistiques
                    Markup.button.callback('⚠️ Quarantaine', 'message_quarantine'),
                    Markup.button.callback('📊 Stats', 'filter_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_messaging')]
            ]);

            // Récupération des statistiques de filtrage
            const stats = await this.getFilterStats();
            const filters = await MessageFilter.find({ active: true });

            // Construction du message
            let message = '🔍 Filtres et Modération\n\n';

            // État des filtres
            message += '📋 Filtres actifs:\n';
            filters.forEach(filter => {
                message += `${this.getFilterEmoji(filter.type)} ${filter.name}: `;
                message += `${filter.active ? '✅' : '❌'}\n`;
                message += `- Actions: ${filter.actions.join(', ')}\n`;
                message += `- Détections (24h): ${stats[filter._id]?.matches || 0}\n\n`;
            });

            // Statistiques globales
            message += '📊 Statistiques (24h):\n';
            message += `Messages analysés: ${stats.analyzedMessages}\n`;
            message += `Messages filtrés: ${stats.filteredMessages}\n`;
            message += `Taux de filtrage: ${stats.filterRate}%\n`;
            message += `Faux positifs: ${stats.falsePositives}%\n\n`;

            // Messages en quarantaine
            message += '⚠️ Quarantaine:\n';
            message += `Messages en attente: ${stats.quarantineCount}\n`;
            message += `Temps moyen révision: ${stats.avgReviewTime}min\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion filtres:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion de la file d'attente des messages
     * @param {object} ctx - Contexte Telegraf
     */
    async manageMessageQueue(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion de la file
                    Markup.button.callback('👁️ Voir file', 'view_queue'),
                    Markup.button.callback('🔄 Actualiser', 'refresh_queue')
                ],
                [
                    // Actions sur la file
                    Markup.button.callback('⏸️ Pause', 'pause_queue'),
                    Markup.button.callback('▶️ Reprendre', 'resume_queue')
                ],
                [
                    // Configuration
                    Markup.button.callback('⚙️ Paramètres', 'queue_settings'),
                    Markup.button.callback('📊 Performance', 'queue_performance')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_messaging')]
            ]);

            // Récupération des statistiques de la file
            const queueStats = await this.getQueueStats();
            const queueConfig = await Config.findOne().select('messageQueue');

            // Construction du message
            let message = '📨 File d\'Attente Messages\n\n';

            // État actuel
            message += '📊 État actuel:\n';
            message += `État: ${queueStats.active ? '✅ Active' : '⏸️ Pause'}\n`;
            message += `Messages en attente: ${queueStats.pendingMessages}\n`;
            message += `Traitement/min: ${queueStats.processRate}/min\n`;
            message += `Temps moyen: ${queueStats.avgProcessTime}ms\n\n`;

            // Configuration
            message += '⚙️ Configuration:\n';
            message += `Taille max: ${queueConfig.maxSize || 'Illimitée'}\n`;
            message += `Timeout: ${queueConfig.timeout || '30'}s\n`;
            message += `Priorités: ${queueConfig.priorityLevels || '3'} niveaux\n`;
            message += `Retry auto: ${queueConfig.autoRetry ? '✅' : '❌'}\n\n`;

            // Performance
            if (queueStats.performance) {
                message += '📈 Performance (1h):\n';
                message += `Messages traités: ${queueStats.performance.processed}\n`;
                message += `Erreurs: ${queueStats.performance.errors}\n`;
                message += `Utilisation mémoire: ${queueStats.performance.memoryUsage}MB\n`;
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion file attente:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Rapports et analyses de communication
     * @param {object} ctx - Contexte Telegraf
     */
    async messagingAnalytics(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Types de rapports
                    Markup.button.callback('📊 Général', 'general_report'),
                    Markup.button.callback('👥 Utilisateurs', 'user_report')
                ],
                [
                    // Analyses spécifiques
                    Markup.button.callback('⏱️ Performance', 'performance_report'),
                    Markup.button.callback('🎯 Engagement', 'engagement_report')
                ],
                [
                    // Export et planification
                    Markup.button.callback('📤 Exporter', 'export_reports'),
                    Markup.button.callback('⏰ Planifier', 'schedule_reports')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_messaging')]
            ]);

            // Récupération des statistiques
            const analytics = await this.getMessagingAnalytics();

            // Construction du message
            let message = '📊 Analyses Communication\n\n';

            // Vue d'ensemble
            message += '📈 Vue d\'ensemble (30j):\n';
            message += `Messages totaux: ${analytics.totalMessages}\n`;
            message += `Utilisateurs actifs: ${analytics.activeUsers}\n`;
            message += `Temps réponse moyen: ${analytics.avgResponseTime}s\n`;
            message += `Taux satisfaction: ${analytics.satisfactionRate}%\n\n`;

            // Engagement
            message += '🎯 Engagement:\n';
            message += `Taux réponse: ${analytics.responseRate}%\n`;
            message += `Messages/utilisateur: ${analytics.messagesPerUser}\n`;
            message += `Sessions/jour: ${analytics.dailySessions}\n\n`;

            // Performance
            message += '⚡ Performance:\n';
            message += `Disponibilité: ${analytics.uptime}%\n`;
            message += `Erreurs: ${analytics.errorRate}%\n`;
            message += `Utilisation CPU: ${analytics.cpuUsage}%\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur analytics messagerie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Optimisation des performances de messagerie
     * @param {object} ctx - Contexte Telegraf
     */
    async optimizeMessaging(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Performance
                    Markup.button.callback('🚀 Cache', 'optimize_cache'),
                    Markup.button.callback('⚡ Rate Limits', 'optimize_rate_limits')
                ],
                [
                    // Optimisations
                    Markup.button.callback('🗄️ Base données', 'optimize_database'),
                    Markup.button.callback('🔄 Requêtes', 'optimize_queries')
                ],
                [
                    // Maintenance
                    Markup.button.callback('🧹 Nettoyage', 'cleanup_messages'),
                    Markup.button.callback('📊 Monitoring', 'performance_monitoring')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_messaging')]
            ]);

            // Récupération des métriques de performance
            const metrics = await this.getPerformanceMetrics();

            // Construction du message
            let message = '⚡ Optimisation Messagerie\n\n';

            // Métriques actuelles
            message += '📊 Métriques actuelles:\n';
            message += `CPU: ${metrics.cpu}%\n`;
            message += `Mémoire: ${metrics.memory}MB\n`;
            message += `Cache hits: ${metrics.cacheHitRate}%\n`;
            message += `Latence moyenne: ${metrics.avgLatency}ms\n\n`;

            // Optimisations possibles
            message += '🔧 Optimisations suggérées:\n';
            metrics.suggestions.forEach(suggestion => {
                message += `- ${suggestion}\n`;
            });
            message += '\n';

            // État du cache
            message += '💾 État du cache:\n';
            message += `Taille: ${metrics.cacheSize}MB\n`;
            message += `Items: ${metrics.cachedItems}\n`;
            message += `Expiration moyenne: ${metrics.avgCacheLifetime}min\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur optimisation messagerie:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji pour un type de filtre
     * @private
     * @param {string} type - Type de filtre
     * @returns {string} Emoji correspondant
     */
    getFilterEmoji(type) {
        const emojis = {
            'spam': '🚫',
            'content': '🔍',
            'keyword': '🔤',
            'pattern': '📝',
            'language': '🌐',
            'media': '🖼️'
        };
        return emojis[type] || '📋';
    }
    /**
     * Gestion principale du contenu et des médias
     * Interface de gestion des contenus multimédia
     * @param {object} ctx - Contexte Telegraf
     */
    async manageContent(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Médias et fichiers
                    Markup.button.callback('🖼️ Médias', 'manage_media'),
                    Markup.button.callback('📁 Fichiers', 'manage_files')
                ],
                [
                    // Organisation et bibliothèque
                    Markup.button.callback('📚 Bibliothèque', 'content_library'),
                    Markup.button.callback('🏷️ Tags', 'manage_tags')
                ],
                [
                    // Stockage et optimisation
                    Markup.button.callback('💾 Stockage', 'storage_settings'),
                    Markup.button.callback('⚡ Optimisation', 'optimize_media')
                ],
                [
                    // Statistiques et recherche
                    Markup.button.callback('📊 Stats', 'content_stats'),
                    Markup.button.callback('🔍 Rechercher', 'search_content')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération des statistiques
            const stats = await this.getContentStats();

            // Construction du message
            let message = '📚 Gestion du Contenu\n\n';

            // Vue d'ensemble
            message += '📊 Vue d\'ensemble:\n';
            message += `Total fichiers: ${stats.totalFiles}\n`;
            message += `Espace utilisé: ${this.formatSize(stats.usedSpace)}\n`;
            message += `Taux compression: ${stats.compressionRate}%\n\n`;

            // Par type de contenu
            message += '📋 Par type:\n';
            Object.entries(stats.byType).forEach(([type, count]) => {
                message += `${this.getContentEmoji(type)} ${type}: ${count}\n`;
            });
            message += '\n';

            // Activité récente
            message += '🔄 Activité récente (24h):\n';
            message += `Uploads: ${stats.recentActivity.uploads}\n`;
            message += `Downloads: ${stats.recentActivity.downloads}\n`;
            message += `Suppressions: ${stats.recentActivity.deletions}\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion contenu:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion de la bibliothèque média
     * @param {object} ctx - Contexte Telegraf
     */
    async manageMediaLibrary(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions principales
                    Markup.button.callback('⬆️ Upload', 'upload_media'),
                    Markup.button.callback('📋 Galerie', 'view_gallery')
                ],
                [
                    // Organisation
                    Markup.button.callback('📁 Albums', 'manage_albums'),
                    Markup.button.callback('🏷️ Tags', 'manage_media_tags')
                ],
                [
                    // Édition et outils
                    Markup.button.callback('✏️ Éditer', 'edit_media'),
                    Markup.button.callback('🛠️ Outils', 'media_tools')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_content')]
            ]);

            // Récupération des médias récents
            const recentMedia = await Media.find()
                .sort({ uploadedAt: -1 })
                .limit(5);
            const stats = await this.getMediaStats();

            // Construction du message
            let message = '🖼️ Bibliothèque Média\n\n';

            // Statistiques
            message += '📊 Statistiques:\n';
            message += `Total médias: ${stats.totalMedia}\n`;
            message += `Albums: ${stats.albums}\n`;
            message += `Tags uniques: ${stats.uniqueTags}\n\n`;

            // Médias récents
            message += '📝 Derniers uploads:\n';
            recentMedia.forEach(media => {
                message += `${this.getMediaEmoji(media.type)} ${media.name}\n`;
                message += `📅 ${new Date(media.uploadedAt).toLocaleString()}\n`;
                message += `📊 Taille: ${this.formatSize(media.size)}\n\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion bibliothèque:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration du stockage des contenus
     * @param {object} ctx - Contexte Telegraf
     */
    async manageStorageSettings(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Configuration stockage
                    Markup.button.callback('⚙️ Config', 'configure_storage'),
                    Markup.button.callback('🔄 Migration', 'migrate_storage')
                ],
                [
                    // Nettoyage et maintenance
                    Markup.button.callback('🧹 Nettoyage', 'cleanup_storage'),
                    Markup.button.callback('🔍 Analyse', 'analyze_storage')
                ],
                [
                    // Backup et quotas
                    Markup.button.callback('💾 Backup', 'backup_content'),
                    Markup.button.callback('📊 Quotas', 'manage_quotas')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_content')]
            ]);

            // Récupération configuration stockage
            const storageConfig = await this.getStorageConfig();
            const stats = await this.getStorageStats();

            // Construction du message
            let message = '💾 Configuration Stockage\n\n';

            // État actuel
            message += '📊 État actuel:\n';
            message += `Provider: ${storageConfig.provider}\n`;
            message += `Espace total: ${this.formatSize(stats.totalSpace)}\n`;
            message += `Espace utilisé: ${this.formatSize(stats.usedSpace)}\n`;
            message += `Espace libre: ${this.formatSize(stats.freeSpace)}\n\n`;

            // Configuration
            message += '⚙️ Configuration:\n';
            message += `Compression: ${storageConfig.compression ? '✅' : '❌'}\n`;
            message += `Cache: ${storageConfig.cache ? '✅' : '❌'}\n`;
            message += `Durée cache: ${storageConfig.cacheDuration}min\n`;
            message += `Limite upload: ${this.formatSize(storageConfig.uploadLimit)}\n\n`;

            // Quotas
            if (storageConfig.quotas) {
                message += '📊 Quotas:\n';
                Object.entries(storageConfig.quotas).forEach(([type, limit]) => {
                    message += `${this.getContentEmoji(type)}: ${this.formatSize(limit)}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur config stockage:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Optimisation des médias
     * @param {object} ctx - Contexte Telegraf
     */
    async optimizeMedia(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions d'optimisation
                    Markup.button.callback('🗜️ Compression', 'compress_media'),
                    Markup.button.callback('🖼️ Redimensionner', 'resize_media')
                ],
                [
                    // Qualité et formats
                    Markup.button.callback('✨ Qualité', 'quality_settings'),
                    Markup.button.callback('🔄 Formats', 'convert_formats')
                ],
                [
                    // Traitement par lot
                    Markup.button.callback('📦 Lot', 'batch_optimize'),
                    Markup.button.callback('📊 Rapport', 'optimization_report')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_content')]
            ]);

            // Récupération des métriques d'optimisation
            const metrics = await this.getOptimizationMetrics();

            // Construction du message
            let message = '⚡ Optimisation des Médias\n\n';

            // Métriques globales
            message += '📊 Métriques globales:\n';
            message += `Espace économisé: ${this.formatSize(metrics.savedSpace)}\n`;
            message += `Taux moyen: ${metrics.avgCompressionRate}%\n`;
            message += `Qualité moyenne: ${metrics.avgQuality}%\n\n`;

            // Par type de média
            message += '📋 Par type:\n';
            Object.entries(metrics.byType).forEach(([type, stats]) => {
                message += `${this.getContentEmoji(type)}:\n`;
                message += `- Compression: ${stats.compressionRate}%\n`;
                message += `- Gain: ${this.formatSize(stats.savedSpace)}\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur optimisation média:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji pour un type de contenu
     * @private
     * @param {string} type - Type de contenu
     * @returns {string} Emoji correspondant
     */
    getContentEmoji(type) {
        const emojis = {
            'image': '🖼️',
            'video': '🎥',
            'audio': '🔊',
            'document': '📄',
            'archive': '📦',
            'other': '📎'
        };
        return emojis[type] || '📎';
    }

    /**
     * Obtient l'emoji pour un type de média
     * @private
     * @param {string} type - Type de média
     * @returns {string} Emoji correspondant
     */
    getMediaEmoji(type) {
        const emojis = {
            'photo': '📸',
            'video': '🎬',
            'animation': '🎭',
            'sticker': '🎨',
            'voice': '🎤',
            'audio': '🎵'
        };
        return emojis[type] || '📷';
    }
    /**
     * Gestion des formats et conversions de médias
     * @param {object} ctx - Contexte Telegraf
     */
    async manageMediaFormats(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Formats et conversion
                    Markup.button.callback('➕ Nouveau format', 'add_format'),
                    Markup.button.callback('🔄 Convertir', 'convert_media')
                ],
                [
                    // Règles et profils
                    Markup.button.callback('📋 Règles', 'format_rules'),
                    Markup.button.callback('👤 Profils', 'format_profiles')
                ],
                [
                    // Traitement par lot
                    Markup.button.callback('📦 Batch', 'batch_convert'),
                    Markup.button.callback('⚙️ Config', 'conversion_settings')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_content')]
            ]);

            // Récupération des formats configurés
            const formats = await MediaFormat.find();
            const stats = await this.getFormatStats();

            // Construction du message
            let message = '🔄 Formats et Conversions\n\n';

            // Liste des formats
            message += '📋 Formats configurés:\n';
            formats.forEach(format => {
                message += `${this.getFormatEmoji(format.type)} ${format.name}:\n`;
                message += `- Extensions: ${format.extensions.join(', ')}\n`;
                message += `- Qualité: ${format.quality}%\n`;
                message += `- Utilisé: ${stats[format._id]?.usageCount || 0} fois\n\n`;
            });

            // Statistiques de conversion
            message += '📊 Statistiques (24h):\n';
            message += `Conversions: ${stats.totalConversions}\n`;
            message += `Réussies: ${stats.successfulConversions}\n`;
            message += `Temps moyen: ${stats.avgConversionTime}s\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion formats:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Système de classification automatique des médias
     * @param {object} ctx - Contexte Telegraf
     */
    async manageAutoClassification(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Modèles et règles
                    Markup.button.callback('🤖 Modèles IA', 'ai_models'),
                    Markup.button.callback('📋 Règles', 'classification_rules')
                ],
                [
                    // Classification et tags
                    Markup.button.callback('🏷️ Auto-tags', 'auto_tagging'),
                    Markup.button.callback('📁 Catégories', 'auto_categories')
                ],
                [
                    // Entraînement et analyse
                    Markup.button.callback('📚 Entraîner', 'train_classifier'),
                    Markup.button.callback('📊 Analyse', 'analyze_results')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_content')]
            ]);

            // Récupération des statistiques de classification
            const stats = await this.getClassificationStats();

            // Construction du message
            let message = '🤖 Classification Automatique\n\n';

            // État du système
            message += '📊 Performance système:\n';
            message += `Précision: ${stats.accuracy}%\n`;
            message += `Confiance moyenne: ${stats.avgConfidence}%\n`;
            message += `Temps moyen: ${stats.avgProcessingTime}ms\n\n`;

            // Par catégorie
            message += '📋 Par catégorie:\n';
            Object.entries(stats.byCategory).forEach(([category, data]) => {
                message += `${this.getCategoryEmoji(category)}:\n`;
                message += `- Précision: ${data.accuracy}%\n`;
                message += `- Items: ${data.itemCount}\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur classification auto:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des droits et accès aux médias
     * @param {object} ctx - Contexte Telegraf
     */
    async manageMediaPermissions(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des droits
                    Markup.button.callback('👥 Rôles', 'media_roles'),
                    Markup.button.callback('🔐 Permissions', 'media_permissions')
                ],
                [
                    // Accès et restrictions
                    Markup.button.callback('🔒 Restrictions', 'media_restrictions'),
                    Markup.button.callback('👁️ Visibilité', 'media_visibility')
                ],
                [
                    // Audit et contrôle
                    Markup.button.callback('📋 Audit', 'media_audit'),
                    Markup.button.callback('📊 Rapports', 'permission_reports')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_content')]
            ]);

            // Récupération des configurations de droits
            const permissions = await MediaPermission.find();
            const stats = await this.getPermissionStats();

            // Construction du message
            let message = '🔐 Droits et Accès\n\n';

            // Vue d'ensemble
            message += '📊 Vue d\'ensemble:\n';
            message += `Rôles définis: ${permissions.length}\n`;
            message += `Utilisateurs affectés: ${stats.totalUsers}\n`;
            message += `Règles actives: ${stats.activeRules}\n\n`;

            // Par rôle
            message += '👥 Par rôle:\n';
            permissions.forEach(perm => {
                message += `${perm.name}:\n`;
                message += `- Utilisateurs: ${stats.byRole[perm._id]?.users || 0}\n`;
                message += `- Accès: ${perm.permissions.join(', ')}\n\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion permissions:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Outils de traitement d'image avancés
     * @param {object} ctx - Contexte Telegraf
     */
    async manageImageTools(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Outils de base
                    Markup.button.callback('✂️ Recadrer', 'crop_image'),
                    Markup.button.callback('🎨 Filtres', 'image_filters')
                ],
                [
                    // Ajustements
                    Markup.button.callback('💡 Ajustements', 'image_adjustments'),
                    Markup.button.callback('🎯 Effets', 'image_effects')
                ],
                [
                    // Traitement avancé
                    Markup.button.callback('🔍 OCR', 'image_ocr'),
                    Markup.button.callback('🎭 IA', 'ai_processing')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_content')]
            ]);

            // Récupération des statistiques d'utilisation
            const stats = await this.getImageToolsStats();

            // Construction du message
            let message = '🎨 Outils Image\n\n';

            // Outils disponibles
            message += '🛠️ Outils disponibles:\n';
            message += '✂️ Recadrage et redimensionnement\n';
            message += '🎨 Filtres et effets\n';
            message += '💡 Ajustements de couleur et luminosité\n';
            message += '🔍 Reconnaissance de texte (OCR)\n';
            message += '🎭 Traitement IA\n\n';

            // Statistiques d'utilisation
            message += '📊 Utilisation (24h):\n';
            Object.entries(stats.toolUsage).forEach(([tool, count]) => {
                message += `${this.getToolEmoji(tool)}: ${count} utilisations\n`;
            });

            // Performance
            message += '\n⚡ Performance:\n';
            message += `Temps moyen: ${stats.avgProcessingTime}ms\n`;
            message += `Précision OCR: ${stats.ocrAccuracy}%\n`;
            message += `Qualité moyenne: ${stats.avgQuality}%\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur outils image:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji pour un type de format
     * @private
     * @param {string} type - Type de format
     * @returns {string} Emoji correspondant
     */
    getFormatEmoji(type) {
        const emojis = {
            'image': '🖼️',
            'video': '🎬',
            'audio': '🎵',
            'document': '📄',
            'archive': '📦'
        };
        return emojis[type] || '📎';
    }

    /**
     * Obtient l'emoji pour une catégorie
     * @private
     * @param {string} category - Catégorie
     * @returns {string} Emoji correspondant
     */
    getCategoryEmoji(category) {
        const emojis = {
            'people': '👥',
            'nature': '🌳',
            'objects': '📦',
            'places': '🏠',
            'symbols': '🔣',
            'other': '📎'
        };
        return emojis[category] || '📎';
    }

    /**
     * Obtient l'emoji pour un outil
     * @private
     * @param {string} tool - Nom de l'outil
     * @returns {string} Emoji correspondant
     */
    getToolEmoji(tool) {
        const emojis = {
            'crop': '✂️',
            'filter': '🎨',
            'adjust': '💡',
            'effect': '🎯',
            'ocr': '🔍',
            'ai': '🎭'
        };
        return emojis[tool] || '🛠️';
    }
    /**
     * Gestion principale de la maintenance système
     * Interface de maintenance et d'optimisation du bot
     * @param {object} ctx - Contexte Telegraf
     */
    async manageSystemMaintenance(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Performance et santé
                    Markup.button.callback('📊 Performance', 'system_performance'),
                    Markup.button.callback('💪 Santé', 'system_health')
                ],
                [
                    // Backup et maintenance
                    Markup.button.callback('💾 Backup', 'system_backup'),
                    Markup.button.callback('🔧 Maintenance', 'system_maintenance')
                ],
                [
                    // Logs et monitoring
                    Markup.button.callback('📝 Logs', 'system_logs'),
                    Markup.button.callback('📈 Monitoring', 'system_monitoring')
                ],
                [
                    // Nettoyage et mise à jour
                    Markup.button.callback('🧹 Nettoyage', 'system_cleanup'),
                    Markup.button.callback('🔄 Updates', 'system_updates')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération des métriques système
            const metrics = await this.getSystemMetrics();

            // Construction du message
            let message = '🔧 Maintenance Système\n\n';

            // État général
            message += '📊 État du Système:\n';
            message += `CPU: ${metrics.cpu}%\n`;
            message += `RAM: ${metrics.memory}%\n`;
            message += `Charge: ${metrics.load.join(', ')}\n`;
            message += `Uptime: ${this.formatUptime(metrics.uptime)}\n\n`;

            // Santé des services
            message += '🚦 Santé des Services:\n';
            Object.entries(metrics.services).forEach(([service, status]) => {
                message += `${this.getServiceEmoji(status)} ${service}\n`;
            });
            message += '\n';

            // Alertes système
            if (metrics.alerts.length > 0) {
                message += '⚠️ Alertes actives:\n';
                metrics.alerts.forEach(alert => {
                    message += `- ${alert.severity}: ${alert.message}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur maintenance système:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des performances système
     * @param {object} ctx - Contexte Telegraf
     */
    async manageSystemPerformance(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Optimisation et analyse
                    Markup.button.callback('⚡ Optimiser', 'optimize_system'),
                    Markup.button.callback('📊 Analyser', 'analyze_performance')
                ],
                [
                    // Cache et base de données
                    Markup.button.callback('🗄️ Cache', 'manage_cache'),
                    Markup.button.callback('🔍 DB', 'optimize_database')
                ],
                [
                    // Tests et limites
                    Markup.button.callback('🧪 Tests', 'performance_tests'),
                    Markup.button.callback('⚙️ Limites', 'resource_limits')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_system_maintenance')]
            ]);

            // Récupération des métriques de performance
            const metrics = await this.getPerformanceMetrics();

            // Construction du message
            let message = '⚡ Performance Système\n\n';

            // Métriques temps réel
            message += '📊 Temps réel:\n';
            message += `Requêtes/sec: ${metrics.requestRate}\n`;
            message += `Temps réponse: ${metrics.responseTime}ms\n`;
            message += `Queue: ${metrics.queueSize} tâches\n\n`;

            // Utilisation ressources
            message += '💻 Ressources:\n';
            message += `CPU: ${metrics.cpu}%\n`;
            message += `RAM: ${this.formatSize(metrics.memoryUsed)} / ${this.formatSize(metrics.memoryTotal)}\n`;
            message += `Swap: ${metrics.swapUsage}%\n`;
            message += `Disque: ${metrics.diskUsage}%\n\n`;

            // Performance cache
            message += '🗄️ Cache:\n';
            message += `Hit rate: ${metrics.cacheHitRate}%\n`;
            message += `Taille: ${this.formatSize(metrics.cacheSize)}\n`;
            message += `Items: ${metrics.cacheItems}\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion performance:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration des sauvegardes système
     * @param {object} ctx - Contexte Telegraf
     */
    async manageSystemBackup(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions de sauvegarde
                    Markup.button.callback('📦 Backup', 'create_backup'),
                    Markup.button.callback('📥 Restaurer', 'restore_backup')
                ],
                [
                    // Configuration
                    Markup.button.callback('⚙️ Config', 'backup_settings'),
                    Markup.button.callback('📋 Liste', 'list_backups')
                ],
                [
                    // Planning et stockage
                    Markup.button.callback('⏰ Planning', 'schedule_backups'),
                    Markup.button.callback('💾 Stockage', 'backup_storage')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_system_maintenance')]
            ]);

            // Récupération configuration backup
            const config = await this.getBackupConfig();
            const stats = await this.getBackupStats();

            // Construction du message
            let message = '💾 Sauvegardes Système\n\n';

            // Configuration actuelle
            message += '⚙️ Configuration:\n';
            message += `Fréquence: ${config.frequency}\n`;
            message += `Rétention: ${config.retention} jours\n`;
            message += `Compression: ${config.compression ? '✅' : '❌'}\n`;
            message += `Stockage: ${config.storage}\n\n`;

            // Statistiques
            message += '📊 Statistiques:\n';
            message += `Dernière backup: ${stats.lastBackup ?
                new Date(stats.lastBackup).toLocaleString() : 'Jamais'}\n`;
            message += `Taille totale: ${this.formatSize(stats.totalSize)}\n`;
            message += `Backups stockées: ${stats.storedBackups}\n\n`;

            // État des backups
            message += '📋 État des backups:\n';
            message += `Réussies: ${stats.successRate}%\n`;
            message += `Complètes: ${stats.completeBackups}\n`;
            message += `En erreur: ${stats.failedBackups}\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion backup:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Nettoyage et optimisation du système
     * @param {object} ctx - Contexte Telegraf
     */
    async manageSystemCleanup(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions de nettoyage
                    Markup.button.callback('🗑️ Cache', 'clear_cache'),
                    Markup.button.callback('🧹 Temp', 'clear_temp')
                ],
                [
                    // Optimisation
                    Markup.button.callback('🗄️ DB', 'optimize_db'),
                    Markup.button.callback('📁 Fichiers', 'cleanup_files')
                ],
                [
                    // Analyse et rapports
                    Markup.button.callback('🔍 Analyse', 'analyze_cleanup'),
                    Markup.button.callback('📊 Rapport', 'cleanup_report')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_system_maintenance')]
            ]);

            // Récupération des statistiques de nettoyage
            const stats = await this.getCleanupStats();

            // Construction du message
            let message = '🧹 Nettoyage Système\n\n';

            // Espace récupérable
            message += '💾 Espace récupérable:\n';
            message += `Cache: ${this.formatSize(stats.cacheSize)}\n`;
            message += `Temp: ${this.formatSize(stats.tempSize)}\n`;
            message += `Logs: ${this.formatSize(stats.logsSize)}\n`;
            message += `DB: ${this.formatSize(stats.dbSize)}\n\n`;

            // Derniers nettoyages
            message += '📋 Derniers nettoyages:\n';
            stats.recentCleanups.forEach(cleanup => {
                message += `${cleanup.type}: ${this.formatSize(cleanup.freed)} libérés\n`;
                message += `📅 ${new Date(cleanup.date).toLocaleString()}\n\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur nettoyage système:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji pour l'état d'un service
     * @private
     * @param {string} status - État du service
     * @returns {string} Emoji correspondant
     */
    getServiceEmoji(status) {
        const emojis = {
            'ok': '🟢',
            'warning': '🟡',
            'error': '🔴',
            'unknown': '⚪'
        };
        return emojis[status] || '⚪';
    }

    /**
     * Formate une durée d'uptime
     * @private
     * @param {number} seconds - Durée en secondes
     * @returns {string} Durée formatée
     */
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        const parts = [];
        if (days > 0) parts.push(`${days}j`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);

        return parts.join(' ');
    }
    /**
     * Monitoring système avancé en temps réel
     * @param {object} ctx - Contexte Telegraf
     */
    async systemMonitoring(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Vues monitoring
                    Markup.button.callback('📊 Dashboard', 'monitoring_dashboard'),
                    Markup.button.callback('📈 Graphiques', 'monitoring_graphs')
                ],
                [
                    // Métriques et alertes
                    Markup.button.callback('📉 Métriques', 'custom_metrics'),
                    Markup.button.callback('⚠️ Alertes', 'monitoring_alerts')
                ],
                [
                    // Configuration avancée
                    Markup.button.callback('⚙️ Config', 'monitoring_settings'),
                    Markup.button.callback('🔍 Détails', 'monitoring_details')
                ],
                [
                    // Export et rapports
                    Markup.button.callback('📤 Export', 'export_metrics'),
                    Markup.button.callback('📋 Rapport', 'monitoring_report')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_system_maintenance')]
            ]);

            // Récupération des métriques en temps réel
            const metrics = await this.getRealTimeMetrics();
            const alerts = await this.getActiveAlerts();

            // Construction du message
            let message = '📊 Monitoring Système\n\n';

            // Métriques principales
            message += '💻 Ressources (temps réel):\n';
            message += `CPU: ${metrics.cpu}% (${metrics.cpuTemp}°C)\n`;
            message += `RAM: ${metrics.memory}% (${this.formatSize(metrics.memoryUsed)})\n`;
            message += `Disque: ${metrics.disk}% utilisé\n`;
            message += `Réseau: ↑${this.formatSize(metrics.networkUp)}/s ↓${this.formatSize(metrics.networkDown)}/s\n\n`;

            // Performance applicative
            message += '⚡ Performance:\n';
            message += `Requêtes/sec: ${metrics.requestRate}\n`;
            message += `Temps réponse: ${metrics.responseTime}ms\n`;
            message += `Erreurs/min: ${metrics.errorRate}\n`;
            message += `Sessions actives: ${metrics.activeSessions}\n\n`;

            // Alertes actives
            if (alerts.length > 0) {
                message += '⚠️ Alertes actives:\n';
                alerts.forEach(alert => {
                    message += `${this.getAlertEmoji(alert.severity)} ${alert.message}\n`;
                    message += `📅 ${new Date(alert.timestamp).toLocaleString()}\n\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur monitoring système:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des mises à jour système
     * @param {object} ctx - Contexte Telegraf
     */
    async manageSystemUpdates(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions de mise à jour
                    Markup.button.callback('🔍 Vérifier', 'check_updates'),
                    Markup.button.callback('📦 Installer', 'install_updates')
                ],
                [
                    // Planification et historique
                    Markup.button.callback('⏰ Planifier', 'schedule_updates'),
                    Markup.button.callback('📋 Historique', 'update_history')
                ],
                [
                    // Configuration
                    Markup.button.callback('⚙️ Paramètres', 'update_settings'),
                    Markup.button.callback('📊 Statut', 'update_status')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_system_maintenance')]
            ]);

            // Récupération des informations de mise à jour
            const updates = await this.getAvailableUpdates();
            const config = await this.getUpdateConfig();

            // Construction du message
            let message = '🔄 Gestion des Mises à jour\n\n';

            // État actuel
            message += '📊 État actuel:\n';
            message += `Version: ${config.currentVersion}\n`;
            message += `Dernière vérification: ${new Date(config.lastCheck).toLocaleString()}\n`;
            message += `Mises à jour auto: ${config.autoUpdate ? '✅' : '❌'}\n\n`;

            // Mises à jour disponibles
            if (updates.length > 0) {
                message += '📦 Mises à jour disponibles:\n';
                updates.forEach(update => {
                    message += `\n🔹 Version ${update.version}:\n`;
                    message += `- Type: ${update.type}\n`;
                    message += `- Taille: ${this.formatSize(update.size)}\n`;
                    message += `- Priorité: ${this.getUpdatePriority(update.priority)}\n`;
                    if (update.security) message += '🔒 Mise à jour de sécurité\n';
                });
            } else {
                message += '✅ Système à jour\n\n';
            }

            // Historique récent
            const history = await this.getUpdateHistory(5);
            if (history.length > 0) {
                message += '\n📋 Dernières mises à jour:\n';
                history.forEach(entry => {
                    message += `${entry.success ? '✅' : '❌'} Version ${entry.version}\n`;
                    message += `📅 ${new Date(entry.date).toLocaleDateString()}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion mises à jour:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Diagnostics et dépannage système
     * @param {object} ctx - Contexte Telegraf
     */
    async systemDiagnostics(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Tests et diagnostics
                    Markup.button.callback('🔍 Tests', 'run_diagnostics'),
                    Markup.button.callback('⚡ Performance', 'performance_test')
                ],
                [
                    // Analyse et debug
                    Markup.button.callback('🔬 Analyser', 'analyze_system'),
                    Markup.button.callback('🐛 Debug', 'debug_mode')
                ],
                [
                    // Outils et logs
                    Markup.button.callback('🛠️ Outils', 'diagnostic_tools'),
                    Markup.button.callback('📝 Logs', 'diagnostic_logs')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_system_maintenance')]
            ]);

            // Lancement des diagnostics
            const diagnostics = await this.runSystemDiagnostics();

            // Construction du message
            let message = '🔍 Diagnostics Système\n\n';

            // État général
            message += '📊 État général:\n';
            message += `Santé: ${diagnostics.health}%\n`;
            message += `Tests passés: ${diagnostics.passedTests}/${diagnostics.totalTests}\n`;
            message += `Erreurs détectées: ${diagnostics.errors.length}\n\n`;

            // Tests par catégorie
            message += '🔬 Résultats par catégorie:\n';
            Object.entries(diagnostics.categories).forEach(([category, result]) => {
                message += `${this.getDiagnosticEmoji(result.status)} ${category}: `;
                message += `${result.score}%\n`;
            });
            message += '\n';

            // Problèmes détectés
            if (diagnostics.issues.length > 0) {
                message += '⚠️ Problèmes détectés:\n';
                diagnostics.issues.forEach(issue => {
                    message += `- ${issue.severity}: ${issue.message}\n`;
                    if (issue.solution) message += `  ↳ Solution: ${issue.solution}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur diagnostics système:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion de la sécurité système
     * @param {object} ctx - Contexte Telegraf
     */
    async manageSystemSecurity(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Sécurité et audit
                    Markup.button.callback('🔒 Sécurité', 'security_status'),
                    Markup.button.callback('📝 Audit', 'security_audit')
                ],
                [
                    // Accès et authentification
                    Markup.button.callback('🔑 Accès', 'access_control'),
                    Markup.button.callback('👥 Auth', 'authentication')
                ],
                [
                    // Logs et alertes
                    Markup.button.callback('📋 Logs', 'security_logs'),
                    Markup.button.callback('⚠️ Alertes', 'security_alerts')
                ],
                [
                    // Configuration et scans
                    Markup.button.callback('⚙️ Config', 'security_settings'),
                    Markup.button.callback('🔍 Scan', 'security_scan')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_system_maintenance')]
            ]);

            // Récupération des informations de sécurité
            const security = await this.getSecurityStatus();
            const threats = await this.getSecurityThreats();

            // Construction du message
            let message = '🔒 Sécurité Système\n\n';

            // Score de sécurité
            message += '📊 Score de sécurité:\n';
            message += `Global: ${security.score}%\n`;
            message += `Dernière analyse: ${new Date(security.lastScan).toLocaleString()}\n\n`;

            // État des protections
            message += '🛡️ Protections:\n';
            Object.entries(security.protections).forEach(([protection, status]) => {
                message += `${status.enabled ? '✅' : '❌'} ${protection}\n`;
            });
            message += '\n';

            // Menaces détectées
            if (threats.length > 0) {
                message += '⚠️ Menaces détectées:\n';
                threats.forEach(threat => {
                    message += `${this.getThreatEmoji(threat.level)} ${threat.type}\n`;
                    message += `- Source: ${threat.source}\n`;
                    message += `- Impact: ${threat.impact}\n\n`;
                });
            } else {
                message += '✅ Aucune menace détectée\n\n';
            }

            // Derniers incidents
            const incidents = await this.getSecurityIncidents(5);
            if (incidents.length > 0) {
                message += '🚨 Derniers incidents:\n';
                incidents.forEach(incident => {
                    message += `${new Date(incident.date).toLocaleString()}\n`;
                    message += `- ${incident.type}: ${incident.description}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion sécurité:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji pour une alerte
     * @private
     * @param {string} severity - Niveau de sévérité
     * @returns {string} Emoji correspondant
     */
    getAlertEmoji(severity) {
        const emojis = {
            'critical': '🔴',
            'high': '🟠',
            'medium': '🟡',
            'low': '🟢',
            'info': 'ℹ️'
        };
        return emojis[severity] || '⚪';
    }

    /**
     * Obtient l'emoji diagnostique
     * @private
     * @param {string} status - Statut du diagnostic
     * @returns {string} Emoji correspondant
     */
    getDiagnosticEmoji(status) {
        const emojis = {
            'pass': '✅',
            'warn': '⚠️',
            'fail': '❌',
            'info': 'ℹ️'
        };
        return emojis[status] || '❓';
    }

    /**
     * Obtient l'emoji pour une menace
     * @private
     * @param {string} level - Niveau de menace
     * @returns {string} Emoji correspondant
     */
    getThreatEmoji(level) {
        const emojis = {
            'critical': '⛔',
            'high': '🔴',
            'medium': '🟠',
            'low': '🟡',
            'info': 'ℹ️'
        };
        return emojis[level] || '⚪';
    }
    /**
     * Gestion principale des interfaces et personnalisation
     * Configuration de l'apparence et du comportement du bot
     * @param {object} ctx - Contexte Telegraf
     */
    async manageInterface(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Thèmes et apparence
                    Markup.button.callback('🎨 Thèmes', 'manage_themes'),
                    Markup.button.callback('📱 Affichage', 'display_settings')
                ],
                [
                    // Menus et commandes
                    Markup.button.callback('📋 Menus', 'menu_settings'),
                    Markup.button.callback('⌨️ Commandes', 'command_settings')
                ],
                [
                    // Langues et formats
                    Markup.button.callback('🌐 Langues', 'language_settings'),
                    Markup.button.callback('🔧 Formats', 'format_settings')
                ],
                [
                    // Personnalisation avancée
                    Markup.button.callback('⚙️ Avancé', 'advanced_ui'),
                    Markup.button.callback('📊 Préréglages', 'ui_presets')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération de la configuration actuelle
            const config = await this.getUIConfig();

            // Construction du message
            let message = '🎨 Configuration Interface\n\n';

            // Thème actuel
            message += '📱 Apparence actuelle:\n';
            message += `Thème: ${config.theme.name}\n`;
            message += `Mode: ${config.theme.darkMode ? 'Sombre' : 'Clair'}\n`;
            message += `Police: ${config.theme.font}\n`;
            message += `Taille texte: ${config.theme.fontSize}px\n\n`;

            // Menus et commandes
            message += '📋 Configuration menus:\n';
            message += `Style: ${config.menu.style}\n`;
            message += `Groupement: ${config.menu.grouping ? '✅' : '❌'}\n`;
            message += `Commandes visibles: ${config.menu.visibleCommands}\n\n`;

            // Langues
            message += '🌐 Langues:\n';
            message += `Principale: ${config.language.primary}\n`;
            message += `Alternatives: ${config.language.alternatives.join(', ')}\n`;
            message += `Auto-détection: ${config.language.autoDetect ? '✅' : '❌'}\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration interface:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des thèmes et de l'apparence
     * @param {object} ctx - Contexte Telegraf
     */
    async manageThemes(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Sélection de thème
                    Markup.button.callback('🎨 Changer', 'change_theme'),
                    Markup.button.callback('✨ Personnaliser', 'customize_theme')
                ],
                [
                    // Options d'apparence
                    Markup.button.callback('🌓 Mode sombre', 'toggle_dark_mode'),
                    Markup.button.callback('📝 Police', 'font_settings')
                ],
                [
                    // Couleurs et styles
                    Markup.button.callback('🎯 Couleurs', 'color_settings'),
                    Markup.button.callback('🔲 Styles', 'style_settings')
                ],
                [
                    // Import/Export
                    Markup.button.callback('📥 Importer', 'import_theme'),
                    Markup.button.callback('📤 Exporter', 'export_theme')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_interface')]
            ]);

            // Récupération des thèmes
            const themes = await Theme.find();
            const currentTheme = await this.getCurrentTheme();

            // Construction du message
            let message = '🎨 Gestion des Thèmes\n\n';

            // Thème actuel
            message += '📱 Thème actuel:\n';
            message += `Nom: ${currentTheme.name}\n`;
            message += `Style: ${currentTheme.style}\n`;
            message += `Couleur principale: ${currentTheme.primaryColor}\n`;
            message += `Mode: ${currentTheme.darkMode ? 'Sombre' : 'Clair'}\n\n`;

            // Liste des thèmes disponibles
            message += '📋 Thèmes disponibles:\n';
            themes.forEach(theme => {
                message += `${theme.name === currentTheme.name ? '✅ ' : ''}${theme.name}\n`;
                message += `- Type: ${theme.type}\n`;
                message += `- Créé par: @${theme.createdBy}\n\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion thèmes:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration des menus et commandes
     * @param {object} ctx - Contexte Telegraf
     */
    async manageMenus(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Structure des menus
                    Markup.button.callback('📋 Structure', 'menu_structure'),
                    Markup.button.callback('🔄 Ordre', 'menu_order')
                ],
                [
                    // Visibilité et accès
                    Markup.button.callback('👁️ Visibilité', 'menu_visibility'),
                    Markup.button.callback('🔒 Accès', 'menu_access')
                ],
                [
                    // Personnalisation
                    Markup.button.callback('✏️ Labels', 'menu_labels'),
                    Markup.button.callback('🎨 Style', 'menu_style')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_interface')]
            ]);

            // Récupération de la configuration des menus
            const menuConfig = await this.getMenuConfig();
            const stats = await this.getMenuStats();

            // Construction du message
            let message = '📋 Configuration des Menus\n\n';

            // Structure actuelle
            message += '📊 Structure actuelle:\n';
            message += `Niveaux: ${menuConfig.levels}\n`;
            message += `Groupes: ${menuConfig.groups.length}\n`;
            message += `Commandes: ${menuConfig.commands.length}\n\n`;

            // Statistiques d'utilisation
            message += '📈 Utilisation (7j):\n';
            message += `Interactions: ${stats.interactions}\n`;
            message += `Commandes populaires:\n`;
            stats.topCommands.forEach(cmd => {
                message += `- ${cmd.name}: ${cmd.uses} utilisations\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration menus:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration des paramètres de langue et localisation
     * @param {object} ctx - Contexte Telegraf
     */
    async manageLanguages(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Langues disponibles
                    Markup.button.callback('➕ Ajouter', 'add_language'),
                    Markup.button.callback('✏️ Modifier', 'edit_language')
                ],
                [
                    // Traductions et textes
                    Markup.button.callback('📝 Textes', 'edit_translations'),
                    Markup.button.callback('🔍 Manquants', 'missing_translations')
                ],
                [
                    // Import/Export
                    Markup.button.callback('📥 Importer', 'import_translations'),
                    Markup.button.callback('📤 Exporter', 'export_translations')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_interface')]
            ]);

            // Récupération des langues configurées
            const languages = await Language.find();
            const stats = await this.getLanguageStats();

            // Construction du message
            let message = '🌐 Configuration des Langues\n\n';

            // Langues disponibles
            message += '📋 Langues disponibles:\n';
            languages.forEach(lang => {
                const coverage = stats.coverage[lang.code] || 0;
                message += `${lang.default ? '✅ ' : ''}${lang.name} (${lang.code})\n`;
                message += `- Traductions: ${coverage}%\n`;
                message += `- Utilisateurs: ${stats.usage[lang.code] || 0}\n\n`;
            });

            // Statistiques globales
            message += '📊 Statistiques:\n';
            message += `Total langues: ${languages.length}\n`;
            message += `Textes à traduire: ${stats.totalStrings}\n`;
            message += `Traductions manquantes: ${stats.missingTranslations}\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration langues:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    /**
     * Configuration des formats et styles avancés
     * @param {object} ctx - Contexte Telegraf
     */
    async manageAdvancedStyles(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Styles de texte
                    Markup.button.callback('📝 Texte', 'text_styles'),
                    Markup.button.callback('🔤 Typographie', 'typography')
                ],
                [
                    // Mise en page et espacement
                    Markup.button.callback('📏 Mise en page', 'layout_settings'),
                    Markup.button.callback('↔️ Espacement', 'spacing_settings')
                ],
                [
                    // Animations et transitions
                    Markup.button.callback('✨ Animations', 'animation_settings'),
                    Markup.button.callback('🔄 Transitions', 'transition_settings')
                ],
                [
                    // Styles personnalisés
                    Markup.button.callback('🎨 Custom CSS', 'custom_styles'),
                    Markup.button.callback('📋 Templates', 'style_templates')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_interface')]
            ]);

            // Récupération des styles actuels
            const styles = await this.getAdvancedStyles();

            // Construction du message
            let message = '🎨 Styles Avancés\n\n';

            // Styles de texte
            message += '📝 Texte et typographie:\n';
            message += `Police: ${styles.text.fontFamily}\n`;
            message += `Taille base: ${styles.text.baseSize}px\n`;
            message += `Échelle: ${styles.text.scale}\n`;
            message += `Hauteur ligne: ${styles.text.lineHeight}\n\n`;

            // Mise en page
            message += '📏 Mise en page:\n';
            message += `Grille: ${styles.layout.grid ? '✅' : '❌'}\n`;
            message += `Colonnes: ${styles.layout.columns}\n`;
            message += `Marges: ${styles.layout.margin}px\n`;
            message += `Padding: ${styles.layout.padding}px\n\n`;

            // Animations
            message += '✨ Animations:\n';
            message += `Activées: ${styles.animations.enabled ? '✅' : '❌'}\n`;
            message += `Durée: ${styles.animations.duration}ms\n`;
            message += `Timing: ${styles.animations.timing}\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion styles avancés:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Personnalisation des notifications
     * @param {object} ctx - Contexte Telegraf
     */
    async customizeNotifications(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Types de notifications
                    Markup.button.callback('🔔 Pop-ups', 'popup_settings'),
                    Markup.button.callback('📱 In-app', 'inapp_notifications')
                ],
                [
                    // Styles et sons
                    Markup.button.callback('🎨 Styles', 'notification_styles'),
                    Markup.button.callback('🔊 Sons', 'notification_sounds')
                ],
                [
                    // Comportement
                    Markup.button.callback('⚙️ Comportement', 'notification_behavior'),
                    Markup.button.callback('⏱️ Durée', 'notification_duration')
                ],
                [
                    // Préréglages
                    Markup.button.callback('📋 Préréglages', 'notification_presets'),
                    Markup.button.callback('🔄 Par défaut', 'default_notifications')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_interface')]
            ]);

            // Récupération de la configuration des notifications
            const config = await this.getNotificationConfig();

            // Construction du message
            let message = '🔔 Personnalisation des Notifications\n\n';

            // Configuration générale
            message += '⚙️ Configuration générale:\n';
            message += `Pop-ups: ${config.popups.enabled ? '✅' : '❌'}\n`;
            message += `In-app: ${config.inApp.enabled ? '✅' : '❌'}\n`;
            message += `Sons: ${config.sounds.enabled ? '✅' : '❌'}\n\n`;

            // Styles
            message += '🎨 Styles actuels:\n';
            message += `Position: ${config.position}\n`;
            message += `Animation: ${config.animation}\n`;
            message += `Durée: ${config.duration}s\n\n`;

            // Préréglages
            message += '📋 Préréglages disponibles:\n';
            config.presets.forEach(preset => {
                message += `- ${preset.name}: ${preset.active ? '✅' : '❌'}\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur personnalisation notifications:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des widgets et composants
     * @param {object} ctx - Contexte Telegraf
     */
    async manageWidgets(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des widgets
                    Markup.button.callback('➕ Ajouter', 'add_widget'),
                    Markup.button.callback('📋 Liste', 'list_widgets')
                ],
                [
                    // Personnalisation
                    Markup.button.callback('🎨 Style', 'widget_styles'),
                    Markup.button.callback('⚙️ Config', 'widget_config')
                ],
                [
                    // Organisation
                    Markup.button.callback('📏 Disposition', 'widget_layout'),
                    Markup.button.callback('🔄 Ordre', 'widget_order')
                ],
                [
                    // Import/Export
                    Markup.button.callback('📥 Importer', 'import_widgets'),
                    Markup.button.callback('📤 Exporter', 'export_widgets')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_interface')]
            ]);

            // Récupération des widgets actifs
            const widgets = await Widget.find({ active: true });
            const stats = await this.getWidgetStats();

            // Construction du message
            let message = '🔧 Gestion des Widgets\n\n';

            // Liste des widgets
            message += '📋 Widgets actifs:\n';
            widgets.forEach(widget => {
                message += `${widget.name}:\n`;
                message += `- Type: ${widget.type}\n`;
                message += `- Position: ${widget.position}\n`;
                message += `- Utilisations: ${stats.usage[widget._id] || 0}\n\n`;
            });

            // Statistiques
            message += '📊 Statistiques:\n';
            message += `Total widgets: ${widgets.length}\n`;
            message += `Widgets personnalisés: ${stats.customWidgets}\n`;
            message += `Performance moyenne: ${stats.avgPerformance}ms\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion widgets:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des préréglages et templates
     * @param {object} ctx - Contexte Telegraf
     */
    async managePresets(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des préréglages
                    Markup.button.callback('➕ Nouveau', 'new_preset'),
                    Markup.button.callback('✏️ Modifier', 'edit_preset')
                ],
                [
                    // Templates
                    Markup.button.callback('📋 Templates', 'manage_templates'),
                    Markup.button.callback('💾 Sauvegarder', 'save_as_template')
                ],
                [
                    // Import/Export
                    Markup.button.callback('📥 Importer', 'import_presets'),
                    Markup.button.callback('📤 Exporter', 'export_presets')
                ],
                [
                    // Application
                    Markup.button.callback('✅ Appliquer', 'apply_preset'),
                    Markup.button.callback('🔄 Réinitialiser', 'reset_presets')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_interface')]
            ]);

            // Récupération des préréglages
            const presets = await Preset.find();
            const currentPreset = await this.getCurrentPreset();

            // Construction du message
            let message = '📋 Préréglages et Templates\n\n';

            // Préréglage actuel
            message += '✨ Préréglage actuel:\n';
            if (currentPreset) {
                message += `Nom: ${currentPreset.name}\n`;
                message += `Type: ${currentPreset.type}\n`;
                message += `Créé par: @${currentPreset.createdBy}\n`;
                message += `Modifié: ${new Date(currentPreset.updatedAt).toLocaleString()}\n\n`;
            } else {
                message += 'Aucun préréglage actif\n\n';
            }

            // Liste des préréglages
            message += '📋 Préréglages disponibles:\n';
            presets.forEach(preset => {
                message += `${preset._id.equals(currentPreset?._id) ? '✅ ' : ''}${preset.name}\n`;
                message += `- Type: ${preset.type}\n`;
                message += `- Composants: ${preset.components.length}\n\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion préréglages:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }
    /**
     * Gestion principale des rapports et analytics
     * Interface centralisée pour l'analyse des données
     * @param {object} ctx - Contexte Telegraf
     */
    async manageAnalytics(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Tableaux de bord et rapports
                    Markup.button.callback('📊 Dashboard', 'analytics_dashboard'),
                    Markup.button.callback('📑 Rapports', 'manage_reports')
                ],
                [
                    // Données et métriques
                    Markup.button.callback('📈 Métriques', 'view_metrics'),
                    Markup.button.callback('📊 Stats', 'custom_stats')
                ],
                [
                    // Export et planification
                    Markup.button.callback('📥 Export', 'export_analytics'),
                    Markup.button.callback('⏰ Planning', 'schedule_reports')
                ],
                [
                    // Configuration avancée
                    Markup.button.callback('⚙️ Config', 'analytics_settings'),
                    Markup.button.callback('🔍 Filtres', 'analytics_filters')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération des statistiques globales
            const stats = await this.getGlobalStats();

            // Construction du message
            let message = '📊 Rapports & Analytics\n\n';

            // Vue d'ensemble
            message += '📈 Vue d\'ensemble (30j):\n';
            message += `Utilisateurs actifs: ${stats.activeUsers}\n`;
            message += `Sessions: ${stats.sessions}\n`;
            message += `Taux engagement: ${stats.engagementRate}%\n`;
            message += `Temps moyen: ${stats.avgSessionTime}min\n\n`;

            // Tendances
            message += '📊 Tendances:\n';
            message += `Croissance: ${stats.growth > 0 ? '+' : ''}${stats.growth}%\n`;
            message += `Rétention: ${stats.retention}%\n`;
            message += `Satisfaction: ${stats.satisfaction}%\n\n`;

            // Rapports planifiés
            const scheduledReports = await ScheduledReport.find({ active: true });
            if (scheduledReports.length > 0) {
                message += '📋 Rapports planifiés:\n';
                scheduledReports.forEach(report => {
                    message += `- ${report.name} (${report.frequency})\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion analytics:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des rapports personnalisés
     * @param {object} ctx - Contexte Telegraf
     */
    async manageReports(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Création et modèles
                    Markup.button.callback('➕ Nouveau', 'new_report'),
                    Markup.button.callback('📋 Modèles', 'report_templates')
                ],
                [
                    // Types de rapports
                    Markup.button.callback('👥 Utilisateurs', 'user_reports'),
                    Markup.button.callback('💰 Financier', 'financial_reports')
                ],
                [
                    // Performance et contenu
                    Markup.button.callback('⚡ Performance', 'performance_reports'),
                    Markup.button.callback('📊 Contenus', 'content_reports')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_analytics')]
            ]);

            // Récupération des rapports
            const reports = await Report.find()
                .sort({ lastRun: -1 })
                .limit(5);

            // Construction du message
            let message = '📑 Gestion des Rapports\n\n';

            // Liste des derniers rapports
            message += '📋 Derniers rapports:\n';
            reports.forEach(report => {
                message += `${report.name}:\n`;
                message += `- Type: ${report.type}\n`;
                message += `- Dernière exécution: ${report.lastRun ?
                    new Date(report.lastRun).toLocaleString() : 'Jamais'}\n`;
                message += `- Status: ${this.getReportStatus(report.status)}\n\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion rapports:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Visualisation des métriques personnalisées
     * @param {object} ctx - Contexte Telegraf
     */
    async viewMetrics(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Types de métriques
                    Markup.button.callback('📈 Performance', 'performance_metrics'),
                    Markup.button.callback('👥 Utilisateurs', 'user_metrics')
                ],
                [
                    // Métriques spécifiques
                    Markup.button.callback('💰 Revenus', 'revenue_metrics'),
                    Markup.button.callback('🎯 Conversions', 'conversion_metrics')
                ],
                [
                    // Configuration
                    Markup.button.callback('➕ Personnaliser', 'custom_metrics'),
                    Markup.button.callback('⚙️ Config', 'metrics_settings')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_analytics')]
            ]);

            // Récupération des métriques
            const metrics = await this.getCustomMetrics();

            // Construction du message
            let message = '📈 Métriques Personnalisées\n\n';

            // Affichage des métriques par catégorie
            Object.entries(metrics).forEach(([category, data]) => {
                message += `${this.getMetricEmoji(category)} ${category}:\n`;
                Object.entries(data).forEach(([metric, value]) => {
                    message += `- ${metric}: ${this.formatMetricValue(value)}\n`;
                });
                message += '\n';
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur affichage métriques:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Configuration des paramètres d'analytics
     * @param {object} ctx - Contexte Telegraf
     */
    async configureAnalytics(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Paramètres généraux
                    Markup.button.callback('⚙️ Général', 'general_analytics_settings'),
                    Markup.button.callback('🎯 Objectifs', 'analytics_goals')
                ],
                [
                    // Intégrations
                    Markup.button.callback('🔌 Google Analytics', 'setup_ga'),
                    Markup.button.callback('📊 Custom', 'custom_tracking')
                ],
                [
                    // Données et confidentialité
                    Markup.button.callback('🔒 Confidentialité', 'privacy_settings'),
                    Markup.button.callback('🗑️ Nettoyage', 'data_cleanup')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_analytics')]
            ]);

            // Récupération de la configuration
            const config = await this.getAnalyticsConfig();

            // Construction du message
            let message = '⚙️ Configuration Analytics\n\n';

            // Configuration actuelle
            message += '📊 Paramètres actuels:\n';
            message += `Suivi utilisateurs: ${config.userTracking ? '✅' : '❌'}\n`;
            message += `Données anonymes: ${config.anonymousData ? '✅' : '❌'}\n`;
            message += `Rétention données: ${config.dataRetention} jours\n`;
            message += `Archivage auto: ${config.autoArchive ? '✅' : '❌'}\n\n`;

            // Intégrations
            message += '🔌 Intégrations:\n';
            Object.entries(config.integrations).forEach(([name, status]) => {
                message += `- ${name}: ${status.enabled ? '✅' : '❌'}\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration analytics:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji pour une métrique
     * @private
     * @param {string} category - Catégorie de métrique
     * @returns {string} Emoji correspondant
     */
    getMetricEmoji(category) {
        const emojis = {
            'performance': '⚡',
            'users': '👥',
            'revenue': '💰',
            'conversion': '🎯',
            'engagement': '🎮',
            'satisfaction': '😊'
        };
        return emojis[category] || '📊';
    }

    /**
     * Formate la valeur d'une métrique
     * @private
     * @param {any} value - Valeur à formater
     * @returns {string} Valeur formatée
     */
    formatMetricValue(value) {
        if (typeof value === 'number') {
            if (value > 1000000) {
                return `${(value / 1000000).toFixed(1)}M`;
            } else if (value > 1000) {
                return `${(value / 1000).toFixed(1)}K`;
            }
            return value.toFixed(1);
        }
        return value.toString();
    }

    /**
     * Configuration avancée des plugins
     * @param {object} ctx - Contexte Telegraf
     */
    async advancedPluginConfig(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Configuration et optimisation
                    Markup.button.callback('⚙️ Config', 'plugin_config_advanced'),
                    Markup.button.callback('⚡ Performance', 'plugin_performance')
                ],
                [
                    // Intégrations et hooks
                    Markup.button.callback('🔗 Hooks', 'plugin_hooks'),
                    Markup.button.callback('🔌 API', 'plugin_api')
                ],
                [
                    // Cache et stockage
                    Markup.button.callback('💾 Cache', 'plugin_cache'),
                    Markup.button.callback('📁 Stockage', 'plugin_storage')
                ],
                [
                    // Logs et debug
                    Markup.button.callback('📝 Logs', 'plugin_logs'),
                    Markup.button.callback('🐛 Debug', 'plugin_debug')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_plugins')]
            ]);

            // Récupération des configurations avancées
            const advancedConfig = await this.getAdvancedPluginConfig();
            const perfStats = await this.getPluginPerformanceStats();

            // Construction du message
            let message = '⚙️ Configuration Avancée des Plugins\n\n';

            // Configuration actuelle
            message += '🔧 Configuration:\n';
            message += `Cache: ${advancedConfig.cache.enabled ? '✅' : '❌'}\n`;
            message += `API Rate Limit: ${advancedConfig.api.rateLimit}/min\n`;
            message += `Stockage max: ${this.formatSize(advancedConfig.storage.maxSize)}\n`;
            message += `Debug mode: ${advancedConfig.debug ? '✅' : '❌'}\n\n`;

            // Performance
            message += '⚡ Performance:\n';
            message += `CPU moyen: ${perfStats.avgCPU}%\n`;
            message += `Mémoire: ${this.formatSize(perfStats.memoryUsage)}\n`;
            message += `Temps réponse: ${perfStats.avgResponseTime}ms\n\n`;

            // Hooks actifs
            message += '🔗 Hooks actifs:\n';
            Object.entries(advancedConfig.hooks).forEach(([hook, count]) => {
                message += `${hook}: ${count} listeners\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur configuration avancée plugins:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion de la sécurité des plugins
     * @param {object} ctx - Contexte Telegraf
     */
    async managePluginSecurity(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Sécurité et permissions
                    Markup.button.callback('🔒 Permissions', 'plugin_permissions'),
                    Markup.button.callback('🛡️ Sandbox', 'plugin_sandbox')
                ],
                [
                    // Analyse et vérification
                    Markup.button.callback('🔍 Audit', 'plugin_security_audit'),
                    Markup.button.callback('✅ Validation', 'plugin_validation')
                ],
                [
                    // Blocage et liste noire
                    Markup.button.callback('🚫 Blocage', 'plugin_blocking'),
                    Markup.button.callback('⚫ Liste noire', 'plugin_blacklist')
                ],
                [
                    // Rapport et monitoring
                    Markup.button.callback('📊 Rapport', 'plugin_security_report'),
                    Markup.button.callback('👁️ Monitoring', 'plugin_security_monitoring')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_plugins')]
            ]);

            // Récupération des données de sécurité
            const security = await this.getPluginSecurity();
            const securityStats = await this.getPluginSecurityStats();

            // Construction du message
            let message = '🔒 Sécurité des Plugins\n\n';

            // État de la sécurité
            message += '🛡️ État de la sécurité:\n';
            message += `Score global: ${security.score}/100\n`;
            message += `Sandbox: ${security.sandbox ? '✅' : '❌'}\n`;
            message += `Isolation: ${security.isolation}\n\n`;

            // Alertes de sécurité
            if (securityStats.alerts.length > 0) {
                message += '⚠️ Alertes récentes:\n';
                securityStats.alerts.forEach(alert => {
                    message += `- ${alert.severity}: ${alert.message}\n`;
                });
                message += '\n';
            }

            // Plugins bloqués
            message += '🚫 Plugins bloqués:\n';
            security.blocked.forEach(plugin => {
                message += `- ${plugin.name}: ${plugin.reason}\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur sécurité plugins:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des dépendances des plugins
     * @param {object} ctx - Contexte Telegraf
     */
    async managePluginDependencies(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des dépendances
                    Markup.button.callback('🔍 Analyser', 'analyze_dependencies'),
                    Markup.button.callback('🔄 Mettre à jour', 'update_dependencies')
                ],
                [
                    // Résolution et conflits
                    Markup.button.callback('🎯 Résoudre', 'resolve_conflicts'),
                    Markup.button.callback('⚠️ Conflits', 'view_conflicts')
                ],
                [
                    // Optimisation et nettoyage
                    Markup.button.callback('⚡ Optimiser', 'optimize_dependencies'),
                    Markup.button.callback('🧹 Nettoyer', 'clean_dependencies')
                ],
                [
                    // Graphe et rapport
                    Markup.button.callback('📊 Graphe', 'dependency_graph'),
                    Markup.button.callback('📝 Rapport', 'dependency_report')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_plugins')]
            ]);

            // Analyse des dépendances
            const dependencies = await this.analyzeDependencies();
            const depStats = await this.getDependencyStats();

            // Construction du message
            let message = '🔗 Gestion des Dépendances\n\n';

            // Vue d'ensemble
            message += '📊 Vue d\'ensemble:\n';
            message += `Total dépendances: ${depStats.totalDeps}\n`;
            message += `Directes: ${depStats.directDeps}\n`;
            message += `Indirectes: ${depStats.indirectDeps}\n`;
            message += `Conflits: ${depStats.conflicts}\n\n`;

            // État des dépendances
            message += '📈 État des dépendances:\n';
            message += `À jour: ${depStats.upToDate}\n`;
            message += `Obsolètes: ${depStats.outdated}\n`;
            message += `Vulnérables: ${depStats.vulnerable}\n\n`;

            // Conflits détectés
            if (dependencies.conflicts.length > 0) {
                message += '⚠️ Conflits détectés:\n';
                dependencies.conflicts.forEach(conflict => {
                    message += `- ${conflict.package}: ${conflict.description}\n`;
                });
            }

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion dépendances:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Déploiement automatisé des plugins
     * @param {object} ctx - Contexte Telegraf
     */
    async automatedPluginDeployment(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Déploiement et environnements
                    Markup.button.callback('🚀 Déployer', 'deploy_plugins'),
                    Markup.button.callback('🌍 Environnements', 'deployment_envs')
                ],
                [
                    // Pipeline et tests
                    Markup.button.callback('⚡ Pipeline', 'deployment_pipeline'),
                    Markup.button.callback('🧪 Tests', 'deployment_tests')
                ],
                [
                    // Rollback et monitoring
                    Markup.button.callback('↩️ Rollback', 'deployment_rollback'),
                    Markup.button.callback('📊 Monitoring', 'deployment_monitoring')
                ],
                [
                    // Logs et rapport
                    Markup.button.callback('📝 Logs', 'deployment_logs'),
                    Markup.button.callback('📋 Rapport', 'deployment_report')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_plugins')]
            ]);

            // Récupération des données de déploiement
            const deployments = await this.getDeploymentStatus();
            const deployStats = await this.getDeploymentStats();

            // Construction du message
            let message = '🚀 Déploiement Automatisé\n\n';

            // État actuel
            message += '📊 État actuel:\n';
            message += `Environnements: ${deployStats.environments}\n`;
            message += `Déploiements actifs: ${deployStats.activeDeployments}\n`;
            message += `Taux de succès: ${deployStats.successRate}%\n\n`;

            // Dernier déploiement
            if (deployments.latest) {
                message += '🔄 Dernier déploiement:\n';
                message += `Version: ${deployments.latest.version}\n`;
                message += `État: ${this.getDeploymentStatus(deployments.latest.status)}\n`;
                message += `Durée: ${deployments.latest.duration}s\n\n`;
            }

            // Pipeline de déploiement
            message += '⚡ Pipeline:\n';
            deployments.pipeline.stages.forEach(stage => {
                message += `${this.getStageEmoji(stage.status)} ${stage.name}\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur déploiement plugins:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji pour une étape de déploiement
     * @private
     * @param {string} status - Statut de l'étape
     * @returns {string} Emoji correspondant
     */
    getStageEmoji(status) {
        const emojis = {
            'pending': '⏳',
            'running': '🔄',
            'success': '✅',
            'failed': '❌',
            'skipped': '⏭️',
            'cancelled': '⛔'
        };
        return emojis[status] || '❓';
    }
    /**
     * Gestion principale du service client/support
     * @param {object} ctx - Contexte Telegraf
     */
    async manageCustomerSupport(ctx) {
        try {
            // Vérification des permissions administrateur
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Tickets et requêtes
                    Markup.button.callback('🎫 Tickets', 'manage_tickets'),
                    Markup.button.callback('💬 Chat Live', 'live_support')
                ],
                [
                    // Base de connaissances et FAQ
                    Markup.button.callback('📚 Knowledge Base', 'knowledge_base'),
                    Markup.button.callback('❓ FAQ', 'manage_faq')
                ],
                [
                    // Agents et équipes
                    Markup.button.callback('👥 Agents', 'manage_agents'),
                    Markup.button.callback('👥 Équipes', 'manage_teams')
                ],
                [
                    // Rapports et statistiques
                    Markup.button.callback('📊 Rapports', 'support_reports'),
                    Markup.button.callback('⚙️ Config', 'support_settings')
                ],
                [Markup.button.callback('🔙 Retour', 'admin_config')]
            ]);

            // Récupération des statistiques
            const stats = await this.getSupportStats();
            const activeTickets = await Ticket.count({ status: 'open' });

            // Construction du message
            let message = '🎮 Gestion du Support Client\n\n';

            // Vue d'ensemble
            message += '📊 Vue d\'ensemble:\n';
            message += `Tickets en cours: ${activeTickets}\n`;
            message += `Temps réponse moyen: ${stats.avgResponseTime}min\n`;
            message += `Satisfaction client: ${stats.satisfaction}%\n\n`;

            // Agents
            message += '👥 Agents:\n';
            message += `En ligne: ${stats.onlineAgents}\n`;
            message += `Disponibles: ${stats.availableAgents}\n`;
            message += `En pause: ${stats.busyAgents}\n\n`;

            // Charge de travail
            message += '📈 Charge actuelle:\n';
            message += `File d'attente: ${stats.queueLength}\n`;
            message += `Temps d'attente: ${stats.waitTime}min\n`;
            message += `Chats actifs: ${stats.activeChats}\n`;

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion support:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des tickets de support
     * @param {object} ctx - Contexte Telegraf
     */
    async manageTickets(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Actions principales
                    Markup.button.callback('📝 Nouveaux', 'new_tickets'),
                    Markup.button.callback('🔄 En cours', 'active_tickets')
                ],
                [
                    // Filtres et tri
                    Markup.button.callback('🔍 Rechercher', 'search_tickets'),
                    Markup.button.callback('🏷️ Étiquettes', 'ticket_tags')
                ],
                [
                    // Assignation et priorité
                    Markup.button.callback('👤 Assigner', 'assign_tickets'),
                    Markup.button.callback('⚡ Priorité', 'ticket_priority')
                ],
                [
                    // Options avancées
                    Markup.button.callback('⚙️ Config', 'ticket_settings'),
                    Markup.button.callback('📊 Stats', 'ticket_stats')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_customer_support')]
            ]);

            // Récupération des tickets récents
            const tickets = await Ticket.find()
                .sort({ createdAt: -1 })
                .limit(5)
                .populate('user agent');

            // Construction du message
            let message = '🎫 Gestion des Tickets\n\n';

            // Tickets récents
            message += '📝 Derniers tickets:\n\n';
            tickets.forEach(ticket => {
                message += `#${ticket.number} - ${this.getTicketStatusEmoji(ticket.status)}\n`;
                message += `De: @${ticket.user.username}\n`;
                message += `Sujet: ${ticket.subject}\n`;
                message += `Priorité: ${this.getTicketPriorityEmoji(ticket.priority)}\n`;
                if (ticket.agent) {
                    message += `Agent: @${ticket.agent.username}\n`;
                }
                message += '\n';
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion tickets:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion de la base de connaissances
     * @param {object} ctx - Contexte Telegraf
     */
    async manageKnowledgeBase(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des articles
                    Markup.button.callback('📝 Articles', 'manage_articles'),
                    Markup.button.callback('🔍 Rechercher', 'search_articles')
                ],
                [
                    // Catégories et tags
                    Markup.button.callback('📁 Catégories', 'kb_categories'),
                    Markup.button.callback('🏷️ Tags', 'kb_tags')
                ],
                [
                    // Import/Export
                    Markup.button.callback('📥 Importer', 'import_kb'),
                    Markup.button.callback('📤 Exporter', 'export_kb')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_customer_support')]
            ]);

            // Récupération des statistiques
            const kbStats = await this.getKnowledgeBaseStats();

            // Construction du message
            let message = '📚 Base de Connaissances\n\n';

            // Statistiques
            message += '📊 Vue d\'ensemble:\n';
            message += `Articles: ${kbStats.totalArticles}\n`;
            message += `Catégories: ${kbStats.categories}\n`;
            message += `Tags: ${kbStats.tags}\n\n`;

            // Utilisation
            message += '📈 Utilisation (30j):\n';
            message += `Vues: ${kbStats.views}\n`;
            message += `Recherches: ${kbStats.searches}\n`;
            message += `Utile: ${kbStats.helpfulRating}%\n\n`;

            // Articles populaires
            message += '🔝 Articles populaires:\n';
            kbStats.popularArticles.forEach(article => {
                message += `- ${article.title} (${article.views} vues)\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion base connaissances:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Gestion des agents de support
     * @param {object} ctx - Contexte Telegraf
     */
    async manageSupportAgents(ctx) {
        try {
            // Vérification des permissions
            if (!await this.isAdmin(ctx)) return;

            // Construction du clavier
            const keyboard = Markup.inlineKeyboard([
                [
                    // Gestion des agents
                    Markup.button.callback('➕ Ajouter', 'add_agent'),
                    Markup.button.callback('✏️ Modifier', 'edit_agent')
                ],
                [
                    // Équipes et rôles
                    Markup.button.callback('👥 Équipes', 'manage_support_teams'),
                    Markup.button.callback('🔑 Rôles', 'agent_roles')
                ],
                [
                    // Performance et formations
                    Markup.button.callback('📊 Performance', 'agent_performance'),
                    Markup.button.callback('📚 Formation', 'agent_training')
                ],
                [
                    // Planning et disponibilité
                    Markup.button.callback('📅 Planning', 'agent_schedule'),
                    Markup.button.callback('⏰ Disponibilité', 'agent_availability')
                ],
                [Markup.button.callback('🔙 Retour', 'manage_customer_support')]
            ]);

            // Récupération des agents
            const agents = await SupportAgent.find()
                .populate('user')
                .sort({ status: 1, username: 1 });

            // Construction du message
            let message = '👥 Gestion des Agents\n\n';

            // Liste des agents
            message += '📋 Agents:\n\n';
            agents.forEach(agent => {
                message += `${this.getAgentStatusEmoji(agent.status)} @${agent.user.username}\n`;
                message += `Rôle: ${agent.role}\n`;
                message += `Équipe: ${agent.team}\n`;
                message += `Tickets assignés: ${agent.assignedTickets}\n`;
                message += `Satisfaction: ${agent.satisfaction}%\n\n`;
            });

            // Envoi du message avec le clavier
            await ctx.reply(message, keyboard);
        } catch (error) {
            // Gestion des erreurs
            logger.error('Erreur gestion agents:', error);
            ctx.reply('Une erreur est survenue').catch(console.error);
        }
    }

    /**
     * Obtient l'emoji pour un statut de ticket
     * @private
     * @param {string} status - Statut du ticket
     * @returns {string} Emoji correspondant
     */
    getTicketStatusEmoji(status) {
        const emojis = {
            'new': '🆕',
            'open': '📖',
            'pending': '⏳',
            'resolved': '✅',
            'closed': '🔒',
            'reopened': '🔄'
        };
        return emojis[status] || '❓';
    }

    /**
     * Obtient l'emoji pour une priorité de ticket
     * @private
     * @param {string} priority - Priorité du ticket
     * @returns {string} Emoji correspondant
     */
    getTicketPriorityEmoji(priority) {
        const emojis = {
            'low': '🟢',
            'medium': '🟡',
            'high': '🟠',
            'urgent': '🔴',
            'critical': '⚠️'
        };
        return emojis[priority] || '⚪';
    }

    /**
     * Obtient l'emoji pour un statut d'agent
     * @private
     * @param {string} status - Statut de l'agent
     * @returns {string} Emoji correspondant
     */
    getAgentStatusEmoji(status) {
        const emojis = {
            'online': '🟢',
            'busy': '🟡',
            'away': '🟠',
            'offline': '⚪',
            'training': '📚',
            'meeting': '👥'
        };
        return emojis[status] || '❓';
    }
    //===================== FONCTIONS UTILITAIRES =====================

    // Créer un artefact React
    async createReactArtifact(ctx, id, component) {
        try {
            await this.bot.telegram.sendMessage(
                ctx.chat.id,
                '',
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: 'Voir le graphique', callback_data: `view_artifact_${id}` }
                        ]]
                    }
                }
            );
        } catch (error) {
            logger.error('Erreur création artifact:', error);
        }
    }

    // Mettre à jour les statistiques utilisateur
    async updateUserStats(userId, order) {
        try {
            const user = await User.findOne({ telegramId: userId });
            if (!user) return;

            // Mettre à jour les totaux
            user.stats.totalOrders = (user.stats.totalOrders || 0) + 1;
            user.stats.totalSpent = (user.stats.totalSpent || 0) + order.payment.amount.total;

            // Mettre à jour les catégories préférées
            if (!user.stats.favoriteCategories) {
                user.stats.favoriteCategories = [];
            }

            order.products.forEach(product => {
                const existingCategory = user.stats.favoriteCategories.find(
                    fc => fc.category.equals(product.product.category)
                );

                if (existingCategory) {
                    existingCategory.count += 1;
                } else {
                    user.stats.favoriteCategories.push({
                        category: product.product.category,
                        count: 1
                    });
                }
            });

            // Trier et limiter les catégories préférées
            user.stats.favoriteCategories.sort((a, b) => b.count - a.count);
            user.stats.favoriteCategories = user.stats.favoriteCategories.slice(0, 5);

            await user.save();
        } catch (error) {
            logger.error('Erreur mise à jour stats utilisateur:', error);
        }
    }

    // Logger une action administrative
    async logAdminAction(telegramId, action, details = {}) {
        try {
            // Trouver l'admin par son telegramId
            const admin = await User.findOne({ telegramId });
            if (!admin) {
                console.error('Admin non trouvé:', telegramId);
                return null;
            }

            // Préparer les données du log
            const logData = {
                adminId: admin._id,
                adminUsername: admin.username,
                action: action,
                entityType: details.entityType || 'system',
                entityId: details.entityId || admin._id,
                details: details,
                status: 'success',
                metadata: {
                    impactLevel: details.impactLevel || 'low',
                    notes: details.notes
                }
            };

            // Si des changements sont fournis
            if (details.before || details.after) {
                logData.changes = {
                    before: details.before,
                    after: details.after
                };
            }

            // Si des informations de session sont fournies
            if (details.sessionInfo) {
                logData.sessionInfo = details.sessionInfo;
            }

            // Créer et sauvegarder le log
            const log = await AdminLog.create(logData);

            console.log('Action administrative enregistrée:', {
                admin: admin.username,
                action: action,
                entityType: logData.entityType,
                status: 'success'
            });

            return log;
        } catch (error) {
            console.error('Erreur logging action:', error);
            // Créer un log d'erreur
            try {
                const admin = await User.findOne({ telegramId });
                if (admin) {
                    await AdminLog.create({
                        adminId: admin._id,
                        adminUsername: admin.username,
                        action: action,
                        entityType: 'system',
                        entityId: admin._id,
                        status: 'error',
                        error: {
                            message: error.message,
                            stack: error.stack
                        },
                        metadata: {
                            impactLevel: 'high',
                            notes: 'Erreur lors de la journalisation'
                        }
                    });
                }
            } catch (logError) {
                console.error('Erreur lors de la création du log d\'erreur:', logError);
            }
            return null;
        }
    }

    // Maintenant, modifions handleBotNameEdit pour utiliser correctement cette fonction
    async handleBotNameEdit(ctx) {
        try {
            const chatId = ctx.chat?.id || ctx.channelPost?.chat?.id;
            if (!chatId) {
                console.error('Chat ID non trouvé');
                return;
            }

            // Récupération et nettoyage du nouveau nom
            const newName = ctx.message.text.trim();

            // Validation de la longueur du nom
            if (newName.length < 3 || newName.length > 32) {
                await ctx.telegram.sendMessage(
                    chatId,
                    '❌ Le nom doit contenir entre 3 et 32 caractères'
                );
                return;
            }

            try {
                // Mettre à jour le nom du bot via l'API Telegram
                await ctx.telegram.setMyName(newName);
                console.log('Nom du bot mis à jour dans Telegram API');
            } catch (telegramError) {
                console.error('Erreur lors de la mise à jour du nom via Telegram API:', telegramError);
                await ctx.telegram.sendMessage(
                    chatId,
                    '❌ Erreur lors de la mise à jour du nom du bot dans Telegram'
                );
                return;
            }

            // Récupération et mise à jour de la configuration
            const config = await Config.findOne() || new Config();
            const oldName = config.botName;
            config.botName = newName;
            config.lastUpdate = new Date();
            await config.save();

            // Journalisation
            await this.logAdminAction(
                ctx.from.id,
                'edit_bot_name',
                {
                    entityType: 'system',
                    entityId: config._id,
                    details: {
                        oldName,
                        newName,
                        updateType: 'bot_name'
                    },
                    changes: {
                        before: { botName: oldName },
                        after: { botName: newName }
                    }
                }
            );

            // Nettoyage de l'état
            if (ctx.session) {
                ctx.session.adminState = null;
            }

            // Confirmation
            await ctx.telegram.sendMessage(
                chatId,
                `✅ Nom du bot modifié : ${newName}`
            );

            // Retour au menu des paramètres
            await this.editBotSettings(ctx);
        } catch (error) {
            console.error('Erreur modification nom bot:', error);
            const chatId = ctx.chat?.id || ctx.channelPost?.chat?.id;
            if (chatId) {
                await ctx.telegram.sendMessage(
                    chatId,
                    '❌ Une erreur est survenue lors de la modification du nom du bot'
                ).catch(console.error);
            }
        }
    }

    // Gérer les erreurs
    async handleError(ctx, error, action) {
        // Logger l'erreur
        logger.error(`Erreur dans ${action}:`, error);

        // Créer un log d'erreur
        await AdminLog.create({
            action: 'error',
            details: {
                action,
                error: error.message,
                stack: error.stack
            },
            timestamp: new Date()
        });

        // Notifier l'utilisateur
        await ctx.reply(
            '❌ Une erreur est survenue.\n' +
            'Nos équipes ont été notifiées du problème.'
        );

        // Notifier les admins
        const errorMessage = `🚨 Erreur détectée\n\n` +
            `Action: ${action}\n` +
            `Erreur: ${error.message}\n` +
            `Utilisateur: @${ctx.from.username}\n` +
            `Date: ${new Date().toLocaleString()}`;

        await this.notifyAdmins(errorMessage);
    }

    // Notifier les admins
    async notifyAdmins(message) {
        try {
            const admins = await User.find({
                role: { $in: ['admin', 'superadmin'] }
            });

            for (const admin of admins) {
                await this.bot.telegram.sendMessage(admin.telegramId, message);
            }
        } catch (error) {
            logger.error('Erreur notification admins:', error);
        }
    }

    // Créer un keyboard dynamique
    createDynamicKeyboard(buttons, columns = 2) {
        const keyboard = [];
        for (let i = 0; i < buttons.length; i += columns) {
            keyboard.push(buttons.slice(i, i + columns));
        }
        return keyboard;
    }

    // Gérer la pagination
    async handlePagination(ctx, data, page, itemsPerPage, renderItem) {
        const startIndex = page * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const totalPages = Math.ceil(data.length / itemsPerPage);

        const items = data.slice(startIndex, endIndex);
        let message = items.map(renderItem).join('\n\n');

        const keyboard = [];
        if (totalPages > 1) {
            const navigationButtons = [];
            if (page > 0) {
                navigationButtons.push(
                    Markup.button.callback('⬅️', `page_${page - 1}`)
                );
            }
            navigationButtons.push(
                Markup.button.callback(`${page + 1}/${totalPages}`, 'null')
            );
            if (page < totalPages - 1) {
                navigationButtons.push(
                    Markup.button.callback('➡️', `page_${page + 1}`)
                );
            }
            keyboard.push(navigationButtons);
        }

        return { message, keyboard: Markup.inlineKeyboard(keyboard) };
    }

    // Formater une timeline
    formatTimeline(timeline) {
        if (!timeline || timeline.length === 0) return '';

        return timeline.map(event => {
            const date = new Date(event.timestamp).toLocaleString();
            const emoji = this.getStatusEmoji(event.status);
            let message = `${emoji} ${date}: ${event.status}`;
            if (event.notes) message += `\n📝 ${event.notes}`;
            if (event.adminId) {
                message += `\n👤 Par: ${event.adminUsername || event.adminId}`;
            }
            return message;
        }).join('\n\n');
    }

    // Formater la monnaie
    formatCurrency(amount) {
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 2
        }).format(amount);
    }

    // Valider et nettoyer le texte
    sanitizeInput(text) {
        if (!text) return '';

        // Enlever les caractères dangereux
        text = text.replace(/[<>]/g, '');
        // Limiter la longueur
        text = text.slice(0, 1000);
        // Nettoyer les espaces
        text = text.trim();

        return text;
    }

    // Valider une URL
    isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    // Obtenir l'emoji d'un statut
    getStatusEmoji(status) {
        const statusEmojis = {
            'pending': '⏳',
            'processing': '🔄',
            'completed': '✅',
            'delivered': '📦',
            'cancelled': '❌',
            'refunded': '💰',
            'rejected': '⛔',
            'failed': '⚠️',
            'active': '✅',
            'inactive': '❌',
            'banned': '🚫'
        };
        return statusEmojis[status] || '❓';
    }

    // Vérifier les autorisations
    async checkPermissions(userId, requiredRole) {
        const user = await User.findOne({ telegramId: userId });
        if (!user) return false;

        const roleHierarchy = {
            'user': 0,
            'support': 1,
            'admin': 2,
            'superadmin': 3
        };

        return roleHierarchy[user.role] >= roleHierarchy[requiredRole];
    }
}

module.exports = AdminController;