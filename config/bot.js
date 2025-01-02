const path = require('path');

module.exports = {
    // Configuration générale du bot
    bot: {
        name: process.env.BOT_NAME || 'ShopBot',
        username: process.env.BOT_USERNAME || 'YourShopBot',
        webhook: {
            domain: process.env.WEBHOOK_DOMAIN,
            port: process.env.PORT || 3000,
            path: '/webhook',
            maxConnections: 100
        },
        admins: process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : []
    },

    // Configuration des sessions
    session: {
        type: 'memory', // 'memory' ou 'redis'
        redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD,
            ttl: 24 * 60 * 60 // 24 heures
        }
    },

    // Configuration des paiements
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
                        minConfirmations: 3,
                        network: process.env.NODE_ENV === 'production' ? 'mainnet' : 'testnet'
                    },
                    ethereum: {
                        enabled: true,
                        minConfirmations: 12,
                        network: process.env.NODE_ENV === 'production' ? 'mainnet' : 'goerli'
                    }
                }
            }
        }
    },

    // Configuration des délais
    timeouts: {
        payment: 30 * 60, // 30 minutes en secondes
        cart: 24 * 60 * 60, // 24 heures en secondes
        session: 60 * 60, // 1 heure en secondes
        orderConfirmation: 72 * 60 * 60 // 72 heures en secondes
    },

    // Configuration des limites
    limits: {
        products: {
            maxPerCategory: 100,
            maxImages: 10,
            maxCustomFields: 5
        },
        cart: {
            maxItems: 10,
            maxQuantityPerItem: 5
        },
        orders: {
            maxPending: 3,
            maxPerDay: 10
        },
        uploads: {
            maxSize: 10 * 1024 * 1024, // 10 MB
            allowedTypes: ['image/jpeg', 'image/png', 'application/pdf']
        }
    },

    // Configuration des chemins
    paths: {
        uploads: path.join(__dirname, '../uploads'),
        temp: path.join(__dirname, '../temp'),
        logs: path.join(__dirname, '../logs')
    },

    // Configuration des notifications
    notifications: {
        orders: {
            created: true,
            paid: true,
            processed: true,
            shipped: true,
            delivered: true,
            cancelled: true
        },
        admin: {
            newOrder: true,
            paymentIssue: true,
            lowStock: true,
            customerIssue: true
        }
    },

    // Configuration de la sécurité
    security: {
        rateLimit: {
            window: 15 * 60 * 1000, // 15 minutes
            max: 100 // requêtes maximum par fenêtre
        },
        telegram: {
            allowedUpdates: [
                'message',
                'callback_query',
                'edited_message',
                'channel_post',
                'edited_channel_post',
                'inline_query',
                'chosen_inline_result'
            ]
        }
    }
};