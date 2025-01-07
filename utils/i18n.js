// utils/i18n.js
const logger = require('./logger');

class I18n {
    constructor() {
        this.translations = {};
        this.defaultLocale = 'fr';
        this.fallbackLocale = 'en';
        this.availableLocales = ['fr', 'en', 'es', 'de'];
        this.loadTranslations();
    }

    loadTranslations() {
        try {
            this.translations = {
                fr: {
                    admin: {
                        // Paramètres du bot
                        botSettings: '🤖 Paramètres du Bot',
                        currentName: '📝 Nom actuel',
                        currentLanguage: '🌐 Langue',
                        currentTimezone: '⏰ Fuseau horaire',
                        currentTheme: '🎨 Thème',
                        maintenanceMode: '🔒 Mode maintenance',
                        version: '🔄 Version',
                        undefined: 'Non défini',
                        editBotName: '📝 Nom du bot',
                        editLanguage: '🌐 Langue',
                        editTimezone: '⏰ Fuseau horaire',
                        editTheme: '🎨 Thème',
                        toggleMaintenance: '🔄 Mode maintenance',
                        viewStats: '📊 Stats bot',
                        back: '🔙 Retour',
                        // Messages de confirmation
                        languageChanged: '✅ Langue modifiée en : {lang}',
                        nameChanged: '✅ Nom du bot modifié en : {name}',
                        timezoneChanged: '✅ Fuseau horaire modifié en : {timezone}',
                        themeChanged: '✅ Thème modifié en : {theme}',
                        maintenanceToggled: '✅ Mode maintenance {status}',
                        // Messages d'erreur admin
                        invalidCommand: '❌ Commande invalide',
                        accessDenied: '⛔ Accès non autorisé',
                        configError: '❌ Erreur de configuration'
                    },
                    errors: {
                        general: 'Une erreur est survenue',
                        validation: 'Erreur de validation',
                        notFound: 'Non trouvé',
                        unauthorized: 'Non autorisé',
                        forbidden: 'Accès interdit',
                        fileNotFound: 'Fichier non trouvé',
                        invalidFormat: 'Format invalide',
                        paymentFailed: 'Paiement échoué',
                        maintenance: 'Service en maintenance'
                    },
                    common: {
                        yes: 'Oui',
                        no: 'Non',
                        ok: 'OK',
                        cancel: 'Annuler',
                        save: 'Sauvegarder',
                        edit: 'Modifier',
                        delete: 'Supprimer',
                        search: 'Rechercher',
                        filter: 'Filtrer',
                        loading: 'Chargement...',
                        noResults: 'Aucun résultat',
                        next: 'Suivant',
                        previous: 'Précédent',
                        confirm: 'Confirmer',
                        selected: 'Sélectionné'
                    },
                    cart: {
                        empty: 'Panier vide',
                        addItem: 'Ajouter au panier',
                        removeItem: 'Retirer du panier',
                        checkout: 'Commander',
                        total: 'Total',
                        quantity: 'Quantité'
                    },
                    orders: {
                        status: {
                            pending: 'En attente',
                            processing: 'En cours',
                            completed: 'Terminé',
                            cancelled: 'Annulé',
                            refunded: 'Remboursé'
                        },
                        actions: {
                            create: 'Créer une commande',
                            view: 'Voir la commande',
                            cancel: 'Annuler la commande',
                            refund: 'Rembourser la commande'
                        }
                    },
                    payments: {
                        status: {
                            pending: 'En attente',
                            processing: 'En cours',
                            completed: 'Terminé',
                            failed: 'Échoué',
                            refunded: 'Remboursé'
                        },
                        methods: {
                            card: 'Carte bancaire',
                            paypal: 'PayPal',
                            crypto: 'Crypto-monnaie',
                            transfer: 'Virement bancaire'
                        }
                    }
                },

                en: {
                    admin: {
                        // Bot settings
                        botSettings: '🤖 Bot Settings',
                        currentName: '📝 Current name',
                        currentLanguage: '🌐 Language',
                        currentTimezone: '⏰ Timezone',
                        currentTheme: '🎨 Theme',
                        maintenanceMode: '🔒 Maintenance mode',
                        version: '🔄 Version',
                        undefined: 'Undefined',
                        editBotName: '📝 Bot name',
                        editLanguage: '🌐 Language',
                        editTimezone: '⏰ Timezone',
                        editTheme: '🎨 Theme',
                        toggleMaintenance: '🔄 Maintenance mode',
                        viewStats: '📊 Bot stats',
                        back: '🔙 Back',
                        // Confirmation messages
                        languageChanged: '✅ Language changed to: {lang}',
                        nameChanged: '✅ Bot name changed to: {name}',
                        timezoneChanged: '✅ Timezone changed to: {timezone}',
                        themeChanged: '✅ Theme changed to: {theme}',
                        maintenanceToggled: '✅ Maintenance mode {status}',
                        // Admin error messages
                        invalidCommand: '❌ Invalid command',
                        accessDenied: '⛔ Access denied',
                        configError: '❌ Configuration error'
                    },
                    errors: {
                        general: 'An error occurred',
                        validation: 'Validation error',
                        notFound: 'Not found',
                        unauthorized: 'Unauthorized',
                        forbidden: 'Access forbidden',
                        fileNotFound: 'File not found',
                        invalidFormat: 'Invalid format',
                        paymentFailed: 'Payment failed',
                        maintenance: 'Service under maintenance'
                    },
                    common: {
                        yes: 'Yes',
                        no: 'No',
                        ok: 'OK',
                        cancel: 'Cancel',
                        save: 'Save',
                        edit: 'Edit',
                        delete: 'Delete',
                        search: 'Search',
                        filter: 'Filter',
                        loading: 'Loading...',
                        noResults: 'No results',
                        next: 'Next',
                        previous: 'Previous',
                        confirm: 'Confirm',
                        selected: 'Selected'
                    },
                    cart: {
                        empty: 'Cart empty',
                        addItem: 'Add to cart',
                        removeItem: 'Remove from cart',
                        checkout: 'Checkout',
                        total: 'Total',
                        quantity: 'Quantity'
                    },
                    orders: {
                        status: {
                            pending: 'Pending',
                            processing: 'Processing',
                            completed: 'Completed',
                            cancelled: 'Cancelled',
                            refunded: 'Refunded'
                        },
                        actions: {
                            create: 'Create order',
                            view: 'View order',
                            cancel: 'Cancel order',
                            refund: 'Refund order'
                        }
                    },
                    payments: {
                        status: {
                            pending: 'Pending',
                            processing: 'Processing',
                            completed: 'Completed',
                            failed: 'Failed',
                            refunded: 'Refunded'
                        },
                        methods: {
                            card: 'Credit card',
                            paypal: 'PayPal',
                            crypto: 'Cryptocurrency',
                            transfer: 'Bank transfer'
                        }
                    }
                },

                es: {
                    admin: {
                        // Configuración del bot
                        botSettings: '🤖 Configuración del Bot',
                        currentName: '📝 Nombre actual',
                        currentLanguage: '🌐 Idioma',
                        currentTimezone: '⏰ Zona horaria',
                        currentTheme: '🎨 Tema',
                        maintenanceMode: '🔒 Modo mantenimiento',
                        version: '🔄 Versión',
                        undefined: 'No definido',
                        editBotName: '📝 Nombre del bot',
                        editLanguage: '🌐 Idioma',
                        editTimezone: '⏰ Zona horaria',
                        editTheme: '🎨 Tema',
                        toggleMaintenance: '🔄 Modo mantenimiento',
                        viewStats: '📊 Estadísticas',
                        back: '🔙 Volver',
                        // Mensajes de confirmación
                        languageChanged: '✅ Idioma cambiado a: {lang}',
                        nameChanged: '✅ Nombre del bot cambiado a: {name}',
                        timezoneChanged: '✅ Zona horaria cambiada a: {timezone}',
                        themeChanged: '✅ Tema cambiado a: {theme}',
                        maintenanceToggled: '✅ Modo mantenimiento {status}',
                        // Mensajes de error de administración
                        invalidCommand: '❌ Comando inválido',
                        accessDenied: '⛔ Acceso denegado',
                        configError: '❌ Error de configuración'
                    },
                    errors: {
                        general: 'Ha ocurrido un error',
                        validation: 'Error de validación',
                        notFound: 'No encontrado',
                        unauthorized: 'No autorizado',
                        forbidden: 'Acceso prohibido',
                        fileNotFound: 'Archivo no encontrado',
                        invalidFormat: 'Formato inválido',
                        paymentFailed: 'Pago fallido',
                        maintenance: 'Servicio en mantenimiento'
                    },
                    common: {
                        yes: 'Sí',
                        no: 'No',
                        ok: 'OK',
                        cancel: 'Cancelar',
                        save: 'Guardar',
                        edit: 'Editar',
                        delete: 'Eliminar',
                        search: 'Buscar',
                        filter: 'Filtrar',
                        loading: 'Cargando...',
                        noResults: 'Sin resultados',
                        next: 'Siguiente',
                        previous: 'Anterior',
                        confirm: 'Confirmar',
                        selected: 'Seleccionado'
                    },
                    cart: {
                        empty: 'Carrito vacío',
                        addItem: 'Añadir al carrito',
                        removeItem: 'Quitar del carrito',
                        checkout: 'Comprar',
                        total: 'Total',
                        quantity: 'Cantidad'
                    },
                    orders: {
                        status: {
                            pending: 'Pendiente',
                            processing: 'Procesando',
                            completed: 'Completado',
                            cancelled: 'Cancelado',
                            refunded: 'Reembolsado'
                        },
                        actions: {
                            create: 'Crear pedido',
                            view: 'Ver pedido',
                            cancel: 'Cancelar pedido',
                            refund: 'Reembolsar pedido'
                        }
                    },
                    payments: {
                        status: {
                            pending: 'Pendiente',
                            processing: 'Procesando',
                            completed: 'Completado',
                            failed: 'Fallido',
                            refunded: 'Reembolsado'
                        },
                        methods: {
                            card: 'Tarjeta de crédito',
                            paypal: 'PayPal',
                            crypto: 'Criptomoneda',
                            transfer: 'Transferencia bancaria'
                        }
                    }
                },

                de: {
                    admin: {
                        // Bot-Einstellungen
                        botSettings: '🤖 Bot-Einstellungen',
                        currentName: '📝 Aktueller Name',
                        currentLanguage: '🌐 Sprache',
                        currentTimezone: '⏰ Zeitzone',
                        currentTheme: '🎨 Theme',
                        maintenanceMode: '🔒 Wartungsmodus',
                        version: '🔄 Version',
                        undefined: 'Nicht definiert',
                        editBotName: '📝 Bot-Name',
                        editLanguage: '🌐 Sprache',
                        editTimezone: '⏰ Zeitzone',
                        editTheme: '🎨 Theme',
                        toggleMaintenance: '🔄 Wartungsmodus',
                        viewStats: '📊 Statistiken',
                        back: '🔙 Zurück',
                        // Bestätigungsmeldungen
                        languageChanged: '✅ Sprache geändert zu: {lang}',
                        nameChanged: '✅ Bot-Name geändert zu: {name}',
                        timezoneChanged: '✅ Zeitzone geändert zu: {timezone}',
                        themeChanged: '✅ Theme geändert zu: {theme}',
                        maintenanceToggled: '✅ Wartungsmodus {status}',
                        // Admin-Fehlermeldungen
                        invalidCommand: '❌ Ungültiger Befehl',
                        accessDenied: '⛔ Zugriff verweigert',
                        configError: '❌ Konfigurationsfehler'
                    },
                    errors: {
                        general: 'Ein Fehler ist aufgetreten',
                        validation: 'Validierungsfehler',
                        notFound: 'Nicht gefunden',
                        unauthorized: 'Nicht autorisiert',
                        forbidden: 'Zugriff verboten',
                        fileNotFound: 'Datei nicht gefunden',
                        invalidFormat: 'Ungültiges Format',
                        paymentFailed: 'Zahlung fehlgeschlagen',
                        maintenance: 'Service in Wartung'
                    },
                    common: {
                        yes: 'Ja',
                        no: 'Nein',
                        ok: 'OK',
                        cancel: 'Abbrechen',
                        save: 'Speichern',
                        edit: 'Bearbeiten',
                        delete: 'Löschen',
                        search: 'Suchen',
                        filter: 'Filtern',
                        loading: 'Lädt...',
                        noResults: 'Keine Ergebnisse',
                        next: 'Weiter',
                        previous: 'Zurück',
                        confirm: 'Bestätigen',
                        selected: 'Ausgewählt'
                    },
                    cart: {
                        empty: 'Warenkorb leer',
                        addItem: 'In den Warenkorb',
                        removeItem: 'Aus dem Warenkorb entfernen',
                        checkout: 'Zur Kasse',
                        total: 'Gesamt',
                        quantity: 'Menge'
                    },
                    orders: {
                        status: {
                            pending: 'Ausstehend',
                            processing: 'In Bearbeitung',
                            completed: 'Abgeschlossen',
                            cancelled: 'Storniert',
                            refunded: 'Erstattet'
                        },
                        actions: {
                            create: 'Bestellung erstellen',
                            view: 'Bestellung ansehen',
                            cancel: 'Bestellung stornieren',
                            refund: 'Bestellung erstatten'
                        }
                    },
                    payments: {
                        status: {
                            pending: 'Ausstehend',
                            processing: 'In Bearbeitung',
                            completed: 'Abgeschlossen',
                            failed: 'Fehlgeschlagen',
                            refunded: 'Erstattet'
                        },
                        methods: {
                            card: 'Kreditkarte',
                            paypal: 'PayPal',
                            crypto: 'Kryptowährung',
                            transfer: 'Überweisung'
                        }
                    }
                }
            };
            logger.info('Traductions chargées avec succès');
        } catch (error) {
            logger.error('Erreur lors du chargement des traductions:', error);
        }
    }

