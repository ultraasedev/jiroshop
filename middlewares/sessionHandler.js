const logger = require('../utils/logger');
const config = require('../config/bot');
const User = require('../models/User');

// Gestionnaire de session
const sessionHandler = async (ctx, next) => {
    try {
        // Initialisation de la session si elle n'existe pas
        if (!ctx.session) {
            ctx.session = {};
        }

        // Ajouter un timestamp à la session
        ctx.session.lastActivity = Date.now();

        // Vérifier et mettre à jour l'utilisateur
        if (ctx.from) {
            const user = await getOrCreateUser(ctx.from);
            ctx.session.user = user;

            // Vérifier si l'utilisateur est banni
            if (user.status === 'banned') {
                logger.warn('Tentative d\'accès d\'un utilisateur banni:', {
                    userId: user.telegramId,
                    username: user.username
                });
                return await ctx.reply('⛔ Votre accès a été restreint. Contactez le support pour plus d\'informations.');
            }

            // Mise à jour de l'activité utilisateur
            await updateUserActivity(user);
        }

        // Nettoyer la session si nécessaire
        if (shouldCleanSession(ctx.session)) {
            cleanSession(ctx.session);
        }

        return next();
    } catch (error) {
        logger.error('Erreur dans le gestionnaire de session:', error);
        ctx.session = {};
        return next();
    }
};

// Récupérer ou créer un utilisateur
async function getOrCreateUser(telegramUser) {
    try {
        let user = await User.findOne({ telegramId: telegramUser.id });

        if (!user) {
            user = new User({
                telegramId: telegramUser.id,
                username: telegramUser.username || 'Unknown',
                profile: {
                    firstName: telegramUser.first_name,
                    lastName: telegramUser.last_name,
                    language: telegramUser.language_code
                }
            });
            await user.save();
            logger.info('Nouvel utilisateur créé:', {
                telegramId: user.telegramId,
                username: user.username
            });
        } else {
            // Mettre à jour les informations si nécessaire
            let needsUpdate = false;

            if (telegramUser.username && telegramUser.username !== user.username) {
                user.username = telegramUser.username;
                needsUpdate = true;
            }

            if (telegramUser.first_name !== user.profile.firstName || 
                telegramUser.last_name !== user.profile.lastName) {
                user.profile.firstName = telegramUser.first_name;
                user.profile.lastName = telegramUser.last_name;
                needsUpdate = true;
            }

            if (needsUpdate) {
                await user.save();
                logger.debug('Informations utilisateur mises à jour:', {
                    telegramId: user.telegramId,
                    username: user.username
                });
            }
        }

        return user;
    } catch (error) {
        logger.error('Erreur lors de la récupération/création de l\'utilisateur:', error);
        throw error;
    }
}

// Mettre à jour l'activité de l'utilisateur
async function updateUserActivity(user) {
    try {
        user.lastActivity = new Date();
        
        // Mise à jour asynchrone sans attendre
        User.updateOne(
            { _id: user._id },
            { $set: { lastActivity: user.lastActivity } }
        ).catch(err => {
            logger.error('Erreur lors de la mise à jour de l\'activité:', err);
        });
    } catch (error) {
        logger.error('Erreur lors de la mise à jour de l\'activité:', error);
    }
}

// Vérifier si la session doit être nettoyée
function shouldCleanSession(session) {
    if (!session.lastClean) {
        session.lastClean = Date.now();
        return false;
    }

    // Nettoyer toutes les 24 heures
    return Date.now() - session.lastClean > 24 * 60 * 60 * 1000;
}

// Nettoyer la session
function cleanSession(session) {
    // Liste des clés à préserver
    const keepKeys = ['user', 'lastActivity', 'lastClean'];
    
    // Supprimer toutes les autres clés
    Object.keys(session).forEach(key => {
        if (!keepKeys.includes(key)) {
            delete session[key];
        }
    });

    session.lastClean = Date.now();
}

module.exports = sessionHandler;