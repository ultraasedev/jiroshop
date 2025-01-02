const crypto = require('crypto');
const logger = require('./logger');
const config = require('./config');
const queue = require('./queue');
const cache = require('./cache');

class WebhookManager {
    constructor() {
        this.webhooks = new Map();
        this.handlers = new Map();
        this.secretKey = config.get('webhook.secretKey', crypto.randomBytes(32).toString('hex'));
        this.maxRetries = config.get('webhook.maxRetries', 3);
        this.retryDelay = config.get('webhook.retryDelay', 5000);
        this.timeout = config.get('webhook.timeout', 10000);

        this.initialize();
    }

    // Initialiser les webhooks
    async initialize() {
        try {
            // Charger les webhooks enregistrés depuis la base de données
            await this.loadWebhooks();

            // Initialiser les handlers par défaut
            this.initializeDefaultHandlers();

            logger.info('Gestionnaire de webhooks initialisé');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation des webhooks:', error);
        }
    }

    // Charger les webhooks depuis la base de données
    async loadWebhooks() {
        try {
            const Webhook = require('../models/Webhook');
            const webhooks = await Webhook.find({ active: true });

            webhooks.forEach(webhook => {
                this.webhooks.set(webhook.id, {
                    url: webhook.url,
                    secret: webhook.secret,
                    events: webhook.events,
                    active: webhook.active,
                    failureCount: 0,
                    lastSuccess: webhook.lastSuccess,
                    lastFailure: webhook.lastFailure
                });
            });

            logger.info(`${webhooks.length} webhooks chargés`);
        } catch (error) {
            logger.error('Erreur lors du chargement des webhooks:', error);
        }
    }

    // Initialiser les handlers par défaut
    initializeDefaultHandlers() {
        // Handler pour les commandes
        this.registerHandler('order', async (event, data) => {
            switch (event) {
                case 'order.created':
                case 'order.updated':
                case 'order.completed':
                case 'order.cancelled':
                    await this.dispatchWebhook(event, data);
                    break;
            }
        });

        // Handler pour les paiements
        this.registerHandler('payment', async (event, data) => {
            switch (event) {
                case 'payment.pending':
                case 'payment.completed':
                case 'payment.failed':
                case 'payment.refunded':
                    await this.dispatchWebhook(event, data);
                    break;
            }
        });

        // Handler pour les utilisateurs
        this.registerHandler('user', async (event, data) => {
            switch (event) {
                case 'user.registered':
                case 'user.updated':
                case 'user.deleted':
                    await this.dispatchWebhook(event, data);
                    break;
            }
        });
    }

    // Enregistrer un nouveau webhook
    async register(url, events, secret = null) {
        try {
            const webhook = {
                id: crypto.randomBytes(16).toString('hex'),
                url,
                secret: secret || crypto.randomBytes(32).toString('hex'),
                events,
                active: true,
                failureCount: 0,
                lastSuccess: null,
                lastFailure: null
            };

            // Sauvegarder dans la base de données
            const Webhook = require('../models/Webhook');
            const savedWebhook = await Webhook.create({
                ...webhook,
                createdAt: new Date()
            });

            this.webhooks.set(savedWebhook.id, webhook);
            logger.info(`Nouveau webhook enregistré: ${url}`);

            return savedWebhook;
        } catch (error) {
            logger.error('Erreur lors de l\'enregistrement du webhook:', error);
            throw error;
        }
    }

    // Désactiver un webhook
    async unregister(webhookId) {
        try {
            const Webhook = require('../models/Webhook');
            await Webhook.findByIdAndUpdate(webhookId, { active: false });
            
            this.webhooks.delete(webhookId);
            logger.info(`Webhook désactivé: ${webhookId}`);

            return true;
        } catch (error) {
            logger.error('Erreur lors de la désactivation du webhook:', error);
            throw error;
        }
    }

    // Enregistrer un handler pour un type d'événement
    registerHandler(eventType, handler) {
        if (typeof handler !== 'function') {
            throw new Error('Le handler doit être une fonction');
        }
        this.handlers.set(eventType, handler);
    }