    t(key, vars = {}, locale = this.defaultLocale) {
        try {
            // Vérifier que la locale est disponible
            if (!this.availableLocales.includes(locale)) {
                locale = this.defaultLocale;
            }

            // Obtenir la traduction
            const keys = key.split('.');
            let translation = this.translations[locale];

            for (const k of keys) {
                if (!translation || !translation[k]) {
                    // Essayer avec la locale de fallback
                    translation = this.translations[this.fallbackLocale];
                    for (const fk of keys) {
                        if (!translation || !translation[fk]) {
                            return key; // Retourner la clé si pas de traduction
                        }
                        translation = translation[fk];
                    }
                    break;
                }
                translation = translation[k];
            }

            // Remplacer les variables
            let result = translation;
            Object.entries(vars).forEach(([key, value]) => {
                result = result.replace(`{${key}}`, value);
            });

            return result;
        } catch (error) {
            logger.error('Erreur lors de la traduction:', error);
            return key;
        }
    }

    setDefaultLocale(locale) {
        if (this.availableLocales.includes(locale)) {
            this.defaultLocale = locale;
            logger.info(`Langue par défaut changée pour: ${locale}`);
        } else {
            logger.warn('Langue non disponible:', locale);
        }
    }

    addLocale(locale, translations) {
        try {
            if (!locale || typeof locale !== 'string') {
                throw new Error('Locale invalide');
            }

            if (!translations || typeof translations !== 'object') {
                throw new Error('Traductions invalides');
            }

            this.translations[locale] = translations;
            if (!this.availableLocales.includes(locale)) {
                this.availableLocales.push(locale);
            }

            logger.info('Nouvelle langue ajoutée:', locale);
        } catch (error) {
            logger.error('Erreur lors de l\'ajout de la langue:', error);
        }
    }

    getTranslations(locale = this.defaultLocale) {
        return this.translations[locale] || {};
    }

    formatDate(date, options = {}) {
        try {
            const locale = options.locale || this.defaultLocale;
            return new Date(date).toLocaleDateString(locale, options);
        } catch (error) {
            logger.error('Erreur lors du formatage de la date:', error);
            return date;
        }
    }

    formatNumber(number, options = {}) {
        try {
            const locale = options.locale || this.defaultLocale;
            return new Intl.NumberFormat(locale, options).format(number);
        } catch (error) {
            logger.error('Erreur lors du formatage du nombre:', error);
            return number;
        }
    }

    formatCurrency(amount, currency = 'EUR', locale = this.defaultLocale) {
        try {
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: currency
            }).format(amount);
        } catch (error) {
            logger.error('Erreur lors du formatage de la devise:', error);
            return `${amount} ${currency}`;
        }
    }

    getTextDirection(locale = this.defaultLocale) {
        const rtlLocales = ['ar', 'he', 'fa'];
        return rtlLocales.includes(locale) ? 'rtl' : 'ltr';
    }
}

// Exporter une instance unique
module.exports = new I18n();