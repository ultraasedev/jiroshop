const { Telegraf, Markup } = require('telegraf');
const logger = require('../utils/logger');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Cart = require('../models/Cart');

class BotController {
    constructor(token) {
        this.bot = new Telegraf(token);
        this.initializeBot();
    }

    initializeBot() {
        // Middleware pour la gestion des utilisateurs
        this.bot.use(async (ctx, next) => {
            try {
                // Créer ou mettre à jour l'utilisateur
                const telegramUser = ctx.from;
                let user = await User.findOne({ telegramId: telegramUser.id });
                
                if (!user) {
                    user = new User({
                        telegramId: telegramUser.id,
                        username: telegramUser.username || 'Unknown',
                        profile: {
                            firstName: telegramUser.first_name,
                            lastName: telegramUser.last_name
                        }
                    });
                    await user.save();
                }

                ctx.state.user = user;
                return next();
            } catch (error) {
                logger.error('Erreur middleware utilisateur:', error);
                return next();
            }
        });

        // Commande de démarrage
        this.bot.command('start', this.handleStart.bind(this));

        // Gestionnaire du menu principal
        this.bot.command('menu', this.showMainMenu.bind(this));
        
        // Gestionnaire des catégories
        this.bot.action(/^category_(.+)$/, this.handleCategory.bind(this));
        
        // Gestionnaire des produits
        this.bot.action(/^product_(.+)$/, this.handleProduct.bind(this));
        
        // Gestionnaire du panier
        this.bot.command('cart', this.showCart.bind(this));
        this.bot.action('view_cart', this.showCart.bind(this));
        this.bot.action(/^add_to_cart_(.+)$/, this.addToCart.bind(this));
        this.bot.action(/^remove_from_cart_(.+)$/, this.removeFromCart.bind(this));
        
        // Gestionnaire des paramètres
        this.bot.command('settings', this.showSettings.bind(this));
        this.bot.action('settings', this.showSettings.bind(this));

        // Gestionnaire des erreurs
        this.bot.catch((err, ctx) => {
            logger.error('Erreur bot:', err);
            ctx.reply('Une erreur est survenue. Veuillez réessayer.').catch(console.error);
        });
    }

    // Gestionnaire de démarrage
    async handleStart(ctx) {
        try {
            const welcomeMessage = `👋 Bienvenue ${ctx.state.user.profile.firstName} dans notre boutique !

🛍️ Vous pouvez parcourir nos produits et services en utilisant le menu ci-dessous.`;

            const mainMenuKeyboard = Markup.keyboard([
                ['🛍️ Catégories', '🛒 Mon Panier'],
                ['⚙️ Paramètres', '❓ Aide']
            ]).resize();

            await ctx.reply(welcomeMessage, mainMenuKeyboard);
            await this.showCategories(ctx);
        } catch (error) {
            logger.error('Erreur handleStart:', error);
            ctx.reply('Une erreur est survenue au démarrage.').catch(console.error);
        }
    }

