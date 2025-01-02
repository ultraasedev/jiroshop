const logger = require('./logger');
const config = require('./config');
const queue = require('./queue');
const moment = require('moment');

class AuditManager {
    constructor() {
        this.enabled = config.get('audit.enabled', true);
        this.retentionDays = config.get('audit.retentionDays', 90);
        this.batchSize = config.get('audit.batchSize', 100);

        // Types d'événements d'audit
        this.eventTypes = {
            // Événements utilisateur
            USER_LOGIN: 'user.login',
            USER_LOGOUT: 'user.logout',
            USER_REGISTER: 'user.register',
            USER_UPDATE: 'user.update',
            USER_DELETE: 'user.delete',

            // Événements admin
            ADMIN_LOGIN: 'admin.login',
            ADMIN_ACTION: 'admin.action',
            CONFIG_CHANGE: 'admin.config_change',
            USER_BAN: 'admin.user_ban',
            USER_UNBAN: 'admin.user_unban',

            // Événements de commande
            ORDER_CREATE: 'order.create',
            ORDER_UPDATE: 'order.update',
            ORDER_CANCEL: 'order.cancel',
            ORDER_COMPLETE: 'order.complete',

            // Événements de paiement
            PAYMENT_ATTEMPT: 'payment.attempt',
            PAYMENT_SUCCESS: 'payment.success',
            PAYMENT_FAIL: 'payment.fail',
            REFUND_REQUEST: 'payment.refund_request',
            REFUND_APPROVE: 'payment.refund_approve',

            // Événements de sécurité
            SECURITY_ALERT: 'security.alert',
            INVALID_ACCESS: 'security.invalid_access',
            RATE_LIMIT: 'security.rate_limit',
            SUSPICIOUS_ACTIVITY: 'security.suspicious',

            // Événements système
            SYSTEM_START: 'system.start',
            SYSTEM_STOP: 'system.stop',
            ERROR: 'system.error',
            BACKUP: 'system.backup'
        };

        // Niveaux de gravité
        this.severityLevels = {
            INFO: 'info',
            WARNING: 'warning',
            ERROR: 'error',
            CRITICAL: 'critical'
        };
    }

    // Créer une entrée d'audit
    async log(eventType, data, options = {}) {
        try {
            if (!this.enabled) return;

            const auditEntry = {
                eventType,
                timestamp: new Date(),
                data,
                metadata: {
                    userId: options.userId || null,
                    ip: options.ip || null,
                    userAgent: options.userAgent || null,
                    severity: options.severity || this.severityLevels.INFO,
                    source: options.source || 'system'
                }
            };

            // Ajouter à la queue pour traitement asynchrone
            await queue.add('audit_logs', auditEntry, {
                priority: this.getPriority(options.severity)
            });

            // Log immédiat des événements critiques
            if (options.severity === this.severityLevels.CRITICAL) {
                logger.error('Événement critique:', auditEntry);
            }

            return true;
        } catch (error) {
            logger.error('Erreur lors de la création de l\'entrée d\'audit:', error);
            return false;
        }
    }

    // Obtenir la priorité de traitement selon la gravité
    getPriority(severity) {
        const priorities = {
            [this.severityLevels.CRITICAL]: 1,
            [this.severityLevels.ERROR]: 2,
            [this.severityLevels.WARNING]: 3,
            [this.severityLevels.INFO]: 4
        };
        return priorities[severity] || 4;
    }

    // Processeur d'entrées d'audit
    async processAuditEntry(auditEntry) {
        try {
            const AuditLog = require('../models/AuditLog');
            await AuditLog.create(auditEntry);

            // Notifier les administrateurs pour les événements critiques
            if (auditEntry.metadata.severity === this.severityLevels.CRITICAL) {
                await this.notifyAdmins(auditEntry);
            }
        } catch (error) {
            logger.error('Erreur lors du traitement de l\'entrée d\'audit:', error);
            throw error;
        }
    }

    // Rechercher dans les logs d'audit
    async search(criteria = {}) {
        try {
            const AuditLog = require('../models/AuditLog');
            const query = {};

            // Filtres de recherche
            if (criteria.eventType) {
                query.eventType = criteria.eventType;
            }

            if (criteria.severity) {
                query['metadata.severity'] = criteria.severity;
            }

            if (criteria.userId) {
                query['metadata.userId'] = criteria.userId;
            }

            if (criteria.dateRange) {
                query.timestamp = {
                    $gte: criteria.dateRange.start,
                    $lte: criteria.dateRange.end
                };
            }

            // Exécuter la recherche
            const results = await AuditLog.find(query)
                .sort({ timestamp: -1 })
                .skip(criteria.skip || 0)
                .limit(criteria.limit || this.batchSize);

            return results;
        } catch (error) {
            logger.error('Erreur lors de la recherche dans les logs d\'audit:', error);
            throw error;
        }
    }

