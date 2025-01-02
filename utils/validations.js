// validation.js
// Système complet de validation pour le bot e-shop Telegram

class ValidationError extends Error {
    constructor(message, errors = []) {
        super(message);
        this.name = 'ValidationError';
        this.errors = errors;
    }
}

class Validator {
    // Constantes et Regex pour la validation
    static CONSTANTS = {
        MIN_PRICE: 0.01,
        MAX_PRICE: 1000000,
        MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
        SUPPORTED_PAYMENT_METHODS: ['paypal', 'pcs', 'transcash', 'paysafecard', 'crypto', 'mainpropre'],
        SUPPORTED_CRYPTO: ['btc', 'eth', 'usdt'],
        ALLOWED_FILE_TYPES: ['application/pdf', 'image/jpeg', 'image/png'],
        CATEGORIES: [
            'vehicules',
            'papier_hebdomadaire',
            'papier_routier',
            'papier_auto',
            'papier_maison',
            'papier_identite',
            'tech',
            'contact'
        ]
    };

    static PATTERNS = {
        EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        PHONE: /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/,
        URL: /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/,
        PRICE: /^\d+(\.\d{1,2})?$/,
        USERNAME: /^[a-zA-Z0-9_]{3,30}$/,
        PASSWORD: /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/,
        CRYPTO: {
            BTC: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
            ETH: /^0x[a-fA-F0-9]{40}$/,
            USDT: /^T[1-9A-HJ-NP-Za-km-z]{33}$/
        }
    };

    // Validation des utilisateurs
    static validateUser(user) {
        const errors = [];

        if (!user.username || !this.PATTERNS.USERNAME.test(user.username)) {
            errors.push('Nom d\'utilisateur invalide (3-30 caractères, lettres, chiffres et underscore uniquement)');
        }

        if (user.email && !this.PATTERNS.EMAIL.test(user.email)) {
            errors.push('Email invalide');
        }

        if (user.phone && !this.PATTERNS.PHONE.test(user.phone)) {
            errors.push('Numéro de téléphone invalide');
        }

        if (user.password && !this.PATTERNS.PASSWORD.test(user.password)) {
            errors.push('Mot de passe invalide (minimum 8 caractères, au moins 1 lettre et 1 chiffre)');
        }

        return this._returnValidation(errors);
    }

    // Validation des produits
    static validateProduct(product) {
        const errors = [];

        if (!product.name || typeof product.name !== 'string' || product.name.length < 3) {
            errors.push('Le nom du produit doit contenir au moins 3 caractères');
        }

        if (!product.description || product.description.length < 10) {
            errors.push('La description doit contenir au moins 10 caractères');
        }

        if (!this.PATTERNS.PRICE.test(product.price) || 
            product.price < this.CONSTANTS.MIN_PRICE || 
            product.price > this.CONSTANTS.MAX_PRICE) {
            errors.push(`Le prix doit être entre ${this.CONSTANTS.MIN_PRICE} et ${this.CONSTANTS.MAX_PRICE}`);
        }

        if (!this.CONSTANTS.CATEGORIES.includes(product.category?.toLowerCase())) {
            errors.push('Catégorie invalide');
        }

        if (product.questions) {
            product.questions.forEach((question, index) => {
                const questionValidation = this.validateCustomQuestion(question);
                if (!questionValidation.isValid) {
                    errors.push(`Question ${index + 1}: ${questionValidation.errors.join(', ')}`);
                }
            });
        }

        return this._returnValidation(errors);
    }

    // Validation des paiements
    static validatePayment(payment) {
        const errors = [];

        if (!this.CONSTANTS.SUPPORTED_PAYMENT_METHODS.includes(payment.method?.toLowerCase())) {
            errors.push('Méthode de paiement non supportée');
        }

        if (!payment.amount || !this.PATTERNS.PRICE.test(payment.amount)) {
            errors.push('Montant invalide');
        }

        // Validation spécifique par méthode de paiement
        switch(payment.method?.toLowerCase()) {
            case 'crypto':
                if (!payment.cryptoType || !this.CONSTANTS.SUPPORTED_CRYPTO.includes(payment.cryptoType)) {
                    errors.push('Type de crypto-monnaie non supporté');
                }
                if (!payment.address || !this.PATTERNS.CRYPTO[payment.cryptoType?.toUpperCase()]?.test(payment.address)) {
                    errors.push('Adresse crypto invalide');
                }
                break;

            case 'paypal':
                if (!payment.email || !this.PATTERNS.EMAIL.test(payment.email)) {
                    errors.push('Email PayPal invalide');
                }
                break;

            case 'pcs':
            case 'transcash':
            case 'paysafecard':
                if (!payment.code || payment.code.length < 10) {
                    errors.push('Code invalide');
                }
                break;
        }

        return this._returnValidation(errors);
    }

    // Validation du panier
    static validateCartItem(item) {
        const errors = [];

        if (!item.productId) {
            errors.push('ID du produit manquant');
        }

        if (!Number.isInteger(item.quantity) || item.quantity < 1) {
            errors.push('Quantité invalide');
        }

        return this._returnValidation(errors);
    }

    // Validation d'une commande complète
    static validateOrder(order) {
        const errors = [];

        if (!order.userId) {
            errors.push('ID utilisateur manquant');
        }

        if (!Array.isArray(order.items) || order.items.length === 0) {
            errors.push('La commande doit contenir au moins un article');
        } else {
            order.items.forEach((item, index) => {
                const itemValidation = this.validateCartItem(item);
                if (!itemValidation.isValid) {
                    errors.push(`Article ${index + 1}: ${itemValidation.errors.join(', ')}`);
                }
            });
        }

        if (!order.paymentMethod) {
            errors.push('Méthode de paiement manquante');
        }

        return this._returnValidation(errors);
    }

    // Validation des questions personnalisées
    static validateCustomQuestion(question) {
        const errors = [];

        if (!question.text || question.text.length < 5) {
            errors.push('La question doit contenir au moins 5 caractères');
        }

        if (typeof question.required !== 'boolean') {
            errors.push('Le champ required doit être un booléen');
        }

        const validTypes = ['text', 'choice', 'file', 'date', 'number'];
        if (!validTypes.includes(question.type)) {
            errors.push(`Type de question invalide. Types valides: ${validTypes.join(', ')}`);
        }

        if (question.type === 'choice' && (!Array.isArray(question.options) || question.options.length < 2)) {
            errors.push('Les questions à choix doivent avoir au moins 2 options');
        }

        return this._returnValidation(errors);
    }

    // Validation des promotions
    static validatePromotion(promotion) {
        const errors = [];

        if (!promotion.code || promotion.code.length < 3) {
            errors.push('Le code promotion doit contenir au moins 3 caractères');
        }

        if (!Number.isFinite(promotion.discount) || promotion.discount <= 0 || promotion.discount > 100) {
            errors.push('La réduction doit être un nombre entre 0 et 100');
        }

        if (promotion.startDate && promotion.endDate) {
            const start = new Date(promotion.startDate);
            const end = new Date(promotion.endDate);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                errors.push('Dates invalides');
            } else if (start >= end) {
                errors.push('La date de fin doit être postérieure à la date de début');
            }
        }

        return this._returnValidation(errors);
    }

    // Méthode utilitaire pour retourner le résultat de validation
    static _returnValidation(errors) {
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    // Méthode pour lancer une erreur si la validation échoue
    static throwIfInvalid(validation, message = 'Validation failed') {
        if (!validation.isValid) {
            throw new ValidationError(message, validation.errors);
        }
    }
}

module.exports = {
    Validator,
    ValidationError
};