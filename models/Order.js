const mongoose = require('mongoose');
const logger = require('../utils/logger');

const orderSchema = new mongoose.Schema({
    orderNumber: {
        type: String,
        unique: true,
        required: true
    },
    user: {
        id: {
            type: String,
            required: true
        },
        username: String,
        contactInfo: {
            telegram: String,
            email: String,
            phone: String
        }
    },
    products: [{
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
        price: {
            type: Number,
            required: true
        },
        customFields: [{
            question: String,
            answer: String,
            fileUrl: String
        }],
        status: {
            type: String,
            enum: ['pending', 'processing', 'completed', 'cancelled'],
            default: 'pending'
        },
        deliveryMethod: {
            type: String,
            enum: ['instant', 'manual'],
            required: true
        },
        deliveredContent: {
            files: [{
                name: String,
                url: String,
                type: String
            }],
            text: String,
            deliveredAt: Date
        }
    }],
    payment: {
        method: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PaymentMethod',
            required: true
        },
        status: {
            type: String,
            enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
            default: 'pending'
        },
        amount: {
            subtotal: Number,
            fees: Number,
            total: Number
        },
        details: {
            transactionId: String,
            paymentProof: String,
            verificationCode: String,
            notes: String
        },
        history: [{
            status: String,
            timestamp: Date,
            notes: String
        }]
    },
    status: {
        type: String,
        enum: ['created', 'pending_payment', 'processing', 'completed', 'cancelled', 'refunded'],
        default: 'created'
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
    adminNotes: [{
        note: String,
        adminId: String,
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    metadata: {
        ip: String,
        userAgent: String,
        source: String
    }
}, {
    timestamps: true
});

// Indexes
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ 'user.id': 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

// Middleware pré-sauvegarde
orderSchema.pre('save', async function(next) {
    try {
        if (this.isNew) {
            // Générer un numéro de commande unique
            const lastOrder = await this.constructor.findOne({}, {}, { sort: { 'orderNumber': -1 } });
            let nextNumber = 1;
            if (lastOrder && lastOrder.orderNumber) {
                nextNumber = parseInt(lastOrder.orderNumber.split('-')[1]) + 1;
            }
            this.orderNumber = `ORD-${nextNumber.toString().padStart(6, '0')}`;
        }

        if (this.isModified('status')) {
            // Ajouter à la timeline
            this.timeline.push({
                status: this.status,
                timestamp: new Date(),
                notes: 'Statut mis à jour automatiquement'
            });
        }

        next();
    } catch (error) {
        next(error);
    }
});

// Méthodes d'instance
orderSchema.methods = {
    // Calculer le total de la commande
    async calculateTotal() {
        let subtotal = 0;
        for (const item of this.products) {
            subtotal += item.price * item.quantity;
        }

        const paymentMethod = await mongoose.model('PaymentMethod').findById(this.payment.method);
        const fees = paymentMethod.calculateFees(subtotal);

        this.payment.amount = {
            subtotal,
            fees,
            total: subtotal + fees
        };

        return this.payment.amount;
    },

    // Mettre à jour le statut de la commande
    async updateStatus(newStatus, notes = '', adminId = null) {
        this.status = newStatus;
        this.timeline.push({
            status: newStatus,
            timestamp: new Date(),
            notes,
            adminId
        });

        // Mettre à jour les produits si nécessaire
        if (newStatus === 'cancelled') {
            await this.handleCancellation();
        }

        await this.save();
        await this.notifyStatusChange();
    },

    // Gérer l'annulation
    async handleCancellation() {
        // Remettre en stock les produits si nécessaire
        for (const item of this.products) {
            const product = await mongoose.model('Product').findById(item.product);
            if (product && product.stock !== -1) {
                product.stock += item.quantity;
                await product.save();
            }
        }
    },

    // Vérifier si la commande peut être modifiée
    canBeModified() {
        return ['created', 'pending_payment'].includes(this.status);
    },

    // Vérifier si la commande peut être annulée
    canBeCancelled() {
        return ['created', 'pending_payment', 'processing'].includes(this.status);
    },

    // Ajouter une note admin
    async addAdminNote(note, adminId) {
        this.adminNotes.push({
            note,
            adminId,
            timestamp: new Date()
        });
        await this.save();
    },

    // Notifier les changements de statut
    async notifyStatusChange() {
        try {
            // Implémenter les notifications selon vos besoins
            logger.info('Statut de commande mis à jour:', {
                orderNumber: this.orderNumber,
                status: this.status
            });
        } catch (error) {
            logger.error('Erreur lors de la notification:', error);
        }
    }
};

// Méthodes statiques
orderSchema.statics = {
    // Rechercher des commandes avec filtres
    async search(criteria = {}) {
        try {
            const query = {};

            if (criteria.orderNumber) {
                query.orderNumber = new RegExp(criteria.orderNumber, 'i');
            }

            if (criteria.userId) {
                query['user.id'] = criteria.userId;
            }

            if (criteria.status) {
                query.status = criteria.status;
            }

            if (criteria.dateRange) {
                query.createdAt = {
                    $gte: criteria.dateRange.start,
                    $lte: criteria.dateRange.end
                };
            }

            return await this.find(query)
                .populate('products.product payment.method')
                .sort(criteria.sort || { createdAt: -1 })
                .skip(criteria.skip || 0)
                .limit(criteria.limit || 20);
        } catch (error) {
            logger.error('Erreur lors de la recherche des commandes:', error);
            throw error;
        }
    },

    // Obtenir les statistiques des commandes
    async getStats(period = 'day') {
        try {
            const now = new Date();
            let startDate;

            switch(period) {
                case 'day':
                    startDate = new Date(now.setHours(0, 0, 0, 0));
                    break;
                case 'week':
                    startDate = new Date(now.setDate(now.getDate() - 7));
                    break;
                case 'month':
                    startDate = new Date(now.setMonth(now.getMonth() - 1));
                    break;
                default:
                    startDate = new Date(0);
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
                        totalAmount: { $sum: '$payment.amount.total' }
                    }
                }
            ]);
        } catch (error) {
            logger.error('Erreur lors du calcul des statistiques:', error);
            throw error;
        }
    },

    // Obtenir les statistiques par méthode de paiement
    async getPaymentStats(period = 'day') {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - (period === 'month' ? 30 : 7));

            return await this.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate },
                        'payment.status': 'completed'
                    }
                },
                {
                    $group: {
                        _id: '$payment.method',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$payment.amount.total' },
                        avgAmount: { $avg: '$payment.amount.total' }
                    }
                },
                {
                    $lookup: {
                        from: 'paymentmethods',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'methodDetails'
                    }
                }
            ]);
        } catch (error) {
            logger.error('Erreur lors du calcul des statistiques de paiement:', error);
            throw error;
        }
    },

    // Nettoyer les commandes expirées
    async cleanupExpiredOrders(maxAge = 24) { // maxAge en heures
        try {
            const expiryDate = new Date();
            expiryDate.setHours(expiryDate.getHours() - maxAge);

            const expiredOrders = await this.find({
                status: 'pending_payment',
                createdAt: { $lt: expiryDate }
            });

            for (const order of expiredOrders) {
                await order.updateStatus('cancelled', 'Commande expirée automatiquement');
            }

            return expiredOrders.length;
        } catch (error) {
            logger.error('Erreur lors du nettoyage des commandes expirées:', error);
            throw error;
        }
    },

    // Générer un rapport
    async generateReport(options = {}) {
        try {
            const pipeline = [];

            // Filtre par période
            if (options.startDate && options.endDate) {
                pipeline.push({
                    $match: {
                        createdAt: {
                            $gte: new Date(options.startDate),
                            $lte: new Date(options.endDate)
                        }
                    }
                });
            }

            // Groupement par période
            const groupBy = options.groupBy || 'day';
            pipeline.push({
                $group: {
                    _id: {
                        $switch: {
                            branches: [
                                {
                                    case: { $eq: [groupBy, 'day'] },
                                    then: {
                                        $dateToString: {
                                            format: '%Y-%m-%d',
                                            date: '$createdAt'
                                        }
                                    }
                                },
                                {
                                    case: { $eq: [groupBy, 'week'] },
                                    then: {
                                        $dateToString: {
                                            format: '%Y-W%V',
                                            date: '$createdAt'
                                        }
                                    }
                                },
                                {
                                    case: { $eq: [groupBy, 'month'] },
                                    then: {
                                        $dateToString: {
                                            format: '%Y-%m',
                                            date: '$createdAt'
                                        }
                                    }
                                }
                            ],
                            default: {
                                $dateToString: {
                                    format: '%Y-%m-%d',
                                    date: '$createdAt'
                                }
                            }
                        }
                    },
                    totalOrders: { $sum: 1 },
                    completedOrders: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    },
                    cancelledOrders: {
                        $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                    },
                    totalRevenue: {
                        $sum: {
                            $cond: [
                                { $eq: ['$status', 'completed'] },
                                '$payment.amount.total',
                                0
                            ]
                        }
                    },
                    avgOrderValue: {
                        $avg: {
                            $cond: [
                                { $eq: ['$status', 'completed'] },
                                '$payment.amount.total',
                                0
                            ]
                        }
                    }
                }
            });

            // Tri
            pipeline.push({
                $sort: { _id: 1 }
            });

            return await this.aggregate(pipeline);
        } catch (error) {
            logger.error('Erreur lors de la génération du rapport:', error);
            throw error;
        }
    }
};

// Hooks pour la journalisation
orderSchema.post('save', function(doc) {
    logger.info('Commande mise à jour:', {
        orderNumber: doc.orderNumber,
        status: doc.status,
        amount: doc.payment.amount?.total
    });
});

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;