const mongoose = require('mongoose');
const logger = require('../utils/logger');

const transactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        required: true,
        unique: true
    },
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    paymentMethod: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PaymentMethod',
        required: true
    },
    amount: {
        subtotal: Number,
        fees: Number,
        total: {
            type: Number,
            required: true
        }
    },
    currency: {
        type: String,
        default: 'EUR'
    },
    status: {
        type: String,
        enum: [
            'pending',
            'processing',
            'completed',
            'failed',
            'refunded',
            'cancelled',
            'disputed'
        ],
        default: 'pending'
    },
    paymentDetails: {
        provider: String,
        providerTransactionId: String,
        paymentProof: String,
        verificationCode: String,
        walletAddress: String,
        refundDetails: {
            amount: Number,
            reason: String,
            date: Date,
            reference: String
        }
    },
    timeline: [{
        status: String,
        timestamp: {
            type: Date,
            default: Date.now
        },
        notes: String,
        adminId: String
    }],
    verification: {
        status: {
            type: String,
            enum: ['pending', 'verified', 'rejected'],
            default: 'pending'
        },
        verifiedBy: String,
        verifiedAt: Date,
        notes: String
    },
    metadata: {
        ip: String,
        userAgent: String,
        location: {
            country: String,
            city: String
        },
        risk: {
            score: Number,
            flags: [String]
        }
    }
}, {
    timestamps: true
});

// Indexes
transactionSchema.index({ transactionId: 1 });
transactionSchema.index({ order: 1 });
transactionSchema.index({ user: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ createdAt: -1 });

// Génération automatique de l'ID de transaction
transactionSchema.pre('save', async function(next) {
    if (this.isNew) {
        const prefix = 'TXN';
        const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        this.transactionId = `${prefix}-${date}-${random}`;
    }
    next();
});

// Méthodes d'instance
transactionSchema.methods = {
    // Mettre à jour le statut
    async updateStatus(newStatus, notes = '', adminId = null) {
        this.status = newStatus;
        this.timeline.push({
            status: newStatus,
            timestamp: new Date(),
            notes,
            adminId
        });

        // Mettre à jour la commande associée
        const order = await mongoose.model('Order').findById(this.order);
        if (order) {
            if (newStatus === 'completed') {
                await order.updateStatus('processing', 'Paiement confirmé');
            } else if (['failed', 'cancelled'].includes(newStatus)) {
                await order.updateStatus('cancelled', 'Paiement annulé');
            }
        }

        await this.save();
        logger.info('Statut de transaction mis à jour:', {
            transactionId: this.transactionId,
            newStatus,
            adminId
        });
    },

    // Vérifier une transaction
    async verify(adminId, approved = true, notes = '') {
        this.verification = {
            status: approved ? 'verified' : 'rejected',
            verifiedBy: adminId,
            verifiedAt: new Date(),
            notes
        };

        if (approved) {
            await this.updateStatus('completed', 'Transaction vérifiée et approuvée', adminId);
        } else {
            await this.updateStatus('failed', 'Transaction vérifiée et rejetée', adminId);
        }

        await this.save();
    },

    // Effectuer un remboursement
    async processRefund(amount, reason, adminId) {
        if (this.status !== 'completed') {
            throw new Error('Seules les transactions complétées peuvent être remboursées');
        }

        if (amount > this.amount.total) {
            throw new Error('Le montant du remboursement ne peut pas dépasser le montant original');
        }

        this.paymentDetails.refundDetails = {
            amount,
            reason,
            date: new Date(),
            reference: `REF-${this.transactionId}-${Date.now()}`
        };

        await this.updateStatus('refunded', `Remboursement traité: ${reason}`, adminId);

        // Mettre à jour le solde utilisateur si nécessaire
        const user = await mongoose.model('User').findById(this.user);
        if (user) {
            await user.addFunds(amount, 'Remboursement', this.paymentDetails.refundDetails.reference);
        }

        logger.info('Remboursement traité:', {
            transactionId: this.transactionId,
            amount,
            reason,
            adminId
        });
    },

    // Analyser le risque
    async analyzeRisk() {
        let riskScore = 0;
        const flags = [];

        // Vérifier l'historique de l'utilisateur
        const userTransactions = await this.model('Transaction').find({
            user: this.user,
            createdAt: {
                $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 derniers jours
            }
        });

        // Analyser les patterns
        const recentFailures = userTransactions.filter(t => t.status === 'failed').length;
        if (recentFailures > 3) {
            riskScore += 30;
            flags.push('multiple_failures');
        }

        // Vérifier les montants inhabituels
        const avgAmount = userTransactions.reduce((acc, t) => acc + t.amount.total, 0) / userTransactions.length;
        if (this.amount.total > avgAmount * 3) {
            riskScore += 20;
            flags.push('unusual_amount');
        }

        // Vérifier la fréquence
        const last24h = userTransactions.filter(t => 
            new Date(t.createdAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)
        ).length;
        if (last24h > 5) {
            riskScore += 25;
            flags.push('high_frequency');
        }

        this.metadata.risk = {
            score: riskScore,
            flags
        };

        await this.save();
        return { score: riskScore, flags };
    }
};

// Méthodes statiques
transactionSchema.statics = {
    // Rechercher des transactions
    async search(criteria = {}) {
        try {
            const query = {};

            if (criteria.transactionId) {
                query.transactionId = new RegExp(criteria.transactionId, 'i');
            }

            if (criteria.status) {
                query.status = criteria.status;
            }

            if (criteria.paymentMethod) {
                query.paymentMethod = criteria.paymentMethod;
            }

            if (criteria.dateRange) {
                query.createdAt = {
                    $gte: new Date(criteria.dateRange.start),
                    $lte: new Date(criteria.dateRange.end)
                };
            }

            return await this.find(query)
                .populate('user order paymentMethod')
                .sort(criteria.sort || { createdAt: -1 })
                .skip(criteria.skip || 0)
                .limit(criteria.limit || 20);
        } catch (error) {
            logger.error('Erreur lors de la recherche des transactions:', error);
            throw error;
        }
    },

    // Obtenir les statistiques des transactions
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

            return await this.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount.total' },
                        avgAmount: { $avg: '$amount.total' }
                    }
                }
            ]);
        } catch (error) {
            logger.error('Erreur lors du calcul des statistiques:', error);
            throw error;
        }
    },

    // Détecter les transactions suspectes
    async detectSuspiciousTransactions() {
        try {
            const suspicious = await this.find({
                'metadata.risk.score': { $gt: 70 },
                status: { $in: ['pending', 'processing'] }
            }).populate('user order');

            for (const transaction of suspicious) {
                logger.warn('Transaction suspecte détectée:', {
                    transactionId: transaction.transactionId,
                    riskScore: transaction.metadata.risk.score,
                    flags: transaction.metadata.risk.flags
                });
            }

            return suspicious;
        } catch (error) {
            logger.error('Erreur lors de la détection des transactions suspectes:', error);
            throw error;
        }
    }
};

// Hooks pour la journalisation
transactionSchema.post('save', function(doc) {
    logger.info('Transaction mise à jour:', {
        transactionId: doc.transactionId,
        status: doc.status,
        amount: doc.amount.total
    });
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;