const logger = require('../utils/logger');
const config = require('../config/bot');
const User = require('../models/User');

const securityMiddleware = async (ctx, next) => {
    try {
        // Vérifier l'authenticité du message Telegram
        if (!isValidTelegramRequest(ctx)) {
            logger.warn('Requête Telegram invalide détectée');
            return;
        }

        // Vérifier les mises à jour autorisées
        if (!isAllowedUpdate(ctx)) {
            logger.warn('Type de mise à jour non autorisé:', ctx.updateType);
            return;
        }

        // Enregistrer les métadonnées de la requête
        recordRequestMetadata(ctx);

        // Vérifier les restrictions géographiques si configurées
        if (!await checkGeoRestrictions(ctx)) {
            logger.warn('Accès bloqué par restriction géographique:', {
                userId: ctx.from?.id,
                country: ctx.session?.metadata?.country
            });
            return ctx.reply('⛔ Service non disponible dans votre région.');
        }

        // Détecter les comportements suspects
        if (await detectSuspiciousBehavior(ctx)) {
            logger.warn('Comportement suspect détecté:', {
                userId: ctx.from?.id,
                type: ctx.session?.security?.suspiciousType
            });
            await handleSuspiciousBehavior(ctx);
            return;
        }

        // Mettre à jour le score de risque
        await updateRiskScore(ctx);

        return next();
    } catch (error) {
        logger.error('Erreur dans le middleware de sécurité:', error);
        return next();
    }
};

// Vérifier la validité de la requête Telegram
function isValidTelegramRequest(ctx) {
    // Vérifier la présence des champs obligatoires
    if (!ctx.from || !ctx.chat) {
        return false;
    }

    // Vérifier le timestamp du message
    if (ctx.message?.date) {
        const messageTime = ctx.message.date * 1000;
        const now = Date.now();
        // Rejeter les messages de plus de 5 minutes
        if (Math.abs(now - messageTime) > 5 * 60 * 1000) {
            return false;
        }
    }

    return true;
}

// Vérifier si le type de mise à jour est autorisé
function isAllowedUpdate(ctx) {
    const allowedUpdates = config.security.telegram.allowedUpdates;
    return allowedUpdates.includes(ctx.updateType);
}

// Enregistrer les métadonnées de la requête
function recordRequestMetadata(ctx) {
    if (!ctx.session.metadata) {
        ctx.session.metadata = {};
    }

    ctx.session.metadata = {
        ...ctx.session.metadata,
        lastAccess: Date.now(),
        platform: getPlatformInfo(ctx),
        language: ctx.from?.language_code
    };
}

// Obtenir les informations de la plateforme
function getPlatformInfo(ctx) {
    // Extraction des informations du client si disponibles
    return {
        type: 'telegram',
        version: ctx.telegram?.version,
        clientInfo: ctx.telegram?.client
    };
}

// Vérifier les restrictions géographiques
async function checkGeoRestrictions(ctx) {
    // Si pas de restrictions configurées, autoriser
    if (!config.security.geoRestrictions) {
        return true;
    }

    const userCountry = ctx.session?.metadata?.country;
    const { allowedCountries, blockedCountries } = config.security.geoRestrictions;

    // Si la liste des pays autorisés existe et n'est pas vide
    if (allowedCountries?.length > 0) {
        return allowedCountries.includes(userCountry);
    }

    // Si la liste des pays bloqués existe
    if (blockedCountries?.length > 0) {
        return !blockedCountries.includes(userCountry);
    }

    return true;
}

// Détecter les comportements suspects
async function detectSuspiciousBehavior(ctx) {
    if (!ctx.session.security) {
        ctx.session.security = {
            riskScore: 0,
            warnings: 0,
            suspiciousActivities: []
        };
    }

    const security = ctx.session.security;
    let isSuspicious = false;

    // Vérifier la fréquence des requêtes
    if (checkRequestFrequency(ctx)) {
        security.suspiciousActivities.push({
            type: 'high_frequency',
            timestamp: Date.now()
        });
        isSuspicious = true;
    }

    // Vérifier les changements de pattern
    if (await checkPatternChanges(ctx)) {
        security.suspiciousActivities.push({
            type: 'pattern_change',
            timestamp: Date.now()
        });
        isSuspicious = true;
    }

    // Vérifier les tentatives d'exploitation
    if (checkExploitAttempts(ctx)) {
        security.suspiciousActivities.push({
            type: 'exploit_attempt',
            timestamp: Date.now()
        });
        isSuspicious = true;
    }

    return isSuspicious;
}