    // Nettoyer les anciens logs
    async cleanup() {
        try {
            const AuditLog = require('../models/AuditLog');
            const cutoffDate = moment().subtract(this.retentionDays, 'days').toDate();

            const result = await AuditLog.deleteMany({
                timestamp: { $lt: cutoffDate },
                'metadata.severity': { $ne: this.severityLevels.CRITICAL }
            });

            logger.info(`${result.deletedCount} entrées d'audit nettoyées`);
            return result.deletedCount;
        } catch (error) {
            logger.error('Erreur lors du nettoyage des logs d\'audit:', error);
            throw error;
        }
    }

    // Exporter les logs d'audit
    async export(criteria = {}) {
        try {
            const logs = await this.search(criteria);
            const formattedLogs = logs.map(log => ({
                eventType: log.eventType,
                timestamp: moment(log.timestamp).format('YYYY-MM-DD HH:mm:ss'),
                severity: log.metadata.severity,
                userId: log.metadata.userId,
                details: JSON.stringify(log.data)
            }));

            return this.formatExport(formattedLogs, criteria.format || 'json');
        } catch (error) {
            logger.error('Erreur lors de l\'export des logs d\'audit:', error);
            throw error;
        }
    }

    // Formater l'export selon le format demandé
    formatExport(logs, format) {
        switch (format.toLowerCase()) {
            case 'csv':
                return this.formatCSV(logs);
            case 'json':
                return JSON.stringify(logs, null, 2);
            default:
                throw new Error(`Format d'export non supporté: ${format}`);
        }
    }

    // Formater en CSV
    formatCSV(logs) {
        const headers = Object.keys(logs[0]).join(',');
        const rows = logs.map(log => 
            Object.values(log)
                .map(value => `"${value}"`)
                .join(',')
        );
        return [headers, ...rows].join('\n');
    }

    // Obtenir des statistiques sur les logs d'audit
    async getStats(period = 'day') {
        try {
            const AuditLog = require('../models/AuditLog');
            const startDate = moment().subtract(1, period).toDate();

            const stats = await AuditLog.aggregate([
                {
                    $match: {
                        timestamp: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: {
                            eventType: '$eventType',
                            severity: '$metadata.severity'
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $group: {
                        _id: '$_id.severity',
                        events: {
                            $push: {
                                type: '$_id.eventType',
                                count: '$count'
                            }
                        },
                        totalCount: { $sum: '$count' }
                    }
                }
            ]);

            return stats;
        } catch (error) {
            logger.error('Erreur lors du calcul des statistiques d\'audit:', error);
            throw error;
        }
    }

    // Notifier les administrateurs
    async notifyAdmins(auditEntry) {
        try {
            const notifications = require('./notifications');
            const message = `🚨 Événement critique détecté\n\n` +
                          `Type: ${auditEntry.eventType}\n` +
                          `Timestamp: ${moment(auditEntry.timestamp).format('YYYY-MM-DD HH:mm:ss')}\n` +
                          `Détails: ${JSON.stringify(auditEntry.data, null, 2)}`;

            await notifications.sendAdminAlert(message);
        } catch (error) {
            logger.error('Erreur lors de la notification des admins:', error);
        }
    }

    // Valider un événement d'audit
    validateEvent(eventType, data) {
        // Vérifier si le type d'événement existe
        if (!Object.values(this.eventTypes).includes(eventType)) {
            throw new Error(`Type d'événement invalide: ${eventType}`);
        }

        // Valider les données selon le type d'événement
        // Implémentez ici vos règles de validation spécifiques
        return true;
    }

    // Marquer un événement comme vérifié
    async markAsVerified(auditId, adminId, notes = '') {
        try {
            const AuditLog = require('../models/AuditLog');
            const audit = await AuditLog.findById(auditId);

            if (!audit) {
                throw new Error('Entrée d\'audit non trouvée');
            }

            audit.metadata.verified = {
                by: adminId,
                at: new Date(),
                notes
            };

            await audit.save();
            return true;
        } catch (error) {
            logger.error('Erreur lors du marquage de l\'audit comme vérifié:', error);
            return false;
        }
    }

    // Démarrer le nettoyage automatique
    startAutoCleanup(interval = 24 * 60 * 60 * 1000) { // 24h par défaut
        setInterval(() => {
            this.cleanup()
                .catch(error => logger.error('Erreur cleanup automatique:', error));
        }, interval);
    }
}

module.exports = new AuditManager();