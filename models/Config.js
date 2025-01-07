const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
    // Configuration du bot
    bot: {
        name: {
            type: String,
            default: 'ShopBot'
        },
        username: {
            type: String,
            default: 'YourShopBot'
        },
        language: {
            type: String,
            default: 'fr'
        },
        timezone: {
            type: String,
            default: 'Europe/Paris'
        },
        theme: {
            type: String,
            default: 'Default'
        },

        timezone: {
            type: String,
            default: 'Europe/Paris'
        },
        adminIds: [{
            type: String
        }],
        maintenanceMode: {
            type: Boolean,
            default: false
        },
        version: {
            type: String,
            default: '1.0.0'
        },
        lastUpdate: {
            type: Date,
            default: Date.now
        }
    },

    // Configuration des paiements
    payments: {
        currency: {
            type: String,
            default: 'EUR'
        },
        minPaymentAmount: {
            type: Number,
            default: 1
        },
        maxPaymentAmount: {
            type: Number,
            default: 10000
        },
        autoConfirmPayments: {
            type: Boolean,
            default: false
        },
        autoConfirmLimit: {
            type: Number,
            default: 100
        },
        maxPaymentAttempts: {
            type: Number,
            default: 3
        },
        paymentTimeout: {
            type: Number,
            default: 1800 // 30 minutes en secondes
        },
        methods: {
            paypal: {
                enabled: {
                    type: Boolean,
                    default: false
                },
                mode: {
                    type: String,
                    enum: ['sandbox', 'live'],
                    default: 'sandbox'
                },
                clientId: String,
                clientSecret: String
            },
            crypto: {
                enabled: {
                    type: Boolean,
                    default: false
                },
                networks: {
                    bitcoin: {
                        enabled: {
                            type: Boolean,
                            default: true
                        },
                        minConfirmations: {
                            type: Number,
                            default: 3
                        }
                    },
                    ethereum: {
                        enabled: {
                            type: Boolean,
                            default: true
                        },
                        minConfirmations: {
                            type: Number,
                            default: 12
                        }
                    }
                }
            },
            stripe: {
                enabled: {
                    type: Boolean,
                    default: false
                },
                publicKey: String,
                secretKey: String,
                webhookSecret: String
            }
        }
    },

    // Limites et restrictions
    limits: {
        products: {
            maxPerCategory: {
                type: Number,
                default: 100
            },
            maxImages: {
                type: Number,
                default: 10
            },
            maxCustomFields: {
                type: Number,
                default: 5
            }
        },
        cart: {
            maxItems: {
                type: Number,
                default: 10
            },
            maxQuantityPerItem: {
                type: Number,
                default: 5
            },
            expiryTime: {
                type: Number,
                default: 86400 // 24 heures en secondes
            }
        },
        orders: {
            maxPending: {
                type: Number,
                default: 3
            },
            maxPerDay: {
                type: Number,
                default: 10
            },
            confirmationTimeout: {
                type: Number,
                default: 259200 // 72 heures en secondes
            }
        },
        uploads: {
            maxSize: {
                type: Number,
                default: 10485760 // 10MB en bytes
            },
            allowedTypes: [{
                type: String,
                default: ['image/jpeg', 'image/png', 'application/pdf']
            }]
        }
    },

    // Notifications
    notifications: {
        orders: {
            created: {
                type: Boolean,
                default: true
            },
            paid: {
                type: Boolean,
                default: true
            },
            processed: {
                type: Boolean,
                default: true
            },
            shipped: {
                type: Boolean,
                default: true
            },
            delivered: {
                type: Boolean,
                default: true
            },
            cancelled: {
                type: Boolean,
                default: true
            }
        },
        admin: {
            newOrder: {
                type: Boolean,
                default: true
            },
            paymentIssue: {
                type: Boolean,
                default: true
            },
            lowStock: {
                type: Boolean,
                default: true
            },
            customerIssue: {
                type: Boolean,
                default: true
            }
        }
    },

    // Sécurité
    security: {
        rateLimit: {
            window: {
                type: Number,
                default: 900000 // 15 minutes en ms
            },
            max: {
                type: Number,
                default: 100
            }
        },
        telegram: {
            allowedUpdates: [{
                type: String,
                default: [
                    'message',
                    'callback_query',
                    'edited_message',
                    'channel_post',
                    'edited_channel_post',
                    'inline_query',
                    'chosen_inline_result'
                ]
            }]
        },
        ipBlacklist: [{
            type: String
        }],
        requireVerification: {
            type: Boolean,
            default: false
        }
    },

    // Chemins de sauvegarde
    paths: {
        uploads: {
            type: String,
            default: 'uploads'
        },
        temp: {
            type: String,
            default: 'temp'
        },
        logs: {
            type: String,
            default: 'logs'
        }
    },

    // Métadonnées
    metadata: {
        version: String,
        lastUpdate: {
            type: Date,
            default: Date.now
        },
        updatedBy: String
    }
}, {
    timestamps: true,
    collection: 'configs'
});

// Méthode statique pour obtenir la configuration active
configSchema.statics.getActive = async function() {
    let config = await this.findOne();
    if (!config) {
        config = await this.create({});
    }
    return config;
};

// Méthode pour vérifier si un montant est dans les limites
configSchema.methods.isPaymentAmountValid = function(amount) {
    return amount >= this.payments.minPaymentAmount && 
           (amount <= this.payments.maxPaymentAmount || this.payments.maxPaymentAmount === 0);
};

// Méthode pour vérifier si un paiement peut être auto-confirmé
configSchema.methods.canAutoConfirmPayment = function(amount) {
    return this.payments.autoConfirmPayments && 
           amount <= this.payments.autoConfirmLimit;
};

// Hook de pré-sauvegarde
configSchema.pre('save', function(next) {
    this.metadata.lastUpdate = new Date();
    next();
});

const Config = mongoose.model('Config', configSchema);

module.exports = Config;