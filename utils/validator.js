const logger = require('./logger');

class Validator {
    constructor() {
        this.patterns = {
            email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            phone: {
                FR: /^(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}$/,
                INT: /^\+?\d{10,15}$/
            },
            password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
            username: /^[a-zA-Z0-9_-]{3,20}$/,
            url: /^https?:\/\/.+\..+/,
            btcAddress: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
            ethAddress: /^0x[a-fA-F0-9]{40}$/,
            ipAddress: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
            hexColor: /^#?([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/,
            date: /^\d{4}-\d{2}-\d{2}$/
        };

        this.limits = {
            minPasswordLength: 8,
            maxPasswordLength: 128,
            minUsernameLength: 3,
            maxUsernameLength: 20,
            maxEmailLength: 254,
            maxPhoneLength: 15,
            maxFileSize: 10 * 1024 * 1024, // 10MB
        };
    }

    // Validation d'email
    validateEmail(email) {
        try {
            if (!email || typeof email !== 'string') {
                return { isValid: false, error: 'Email invalide' };
            }

            if (email.length > this.limits.maxEmailLength) {
                return { isValid: false, error: 'Email trop long' };
            }

            if (!this.patterns.email.test(email)) {
                return { isValid: false, error: 'Format d\'email invalide' };
            }

            const [localPart, domain] = email.split('@');
            if (localPart.length > 64) {
                return { isValid: false, error: 'Partie locale de l\'email trop longue' };
            }

            if (domain.length > 255) {
                return { isValid: false, error: 'Domaine de l\'email trop long' };
            }

            return { isValid: true };
        } catch (error) {
            logger.error('Erreur validation email:', error);
            return { isValid: false, error: 'Erreur de validation' };
        }
    }

    // Validation de mot de passe
    validatePassword(password, options = {}) {
        const {
            minLength = this.limits.minPasswordLength,
            maxLength = this.limits.maxPasswordLength,
            requireUppercase = true,
            requireLowercase = true,
            requireNumbers = true,
            requireSpecialChars = true
        } = options;

        try {
            const errors = [];

            if (!password || typeof password !== 'string') {
                return { isValid: false, errors: ['Mot de passe invalide'] };
            }

            if (password.length < minLength) {
                errors.push(`Le mot de passe doit contenir au moins ${minLength} caractères`);
            }

            if (password.length > maxLength) {
                errors.push(`Le mot de passe ne doit pas dépasser ${maxLength} caractères`);
            }

            if (requireUppercase && !/[A-Z]/.test(password)) {
                errors.push('Le mot de passe doit contenir au moins une majuscule');
            }

            if (requireLowercase && !/[a-z]/.test(password)) {
                errors.push('Le mot de passe doit contenir au moins une minuscule');
            }

            if (requireNumbers && !/\d/.test(password)) {
                errors.push('Le mot de passe doit contenir au moins un chiffre');
            }

            if (requireSpecialChars && !/[@$!%*?&]/.test(password)) {
                errors.push('Le mot de passe doit contenir au moins un caractère spécial');
            }

            return {
                isValid: errors.length === 0,
                errors
            };
        } catch (error) {
            logger.error('Erreur validation mot de passe:', error);
            return { isValid: false, errors: ['Erreur de validation'] };
        }
    }

    // Validation de numéro de téléphone
    validatePhone(phone, countryCode = 'FR') {
        try {
            if (!phone || typeof phone !== 'string') {
                return { isValid: false, error: 'Numéro de téléphone invalide' };
            }

            const pattern = this.patterns.phone[countryCode] || this.patterns.phone.INT;
            
            if (!pattern.test(phone)) {
                return { isValid: false, error: 'Format de numéro invalide' };
            }

            if (phone.length > this.limits.maxPhoneLength) {
                return { isValid: false, error: 'Numéro trop long' };
            }

            return { isValid: true };
        } catch (error) {
            logger.error('Erreur validation téléphone:', error);
            return { isValid: false, error: 'Erreur de validation' };
        }
    }

    // Validation d'URL
    validateUrl(url) {
        try {
            if (!url || typeof url !== 'string') {
                return { isValid: false, error: 'URL invalide' };
            }

            if (!this.patterns.url.test(url)) {
                return { isValid: false, error: 'Format d\'URL invalide' };
            }

            try {
                new URL(url);
                return { isValid: true };
            } catch {
                return { isValid: false, error: 'URL malformée' };
            }
        } catch (error) {
            logger.error('Erreur validation URL:', error);
            return { isValid: false, error: 'Erreur de validation' };
        }
    }

    // Validation d'adresse crypto
    validateCryptoAddress(address, type) {
        try {
            if (!address || typeof address !== 'string') {
                return { isValid: false, error: 'Adresse invalide' };
            }

            switch (type.toLowerCase()) {
                case 'btc':
                    if (!this.patterns.btcAddress.test(address)) {
                        return { isValid: false, error: 'Format d\'adresse Bitcoin invalide' };
                    }
                    break;
                case 'eth':
                    if (!this.patterns.ethAddress.test(address)) {
                        return { isValid: false, error: 'Format d\'adresse Ethereum invalide' };
                    }
                    break;
                default:
                    return { isValid: false, error: 'Type de crypto non supporté' };
            }

            return { isValid: true };
        } catch (error) {
            logger.error('Erreur validation adresse crypto:', error);
            return { isValid: false, error: 'Erreur de validation' };
        }
    }

