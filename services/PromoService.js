// services/PromoService.js
// Service de gestion des promotions et codes promo

const { eventManager } = require('../utils/events');
const { Validator } = require('../utils/validation');
const Promotion = require('../models/Promotion');

class PromoService {
    constructor() {
        // Map pour stocker les codes promo actifs en cache
        this.activePromotions = new Map();
        
        // Durée du cache (1 heure)
        this.CACHE_DURATION = 60 * 60 * 1000;
    }

    // Valider et appliquer un code promo
    async applyPromoCode(cart, code) {
        try {
            const promo = await this.getPromotion(code);
            
            if (!promo) {
                throw new Error('Code promo invalide');
            }

            // Vérifier la validité de la promotion
            const validation = await this.validatePromotion(promo, cart);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }

            // Calculer la réduction
            const discount = await this.calculateDiscount(promo, cart);

            // Appliquer la réduction au panier
            cart.summary.discount = discount;
            cart.summary.total = cart.summary.subtotal + cart.summary.fees - discount;
            cart.appliedPromo = {
                code: promo.code,
                discount
            };

            // Mettre à jour l'utilisation de la promotion
            await this.updatePromoUsage(promo, cart.userId);

            await eventManager.emitEvent('promo_applied', {
                userId: cart.userId,
                promoCode: code,
                discount,
                cartId: cart._id
            });

            return cart;
        } catch (error) {
            console.error('Error applying promo code:', error);
            throw error;
        }
    }

    // Obtenir une promotion
    async getPromotion(code) {
        try {
            // Vérifier d'abord dans le cache
            let promo = this.activePromotions.get(code);
            
            if (!promo) {
                // Chercher dans la base de données
                promo = await Promotion.findOne({
                    code: code.toUpperCase(),
                    status: 'active',
                    startDate: { $lte: new Date() },
                    endDate: { $gte: new Date() }
                });

                if (promo) {
                    // Mettre en cache
                    this.activePromotions.set(code, promo);
                    setTimeout(() => {
                        this.activePromotions.delete(code);
                    }, this.CACHE_DURATION);
                }
            }

            return promo;
        } catch (error) {
            console.error('Error getting promotion:', error);
            throw error;
        }
    }

    // Valider une promotion
    async validatePromotion(promo, cart) {
        try {
            const errors = [];

            // Vérifier les dates
            const now = new Date();
            if (promo.startDate > now || promo.endDate < now) {
                errors.push('Cette promotion n\'est pas valide actuellement');
            }

            // Vérifier le nombre d'utilisations maximum
            if (promo.maxUses > 0 && promo.usageCount >= promo.maxUses) {
                errors.push('Cette promotion a atteint son nombre maximum d\'utilisations');
            }

            // Vérifier les conditions d'utilisation
            if (promo.minAmount && cart.summary.subtotal < promo.minAmount) {
                errors.push(`Le montant minimum d'achat est de ${promo.minAmount}€`);
            }

            if (promo.maxAmount && cart.summary.subtotal > promo.maxAmount) {
                errors.push(`Le montant maximum d'achat est de ${promo.maxAmount}€`);
            }

            // Vérifier l'utilisation par utilisateur
            if (promo.maxUsesPerUser > 0) {
                const userUsage = await this.getUserPromoUsage(promo._id, cart.userId);
                if (userUsage >= promo.maxUsesPerUser) {
                    errors.push('Vous avez déjà utilisé cette promotion le nombre maximum de fois');
                }
            }

            // Vérifier les catégories éligibles
            if (promo.eligibleCategories && promo.eligibleCategories.length > 0) {
                const hasIneligibleItems = cart.items.some(item => 
                    !promo.eligibleCategories.includes(item.product.category)
                );
                if (hasIneligibleItems) {
                    errors.push('Certains articles ne sont pas éligibles à cette promotion');
                }
            }

            // Vérifier les exclusions
            if (promo.excludedProducts && promo.excludedProducts.length > 0) {
                const hasExcludedItems = cart.items.some(item =>
                    promo.excludedProducts.includes(item.product._id)
                );
                if (hasExcludedItems) {
                    errors.push('Certains articles sont exclus de cette promotion');
                }
            }

            return {
                isValid: errors.length === 0,
                errors
            };
        } catch (error) {
            console.error('Error validating promotion:', error);
            throw error;
        }
    }

    // Calculer la réduction
    async calculateDiscount(promo, cart) {
        try {
            let discount = 0;

            switch (promo.type) {
                case 'percentage':
                    // Réduction en pourcentage
                    discount = (cart.summary.subtotal * promo.value) / 100;
                    break;

                case 'fixed':
                    // Réduction fixe
                    discount = promo.value;
                    break;

                case 'product_specific':
                    // Réduction sur des produits spécifiques
                    discount = cart.items.reduce((total, item) => {
                        if (promo.eligibleProducts.includes(item.product._id)) {
                            return total + ((item.price.unit * promo.value) / 100) * item.quantity;
                        }
                        return total;
                    }, 0);
                    break;

                case 'category_specific':
                    // Réduction sur des catégories spécifiques
                    discount = cart.items.reduce((total, item) => {
                        if (promo.eligibleCategories.includes(item.product.category)) {
                            return total + ((item.price.unit * promo.value) / 100) * item.quantity;
                        }
                        return total;
                    }, 0);
                    break;

                case 'buy_x_get_y':
                    // Promotion de type "achetez X, obtenez Y"
                    discount = this.calculateBuyXGetYDiscount(promo, cart);
                    break;
            }

            // Appliquer les limites de réduction
            if (promo.maxDiscount > 0) {
                discount = Math.min(discount, promo.maxDiscount);
            }

            return Math.round(discount * 100) / 100; // Arrondir à 2 décimales
        } catch (error) {
            console.error('Error calculating discount:', error);
            throw error;
        }
    }

    // Calculer la réduction pour les promotions "achetez X, obtenez Y"
    calculateBuyXGetYDiscount(promo, cart) {
        try {
            let discount = 0;
            const eligibleItems = cart.items.filter(item => {
                if (promo.eligibleProducts) {
                    return promo.eligibleProducts.includes(item.product._id);
                }
                if (promo.eligibleCategories) {
                    return promo.eligibleCategories.includes(item.product.category);
                }
                return true;
            });

            if (eligibleItems.length === 0) return 0;

            const { buyQuantity, getQuantity, discountPercent } = promo.buyXGetY;
            
            eligibleItems.forEach(item => {
                const sets = Math.floor(item.quantity / (buyQuantity + getQuantity));
                const discountedQuantity = sets * getQuantity;
                discount += (item.price.unit * discountedQuantity * discountPercent) / 100;
            });

            return discount;
        } catch (error) {
            console.error('Error calculating buy X get Y discount:', error);
            throw error;
        }
    }

    // Mettre à jour l'utilisation d'une promotion
    async updatePromoUsage(promo, userId) {
        try {
            await Promotion.updateOne(
                { _id: promo._id },
                {
                    $inc: { usageCount: 1 },
                    $push: {
                        usageHistory: {
                            userId,
                            usedAt: new Date()
                        }
                    }
                }
            );
        } catch (error) {
            console.error('Error updating promo usage:', error);
            throw error;
        }
    }

    // Obtenir l'utilisation d'une promotion par un utilisateur
    async getUserPromoUsage(promoId, userId) {
        try {
            const promo = await Promotion.findById(promoId);
            return promo.usageHistory.filter(usage => usage.userId === userId).length;
        } catch (error) {
            console.error('Error getting user promo usage:', error);
            throw error;
        }
    }

    // Créer une nouvelle promotion
    async createPromotion(promoData) {
        try {
            const validation = Validator.validatePromotion(promoData);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }

            const promotion = new Promotion(promoData);
            await promotion.save();

            await eventManager.emitEvent('promo_created', {
                promoId: promotion._id,
                code: promotion.code
            });

            return promotion;
        } catch (error) {
            console.error('Error creating promotion:', error);
            throw error;
        }
    }

    // Désactiver une promotion
    async deactivatePromotion(promoId) {
        try {
            const promotion = await Promotion.findByIdAndUpdate(
                promoId,
                { status: 'inactive' },
                { new: true }
            );

            if (promotion) {
                this.activePromotions.delete(promotion.code);
                await eventManager.emitEvent('promo_deactivated', {
                    promoId: promotion._id,
                    code: promotion.code
                });
            }

            return promotion;
        } catch (error) {
            console.error('Error deactivating promotion:', error);
            throw error;
        }
    }
}

module.exports = new PromoService();