    // Générer la signature d'une payload
    generateSignature(payload, secret) {
        return crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(payload))
            .digest('hex');
    }

    // Vérifier une signature
    verifySignature(payload, signature, secret) {
        const expectedSignature = this.generateSignature(payload, secret);
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    }

    // Dispatcher un webhook
    async dispatchWebhook(event, data) {
        const payload = {
            event,
            data,
            timestamp: Date.now()
        };

        for (const [webhookId, webhook] of this.webhooks) {
            if (webhook.active && webhook.events.includes(event)) {
                await this.sendWebhook(webhookId, webhook, payload);
            }
        }
    }

    // Envoyer un webhook
    async sendWebhook(webhookId, webhook, payload) {
        try {
            // Ajouter à la queue de webhooks
            await queue.add('webhooks', {
                webhookId,
                url: webhook.url,
                payload,
                signature: this.generateSignature(payload, webhook.secret)
            }, {
                attempts: this.maxRetries,
                backoff: {
                    type: 'exponential',
                    delay: this.retryDelay
                }
            });

            logger.debug(`Webhook mis en queue: ${webhookId}`, { event: payload.event });
        } catch (error) {
            logger.error(`Erreur lors de l'envoi du webhook ${webhookId}:`, error);
            await this.handleWebhookFailure(webhookId, error);
        }
    }

    // Processeur de webhook
    async processWebhook(job) {
        const { webhookId, url, payload, signature } = job.data;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Signature': signature,
                    'X-Webhook-Event': payload.event,
                    'X-Webhook-ID': webhookId
                },
                body: JSON.stringify(payload),
                timeout: this.timeout
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            await this.handleWebhookSuccess(webhookId);
        } catch (error) {
            await this.handleWebhookFailure(webhookId, error);
            throw error; // Pour le système de retry de la queue
        }
    }

    // Gérer un succès de webhook
    async handleWebhookSuccess(webhookId) {
        try {
            const webhook = this.webhooks.get(webhookId);
            if (webhook) {
                webhook.failureCount = 0;
                webhook.lastSuccess = new Date();

                // Mettre à jour dans la base de données
                const Webhook = require('../models/Webhook');
                await Webhook.findByIdAndUpdate(webhookId, {
                    failureCount: 0,
                    lastSuccess: webhook.lastSuccess
                });
            }
        } catch (error) {
            logger.error('Erreur lors de la mise à jour du succès du webhook:', error);
        }
    }

    // Gérer un échec de webhook
    async handleWebhookFailure(webhookId, error) {
        try {
            const webhook = this.webhooks.get(webhookId);
            if (webhook) {
                webhook.failureCount++;
                webhook.lastFailure = new Date();

                // Désactiver si trop d'échecs
                if (webhook.failureCount >= this.maxRetries) {
                    webhook.active = false;
                }

                // Mettre à jour dans la base de données
                const Webhook = require('../models/Webhook');
                await Webhook.findByIdAndUpdate(webhookId, {
                    failureCount: webhook.failureCount,
                    lastFailure: webhook.lastFailure,
                    active: webhook.active
                });

                logger.warn(`Échec du webhook ${webhookId}:`, {
                    url: webhook.url,
                    failureCount: webhook.failureCount,
                    error: error.message
                });
            }
        } catch (error) {
            logger.error('Erreur lors de la mise à jour de l\'échec du webhook:', error);
        }
    }

    // Obtenir les webhooks pour un événement
    getWebhooksForEvent(event) {
        return Array.from(this.webhooks.values())
            .filter(webhook => webhook.active && webhook.events.includes(event));
    }

    // Mettre à jour la configuration d'un webhook
    async updateWebhook(webhookId, config) {
        try {
            const webhook = this.webhooks.get(webhookId);
            if (!webhook) {
                throw new Error('Webhook non trouvé');
            }

            // Mettre à jour la configuration
            Object.assign(webhook, config);

            // Mettre à jour dans la base de données
            const Webhook = require('../models/Webhook');
            await Webhook.findByIdAndUpdate(webhookId, config);

            logger.info(`Webhook mis à jour: ${webhookId}`);
            return true;
        } catch (error) {
            logger.error('Erreur lors de la mise à jour du webhook:', error);
            return false;
        }
    }

    // Tester un webhook
    async testWebhook(webhookId) {
        try {
            const webhook = this.webhooks.get(webhookId);
            if (!webhook) {
                throw new Error('Webhook non trouvé');
            }

            const testPayload = {
                event: 'webhook.test',
                data: {
                    message: 'Test webhook',
                    timestamp: Date.now()
                }
            };

            await this.sendWebhook(webhookId, webhook, testPayload);
            return true;
        } catch (error) {
            logger.error('Erreur lors du test du webhook:', error);
            return false;
        }
    }

    // Réinitialiser les compteurs d'échecs
    async resetFailureCount(webhookId) {
        try {
            const webhook = this.webhooks.get(webhookId);
            if (webhook) {
                webhook.failureCount = 0;
                webhook.active = true;

                // Mettre à jour dans la base de données
                const Webhook = require('../models/Webhook');
                await Webhook.findByIdAndUpdate(webhookId, {
                    failureCount: 0,
                    active: true
                });

                return true;
            }
            return false;
        } catch (error) {
            logger.error('Erreur lors de la réinitialisation des compteurs:', error);
            return false;
        }
    }
}

module.exports = new WebhookManager();