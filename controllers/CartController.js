// controllers/CartController.js
// Contrôleur de gestion du panier pour le bot Telegram

const { Markup } = require('telegraf');
const logger = require('../utils/logger');
const CartService = require('../services/CartService');
const { Validator } = require('../utils/validation');

class CartController {
    constructor(bot) {
        this.bot = bot;
        this.initializeCartHandlers();
    }

    initializeCartHandlers() {
        // Commandes du panier
        this.bot.command('cart', this.showCart.bind(this));
        this.bot.action('view_cart', this.showCart.bind(this));
        
        // Actions sur les produits
        this.bot.action(/^add_to_cart_(\w+)$/, this.handleAddToCart.bind(this));
        this.bot.action(/^remove_from_cart_(\w+)$/, this.handleRemoveFromCart.bind(this));
        this.bot.action(/^update_quantity_(\w+)$/, this.handleQuantityUpdate.bind(this));
        
        // Gestion du panier
        this.bot.action('clear_cart', this.handleClearCart.bind(this));
        this.bot.action('apply_promo', this.handlePromoCode.bind(this));
        this.bot.action('checkout_cart', this.handleCheckout.bind(this));

        // Gestion des questions personnalisées
        this.bot.action(/^custom_field_(\w+)_(\w+)$/, this.handleCustomField.bind(this));
    }

