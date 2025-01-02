// models/Promotion.js
// Modèle de données pour les promotions

const mongoose = require('mongoose');

const promotionSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    type: {
        type: String,
        required: true,
        enum: ['percentage', 'fixed', 'product_specific', 'category_specific', 'buy_x_get_y']
    },
    value: {
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        required: true,
        enum: ['active', 'inactive', 'expired'],
        default: 'active'
    },
    description: {
        type: String,
        required: true
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    minAmount: {
        type: Number,
        min: 0,
        default: 0
    },
    maxAmount: {
        type: Number,
        min: 0,
        default: 0
    },
    maxDiscount: {
        type: Number,
        min: 0,
        default: 0
    },
    maxUses: {
        type: Number,
        min: 0,
        default: 0
    },
    maxUsesPerUser: {
        type: Number,
        min: 0,
        default: 1
    },
    usageCount: {
        type: Number,
        default: 0
    },
    usageHistory: [{
        userId: String,
        usedAt: Date
    }],
    eligibleProducts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }],
    eligibleCategories: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    }],
    excludedProducts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }],
    buyXGetY: {
        buyQuantity: Number,
        getQuantity: Number,
        discountPercent: Number
    },
    metadata: {
        createdBy: String,
        lastModifiedBy: String
    }
}, {
    timestamps: true
});

// Index pour améliorer les performances des recherches
promotionSchema.index({ code: 1 });
promotionSchema.index({ status: 1 });
promotionSchema.index({ startDate: 1, endDate: 1 });

// Méthode pour vérifier si la promotion est active
promotionSchema.methods.isActive = function() {
    const now = new Date();
    return (
        this.status === 'active' &&
        this.startDate <= now &&
        this.endDate >= now &&
        (this.maxUses === 0 || this.usageCount < this.maxUses)
    );
};

// Méthode pour vérifier si un utilisateur peut utiliser la promotion
promotionSchema.methods.canBeUsedByUser = async function(userId) {
    if (this.maxUsesPerUser === 0) return true;
    
    const userUsageCount = this.usageHistory.filter(
        usage => usage.userId === userId
    ).length;
    
    return userUsageCount < this.maxUsesPerUser;
};

// Hook pre-save pour la validation des dates
promotionSchema.pre('save', function(next) {
    if (this.startDate >= this.endDate) {
        next(new Error('La date de fin doit être postérieure à la date de début'));
    }
    if (this.type === 'buy_x_get_y' && (!this.buyXGetY || !this.buyXGetY.buyQuantity)) {
        next(new Error('Les paramètres buyXGetY sont requis pour ce type de promotion'));
    }
    next();
});

const Promotion = mongoose.model('Promotion', promotionSchema);

module.exports = Promotion;