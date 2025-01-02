const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');

class Config {
    constructor() {
        this.config = {
            app: {
                name: process.env.APP_NAME || 'Telegram Shop Bot',
                version: process.env.APP_VERSION || '1.0.0',
                env: process.env.NODE_ENV || 'development',
                port: parseInt(process.env.PORT) || 3000,
                debug: process.env.DEBUG === 'true'
            },
            bot: {
                token: process.env.BOT_TOKEN,
                webhookUrl: process.env.WEBHOOK_URL,
                adminIds: (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()),
                commandPrefix: '/',
                sessionTTL: 3600,
                maxMessageLength: 4096
            },
            database: {
                uri: process.env.MONGODB_URI,
                options: {
                    useNewUrlParser: true,
                    useUnifiedTopology: true,
                    maxPoolSize: 10,
                    serverSelectionTimeoutMS: 5000,
                    socketTimeoutMS: 45000
                }
            },
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT) || 6379,
                password: process.env.REDIS_PASSWORD,
                db: parseInt(process.env.REDIS_DB) || 0
            },
            payments: {
                currency: 'EUR',
                methods: {
                    paypal: {
                        enabled: process.env.PAYPAL_ENABLED === 'true',
                        mode: process.env.NODE_ENV === 'production' ? 'live' : 'sandbox',
                        clientId: process.env.PAYPAL_CLIENT_ID,
                        clientSecret: process.env.PAYPAL_CLIENT_SECRET
                    },
                    stripe: {
                        enabled: process.env.STRIPE_ENABLED === 'true',
                        publicKey: process.env.STRIPE_PUBLIC_KEY,
                        secretKey: process.env.STRIPE_SECRET_KEY,
                        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
                    },
                    crypto: {
                        enabled: process.env.CRYPTO_ENABLED === 'true',
                        networks: {
                            bitcoin: {
                                enabled: true,
                                network: process.env.NODE_ENV === 'production' ? 'mainnet' : 'testnet',
                                minConfirmations: 3,
                                address: process.env.BTC_ADDRESS
                            },
                            ethereum: {
                                enabled: true,
                                network: process.env.NODE_ENV === 'production' ? 'mainnet' : 'goerli',
                                minConfirmations: 12,
                                address: process.env.ETH_ADDRESS
                            }
                        }
                    },
                    manual: {
                        enabled: true,
                        types: ['cash', 'bank_transfer']
                    }
                }
            },
            security: {
                jwtSecret: process.env.JWT_SECRET,
                jwtExpiresIn: '24h',
                bcryptRounds: 10,
                rateLimiting: {
                    windowMs: 15 * 60 * 1000, // 15 minutes
                    max: 100 // limite par IP
                }
            },
            files: {
                uploadDir: path.join(__dirname, '../uploads'),
                tempDir: path.join(__dirname, '../temp'),
                maxSize: 10 * 1024 * 1024, // 10MB
                allowedTypes: ['image/jpeg', 'image/png', 'application/pdf']
            },
            mail: {
                enabled: process.env.MAIL_ENABLED === 'true',
                host: process.env.MAIL_HOST,
                port: parseInt(process.env.MAIL_PORT) || 587,
                secure: process.env.MAIL_SECURE === 'true',
                auth: {
                    user: process.env.MAIL_USER,
                    pass: process.env.MAIL_PASS
                },
                from: process.env.MAIL_FROM
            },
            localization: {
                defaultLocale: 'fr',
                availableLocales: ['fr', 'en']
            },
            orders: {
                autoCancel: {
                    enabled: true,
                    delay: 30 * 60 * 1000 // 30 minutes
                },
                statuses: ['pending', 'processing', 'completed', 'cancelled', 'refunded'],
                maxPerUser: 10,
                minAmount: 1,
                maxAmount: 10000
            },
            products: {
                maxPerCategory: 100,
                maxFeatured: 10,
                maxGalleryImages: 5,
                statuses: ['draft', 'active', 'inactive']
            },
            cache: {
                enabled: true,
                ttl: 3600, // 1 heure
                prefix: 'shop:'
            },
            telegram: {
                messageQueue: {
                    enabled: true,
                    concurrency: 3,
                    retryLimit: 3,
                    retryDelay: 1000
                },
                mediaTypes: ['photo', 'document', 'video'],
                messageTypes: ['text', 'callback_query']
            },
            backup: {
                enabled: true,
                schedule: '0 0 * * *', // tous les jours à minuit
                keepDays: 7,
                path: path.join(__dirname, '../backups')
            }
        };

        this.loadConfig();
        this.validateConfig();
    }

    // Charger la configuration depuis un fichier
    async loadConfig() {
        try {
            const configPath = path.join(__dirname, `../config/${this.config.app.env}.json`);
            const configExists = await fs.access(configPath).then(() => true).catch(() => false);

            if (configExists) {
                const fileConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
                this.mergeConfig(fileConfig);
                logger.info('Configuration chargée depuis le fichier');
            }
        } catch (error) {
            logger.error('Erreur lors du chargement de la configuration:', error);
        }
    }

    // Fusionner les configurations
    mergeConfig(newConfig) {
        const merge = (target, source) => {
            for (const key in source) {
                if (source[key] instanceof Object && !Array.isArray(source[key])) {
                    if (!target[key]) Object.assign(target, { [key]: {} });
                    merge(target[key], source[key]);
                } else {
                    Object.assign(target, { [key]: source[key] });
                }
            }
        };

        merge(this.config, newConfig);
    }

    // Valider la configuration
    validateConfig() {
        const requiredFields = [
            'bot.token',
            'database.uri',
            'security.jwtSecret'
        ];

        const missingFields = requiredFields.filter(field => {
            const value = field.split('.').reduce((obj, key) => obj && obj[key], this.config);
            return !value;
        });

        if (missingFields.length > 0) {
            logger.error('Configuration invalide. Champs manquants:', missingFields);
            throw new Error(`Configuration invalide. Champs manquants: ${missingFields.join(', ')}`);
        }
    }

    // Obtenir une valeur de configuration
    get(key, defaultValue = null) {
        const value = key.split('.').reduce((obj, k) => obj && obj[k], this.config);
        return value !== undefined ? value : defaultValue;
    }

    // Définir une valeur de configuration
    set(key, value) {
        const keys = key.split('.');
        const lastKey = keys.pop();
        const obj = keys.reduce((o, k) => {
            if (!o[k]) o[k] = {};
            return o[k];
        }, this.config);
        obj[lastKey] = value;

        logger.info(`Configuration mise à jour: ${key}`);
    }

    // Réinitialiser la configuration
    reset() {
        this.loadConfig();
        this.validateConfig();
        logger.info('Configuration réinitialisée');
    }

    // Obtenir la configuration complète
    getAll() {
        return this.config;
    }

    // Sauvegarder la configuration dans un fichier
    async save() {
        try {
            const configPath = path.join(__dirname, `../config/${this.config.app.env}.json`);
            await fs.writeFile(configPath, JSON.stringify(this.config, null, 2));
            logger.info('Configuration sauvegardée');
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde de la configuration:', error);
            throw error;
        }
    }

    // Vérifier si une fonctionnalité est activée
    isEnabled(feature) {
        return this.get(`${feature}.enabled`, false);
    }

    // Obtenir la configuration d'une méthode de paiement
    getPaymentConfig(method) {
        return this.get(`payments.methods.${method}`);
    }

    // Obtenir la configuration de sécurité
    getSecurityConfig() {
        return this.get('security');
    }

    // Obtenir la configuration des fichiers
    getFilesConfig() {
        return this.get('files');
    }

    // Obtenir la configuration de l'API Telegram
    getTelegramConfig() {
        return this.get('telegram');
    }
}

// Exporter une instance unique
module.exports = new Config();