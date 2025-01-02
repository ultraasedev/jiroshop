const mongoose = require('mongoose');
const logger = require('../utils/logger');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Le nom de la catégorie est requis'],
        trim: true,
        unique: true
    },
    description: {
        type: String,
        required: [true, 'La description est requise'],
        trim: true
    },
    slug: {
        type: String,
        unique: true,
        lowercase: true
    },
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null
    },
    image: {
        type: String,
        default: null
    },
    active: {
        type: Boolean,
        default: true
    },
    order: {
        type: Number,
        default: 0
    },
    metadata: {
        keywords: [String],
        customFields: [{
            key: String,
            value: String
        }]
    }
}, {
    timestamps: true
});

// Middleware pre-save pour générer le slug
categorySchema.pre('save', function(next) {
    if (this.isModified('name')) {
        this.slug = this.name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }
    next();
});

// Méthodes statiques
categorySchema.statics.getFullPath = async function(categoryId) {
    try {
        let path = [];
        let currentCategory = await this.findById(categoryId);
        
        while (currentCategory) {
            path.unshift(currentCategory);
            currentCategory = currentCategory.parent ? 
                await this.findById(currentCategory.parent) : null;
        }
        
        return path;
    } catch (error) {
        logger.error('Erreur lors de la récupération du chemin de la catégorie:', error);
        throw error;
    }
};

// Méthodes d'instance
categorySchema.methods.getSubcategories = async function() {
    try {
        return await this.model('Category').find({ parent: this._id });
    } catch (error) {
        logger.error('Erreur lors de la récupération des sous-catégories:', error);
        throw error;
    }
};

// Index composé pour l'ordre et le parent
categorySchema.index({ parent: 1, order: 1 });

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;