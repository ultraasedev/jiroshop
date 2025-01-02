const logger = require('./logger');

class I18n {
    constructor() {
        this.translations = {};
        this.defaultLocale = 'fr';
        this.fallbackLocale = 'en';
        this.availableLocales = ['fr', 'en'];
        this.loadTranslations();
    }

    // Charger les traductions
    loadTranslations() {
        try {
            this.translations = {
                fr: {
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
                    success: {
                        created: 'Créé avec succès',
                        updated: 'Mis à jour avec succès',
                        deleted: 'Supprimé avec succès',
                        saved: 'Sauvegardé avec succès',
                        sent: 'Envoyé avec succès',
                        processed: 'Traité avec succès'
                    },
                    validation: {
                        required: 'Champ requis',
                        email: 'Email invalide',
                        password: 'Mot de passe invalide',
                        phone: 'Numéro de téléphone invalide',
                        date: 'Date invalide',
                        min: 'Valeur minimale: {min}',
                        max: 'Valeur maximale: {max}',
                        length: 'Longueur invalide',
                        format: 'Format invalide'
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
                    },
                    auth: {
                        login: 'Connexion',
                        logout: 'Déconnexion',
                        register: 'Inscription',
                        forgotPassword: 'Mot de passe oublié',
                        resetPassword: 'Réinitialiser le mot de passe',
                        changePassword: 'Changer le mot de passe'
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
                        noResults: 'Aucun résultat'
                    }
                },
                en: {
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
                    success: {
                        created: 'Successfully created',
                        updated: 'Successfully updated',
                        deleted: 'Successfully deleted',
                        saved: 'Successfully saved',
                        sent: 'Successfully sent',
                        processed: 'Successfully processed'
                    },
                    validation: {
                        required: 'Field required',
                        email: 'Invalid email',
                        password: 'Invalid password',
                        phone: 'Invalid phone number',
                        date: 'Invalid date',
                        min: 'Minimum value: {min}',
                        max: 'Maximum value: {max}',
                        length: 'Invalid length',
                        format: 'Invalid format'
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
                    },
                    auth: {
                        login: 'Login',
                        logout: 'Logout',
                        register: 'Register',
                        forgotPassword: 'Forgot password',
                        resetPassword: 'Reset password',
                        changePassword: 'Change password'
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
                        noResults: 'No results'
                    }
                }
            };
        } catch (error) {
            logger.error('Erreur lors du chargement des traductions:', error);
        }
    }

    // Traduire une clé
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

    // Définir la locale par défaut
    setDefaultLocale(locale) {
        if (this.availableLocales.includes(locale)) {
            this.defaultLocale = locale;
        } else {
            logger.warn('Locale non disponible:', locale);
        }
    }

    // Ajouter une nouvelle locale
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

            logger.info('Nouvelle locale ajoutée:', locale);
        } catch (error) {
            logger.error('Erreur lors de l\'ajout de la locale:', error);
        }
    }

    // Obtenir les traductions pour une locale
    getTranslations(locale = this.defaultLocale) {
        return this.translations[locale] || {};
    }

    // Formater une date selon la locale
    formatDate(date, options = {}) {
        try {
            const locale = options.locale || this.defaultLocale;
            return new Date(date).toLocaleDateString(locale, options);
        } catch (error) {
            logger.error('Erreur lors du formatage de la date:', error);
            return date;
        }
    }

    // Formater un nombre selon la locale
    formatNumber(number, options = {}) {
        try {
            const locale = options.locale || this.defaultLocale;
            return new Intl.NumberFormat(locale, options).format(number);
        } catch (error) {
            logger.error('Erreur lors du formatage du nombre:', error);
            return number;
        }
    }

    // Formater une devise selon la locale
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

    // Obtenir la direction d'écriture pour une locale
    getTextDirection(locale = this.defaultLocale) {
        const rtlLocales = ['ar', 'he', 'fa'];
        return rtlLocales.includes(locale) ? 'rtl' : 'ltr';
    }
}

// Exporter une instance unique
module.exports = new I18n();