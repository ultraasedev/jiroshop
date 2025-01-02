const mongoose = require('mongoose');
const logger = require('../utils/logger');

const cartSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true
    },
    items: [{
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        addedAt: {
            type: Date,
            default: Date.now
        },
        customFields: [{
            question: String,
            answer: String,
            fileUrl: String
        }],
        price: {
            original: Number,
            final: Number
        }
    }],
    summary: {
        subtotal: Number,
        fees: Number,
        total: Number
    },
    selectedPaymentMethod: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PaymentMethod'
    },
    promoCode: {
        code: String,
        discount: Number,
        type: {
            type: String,
            enum: ['percentage', 'fixed']
        },
        appliedAt: Date
    },
    status: {
        type: String,
        enum: ['active', 'abandoned', 'converted'],
        default: 'active'
    },
    lastActivity: {
        type: Date,
        default: Date.now
    },
    metadata: {
        platform: String,
        source: String,
        sessionId: String
    }
}, {
    timestamps: true
});

// Indexes
cartSchema.index({ userId: 1 });
cartSchema.index({ status: 1 });
cartSchema.index({ lastActivity: 1 });

// Méthodes d'instance
cartSchema.methods = {
    // Ajouter un produit au panier
    async addItem(productId, quantity = 1, customFields = []) {
        try {
            const product = await mongoose.model('Product').findById(productId);
            if (!product || !product.isAvailable()) {
                throw new Error('Produit non disponible');
            }

            // Vérifier si le produit existe déjà dans le panier
            const existingItem = this.items.find(
                item => item.product.toString() === productId.toString()
            );

            if (existingItem) {
                existingItem.quantity += quantity;
                existingItem.customFields = customFields;
            } else {
                this.items.push({
                    product: productId,
                    quantity,
                    customFields,
                    price: {
                        original: product.price,
                        final: product.calculateFinalPrice()
                    }
                });
            }

            await this.updateTotals();
            await this.save();

            logger.info('Produit ajouté au panier:', {
                userId: this.userId,
                productId,
                quantity
            });

            return this;
        } catch (error) {
            logger.error('Erreur lors de l\'ajout au panier:', error);
            throw error;
        }
    },

    // Mettre à jour la quantité d'un produit
    async updateQuantity(productId, quantity) {
        const itemIndex = this.items.findIndex(
            item => item.product.toString() === productId.toString()
        );

        if (itemIndex === -1) {
            throw new Error('Produit non trouvé dans le panier');
        }

        if (quantity <= 0) {
            this.items.splice(itemIndex, 1);
        } else {
            this.items[itemIndex].quantity = quantity;
        }

        await this.updateTotals();
        await this.save();

        return this;
    },

    // Supprimer un produit du panier
    async removeItem(productId) {
        this.items = this.items.filter(
            item => item.product.toString() !== productId.toString()
        );
        await this.updateTotals();
        await this.save();

        return this;
    },

    // Vider le panier
    async clear() {
        this.items = [];
        this.promoCode = undefined;
        this.summary = {
            subtotal: 0,
            fees: 0,
            total: 0
        };
        await this.save();

        return this;
    },

    // Mettre à jour les totaux
    async updateTotals() {
        let subtotal = 0;
        let fees = 0;

        // Calculer le sous-total
        for (const item of this.items) {
            const product = await mongoose.model('Product').findById(item.product);
            if (product) {
                item.price = {
                    original: product.price,
                    final: product.calculateFinalPrice()
                };
                subtotal += item.price.final * item.quantity;
            }
        }

        // Appliquer le code promo si présent
        if (this.promoCode) {
            const discount = this.promoCode.type === 'percentage'
                ? subtotal * (this.promoCode.discount / 100)
                : this.promoCode.discount;
            subtotal -= discount;
        }

        // Calculer les frais si une méthode de paiement est sélectionnée
        if (this.selectedPaymentMethod) {
            const paymentMethod = await mongoose.model('PaymentMethod')
                .findById(this.selectedPaymentMethod);
            if (paymentMethod) {
                fees = paymentMethod.calculateFees(subtotal);
            }
        }

        this.summary = {
            subtotal: Math.max(0, subtotal),
            fees,
            total: Math.max(0, subtotal + fees)
        };

        this.lastActivity = new Date();
    },

    // Appliquer un code promo
    async applyPromoCode(code) {
        // Ici, vous devriez implémenter la vérification des codes promo
        // dans votre système
        const promoCode = await mongoose.model('PromoCode').findOne({
            code,
            active: true,
            validUntil: { $gt: new Date() }
        });

        if (!promoCode) {
            throw new Error('Code promo invalide ou expiré');
        }

        this.promoCode = {
            code: promoCode.code,
            discount: promoCode.discount,
            type: promoCode.type,
            appliedAt: new Date()
        };

        await this.updateTotals();
        await this.save();

        return this;
    },

    // Convertir le panier en commande
    async convertToOrder(userId) {
        try {
            if (!this.items.length) {
                throw new Error('Le panier est vide');
            }

            // Vérifier la disponibilité des produits
            for (const item of this.items) {
                const product = await mongoose.model('Product').findById(item.product);
                if (!product || !await product.canBePurchasedBy(userId)) {
                    throw new Error(`Produit non disponible: ${product.name}`);
                }
            }

            // Créer la commande
            const Order = mongoose.model('Order');
            const order = new Order({
                user: {
                    id: userId
                },
                products: this.items.map(item => ({
                    product: item.product,
                    quantity: item.quantity,
                    price: item.price.final,
                    customFields: item.customFields
                })),
                payment: {
                    method: this.selectedPaymentMethod,
                    amount: this.summary
                }
            });

            await order.save();

            // Marquer le panier comme converti
            this.status = 'converted';
            await this.save();

            return order;
        } catch (error) {
            logger.error('Erreur lors de la conversion du panier en commande:', error);
            throw error;
        }
    }
};

// Méthodes statiques
cartSchema.statics = {
    // Récupérer ou créer un panier pour un utilisateur
    async getOrCreate(userId) {
        let cart = await this.findOne({ userId, status: 'active' });
        
        if (!cart) {
            cart = new this({
                userId,
                items: [],
                summary: {
                    subtotal: 0,
                    fees: 0,
                    total: 0
                }
            });
            await cart.save();
        }

        return cart;
    },

    // Nettoyer les paniers abandonnés
    async cleanupAbandoned(hours = 72) {
        const date = new Date();
        date.setHours(date.getHours() - hours);

        const abandonedCarts = await this.find({
            status: 'active',
            lastActivity: { $lt: date }
        });

        for (const cart of abandonedCarts) {
            cart.status = 'abandoned';
            await cart.save();
        }

        return abandonedCarts.length;
    }
};

// Hooks
cartSchema.pre('save', async function() {
    this.lastActivity = new Date();
});

cartSchema.post('save', function(doc) {
    logger.info('Panier mis à jour:', {
        userId: doc.userId,
        itemCount: doc.items.length,
        total: doc.summary.total
    });
});

const Cart = mongoose.model('Cart', cartSchema);

module.exports = Cart;