// Vérifier la fréquence des requêtes
function checkRequestFrequency(ctx) {
    const recentRequests = ctx.session.metadata?.requests || [];
    const now = Date.now();

    // Nettoyer les anciennes requêtes
    while (recentRequests.length > 0 && now - recentRequests[0] > 60000) {
        recentRequests.shift();
    }

    // Ajouter la nouvelle requête
    recentRequests.push(now);

    // Mettre à jour la session
    if (!ctx.session.metadata) ctx.session.metadata = {};
    ctx.session.metadata.requests = recentRequests;

    // Vérifier si trop de requêtes
    return recentRequests.length > 60; // Plus de 60 requêtes par minute
}

// Vérifier les changements de pattern
async function checkPatternChanges(ctx) {
    const user = await User.findOne({ telegramId: ctx.from?.id });
    if (!user) return false;

    // Vérifier les changements de langue
    if (ctx.from?.language_code && 
        user.profile.language && 
        ctx.from.language_code !== user.profile.language) {
        return true;
    }

    // Vérifier les changements d'horaire d'activité
    const currentHour = new Date().getHours();
    const usualActivityHours = user.metadata?.activityHours || [];
    
    if (usualActivityHours.length > 0 && !usualActivityHours.includes(currentHour)) {
        return true;
    }

    return false;
}

// Vérifier les tentatives d'exploitation
function checkExploitAttempts(ctx) {
    if (!ctx.message?.text) return false;

    const suspiciousPatterns = [
        /(?:\/|\\|\.\.)/i,  // Path traversal
        /[<>]/,             // XSS potentiel
        /<script/i,         // Injection de script
        /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b/i, // SQL Injection
        /%[0-9a-f]{2}/i    // Encodage URL suspect
    ];

    return suspiciousPatterns.some(pattern => pattern.test(ctx.message.text));
}

// Gérer les comportements suspects
async function handleSuspiciousBehavior(ctx) {
    const security = ctx.session.security;
    security.warnings++;

    // Mettre à jour le score de risque
    security.riskScore += 10;

    // Actions basées sur le nombre d'avertissements
    if (security.warnings >= 3) {
        // Bloquer temporairement l'utilisateur
        await User.updateOne(
            { telegramId: ctx.from.id },
            { 
                $set: { 
                    status: 'suspended',
                    'security.suspendedUntil': new Date(Date.now() + 24 * 60 * 60 * 1000)
                }
            }
        );

        await ctx.reply(
            '⚠️ Votre compte a été temporairement suspendu pour des raisons de sécurité.\n' +
            'Contactez le support pour plus d\'informations.'
        );
    } else {
        await ctx.reply(
            '⚠️ Comportement inhabituel détecté.\n' +
            'Veuillez respecter les règles d\'utilisation du service.'
        );
    }
}

// Mettre à jour le score de risque
async function updateRiskScore(ctx) {
    if (!ctx.session.security) return;

    const security = ctx.session.security;
    const riskFactors = {
        newUser: 5,
        suspiciousActivities: 10,
        rapidActions: 3,
        unknownLocation: 5
    };

    let newScore = 0;

    // Utilisateur récent
    const user = await User.findOne({ telegramId: ctx.from?.id });
    if (user && Date.now() - user.createdAt < 24 * 60 * 60 * 1000) {
        newScore += riskFactors.newUser;
    }

    // Activités suspectes récentes
    const recentSuspiciousActivities = security.suspiciousActivities.filter(
        activity => Date.now() - activity.timestamp < 60 * 60 * 1000
    ).length;
    newScore += recentSuspiciousActivities * riskFactors.suspiciousActivities;

    // Actions rapides
    if (checkRequestFrequency(ctx)) {
        newScore += riskFactors.rapidActions;
    }

    // Localisation inconnue
    if (!ctx.session.metadata?.country) {
        newScore += riskFactors.unknownLocation;
    }

    // Mettre à jour le score
    security.riskScore = Math.min(100, newScore);

    // Si le score est trop élevé, prendre des mesures
    if (security.riskScore > 75) {
        await handleHighRiskUser(ctx);
    }
}

// Gérer les utilisateurs à haut risque
async function handleHighRiskUser(ctx) {
    logger.warn('Utilisateur à haut risque détecté:', {
        userId: ctx.from?.id,
        riskScore: ctx.session.security.riskScore
    });

    // Notifier les administrateurs
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
        ctx.telegram.sendMessage(
            admin.telegramId,
            `🚨 Utilisateur à haut risque détecté:\n` +
            `ID: ${ctx.from?.id}\n` +
            `Score: ${ctx.session.security.riskScore}\n` +
            `Actions requises !`
        ).catch(err => logger.error('Erreur notification admin:', err));
    }

    // Restreindre certaines fonctionnalités
    if (!ctx.session.restrictions) {
        ctx.session.restrictions = {
            limitedFeatures: true,
            requiresVerification: true,
            maxTransactionAmount: 50
        };
    }
}

module.exports = securityMiddleware;