    // Afficher le menu principal
    async showMainMenu(ctx) {
        try {
            const menuKeyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('🛍️ Parcourir les Catégories', 'browse_categories'),
                    Markup.button.callback('🛒 Voir mon Panier', 'view_cart')
                ],
                [
                    Markup.button.callback('📱 Mon Compte', 'my_account'),
                    Markup.button.callback('⚙️ Paramètres', 'settings')
                ]
            ]);

            await ctx.reply('Que souhaitez-vous faire ?', menuKeyboard);
        } catch (error) {
            logger.error('Erreur showMainMenu:', error);
            ctx.reply('Erreur d\'affichage du menu.').catch(console.error);
        }
    }

    // Afficher les catégories
    async showCategories(ctx) {
        try {
            const categories = await Category.find({ active: true })
                .sort({ order: 1 });

            if (categories.length === 0) {
                return ctx.reply('Aucune catégorie disponible pour le moment.');
            }

            const categoryButtons = categories.map(cat => [
                Markup.button.callback(cat.name, `category_${cat._id}`)
            ]);

            const keyboard = Markup.inlineKeyboard([
                ...categoryButtons,
                [Markup.button.callback('🔙 Retour au Menu', 'main_menu')]
            ]);

            await ctx.reply('📚 Choisissez une catégorie :', keyboard);
        } catch (error) {
            logger.error('Erreur showCategories:', error);
            ctx.reply('Erreur lors du chargement des catégories.').catch(console.error);
        }
    }

    // Gestionnaire de catégorie
    async handleCategory(ctx) {
        try {
            const categoryId = ctx.match[1];
            const category = await Category.findById(categoryId);

            if (!category) {
                return ctx.reply('Catégorie non trouvée.');
            }

            const products = await Product.find({
                category: categoryId,
                status: 'active'
            });

            if (products.length === 0) {
                return ctx.reply('Aucun produit disponible dans cette catégorie.');
            }

            for (const product of products) {
                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('➕ Ajouter au Panier', `add_to_cart_${product._id}`)],
                    [Markup.button.callback('ℹ️ Plus d\'infos', `product_${product._id}`)]
                ]);

                const message = `📦 ${product.name}\n\n` +
                              `💰 Prix: ${product.price}€\n` +
                              `📝 ${product.description}\n\n` +
                              `🕒 Livraison: ${product.delivery.type === 'instant' ? 
                                'Immédiate' : 
                                `Sous ${product.delivery.processingTime.min}-${product.delivery.processingTime.max}h`}`;

                await ctx.reply(message, keyboard);
            }
        } catch (error) {
            logger.error('Erreur handleCategory:', error);
            ctx.reply('Erreur lors du chargement des produits.').catch(console.error);
        }
    }

    // Gestionnaire de produit
    async handleProduct(ctx) {
        try {
            const productId = ctx.match[1];
            const product = await Product.findById(productId)
                .populate('category');

            if (!product) {
                return ctx.reply('Produit non trouvé.');
            }

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('🛒 Ajouter au Panier', `add_to_cart_${product._id}`)],
                [Markup.button.callback('🔙 Retour à la Catégorie', `category_${product.category._id}`)]
            ]);

            let message = `📦 ${product.name}\n\n` +
                         `📝 Description détaillée:\n${product.description}\n\n` +
                         `💰 Prix: ${product.price}€\n` +
                         `🏷️ Catégorie: ${product.category.name}\n` +
                         `🕒 Délai de livraison: ${product.delivery.type === 'instant' ? 
                            'Immédiat' : 
                            `${product.delivery.processingTime.min}-${product.delivery.processingTime.max}h`}\n\n`;

            if (product.customFields && product.customFields.length > 0) {
                message += '📋 Informations requises lors de l\'achat:\n';
                product.customFields.forEach(field => {
                    message += `- ${field.question}${field.required ? ' (Requis)' : ''}\n`;
                });
            }

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur handleProduct:', error);
            ctx.reply('Erreur lors du chargement du produit.').catch(console.error);
        }
    }

    // Afficher le panier
    async showCart(ctx) {
        try {
            const cart = await Cart.getOrCreate(ctx.state.user.telegramId);
            await cart.populate('items.product');

            if (cart.items.length === 0) {
                return ctx.reply('🛒 Votre panier est vide.');
            }

            let message = '🛒 Votre Panier:\n\n';
            cart.items.forEach((item, index) => {
                message += `${index + 1}. ${item.product.name}\n` +
                          `   Quantité: ${item.quantity}\n` +
                          `   Prix: ${item.price.final}€\n\n`;
            });

            message += `\nSous-total: ${cart.summary.subtotal}€\n`;
            if (cart.summary.fees > 0) {
                message += `Frais: ${cart.summary.fees}€\n`;
            }
            message += `Total: ${cart.summary.total}€`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('💳 Payer', 'checkout')],
                [Markup.button.callback('🗑️ Vider le Panier', 'clear_cart')],
                [Markup.button.callback('🔙 Continuer les Achats', 'browse_categories')]
            ]);

            await ctx.reply(message, keyboard);
        } catch (error) {
            logger.error('Erreur showCart:', error);
            ctx.reply('Erreur lors de l\'affichage du panier.').catch(console.error);
        }
    }

    // Ajouter au panier
    async addToCart(ctx) {
        try {
            const productId = ctx.match[1];
            const cart = await Cart.getOrCreate(ctx.state.user.telegramId);
            
            await cart.addItem(productId);
            
            await ctx.reply('✅ Produit ajouté au panier!', 
                Markup.inlineKeyboard([
                    [Markup.button.callback('🛒 Voir le Panier', 'view_cart')],
                    [Markup.button.callback('🔙 Continuer les Achats', 'browse_categories')]
                ])
            );
        } catch (error) {
            logger.error('Erreur addToCart:', error);
            ctx.reply('Erreur lors de l\'ajout au panier.').catch(console.error);
        }
    }

    // Retirer du panier
    async removeFromCart(ctx) {
        try {
            const productId = ctx.match[1];
            const cart = await Cart.getOrCreate(ctx.state.user.telegramId);
            
            await cart.removeItem(productId);
            await this.showCart(ctx);
        } catch (error) {
            logger.error('Erreur removeFromCart:', error);
            ctx.reply('Erreur lors de la suppression du produit.').catch(console.error);
        }
    }

    // Afficher les paramètres
    async showSettings(ctx) {
        try {
            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('👤 Profil', 'settings_profile'),
                    Markup.button.callback('🔔 Notifications', 'settings_notifications')
                ],
                [
                    Markup.button.callback('💳 Méthodes de Paiement', 'settings_payment'),
                    Markup.button.callback('📜 Historique', 'settings_history')
                ],
                [Markup.button.callback('🔙 Retour au Menu', 'main_menu')]
            ]);

            await ctx.reply('⚙️ Paramètres', keyboard);
        } catch (error) {
            logger.error('Erreur showSettings:', error);
            ctx.reply('Erreur lors de l\'affichage des paramètres.').catch(console.error);
        }
    }

    // Démarrer le bot
    startBot() {
        this.bot.launch();
        logger.info('Bot démarré avec succès');

        // Gestion de l'arrêt gracieux
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}

module.exports = BotController;