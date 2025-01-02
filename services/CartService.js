// services/CartService.js
// Service de gestion du panier pour le bot e-shop Telegram

const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { eventManager } = require('../utils/events');
const { Validator } = require('../utils/validation');

class CartService {
    constructor() {
        // Map pour stocker les paniers en mémoire temporairement
        this.activeCarts = new Map();
        
        // Durée de vie d'un panier (2 heures)
        this.CART_LIFETIME = 2 * 60 * 60 * 1000;
    }

    // Obtenir ou créer un panier
    async getOrCreateCart(userId) {
        try {
            // Vérifier d'abord en mémoire
            let cart = this.activeCarts.get(userId);
            
            if (!cart) {
                // Chercher dans la base de données
                cart = await Cart.findOne({ userId, status: 'active' });
                
                if (!cart) {
                    // Créer un nouveau panier
                    cart = new Cart({
                        userId,
                        items: [],
                        status: 'active',
                        summary: {
                            subtotal: 0,
                            fees: 0,
                            total: 0
                        }
                    });
                    await cart.save();
                }

                // Mettre en mémoire
                this.activeCarts.set(userId, cart);
                
                // Configurer l'expiration
                setTimeout(() => {
                    this.activeCarts.delete(userId);
                }, this.CART_LIFETIME);
            }

            return cart;
        } catch (error) {
            console.error('Error getting/creating cart:', error);
            throw error;
        }
    }

    // Ajouter un produit au panier
    async addToCart(userId, productId, quantity = 1, customFields = []) {
        try {
            const cart = await this.getOrCreateCart(userId);
            const product = await Product.findById(productId);

            if (!product) {
                throw new Error('Product not found');
            }

            // Valider la quantité
            if (product.stock !== -1 && quantity > product.stock) {
                throw new Error('Insufficient stock');
            }

            // Valider les champs personnalisés
            if (product.customFields) {
                const validation = Validator.validateCustomFields(customFields);
                if (!validation.isValid) {
                    throw new Error(`Invalid custom fields: ${validation.errors.join(', ')}`);
                }
            }

            // Vérifier si le produit est déjà dans le panier
            const existingItem = cart.items.find(
                item => item.product.toString() === productId
            );

            if (existingItem) {
                existingItem.quantity += quantity;
                existingItem.price = {
                    unit: product.price,
                    final: product.price * existingItem.quantity
                };
            } else {
                cart.items.push({
                    product: productId,
                    quantity,
                    price: {
                        unit: product.price,
                        final: product.price * quantity
                    },
                    customFields
                });
            }

            // Mettre à jour les totaux
            await this.updateCartTotals(cart);
            await cart.save();

            // Événement
            await eventManager.handleCartEvent(
                eventManager.events.CART_UPDATED,
                cart
            );

            return cart;
        } catch (error) {
            console.error('Error adding to cart:', error);
            throw error;
        }
    }

    // Mettre à jour la quantité d'un produit
    async updateQuantity(userId, productId, quantity) {
        try {
            const cart = await this.getOrCreateCart(userId);
            const itemIndex = cart.items.findIndex(
                item => item.product.toString() === productId
            );

            if (itemIndex === -1) {
                throw new Error('Product not found in cart');
            }

            const product = await Product.findById(productId);
            if (!product) {
                throw new Error('Product not found');
            }

            // Vérifier le stock
            if (product.stock !== -1 && quantity > product.stock) {
                throw new Error('Insufficient stock');
            }

            if (quantity <= 0) {
                // Supprimer l'article
                cart.items.splice(itemIndex, 1);
            } else {
                // Mettre à jour la quantité
                cart.items[itemIndex].quantity = quantity;
                cart.items[itemIndex].price = {
                    unit: product.price,
                    final: product.price * quantity
                };
            }

            await this.updateCartTotals(cart);
            await cart.save();

            await eventManager.handleCartEvent(
                eventManager.events.CART_UPDATED,
                cart
            );

            return cart;
        } catch (error) {
            console.error('Error updating quantity:', error);
            throw error;
        }
    }

    // Supprimer un produit du panier
    async removeFromCart(userId, productId) {
        try {
            const cart = await this.getOrCreateCart(userId);
            const itemIndex = cart.items.findIndex(
                item => item.product.toString() === productId
            );

            if (itemIndex === -1) {
                throw new Error('Product not found in cart');
            }

            cart.items.splice(itemIndex, 1);
            await this.updateCartTotals(cart);
            await cart.save();

            await eventManager.handleCartEvent(
                eventManager.events.CART_UPDATED,
                cart
            );

            return cart;
        } catch (error) {
            console.error('Error removing from cart:', error);
            throw error;
        }
    }

    // Vider le panier
    async clearCart(userId) {
        try {
            const cart = await this.getOrCreateCart(userId);
            cart.items = [];
            cart.summary = {
                subtotal: 0,
                fees: 0,
                total: 0
            };

            await cart.save();
            this.activeCarts.delete(userId);

            await eventManager.handleCartEvent(
                eventManager.events.CART_CLEARED,
                cart
            );

            return cart;
        } catch (error) {
            console.error('Error clearing cart:', error);
            throw error;
        }
    }

    // Mettre à jour les totaux du panier
    async updateCartTotals(cart) {
        try {
            let subtotal = 0;
            let fees = 0;

            // Calculer le sous-total
            for (const item of cart.items) {
                const product = await Product.findById(item.product);
                if (product) {
                    subtotal += product.price * item.quantity;
                    if (product.fees) {
                        fees += product.fees * item.quantity;
                    }
                }
            }

            cart.summary = {
                subtotal,
                fees,
                total: subtotal + fees
            };

            return cart.summary;
        } catch (error) {
            console.error('Error updating cart totals:', error);
            throw error;
        }
    }

    // Appliquer un code promo
    async applyPromoCode(userId, promoCode) {
        try {
            const cart = await this.getOrCreateCart(userId);
            // Implémenter la logique des codes promo
            return cart;
        } catch (error) {
            console.error('Error applying promo code:', error);
            throw error;
        }
    }

    // Vérifier la validité du panier
    async validateCart(userId) {
        try {
            const cart = await this.getOrCreateCart(userId);
            const errors = [];

            if (cart.items.length === 0) {
                errors.push('Le panier est vide');
                return { isValid: false, errors };
            }

            // Vérifier chaque produit
            for (const item of cart.items) {
                const product = await Product.findById(item.product);
                
                if (!product) {
                    errors.push(`Produit non trouvé: ${item.product}`);
                    continue;
                }

                if (product.stock !== -1 && item.quantity > product.stock) {
                    errors.push(`Stock insuffisant pour ${product.name}`);
                }

                if (product.status !== 'active') {
                    errors.push(`Le produit ${product.name} n'est plus disponible`);
                }
            }

            return {
                isValid: errors.length === 0,
                errors
            };
        } catch (error) {
            console.error('Error validating cart:', error);
            throw error;
        }
    }
}

module.exports = new CartService();