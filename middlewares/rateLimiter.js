const logger = require('../utils/logger');
const config = require('../config/bot');

// Stocker les tentatives en mémoire
const attempts = new Map();

// Structure pour stocker les bannissements temporaires
const temporaryBans = new Map();

const rateLimiter = async (ctx, next) => {
    try {
        const userId = ctx.from?.id;
        if (!userId) return next();

        // Vérifier si l'utilisateur est temporairement banni
        if (isTemporarilyBanned(userId)) {
            const banInfo = temporaryBans.get(userId);
            const timeLeft = Math.ceil((banInfo.until - Date.now()) / 1000 / 60);
            
            logger.warn('Tentative d\'accès pendant bannissement:', {
                userId,
                timeLeft
            });

            return ctx.reply(
                `⛔ Accès temporairement restreint. \n` +
                `Veuillez réessayer dans ${timeLeft} minutes.`
            );
        }

        // Obtenir ou initialiser les tentatives de l'utilisateur
        const userAttempts = getUserAttempts(userId);

        // Vérifier si l'utilisateur a dépassé la limite
        if (hasExceededLimit(userAttempts)) {
            await handleExcessiveAttempts(ctx, userId);
            return;
        }

        // Enregistrer la tentative
        recordAttempt(userId);

        // Passer au middleware suivant
        return next();
    } catch (error) {
        logger.error('Erreur dans le rate limiter:', error);
        return next();
    }
};

// Obtenir les tentatives d'un utilisateur
function getUserAttempts(userId) {
    const now = Date.now();
    const userKey = `${userId}`;

    if (!attempts.has(userKey)) {
        attempts.set(userKey, {
            count: 0,
            firstAttempt: now,
            lastAttempt: now
        });
    }

    // Nettoyer les anciennes tentatives
    cleanOldAttempts();

    return attempts.get(userKey);
}

// Vérifier si l'utilisateur a dépassé la limite
function hasExceededLimit(userAttempts) {
    const { count, firstAttempt } = userAttempts;
    const timeWindow = config.security.rateLimit.window;
    const maxAttempts = config.security.rateLimit.max;

    // Vérifier si dans la fenêtre de temps
    if (Date.now() - firstAttempt > timeWindow) {
        return false;
    }

    return count >= maxAttempts;
}

// Enregistrer une tentative
function recordAttempt(userId) {
    const userKey = `${userId}`;
    const userAttempts = attempts.get(userKey);

    // Réinitialiser si hors de la fenêtre de temps
    if (Date.now() - userAttempts.firstAttempt > config.security.rateLimit.window) {
        userAttempts.count = 1;
        userAttempts.firstAttempt = Date.now();
    } else {
        userAttempts.count++;
    }

    userAttempts.lastAttempt = Date.now();
    attempts.set(userKey, userAttempts);
}

// Gérer les tentatives excessives
async function handleExcessiveAttempts(ctx, userId) {
    const userKey = `${userId}`;
    const userAttempts = attempts.get(userKey);

    // Calculer la durée du bannissement
    const banDuration = calculateBanDuration(userAttempts.count);
    
    // Appliquer le bannissement temporaire
    applyTemporaryBan(userId, banDuration);

    // Loguer l'incident
    logger.warn('Rate limit dépassé:', {
        userId,
        attempts: userAttempts.count,
        banDuration
    });

    // Notifier l'utilisateur
    await ctx.reply(
        `⚠️ Vous avez effectué trop de requêtes.\n` +
        `Veuillez patienter ${banDuration} minutes.`
    );
}

// Calculer la durée du bannissement
function calculateBanDuration(attemptCount) {
    // Augmenter progressivement la durée du bannissement
    const baseTime = 5; // 5 minutes
    const multiplier = Math.floor(attemptCount / config.security.rateLimit.max);
    return Math.min(baseTime * Math.pow(2, multiplier), 1440); // Max 24 heures
}

// Appliquer un bannissement temporaire
function applyTemporaryBan(userId, durationMinutes) {
    const until = Date.now() + (durationMinutes * 60 * 1000);
    temporaryBans.set(userId, {
        until,
        duration: durationMinutes
    });
}

// Vérifier si un utilisateur est temporairement banni
function isTemporarilyBanned(userId) {
    if (!temporaryBans.has(userId)) {
        return false;
    }

    const banInfo = temporaryBans.get(userId);
    if (Date.now() > banInfo.until) {
        temporaryBans.delete(userId);
        return false;
    }

    return true;
}

// Nettoyer les anciennes tentatives
function cleanOldAttempts() {
    const now = Date.now();
    const window = config.security.rateLimit.window;

    attempts.forEach((value, key) => {
        if (now - value.lastAttempt > window) {
            attempts.delete(key);
        }
    });

    // Nettoyer aussi les bannissements expirés
    temporaryBans.forEach((value, key) => {
        if (now > value.until) {
            temporaryBans.delete(key);
        }
    });
}

// Nettoyer périodiquement
setInterval(cleanOldAttempts, 60 * 1000); // Toutes les minutes

module.exports = rateLimiter;