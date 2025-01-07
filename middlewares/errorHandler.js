// middlewares/errorHandler.js
const logger = require('../utils/logger');

const errorHandler = async (err, ctx, next) => {
    try {
        // Vérification si nous avons une erreur et/ou un contexte
        if (!err && !ctx) {
            logger.warn('ErrorHandler appelé sans erreur ni contexte');
            return next && next();
        }

        // Logger l'erreur avec tous les détails disponibles
        logger.error('Erreur détectée:', {
            error: err ? {
                name: err.name || 'Unknown',
                message: err.message || 'No message',
                code: err.code,
                stack: err.stack
            } : 'No error object',
            context: ctx ? {
                updateType: ctx.updateType,
                update: ctx.update,
                from: ctx.from,
                chat: ctx.chat,
                channelPost: ctx.channelPost,
                message: ctx.message
            } : 'No context'
        });

        // Si nous avons un contexte valide et une méthode telegram, tenter d'envoyer un message
        if (ctx && ctx.telegram) {
            let chatId = null;
            
            // Déterminer le chat ID
            if (ctx.chat?.id) {
                chatId = ctx.chat.id;
            } else if (ctx.channelPost?.chat?.id) {
                chatId = ctx.channelPost.chat.id;
            } else if (ctx.callbackQuery?.message?.chat?.id) {
                chatId = ctx.callbackQuery.message.chat.id;
            }

            if (chatId) {
                try {
                    await ctx.telegram.sendMessage(
                        chatId,
                        'Une erreur est survenue lors du traitement de votre demande.'
                    );
                } catch (sendError) {
                    logger.error('Erreur lors de l\'envoi du message d\'erreur:', {
                        originalError: err,
                        sendError,
                        chatId
                    });
                }
            } else {
                logger.warn('Pas de chat ID disponible pour envoyer le message d\'erreur');
            }
        }
        
        // Si next est disponible, continuer
        if (next) {
            return next();
        }
    } catch (handlerError) {
        logger.error('Erreur dans le gestionnaire d\'erreurs:', {
            originalError: err,
            handlerError,
            context: ctx
        });
        
        // Si next est disponible, continuer malgré l'erreur
        if (next) {
            return next();
        }
    }
};

module.exports = errorHandler;