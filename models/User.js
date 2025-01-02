const mongoose = require('mongoose');
const logger = require('../utils/logger');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
    telegramId: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['user', 'admin', 'superadmin'],
        default: 'user'
    },
    status: {
        type: String,
        enum: ['active', 'suspended', 'banned'],
        default: 'active'
    },
    profile: {
        firstName: String,
        lastName: String,
        email: String,
        phone: String,
        language: {
            type: String,
            default: 'fr'
        }
    },
    verification: {
        email: {
            verified: Boolean,
            token: String,
            expiry: Date
        },
        phone: {
            verified: Boolean,
            token: String,
            expiry: Date
        },
        documents: [{
            type: String,
            status: {
                type: String,
                enum: ['pending', 'approved', 'rejected']
            },
            url: String,
            notes: String,
            verifiedAt: Date
        }]
    },
    preferences: {
        notifications: {
            orderUpdates: {
                type: Boolean,
                default: true
            },
            promotions: {
                type: Boolean,
                default: true
            },
            newsletter: {
                type: Boolean,
                default: false
            }
        },
        paymentMethods: [{
            method: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'PaymentMethod'
            },
            isDefault: Boolean,
            lastUsed: Date
        }]
    },
    security: {
        loginAttempts: {
            type: Number,
            default: 0
        },
        lastLoginAttempt: Date,
        lastSuccessfulLogin: Date,
        ipHistory: [{
            ip: String,
            timestamp: Date
        }],
        twoFactorAuth: {
            enabled: {
                type: Boolean,
                default: false
            },
            secret: String,
            backupCodes: [String]
        }
    },
    wallet: {
        balance: {
            type: Number,
            default: 0
        },
        transactions: [{
            type: {
                type: String,
                enum: ['credit', 'debit']
            },
            amount: Number,
            description: String,
            reference: String,
            timestamp: Date
        }]
    },
    stats: {
        totalOrders: {
            type: Number,
            default: 0
        },
        totalSpent: {
            type: Number,
            default: 0
        },
        lastOrder: Date,
        favoriteCategories: [{
            category: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Category'
            },
            count: Number
        }]
    },
    adminData: {
        permissions: [{
            type: String
        }],
        notes: [{
            content: String,
            addedBy: String,
            timestamp: Date
        }],
        restrictedAccess: {
            type: Boolean,
            default: false
        }
    }
}, {
    timestamps: true
});

// Indexes
userSchema.index({ telegramId: 1 });
userSchema.index({ username: 1 });
userSchema.index({ 'profile.email': 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });

