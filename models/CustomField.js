// models/CustomField.js
const mongoose = require('mongoose');

const validationSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['regex', 'range', 'enum', 'length', 'format', 'custom'],
        required: true
    },
    params: {
        pattern: String,
        flags: String,
        min: Number,
        max: Number,
        values: [String],
        minLength: Number,
        maxLength: Number,
        format: String,
        customValidator: String
    },
    errorMessage: {
        type: String,
        required: true
    }
}, { _id: false });

const customFieldSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    label: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: [
            'text',          // Texte simple
            'number',        // Nombre
            'date',          // Date
            'time',          // Heure
            'select',        // Sélection unique
            'multiselect',   // Sélection multiple
            'file',          // Fichier
            'image',         // Image
            'document',      // Document spécifique (PDF, etc.)
            'location',      // Localisation
            'idcard',        // Carte d'identité
            'selfie',        // Photo avec une pièce d'identité
            'proofofaddress' // Justificatif de domicile
        ]
    },
    description: String,
    placeholder: String,
    category: {
        type: String,
        required: true,
        enum: [
            'identity',      // Documents d'identité
            'address',       // Documents d'adresse
            'vehicle',       // Documents véhicule
            'payment',       // Informations de paiement
            'contact',       // Informations de contact
            'other'         // Autres informations
        ]
    },
    validation: [validationSchema],
    required: {
        type: Boolean,
        default: false
    },
    options: {
        maxFileSize: {
            type: Number,
            default: 10 * 1024 * 1024 // 10MB
        },
        allowedFileTypes: [{
            type: String
        }],
        imageSize: {
            width: Number,
            height: Number
        },
        autoFormatting: {
            case: {
                type: String,
                enum: ['none', 'upper', 'lower', 'capitalize']
            },
            trim: {
                type: Boolean,
                default: true
            }
        }
    },
    visibility: {
        conditions: [{
            field: String,
            operator: {
                type: String,
                enum: ['equals', 'notEquals', 'contains', 'greaterThan', 'lessThan']
            },
            value: mongoose.Schema.Types.Mixed
        }],
        roles: [{
            type: String,
            enum: ['user', 'admin', 'superadmin']
        }]
    },
    verification: {
        required: {
            type: Boolean,
            default: false
        },
        method: {
            type: String,
            enum: ['manual', 'automatic', 'none'],
            default: 'none'
        },
        instructions: String
    },
    retention: {
        duration: {
            type: Number,
            default: 30 // jours
        },
        autoDelete: {
            type: Boolean,
            default: true
        }
    }
}, {
    timestamps: true
});

// Méthodes d'instance
customFieldSchema.methods = {
    validateValue(value) {
        const errors = [];

        if (this.required && !value) {
            errors.push('Ce champ est requis');
            return { isValid: false, errors };
        }

        for (const validator of this.validation) {
            switch (validator.type) {
                case 'regex':
                    if (!new RegExp(validator.params.pattern, validator.params.flags).test(value)) {
                        errors.push(validator.errorMessage);
                    }
                    break;

                case 'range':
                    const num = parseFloat(value);
                    if (validator.params.min !== undefined && num < validator.params.min) {
                        errors.push(validator.errorMessage);
                    }
                    if (validator.params.max !== undefined && num > validator.params.max) {
                        errors.push(validator.errorMessage);
                    }
                    break;

                case 'enum':
                    if (!validator.params.values.includes(value)) {
                        errors.push(validator.errorMessage);
                    }
                    break;

                case 'length':
                    if (validator.params.minLength && value.length < validator.params.minLength) {
                        errors.push(validator.errorMessage);
                    }
                    if (validator.params.maxLength && value.length > validator.params.maxLength) {
                        errors.push(validator.errorMessage);
                    }
                    break;

                case 'format':
                    if (validator.params.format === 'email' && 
                        !value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                        errors.push(validator.errorMessage);
                    }
                    break;

                case 'custom':
                    try {
                        const fn = new Function('value', validator.params.customValidator);
                        if (!fn(value)) {
                            errors.push(validator.errorMessage);
                        }
                    } catch (error) {
                        errors.push('Erreur de validation personnalisée');
                    }
                    break;
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    },

    async processFile(file) {
        const errors = [];

        if (this.options.maxFileSize && file.size > this.options.maxFileSize) {
            errors.push(`La taille du fichier dépasse la limite de ${this.options.maxFileSize} bytes`);
        }

        if (this.options.allowedFileTypes && 
            !this.options.allowedFileTypes.includes(file.mimetype)) {
            errors.push('Type de fichier non autorisé');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    },

    formatValue(value) {
        if (!value || !this.options.autoFormatting) return value;

        let formatted = value;

        if (this.options.autoFormatting.trim) {
            formatted = formatted.trim();
        }

        if (this.options.autoFormatting.case) {
            switch (this.options.autoFormatting.case) {
                case 'upper':
                    formatted = formatted.toUpperCase();
                    break;
                case 'lower':
                    formatted = formatted.toLowerCase();
                    break;
                case 'capitalize':
                    formatted = formatted.charAt(0).toUpperCase() + 
                              formatted.slice(1).toLowerCase();
                    break;
            }
        }

        return formatted;
    }
};

const CustomField = mongoose.model('CustomField', customFieldSchema);

module.exports = CustomField;