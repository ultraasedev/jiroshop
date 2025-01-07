const logger = require('../utils/logger');
const User = require('../models/User');

const securityMiddleware = async (ctx, next) => {
    try {
        // Vérifier si l'utilisateur est déjà banni de façon permanente
        const user = await User.findOne({ telegramId: ctx.from?.id });
        if (user?.status === 'banned') {
            return ctx.reply('Votre compte a été banni. Contactez le support.');
        }

        // Initialiser la session de sécurité si elle n'existe pas
        if (!ctx.session.security) {
            ctx.session.security = {
                requests: [],
                warnings: 0,
                lastRequest: null
            };
        }

        // Vérifier la fréquence des requêtes (anti-spam basique)
        const now = Date.now();
        ctx.session.security.requests = ctx.session.security.requests.filter(
            time => now - time < 60000 // Garde uniquement les requêtes de la dernière minute
        );
        ctx.session.security.requests.push(now);

        // Si plus de 30 requêtes par minute, ajouter un avertissement
        if (ctx.session.security.requests.length > 30) {
            ctx.session.security.warnings++;
            ctx.session.security.requests = []; // Reset les requêtes

            if (ctx.session.security.warnings >= 10) { // Plus tolérant: 10 avertissements
                await User.updateOne(
                    { telegramId: ctx.from.id },
                    { 
                        $set: { 
                            status: 'suspended',
                            'security.suspendedUntil': new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
                        }
                    }
                );
                return ctx.reply('Trop de requêtes. Compte suspendu pour 15 minutes.');
            }

            return ctx.reply('⚠️ Veuillez ralentir vos actions.');
        }

        // Vérifier le délai entre les requêtes (anti-flood basique)
        if (ctx.session.security.lastRequest) {
            const timeDiff = now - ctx.session.security.lastRequest;
            if (timeDiff < 500) { // 500ms minimum entre les requêtes
                return ctx.reply('⚠️ Veuillez ralentir.');
            }
        }
        ctx.session.security.lastRequest = now;

        // Réinitialisation automatique des avertissements après 1 heure
        if (ctx.session.security.lastWarningReset) {
            if (now - ctx.session.security.lastWarningReset > 3600000) {
                ctx.session.security.warnings = 0;
                ctx.session.security.lastWarningReset = now;
            }
        } else {
            ctx.session.security.lastWarningReset = now;
        }

        return next();
    } catch (error) {
        logger.error('Erreur dans le middleware de sécurité:', error);
        return next();
    }
};

// Démarrer le processus de réinitialisation des suspensions
setInterval(async () => {
    try {
        // Réactiver les comptes suspendus dont la durée est écoulée
        await User.updateMany(
            {
                status: 'suspended',
                'security.suspendedUntil': { $lt: new Date() }
            },
            {
                $set: {
                    status: 'active',
                    'security.warnings': 0
                }
            }
        );
    } catch (error) {
        logger.error('Erreur lors de la réinitialisation des suspensions:', error);
    }
}, 60000); // Vérifier chaque minute

module.exports = securityMiddleware;