    // Afficher le panier
    async showCart(ctx) {
        try {
            const userId = ctx.from.id;
            const cart = await CartService.getOrCreateCart(userId);

            if (cart.items.length === 0) {
                return ctx.reply(
                    '🛒 Votre panier est vide',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('🛍️ Parcourir les produits', 'browse_products')]
                    ])
                );
            }

            await this.renderCart(ctx, cart);
        } catch (error) {
            logger.error('Error showing cart:', error);
            ctx.reply('Une erreur est survenue lors de l\'affichage du panier.').catch(console.error);
        }
    }

    // Rendu du panier
    async renderCart(ctx, cart) {
        try {
            let message = '🛒 Votre Panier:\n\n';

            for (const item of cart.items) {
                message += `📦 ${item.product.name}\n`;
                message += `   Quantité: ${item.quantity}\n`;
                message += `   Prix unitaire: ${item.price.unit}€\n`;
                message += `   Total: ${item.price.final}€\n\n`;

                if (item.customFields && item.customFields.length > 0) {
                    message += '   📝 Informations personnalisées:\n';
                    item.customFields.forEach(field => {
                        message += `   - ${field.label}: ${field.value || 'Non renseigné'}\n`;
                    });
                    message += '\n';
                }
            }

            message += `\n💰 Sous-total: ${cart.summary.subtotal}€\n`;
            if (cart.summary.fees > 0) {
                message += `💳 Frais: ${cart.summary.fees}€\n`;
            }
            message += `📊 Total: ${cart.summary.total}€`;

            const keyboard = [
                ...cart.items.map(item => ([
                    Markup.button.callback('➖', `remove_from_cart_${item.product._id}`),
                    Markup.button.callback(`${item.quantity}x`, `update_quantity_${item.product._id}`),
                    Markup.button.callback('➕', `add_to_cart_${item.product._id}`)
                ])),
                [
                    Markup.button.callback('🗑️ Vider', 'clear_cart'),
                    Markup.button.callback('🏷️ Code Promo', 'apply_promo')
                ],
                [Markup.button.callback('💳 Commander', 'checkout_cart')],
                [Markup.button.callback('🔙 Retour', 'main_menu')]
            ];

            await ctx.reply(message, Markup.inlineKeyboard(keyboard));
        } catch (error) {
            logger.error('Error rendering cart:', error);
            throw error;
        }
    }

    // Gérer l'ajout au panier
    async handleAddToCart(ctx) {
        try {
            const userId = ctx.from.id;
            const productId = ctx.match[1];

            // Vérifier si le produit nécessite des infos personnalisées
            const product = await Product.findById(productId);
            if (product.customFields && product.customFields.length > 0) {
                ctx.session.pendingProduct = {
                    productId,
                    currentField: 0
                };
                return this.askCustomField(ctx, product.customFields[0]);
            }

            const cart = await CartService.addToCart(userId, productId);
            await ctx.answerCbQuery('✅ Produit ajouté au panier');
            await this.renderCart(ctx, cart);
        } catch (error) {
            logger.error('Error adding to cart:', error);
            ctx.answerCbQuery('❌ Erreur lors de l\'ajout au panier').catch(console.error);
        }
    }

    // Gérer la suppression du panier
    async handleRemoveFromCart(ctx) {
        try {
            const userId = ctx.from.id;
            const productId = ctx.match[1];

            const cart = await CartService.removeFromCart(userId, productId);
            await ctx.answerCbQuery('✅ Produit retiré du panier');
            
            if (cart.items.length === 0) {
                return ctx.reply(
                    '🛒 Votre panier est vide',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('🛍️ Parcourir les produits', 'browse_products')]
                    ])
                );
            }

            await this.renderCart(ctx, cart);
        } catch (error) {
            logger.error('Error removing from cart:', error);
            ctx.answerCbQuery('❌ Erreur lors de la suppression').catch(console.error);
        }
    }

    // Gérer la mise à jour de la quantité
    async handleQuantityUpdate(ctx) {
        try {
            const userId = ctx.from.id;
            const productId = ctx.match[1];

            ctx.session.quantityUpdate = { productId };

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('1', `set_quantity_${productId}_1`),
                    Markup.button.callback('2', `set_quantity_${productId}_2`),
                    Markup.button.callback('3', `set_quantity_${productId}_3`)
                ],
                [
                    Markup.button.callback('4', `set_quantity_${productId}_4`),
                    Markup.button.callback('5', `set_quantity_${productId}_5`),
                    Markup.button.callback('6', `set_quantity_${productId}_6`)
                ],
                [Markup.button.callback('❌ Annuler', 'cancel_quantity')]
            ]);

            await ctx.reply('Choisissez la quantité:', keyboard);
        } catch (error) {
            logger.error('Error updating quantity:', error);
            ctx.answerCbQuery('❌ Erreur lors de la mise à jour').catch(console.error);
        }
    }

    // Gérer la suppression du panier
    async handleClearCart(ctx) {
        try {
            const userId = ctx.from.id;
            await CartService.clearCart(userId);

            await ctx.reply(
                '🗑️ Votre panier a été vidé',
                Markup.inlineKeyboard([
                    [Markup.button.callback('🛍️ Parcourir les produits', 'browse_products')]
                ])
            );
        } catch (error) {
            logger.error('Error clearing cart:', error);
            ctx.reply('❌ Erreur lors de la suppression du panier').catch(console.error);
        }
    }

    // Gérer l'application d'un code promo
    async handlePromoCode(ctx) {
        try {
            ctx.session.awaitingPromoCode = true;
            await ctx.reply(
                '🏷️ Entrez votre code promo:',
                Markup.keyboard([['❌ Annuler']])
                    .oneTime()
                    .resize()
            );
        } catch (error) {
            logger.error('Error handling promo code:', error);
            ctx.reply('❌ Erreur lors de l\'application du code promo').catch(console.error);
        }
    }

    // Gérer le début du checkout
    async handleCheckout(ctx) {
        try {
            const userId = ctx.from.id;
            const cart = await CartService.getOrCreateCart(userId);

            // Valider le panier
            const validation = await CartService.validateCart(userId);
            if (!validation.isValid) {
                return ctx.reply(
                    '⚠️ Problèmes avec votre panier:\n' +
                    validation.errors.join('\n')
                );
            }

            // Transférer vers le processus de paiement
            ctx.session.checkout = { cartId: cart._id };
            await ctx.reply('💳 Choisissez votre méthode de paiement:');
            // Continuer avec PaymentController...
        } catch (error) {
            logger.error('Error starting checkout:', error);
            ctx.reply('❌ Erreur lors du passage à la caisse').catch(console.error);
        }
    }

    // Gérer les champs personnalisés
    async handleCustomField(ctx) {
        try {
            const userId = ctx.from.id;
            const [productId, fieldIndex] = ctx.match[1];
            const field = await CustomField.findById(fieldIndex);

            if (!field) {
                throw new Error('Champ personnalisé non trouvé');
            }

            ctx.session.customField = {
                productId,
                fieldIndex,
                fieldType: field.type
            };

            await ctx.reply(
                `📝 ${field.question}`,
                Markup.keyboard([['❌ Annuler']])
                    .oneTime()
                    .resize()
            );
        } catch (error) {
            logger.error('Error handling custom field:', error);
            ctx.reply('❌ Erreur lors de la saisie du champ').catch(console.error);
        }
    }

    // Traiter la réponse d'un champ personnalisé
    async processCustomFieldResponse(ctx) {
        try {
            const { customField } = ctx.session;
            if (!customField) return false;

            const { productId, fieldIndex, fieldType } = customField;
            let value;

            switch (fieldType) {
                case 'text':
                    value = ctx.message.text;
                    break;
                case 'photo':
                    value = ctx.message.photo[0].file_id;
                    break;
                case 'document':
                    value = ctx.message.document.file_id;
                    break;
                default:
                    value = ctx.message.text;
            }

            // Valider et sauvegarder la réponse
            await CartService.updateCustomField(
                ctx.from.id,
                productId,
                fieldIndex,
                value
            );

            delete ctx.session.customField;
            await ctx.reply('✅ Information enregistrée');
            return true;
        } catch (error) {
            logger.error('Error processing custom field response:', error);
            return false;
        }
    }
}

module.exports = CartController;