const mongoose = require('mongoose');
const logger = require('../utils/logger');
const crypto = require('crypto');

const paymentMethodSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Le nom de la méthode est requis'],
        trim: true,
        unique: true
    },
    type: {
        type: String,
        required: true,
        enum: [
            'paypal',
            'crypto',
            'pcs',
            'transcash',
            'paysafecard',
            'stripe',
            'manual'
        ]
    },
    config: {
        credentials: {
            clientId: String,
            clientSecret: String,
            publicKey: String,
            privateKey: String,
            walletAddress: String,
            apiKey: String,
            webhookSecret: String
        },
        // Configuration pour paiements manuels
        manual: {
            instructions: String,
            verificationProcess: String,
            contactInfo: String
        },
        // Configuration pour cryptos
        crypto: {
            networks: [{
                name: String,
                enabled: Boolean,
                walletAddress: String,
                confirmationsRequired: Number
            }],
            exchangeRateSource: String
        }
    },
    fees: {
        type: {
            type: String,
            enum: ['percentage', 'fixed', 'mixed'],
            default: 'percentage'
        },
        percentage: {
            type: Number,
            default: 0
        },
        fixed: {
            type: Number,
            default: 0
        },
        min: {
            type: Number,
            default: 0
        },
        max: {
            type: Number,
            default: 0
        }
    },
    limits: {
        minAmount: {
            type: Number,
            required: true
        },
        maxAmount: {
            type: Number,
            required: true
        },
        dailyLimit: Number,
        monthlyLimit: Number,
        perUserLimit: Number
    },
    processingTime: {
        estimated: {
            min: Number,
            max: Number,
            unit: {
                type: String,
                enum: ['minutes', 'hours', 'days'],
                default: 'hours'
            }
        },
        autoCancel: {
            enabled: Boolean,
            after: Number, // en heures
        }
    },
    verification: {
        required: {
            type: Boolean,
            default: false
        },
        type: [{
            type: String,
            enum: ['email', 'phone', 'identity', 'address']
        }]
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'maintenance', 'deprecated'],
        default: 'inactive'
    },
    displayOrder: {
        type: Number,
        default: 0
    },
    security: {
        ipWhitelist: [String],
        maxAttempts: Number,
        cooldownPeriod: Number
    },
    notifications: {
        success: {
            admin: Boolean,
            user: Boolean,
            template: String
        },
        failure: {
            admin: Boolean,
            user: Boolean,
            template: String
        }
    }
}, {
    timestamps: true
});

