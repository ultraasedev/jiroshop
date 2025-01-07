const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
    // Informations sur l'admin
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    adminUsername: {
        type: String,
        required: true
    },

    // Type d'action
    action: {
        type: String,
        required: true,
        enum: [
            // Actions de configuration du bot
            'edit_bot_name',
            'edit_bot_language',
            'edit_bot_timezone',
            'edit_bot_theme',
            'edit_bot_settings',
            'edit_security_settings',
            'edit_notification_settings',
            'edit_payment_settings',

            // Actions produits
            'add_product',
            'edit_product_name',
            'edit_product_price',
            'edit_product_description',
            'edit_product_category',
            'edit_product_stock',
            'delete_product',
            'toggle_product',
            
            // Actions catégories
            'add_category',
            'edit_category_name',
            'edit_category_description',
            'edit_category_image',
            'edit_category_order',
            'delete_category',
            'toggle_category',
            
            // Actions commandes
            'view_order',
            'approve_order',
            'reject_order',
            'mark_delivered',
            'complete_order',
            'cancel_order',
            'refund_order',
            
            // Actions paiements
            'add_payment_method',
            'edit_payment_method',
            'toggle_payment_method',
            'approve_payment',
            'reject_payment',
            'verify_payment',
            'edit_payment_fees',
            'edit_payment_limits',
            
            // Actions utilisateurs
            'ban_user',
            'unban_user',
            'add_user_note',
            'contact_user',
            'warn_user',
            
            // Actions système et maintenance
            'create_backup',
            'restore_backup',
            'clear_logs',
            'view_logs',
            'export_logs',
            
            // Actions statistiques et rapports
            'view_stats',
            'export_stats',
            'generate_report',
            'email_report'
        ],
        index: true
    },
    
    // Entité concernée par l'action
    entityType: {
        type: String,
        required: true,
        enum: ['system', 'bot', 'product', 'category', 'order', 'payment', 'user', 'config', 'backup', 'log']
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    
    // Détails de l'action
    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    
    // État avant/après (pour le suivi des modifications)
    changes: {
        before: mongoose.Schema.Types.Mixed,
        after: mongoose.Schema.Types.Mixed
    },
    
    // Informations de session Telegram
    sessionInfo: {
        chatId: String,
        messageId: String,
        callbackQuery: String
    },
    
    // Contexte de sécurité
    securityContext: {
        ipAddress: String,
        userAgent: String,
        location: String,
        timestamp: {
            type: Date,
            default: Date.now
        }
    },
    
    // Statut et résultat
    status: {
        type: String,
        enum: ['success', 'error', 'warning', 'info'],
        default: 'success'
    },
    error: {
        message: String,
        stack: String,
        code: String
    },
    
    // Métadonnées
    metadata: {
        duration: Number,
        impactLevel: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'low'
        },
        relatedLogs: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'AdminLog'
        }],
        notes: String
    }
}, {
    timestamps: true
});

// Index composés pour les requêtes fréquentes
adminLogSchema.index({ adminId: 1, createdAt: -1 });
adminLogSchema.index({ action: 1, status: 1 });
adminLogSchema.index({ entityType: 1, entityId: 1 });
adminLogSchema.index({ 'securityContext.timestamp': -1 });

// Méthodes statiques
adminLogSchema.statics = {
    // Rechercher des logs avec filtres
    async search(filters = {}, options = {}) {
        const query = {};
        
        if (filters.adminId) query.adminId = filters.adminId;
        if (filters.action) query.action = filters.action;
        if (filters.entityType) query.entityType = filters.entityType;
        if (filters.status) query.status = filters.status;
        
        if (filters.startDate || filters.endDate) {
            query.createdAt = {};
            if (filters.startDate) {
                query.createdAt.$gte = new Date(filters.startDate);
            }
            if (filters.endDate) {
                query.createdAt.$lte = new Date(filters.endDate);
            }
        }

        const defaultOptions = {
            sort: { createdAt: -1 },
            limit: 50,
            skip: 0
        };
        
        const finalOptions = { ...defaultOptions, ...options };
        
        return this.find(query)
            .sort(finalOptions.sort)
            .skip(finalOptions.skip)
            .limit(finalOptions.limit)
            .populate('adminId', 'username')
            .lean();
    },

    // Obtenir les statistiques des actions d'admin
    async getStats(adminId, period = '24h') {
        const periods = {
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000
        };

        const startDate = new Date(Date.now() - periods[period]);

        return this.aggregate([
            {
                $match: {
                    adminId: mongoose.Types.ObjectId(adminId),
                    createdAt: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: {
                        action: '$action',
                        status: '$status'
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: '$_id.action',
                    total: { $sum: '$count' },
                    statuses: {
                        $push: {
                            status: '$_id.status',
                            count: '$count'
                        }
                    }
                }
            }
        ]);
    },

    // Obtenir l'historique des actions sur une entité
    async getEntityHistory(entityType, entityId, options = {}) {
        const defaultOptions = {
            limit: 20,
            includeDetails: true
        };

        const finalOptions = { ...defaultOptions, ...options };
        
        const query = this.find({
            entityType,
            entityId: mongoose.Types.ObjectId(entityId)
        })
        .sort({ createdAt: -1 })
        .limit(finalOptions.limit);

        if (!finalOptions.includeDetails) {
            query.select('-details -changes -metadata');
        }

        return query.populate('adminId', 'username');
    },

    // Archiver les anciens logs
    async archiveOldLogs(daysToKeep = 90) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        // Optionnellement, sauvegardez les logs avant de les supprimer
        const logsToArchive = await this.find({
            createdAt: { $lt: cutoffDate }
        }).lean();

        // Supprimez les logs
        const result = await this.deleteMany({
            createdAt: { $lt: cutoffDate }
        });

        return {
            deletedCount: result.deletedCount,
            archivedLogs: logsToArchive
        };
    }
};

// Hooks
adminLogSchema.pre('save', function(next) {
    // Calculer la durée si c'est une mise à jour et que le statut est 'success'
    if (this.isModified('status') && this.status === 'success') {
        this.metadata = this.metadata || {};
        this.metadata.duration = Date.now() - this.createdAt.getTime();
    }
    next();
});

const AdminLog = mongoose.model('AdminLog', adminLogSchema);

module.exports = AdminLog;