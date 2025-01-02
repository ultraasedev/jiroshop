const moment = require('moment');
const logger = require('./logger');

class Formatter {
    // Formatage des montants
    static formatAmount(amount, currency = 'EUR', locale = 'fr-FR') {
        try {
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: currency
            }).format(amount);
        } catch (error) {
            logger.error('Erreur lors du formatage du montant:', error);
            return `${amount} ${currency}`;
        }
    }

    // Formatage des dates
    static formatDate(date, format = 'DD/MM/YYYY HH:mm', locale = 'fr') {
        try {
            moment.locale(locale);
            return moment(date).format(format);
        } catch (error) {
            logger.error('Erreur lors du formatage de la date:', error);
            return date.toLocaleString();
        }
    }

    // Formatage des numéros de téléphone
    static formatPhoneNumber(phone, countryCode = 'FR') {
        try {
            // Nettoyer le numéro
            let cleaned = phone.replace(/\D/g, '');

            // Formats selon le pays
            const formats = {
                FR: (num) => {
                    if (num.length !== 10) return num;
                    return num.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
                },
                UK: (num) => {
                    if (num.length !== 11) return num;
                    return num.replace(/(\d{5})(\d{6})/, '$1 $2');
                },
                US: (num) => {
                    if (num.length !== 10) return num;
                    return num.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
                }
            };

            return formats[countryCode] ? formats[countryCode](cleaned) : phone;
        } catch (error) {
            logger.error('Erreur lors du formatage du numéro de téléphone:', error);
            return phone;
        }
    }

    // Formatage des identifiants
    static formatId(id, prefix = '', padLength = 6) {
        try {
            const numStr = String(id).padStart(padLength, '0');
            return prefix ? `${prefix}-${numStr}` : numStr;
        } catch (error) {
            logger.error('Erreur lors du formatage de l\'ID:', error);
            return id;
        }
    }

    // Formatage du texte pour Telegram (échapper les caractères spéciaux)
    static escapeTelegramText(text) {
        try {
            return text
                .replace(/\[/g, '\\[')
                .replace(/\]/g, '\\]')
                .replace(/\(/g, '\\(')
                .replace(/\)/g, '\\)')
                .replace(/\~/g, '\\~')
                .replace(/\`/g, '\\`')
                .replace(/\>/g, '\\>')
                .replace(/\#/g, '\\#')
                .replace(/\+/g, '\\+')
                .replace(/\-/g, '\\-')
                .replace(/\=/g, '\\=')
                .replace(/\|/g, '\\|')
                .replace(/\{/g, '\\{')
                .replace(/\}/g, '\\}')
                .replace(/\./g, '\\.')
                .replace(/\!/g, '\\!');
        } catch (error) {
            logger.error('Erreur lors de l\'échappement du texte Telegram:', error);
            return text;
        }
    }

    // Validation des emails
    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Validation des numéros de téléphone
    static isValidPhoneNumber(phone, countryCode = 'FR') {
        const phoneRegexes = {
            FR: /^(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}$/,
            UK: /^(?:(?:\+|00)44|0)\s*[1-9](?:[\s.-]*\d{2}){4}$/,
            US: /^(?:\+1|1)?[-.\s]?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})$/
        };

        return phoneRegexes[countryCode] ? phoneRegexes[countryCode].test(phone) : false;
    }

    // Validation des codes postaux
    static isValidPostalCode(code, countryCode = 'FR') {
        const postalRegexes = {
            FR: /^(?:[0-8]\d|9[0-8])\d{3}$/,
            UK: /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i,
            US: /^\d{5}(-\d{4})?$/
        };

        return postalRegexes[countryCode] ? postalRegexes[countryCode].test(code) : false;
    }

    // Validation des URLs
    static isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    // Validation des mots de passe
    static validatePassword(password) {
        const result = {
            isValid: false,
            errors: []
        };

        if (password.length < 8) {
            result.errors.push('Le mot de passe doit contenir au moins 8 caractères');
        }
        if (!/[A-Z]/.test(password)) {
            result.errors.push('Le mot de passe doit contenir au moins une majuscule');
        }
        if (!/[a-z]/.test(password)) {
            result.errors.push('Le mot de passe doit contenir au moins une minuscule');
        }
        if (!/[0-9]/.test(password)) {
            result.errors.push('Le mot de passe doit contenir au moins un chiffre');
        }
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
            result.errors.push('Le mot de passe doit contenir au moins un caractère spécial');
        }

        result.isValid = result.errors.length === 0;
        return result;
    }

    // Nettoyage des entrées utilisateur
    static sanitizeInput(input, type = 'text') {
        try {
            switch (type) {
                case 'text':
                    return input
                        .trim()
                        .replace(/[<>]/g, '')
                        .slice(0, 1000);
                
                case 'name':
                    return input
                        .trim()
                        .replace(/[^a-zA-ZÀ-ÿ\s-]/g, '')
                        .slice(0, 100);
                
                case 'number':
                    return input
                        .replace(/[^\d.-]/g, '')
                        .slice(0, 20);
                
                case 'username':
                    return input
                        .trim()
                        .toLowerCase()
                        .replace(/[^a-z0-9_-]/g, '')
                        .slice(0, 30);
                
                case 'search':
                    return input
                        .trim()
                        .replace(/[\<\>\"\']/g, '')
                        .slice(0, 100);
                
                default:
                    return input.trim();
            }
        } catch (error) {
            logger.error('Erreur lors du nettoyage de l\'entrée:', error);
            return '';
        }
    }

    // Tronquer le texte avec ellipsis
    static truncateText(text, length = 100, ellipsis = '...') {
        try {
            if (text.length <= length) return text;
            return text.slice(0, length - ellipsis.length) + ellipsis;
        } catch (error) {
            logger.error('Erreur lors de la troncature du texte:', error);
            return text;
        }
    }

    // Formater un texte en markdown pour Telegram
    static formatMarkdown(text, options = {}) {
        try {
            let formatted = text;

            // Appliquer le gras
            if (options.bold) {
                formatted = `*${formatted}*`;
            }

            // Appliquer l'italique
            if (options.italic) {
                formatted = `_${formatted}_`;
            }

            // Appliquer le code
            if (options.code) {
                formatted = `\`${formatted}\``;
            }

            // Formater comme un lien
            if (options.url) {
                formatted = `[${formatted}](${options.url})`;
            }

            return this.escapeTelegramText(formatted);
        } catch (error) {
            logger.error('Erreur lors du formatage markdown:', error);
            return text;
        }
    }

    // Formatter les erreurs pour l'affichage
    static formatError(error, includeStack = false) {
        try {
            const formatted = {
                message: error.message || 'Une erreur est survenue',
                code: error.code || 'UNKNOWN_ERROR',
                timestamp: this.formatDate(new Date())
            };

            if (includeStack && error.stack) {
                formatted.stack = error.stack.split('\n').map(line => line.trim());
            }

            return formatted;
        } catch (err) {
            logger.error('Erreur lors du formatage de l\'erreur:', err);
            return { message: 'Erreur de formatage' };
        }
    }

    // Formatter les méta-données
    static formatMetadata(metadata, options = {}) {
        try {
            const formatted = {};

            for (const [key, value] of Object.entries(metadata)) {
                // Formatter les dates
                if (value instanceof Date) {
                    formatted[key] = this.formatDate(value, options.dateFormat);
                }
                // Formatter les montants
                else if (typeof value === 'number' && options.currencyFields?.includes(key)) {
                    formatted[key] = this.formatAmount(value, options.currency);
                }
                // Formatter les objets imbriqués
                else if (typeof value === 'object' && value !== null) {
                    formatted[key] = this.formatMetadata(value, options);
                }
                // Valeurs simples
                else {
                    formatted[key] = value;
                }
            }

            return formatted;
        } catch (error) {
            logger.error('Erreur lors du formatage des métadonnées:', error);
            return metadata;
        }
    }

    // Formatter un message système
    static formatSystemMessage(type, message, data = {}) {
        try {
            const templates = {
                success: '✅ ${message}',
                error: '❌ ${message}',
                warning: '⚠️ ${message}',
                info: 'ℹ️ ${message}',
                payment: '💳 ${message}',
                delivery: '📦 ${message}',
                order: '🛍️ ${message}'
            };

            let template = templates[type] || '${message}';

            // Remplacer les variables dans le message
            Object.entries(data).forEach(([key, value]) => {
                template = template.replace(`\${${key}}`, value);
            });

            return template.replace('${message}', message);
        } catch (error) {
            logger.error('Erreur lors du formatage du message système:', error);
            return message;
        }
    }

    // Formatter les statistiques
    static formatStats(stats, type = 'general') {
        try {
            const formatters = {
                general: (data) => ({
                    total: this.formatAmount(data.total),
                    count: data.count.toLocaleString(),
                    average: this.formatAmount(data.average),
                    period: this.formatDate(data.period)
                }),
                
                orders: (data) => ({
                    totalOrders: data.totalOrders.toLocaleString(),
                    completedOrders: data.completedOrders.toLocaleString(),
                    cancelledOrders: data.cancelledOrders.toLocaleString(),
                    totalRevenue: this.formatAmount(data.totalRevenue),
                    averageOrderValue: this.formatAmount(data.averageOrderValue)
                }),
                
                users: (data) => ({
                    totalUsers: data.totalUsers.toLocaleString(),
                    activeUsers: data.activeUsers.toLocaleString(),
                    newUsers: data.newUsers.toLocaleString(),
                    retentionRate: `${data.retentionRate.toFixed(2)}%`
                })
            };

            return formatters[type] ? formatters[type](stats) : stats;
        } catch (error) {
            logger.error('Erreur lors du formatage des statistiques:', error);
            return stats;
        }
    }

    // Convertir une taille de fichier en format lisible
    static formatFileSize(bytes) {
        try {
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            if (bytes === 0) return '0 B';
            const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i];
        } catch (error) {
            logger.error('Erreur lors du formatage de la taille du fichier:', error);
            return bytes + ' B';
        }
    }

    // Formatter un délai en texte lisible
    static formatDuration(milliseconds) {
        try {
            const moment = require('moment');
            moment.locale('fr');
            return moment.duration(milliseconds).humanize();
        } catch (error) {
            logger.error('Erreur lors du formatage de la durée:', error);
            return `${Math.round(milliseconds / 1000)} secondes`;
        }
    }
}

module.exports = Formatter;