// Méthodes d'instance
paymentMethodSchema.methods = {
    // Calculer les frais pour un montant donné
    calculateFees(amount) {
        let fees = 0;
        
        switch (this.fees.type) {
            case 'percentage':
                fees = amount * (this.fees.percentage / 100);
                break;
            case 'fixed':
                fees = this.fees.fixed;
                break;
            case 'mixed':
                fees = this.fees.fixed + (amount * (this.fees.percentage / 100));
                break;
        }

        // Appliquer les limites min/max
        if (this.fees.min) fees = Math.max(fees, this.fees.min);
        if (this.fees.max) fees = Math.min(fees, this.fees.max);

        return fees;
    },

    // Vérifier si la méthode est disponible pour un montant
    async isAvailable(amount, userId = null) {
        try {
            if (this.status !== 'active') return false;

            // Vérifier les limites de montant
            if (amount < this.limits.minAmount || amount > this.limits.maxAmount) {
                return false;
            }

            // Vérifier les limites quotidiennes/mensuelles si définies
            if (this.limits.dailyLimit || this.limits.monthlyLimit) {
                const Transaction = mongoose.model('Transaction');
                const now = new Date();

                if (this.limits.dailyLimit) {
                    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
                    const dailyTotal = await Transaction.aggregate([
                        {
                            $match: {
                                paymentMethod: this._id,
                                status: 'completed',
                                createdAt: { $gte: startOfDay }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                total: { $sum: '$amount' }
                            }
                        }
                    ]);

                    if (dailyTotal.length && 
                        dailyTotal[0].total + amount > this.limits.dailyLimit) {
                        return false;
                    }
                }

                if (this.limits.monthlyLimit) {
                    const startOfMonth = new Date(now.setDate(1));
                    const monthlyTotal = await Transaction.aggregate([
                        {
                            $match: {
                                paymentMethod: this._id,
                                status: 'completed',
                                createdAt: { $gte: startOfMonth }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                total: { $sum: '$amount' }
                            }
                        }
                    ]);

                    if (monthlyTotal.length && 
                        monthlyTotal[0].total + amount > this.limits.monthlyLimit) {
                        return false;
                    }
                }
            }

            // Vérifier la limite par utilisateur si définie
            if (userId && this.limits.perUserLimit) {
                const Transaction = mongoose.model('Transaction');
                const userTotal = await Transaction.aggregate([
                    {
                        $match: {
                            paymentMethod: this._id,
                            userId: userId,
                            status: 'completed'
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: '$amount' }
                        }
                    }
                ]);

                if (userTotal.length && 
                    userTotal[0].total + amount > this.limits.perUserLimit) {
                    return false;
                }
            }

            return true;
        } catch (error) {
            logger.error('Erreur lors de la vérification de disponibilité:', error);
            return false;
        }
    },

    // Obtenir les instructions de paiement
    getPaymentInstructions(amount, orderId) {
        switch(this.type) {
            case 'crypto':
                const selectedNetwork = this.config.crypto.networks.find(n => n.enabled);
                return {
                    type: 'crypto',
                    address: selectedNetwork.walletAddress,
                    network: selectedNetwork.name,
                    confirmationsRequired: selectedNetwork.confirmationsRequired,
                    amount: amount,
                    orderId: orderId
                };
            
            case 'pcs':
            case 'transcash':
            case 'paysafecard':
                return {
                    type: this.type,
                    instructions: this.config.manual.instructions,
                    contactInfo: this.config.manual.contactInfo,
                    amount: amount,
                    orderId: orderId,
                    reference: `${this.type.toUpperCase()}-${orderId}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
                };

            case 'paypal':
                return {
                    type: 'paypal',
                    clientId: this.config.credentials.clientId,
                    amount: amount,
                    orderId: orderId
                };

            case 'stripe':
                return {
                    type: 'stripe',
                    publicKey: this.config.credentials.publicKey,
                    amount: amount,
                    orderId: orderId
                };

            case 'manual':
                return {
                    type: 'manual',
                    instructions: this.config.manual.instructions,
                    verificationProcess: this.config.manual.verificationProcess,
                    contactInfo: this.config.manual.contactInfo,
                    reference: `MAN-${orderId}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
                    amount: amount,
                    orderId: orderId
                };

            default:
                throw new Error('Type de paiement non supporté');
        }
    },

    // Vérifier une preuve de paiement
    async verifyPayment(proof) {
        switch(this.type) {
            case 'crypto':
                return await this.verifyCryptoPayment(proof);
            case 'pcs':
            case 'transcash':
            case 'paysafecard':
                return await this.verifyCodePayment(proof);
            case 'manual':
                return await this.verifyManualPayment(proof);
            default:
                return false;
        }
    },

    // Vérification spécifique pour crypto
    async verifyCryptoPayment(proof) {
        try {
            // Vérifier la transaction sur la blockchain
            const network = this.config.crypto.networks.find(n => n.name === proof.network);
            if (!network || !network.enabled) return false;

            // Implémentation spécifique pour chaque type de crypto
            // À adapter selon les APIs blockchain utilisées
            return true;
        } catch (error) {
            logger.error('Erreur lors de la vérification crypto:', error);
            return false;
        }
    },

    // Vérification des codes (PCS, Transcash, etc.)
    async verifyCodePayment(proof) {
        try {
            // Vérifier si le code n'a pas déjà été utilisé
            const Transaction = mongoose.model('Transaction');
            const existingTransaction = await Transaction.findOne({
                'details.code': proof.code
            });

            if (existingTransaction) return false;

            // Autres vérifications spécifiques au type de code
            // À adapter selon les APIs disponibles
            return true;
        } catch (error) {
            logger.error('Erreur lors de la vérification du code:', error);
            return false;
        }
    },

    // Vérification des paiements manuels
    async verifyManualPayment(proof) {
        // Pour les paiements manuels, la vérification est faite par l'admin
        return 'pending';
    }
};

// Méthodes statiques
paymentMethodSchema.statics = {
    // Récupérer les méthodes disponibles pour un montant
    async getAvailableMethods(amount, userId = null) {
        try {
            const methods = await this.find({ status: 'active' });
            const availableMethods = [];

            for (const method of methods) {
                if (await method.isAvailable(amount, userId)) {
                    availableMethods.push(method);
                }
            }

            return availableMethods.sort((a, b) => a.displayOrder - b.displayOrder);
        } catch (error) {
            logger.error('Erreur lors de la récupération des méthodes:', error);
            return [];
        }
    },

    // Mettre à jour les taux de change crypto
    async updateCryptoRates() {
        try {
            const methods = await this.find({
                type: 'crypto',
                status: 'active'
            });

            for (const method of methods) {
                // Implémenter la mise à jour des taux via API
                // À adapter selon le service utilisé
            }
        } catch (error) {
            logger.error('Erreur lors de la mise à jour des taux crypto:', error);
        }
    }
};

// Middleware de validation avant sauvegarde
paymentMethodSchema.pre('save', function(next) {
    if (this.isModified('config.credentials')) {
        // Encrypter les informations sensibles
        // Implémenter la logique d'encryption si nécessaire
    }
    next();
});

// Hooks pour la journalisation
paymentMethodSchema.post('save', function(doc) {
    logger.info('Méthode de paiement modifiée:', {
        methodId: doc._id,
        name: doc.name,
        type: doc.type,
        status: doc.status
    });
});

const PaymentMethod = mongoose.model('PaymentMethod', paymentMethodSchema);

module.exports = PaymentMethod;