    // Validation de fichier
    validateFile(file, options = {}) {
        const {
            maxSize = this.limits.maxFileSize,
            allowedTypes = [],
            allowedExtensions = []
        } = options;

        try {
            const errors = [];

            if (!file) {
                return { isValid: false, errors: ['Fichier manquant'] };
            }

            if (file.size > maxSize) {
                errors.push(`Fichier trop volumineux (max: ${maxSize / 1024 / 1024}MB)`);
            }

            if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
                errors.push('Type de fichier non autorisé');
            }

            if (allowedExtensions.length > 0) {
                const ext = file.name.split('.').pop().toLowerCase();
                if (!allowedExtensions.includes(ext)) {
                    errors.push('Extension de fichier non autorisée');
                }
            }

            return {
                isValid: errors.length === 0,
                errors
            };
        } catch (error) {
            logger.error('Erreur validation fichier:', error);
            return { isValid: false, errors: ['Erreur de validation'] };
        }
    }

    // Validation de date
    validateDate(date, options = {}) {
        const {
            format = 'YYYY-MM-DD',
            minDate = null,
            maxDate = null
        } = options;

        try {
            if (!date) {
                return { isValid: false, error: 'Date manquante' };
            }

            // Convertir en objet Date si nécessaire
            const dateObj = date instanceof Date ? date : new Date(date);

            if (isNaN(dateObj.getTime())) {
                return { isValid: false, error: 'Date invalide' };
            }

            if (minDate && dateObj < new Date(minDate)) {
                return { isValid: false, error: 'Date trop ancienne' };
            }

            if (maxDate && dateObj > new Date(maxDate)) {
                return { isValid: false, error: 'Date trop récente' };
            }

            return { isValid: true };
        } catch (error) {
            logger.error('Erreur validation date:', error);
            return { isValid: false, error: 'Erreur de validation' };
        }
    }

    // Validation d'objet selon un schéma
    validateObject(obj, schema) {
        try {
            const errors = {};

            for (const [field, rules] of Object.entries(schema)) {
                const value = obj[field];
                const fieldErrors = [];

                // Vérifier si le champ est requis
                if (rules.required && (value === undefined || value === null || value === '')) {
                    fieldErrors.push('Champ requis');
                    errors[field] = fieldErrors;
                    continue;
                }

                // Si le champ n'est pas requis et est vide, passer à la suite
                if (!rules.required && (value === undefined || value === null || value === '')) {
                    continue;
                }

                // Vérifier le type
                if (rules.type && typeof value !== rules.type) {
                    fieldErrors.push(`Type invalide (attendu: ${rules.type})`);
                }

                // Vérifier la longueur minimale
                if (rules.minLength !== undefined && value.length < rules.minLength) {
                    fieldErrors.push(`Longueur minimale: ${rules.minLength}`);
                }

                // Vérifier la longueur maximale
                if (rules.maxLength !== undefined && value.length > rules.maxLength) {
                    fieldErrors.push(`Longueur maximale: ${rules.maxLength}`);
                }

                // Vérifier la valeur minimale
                if (rules.min !== undefined && value < rules.min) {
                    fieldErrors.push(`Valeur minimale: ${rules.min}`);
                }

                // Vérifier la valeur maximale
                if (rules.max !== undefined && value > rules.max) {
                    fieldErrors.push(`Valeur maximale: ${rules.max}`);
                }

                // Vérifier le pattern
                if (rules.pattern && !rules.pattern.test(value)) {
                    fieldErrors.push('Format invalide');
                }

                // Vérifier l'énumération
                if (rules.enum && !rules.enum.includes(value)) {
                    fieldErrors.push(`Valeur non autorisée (autorisées: ${rules.enum.join(', ')})`);
                }

                // Vérifier la fonction de validation personnalisée
                if (rules.validate) {
                    try {
                        const result = rules.validate(value);
                        if (result !== true) {
                            fieldErrors.push(result || 'Validation personnalisée échouée');
                        }
                    } catch (error) {
                        logger.error('Erreur validation personnalisée:', error);
                        fieldErrors.push('Erreur de validation');
                    }
                }

                if (fieldErrors.length > 0) {
                    errors[field] = fieldErrors;
                }
            }

            return {
                isValid: Object.keys(errors).length === 0,
                errors
            };
        } catch (error) {
            logger.error('Erreur validation objet:', error);
            return { 
                isValid: false, 
                errors: { _global: ['Erreur de validation'] }
            };
        }
    }

    // Validation personnalisée
    validate(value, rules) {
        try {
            if (typeof rules === 'function') {
                return rules(value);
            }

            if (rules instanceof RegExp) {
                return rules.test(value);
            }

            if (Array.isArray(rules)) {
                return rules.includes(value);
            }

            return false;
        } catch (error) {
            logger.error('Erreur validation personnalisée:', error);
            return false;
        }
    }
}

// Exporter une instance unique
module.exports = new Validator();