// Méthodes d'instance
userSchema.methods = {
    // Vérifier si l'utilisateur a une permission spécifique
    hasPermission(permission) {
        if (this.role === 'superadmin') return true;
        return this.adminData.permissions.includes(permission);
    },

    // Vérifier le niveau d'accès pour une ressource
    async canAccess(resource, action) {
        if (this.status !== 'active') return false;
        if (this.role === 'superadmin') return true;

        const permissionMap = {
            orders: {
                view: ['view_orders'],
                create: ['create_orders'],
                update: ['update_orders'],
                delete: ['delete_orders']
            },
            products: {
                view: ['view_products'],
                create: ['create_products'],
                update: ['update_products'],
                delete: ['delete_products']
            },
            categories: {
                view: ['view_categories'],
                create: ['create_categories'],
                update: ['update_categories'],
                delete: ['delete_categories']
            },
            users: {
                view: ['view_users'],
                create: ['create_users'],
                update: ['update_users'],
                delete: ['delete_users']
            },
            payments: {
                view: ['view_payments'],
                create: ['create_payments'],
                update: ['update_payments'],
                delete: ['delete_payments']
            }
        };

        const requiredPermission = permissionMap[resource]?.[action];
        if (!requiredPermission) return false;

        return requiredPermission.some(perm => this.hasPermission(perm));
    },

    // Ajouter des fonds au wallet
    async addFunds(amount, description, reference) {
        if (amount <= 0) throw new Error('Le montant doit être positif');

        this.wallet.balance += amount;
        this.wallet.transactions.push({
            type: 'credit',
            amount,
            description,
            reference,
            timestamp: new Date()
        });

        await this.save();
        logger.info('Fonds ajoutés au wallet:', {
            userId: this.telegramId,
            amount,
            reference
        });
    },

    // Débiter des fonds du wallet
    async debitFunds(amount, description, reference) {
        if (amount <= 0) throw new Error('Le montant doit être positif');
        if (this.wallet.balance < amount) throw new Error('Solde insuffisant');

        this.wallet.balance -= amount;
        this.wallet.transactions.push({
            type: 'debit',
            amount,
            description,
            reference,
            timestamp: new Date()
        });

        await this.save();
        logger.info('Fonds débités du wallet:', {
            userId: this.telegramId,
            amount,
            reference
        });
    },

    // Mettre à jour les statistiques utilisateur
    async updateStats(order) {
        this.stats.totalOrders += 1;
        this.stats.totalSpent += order.payment.amount.total;
        this.stats.lastOrder = new Date();

        // Mise à jour des catégories favorites
        for (const item of order.products) {
            const product = await mongoose.model('Product').findById(item.product);
            if (product) {
                const categoryIndex = this.stats.favoriteCategories.findIndex(
                    fc => fc.category.toString() === product.category.toString()
                );

                if (categoryIndex > -1) {
                    this.stats.favoriteCategories[categoryIndex].count += 1;
                } else {
                    this.stats.favoriteCategories.push({
                        category: product.category,
                        count: 1
                    });
                }
            }
        }

        // Trier et limiter les catégories favorites
        this.stats.favoriteCategories.sort((a, b) => b.count - a.count);
        this.stats.favoriteCategories = this.stats.favoriteCategories.slice(0, 5);

        await this.save();
    },

    // Générer un token de vérification
    generateVerificationToken() {
        const token = crypto.randomBytes(32).toString('hex');
        const expiry = new Date();
        expiry.setHours(expiry.getHours() + 24);

        return { token, expiry };
    },

    // Définir une méthode de paiement par défaut
    async setDefaultPaymentMethod(methodId) {
        // Réinitialiser toutes les méthodes
        this.preferences.paymentMethods.forEach(pm => {
            pm.isDefault = false;
        });

        const methodIndex = this.preferences.paymentMethods.findIndex(
            pm => pm.method.toString() === methodId.toString()
        );

        if (methodIndex > -1) {
            this.preferences.paymentMethods[methodIndex].isDefault = true;
        } else {
            this.preferences.paymentMethods.push({
                method: methodId,
                isDefault: true,
                lastUsed: new Date()
            });
        }

        await this.save();
    }
};

