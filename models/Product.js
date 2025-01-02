const mongoose = require('mongoose');
const logger = require('../utils/logger');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Le nom du produit est requis'],
        trim: true
    },
    description: {
        type: String,
        required: [true, 'La description est requise'],
        trim: true
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: [true, 'La catégorie est requise']
    },
    price: {
        type: Number,
        required: [true, 'Le prix est requis'],
        min: [0, 'Le prix ne peut pas être négatif']
    },
    images: [{
        url: String,
        order: Number,
        isMain: Boolean
    }],
    delivery: {
        type: {
            type: String,
            enum: ['instant', 'delayed'],
            required: true
        },
        processingTime: {
            min: Number, // en heures
            max: Number,
            message: String
        }
    },
    customFields: [{
        question: {
            type: String,
            required: true
        },
        required: {
            type: Boolean,
            default: true
        },
        type: {
            type: String,
            enum: ['text', 'file', 'choice', 'date'],
            default: 'text'
        },
        options: [String], // Pour le type 'choice'
        validation: {
            regex: String,
            message: String
        }
    }],
    stock: {
        type: Number,
        default: -1 // -1 pour stock illimité
    },
    status: {
        type: String,
        enum: ['draft', 'active', 'inactive', 'archived'],
        default: 'draft'
    },
    pricing: {
        base: Number,
        discount: {
            type: Number,
            default: 0
        },
        discountType: {
            type: String,
            enum: ['percentage', 'fixed'],
            default: 'percentage'
        },
        discountValidUntil: Date
    },
    restrictions: {
        minAge: {
            type: Number,
            default: 0
        },
        maxPerUser: {
            type: Number,
            default: -1 // -1 pour illimité
        },
        requiresVerification: {
            type: Boolean,
            default: false
        }
    },
    metadata: {
        keywords: [String],
        customData: mongoose.Schema.Types.Mixed
    }
}, {
    timestamps: true
});

// Index pour la recherche
productSchema.index({
    name: 'text',
    description: 'text',
    'metadata.keywords': 'text'
});

// Middleware pre-save
productSchema.pre('save', async function(next) {
    if (this.isModified('pricing')) {
        // Recalculer le prix final
        this.price = this.calculateFinalPrice();
    }
    next();
});

// Méthodes d'instance
productSchema.methods = {
    // Calculer le prix final avec les réductions
    calculateFinalPrice() {
        if (!this.pricing.discount || !this.pricing.discountValidUntil || 
            new Date() > this.pricing.discountValidUntil) {
            return this.pricing.base;
        }

        if (this.pricing.discountType === 'percentage') {
            return this.pricing.base * (1 - this.pricing.discount / 100);
        } else {
            return Math.max(0, this.pricing.base - this.pricing.discount);
        }
    },

    // Vérifier si le produit est disponible
    async isAvailable() {
        return this.status === 'active' && 
               (this.stock === -1 || this.stock > 0);
    },

    // Vérifier si un utilisateur peut acheter ce produit
    async canBePurchasedBy(userId) {
        try {
            if (!await this.isAvailable()) return false;

            if (this.restrictions.maxPerUser !== -1) {
                const Order = mongoose.model('Order');
                const userOrders = await Order.countDocuments({
                    'user': userId,
                    'products.product': this._id
                });
                if (userOrders >= this.restrictions.maxPerUser) return false;
            }

            return true;
        } catch (error) {
            logger.error('Erreur lors de la vérification d\'achat:', error);
            return false;
        }
    },

    // Réserver un produit pour un achat
    async reserve(quantity = 1) {
        try {
            if (this.stock === -1) return true;
            
            if (this.stock >= quantity) {
                this.stock -= quantity;
                await this.save();
                return true;
            }
            return false;
        } catch (error) {
            logger.error('Erreur lors de la réservation du produit:', error);
            return false;
        }
    }
};

// Méthodes statiques
productSchema.statics = {
    // Rechercher des produits avec filtres avancés
    async search(criteria = {}) {
        try {
            const query = {};
            
            if (criteria.category) {
                const Category = mongoose.model('Category');
                const categoryIds = await Category.find({
                    $or: [
                        { _id: criteria.category },
                        { parent: criteria.category }
                    ]
                }).distinct('_id');
                query.category = { $in: categoryIds };
            }

            if (criteria.priceRange) {
                query.price = {
                    $gte: criteria.priceRange.min || 0,
                    $lte: criteria.priceRange.max || Infinity
                };
            }

            if (criteria.text) {
                query.$text = { $search: criteria.text };
            }

            if (criteria.status) {
                query.status = criteria.status;
            }

            return await this.find(query)
                .populate('category')
                .sort(criteria.sort || { createdAt: -1 })
                .skip(criteria.skip || 0)
                .limit(criteria.limit || 20);
        } catch (error) {
            logger.error('Erreur lors de la recherche de produits:', error);
            throw error;
        }
    },

    // Mettre à jour le stock en masse
    async updateStock(updates) {
        try {
            const bulkOps = updates.map(update => ({
                updateOne: {
                    filter: { _id: update.productId },
                    update: { $set: { stock: update.newStock } }
                }
            }));

            return await this.bulkWrite(bulkOps);
        } catch (error) {
            logger.error('Erreur lors de la mise à jour du stock:', error);
            throw error;
        }
    }
};

// Hooks pour la journalisation des modifications importantes
productSchema.post('save', function(doc) {
    logger.info('Produit modifié:', {
        productId: doc._id,
        name: doc.name,
        status: doc.status,
        stock: doc.stock
    });
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product;