// Méthodes statiques
userSchema.statics = {
    // Rechercher des utilisateurs
    async search(criteria = {}) {
        try {
            const query = {};

            if (criteria.username) {
                query.username = new RegExp(criteria.username, 'i');
            }

            if (criteria.role) {
                query.role = criteria.role;
            }

            if (criteria.status) {
                query.status = criteria.status;
            }

            if (criteria.email) {
                query['profile.email'] = new RegExp(criteria.email, 'i');
            }

            return await this.find(query)
                .sort(criteria.sort || { createdAt: -1 })
                .skip(criteria.skip || 0)
                .limit(criteria.limit || 20);
        } catch (error) {
            logger.error('Erreur lors de la recherche des utilisateurs:', error);
            throw error;
        }
    },

    // Obtenir les statistiques des utilisateurs
    async getStats(period = 'day') {
        try {
            const startDate = new Date();
            if (period === 'day') {
                startDate.setHours(0, 0, 0, 0);
            } else if (period === 'week') {
                startDate.setDate(startDate.getDate() - 7);
            } else if (period === 'month') {
                startDate.setMonth(startDate.getMonth() - 1);
            }

            const stats = await this.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalUsers: { $sum: 1 },
                        activeUsers: {
                            $sum: { 
                                $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
                            }
                        },
                        totalSpent: {
                            $sum: '$stats.totalSpent'
                        },
                        avgOrderValue: {
                            $avg: {
                                $cond: [
                                    { $gt: ['$stats.totalOrders', 0] },
                                    { $divide: ['$stats.totalSpent', '$stats.totalOrders'] },
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

            return stats[0] || {
                totalUsers: 0,
                activeUsers: 0,
                totalSpent: 0,
                avgOrderValue: 0
            };
        } catch (error) {
            logger.error('Erreur lors du calcul des statistiques utilisateurs:', error);
            throw error;
        }
    },

    // Obtenir les meilleurs clients
    async getTopCustomers(limit = 10) {
        try {
            return await this.find({
                'stats.totalOrders': { $gt: 0 }
            })
            .select('username stats profile.email')
            .sort({ 'stats.totalSpent': -1 })
            .limit(limit);
        } catch (error) {
            logger.error('Erreur lors de la récupération des meilleurs clients:', error);
            throw error;
        }
    },

    // Vérifier et gérer les tentatives de connexion
    async checkLoginAttempts(telegramId) {
        const user = await this.findOne({ telegramId });
        if (!user) return null;

        const MAX_ATTEMPTS = 5;
        const LOCKOUT_TIME = 30; // minutes

        if (user.security.loginAttempts >= MAX_ATTEMPTS) {
            const lastAttempt = new Date(user.security.lastLoginAttempt);
            const lockoutEnd = new Date(lastAttempt.getTime() + LOCKOUT_TIME * 60000);

            if (new Date() < lockoutEnd) {
                throw new Error(`Compte temporairement bloqué. Réessayez dans ${LOCKOUT_TIME} minutes.`);
            } else {
                // Réinitialiser les tentatives après la période de blocage
                user.security.loginAttempts = 0;
                await user.save();
            }
        }

        return user;
    },

    // Gérer une tentative de connexion réussie
    async handleSuccessfulLogin(telegramId, ip) {
        const user = await this.findOne({ telegramId });
        if (!user) return;

        user.security.loginAttempts = 0;
        user.security.lastSuccessfulLogin = new Date();
        user.security.ipHistory.push({
            ip,
            timestamp: new Date()
        });

        // Garder uniquement les 10 dernières adresses IP
        if (user.security.ipHistory.length > 10) {
            user.security.ipHistory = user.security.ipHistory.slice(-10);
        }

        await user.save();
    },

    // Gérer une tentative de connexion échouée
    async handleFailedLogin(telegramId) {
        const user = await this.findOne({ telegramId });
        if (!user) return;

        user.security.loginAttempts += 1;
        user.security.lastLoginAttempt = new Date();
        await user.save();

        if (user.security.loginAttempts >= 5) {
            logger.warn('Tentatives de connexion multiples détectées:', {
                telegramId,
                attempts: user.security.loginAttempts
            });
        }
    }
};

// Middleware pré-sauvegarde
userSchema.pre('save', function(next) {
    // Vérifier et nettoyer les adresses email
    if (this.isModified('profile.email')) {
        this.profile.email = this.profile.email.toLowerCase().trim();
    }

    // Nettoyer l'historique des transactions si trop long
    if (this.wallet.transactions.length > 100) {
        this.wallet.transactions = this.wallet.transactions.slice(-100);
    }

    // Vérifier les permissions en fonction du rôle
    if (this.isModified('role')) {
        if (this.role === 'user') {
            this.adminData.permissions = [];
        }
    }

    next();
});

// Hooks pour la journalisation
userSchema.post('save', function(doc) {
    logger.info('Utilisateur mis à jour:', {
        telegramId: doc.telegramId,
        username: doc.username,
        role: doc.role,
        status: doc.status
    });
});

const User = mongoose.model('User', userSchema);

module.exports = User;