const logger = require('../utils/logger');

// Types d'erreurs connus
const knownErrors = {
    ETELEGRAM: 'Erreur Telegram API',
    EMONGO: 'Erreur de base de données',
    EPAYMENT: 'Erreur de paiement',
    EVALIDATION: 'Erreur de validation',
    EACCESS: 'Erreur d\'accès',
    EFILE: 'Erreur de fichier',
    ETIMEDOUT: 'Délai d\'attente dépassé',
    ENOTFOUND: 'Ressource non trouvée'
};

const errorHandler = async (err, ctx) => {
    try {
        // Logger l'erreur avec le contexte
        logger.error('Erreur globale:', {
            error: {
                name: err.name,
                message: err.message,
                stack: err.stack
            },
            context: {
                updateType: ctx.updateType,
                userId: ctx.from?.id,
                chatId: ctx.chat?.id,
                messageId: ctx.message?.message_id
            }
        });

        // Analyser l'erreur
        const errorAnalysis = analyzeError(err);

        // Enregistrer l'erreur pour analyse
        await storeError(errorAnalysis, ctx);

        // Notifier les admins si nécessaire
        if (errorAnalysis.severity === 'high') {
            await notifyAdmins(errorAnalysis, ctx);
        }

        // Envoyer une réponse appropriée à l'utilisateur
        await sendUserResponse(errorAnalysis, ctx);

        // Nettoyer si nécessaire
        await cleanup(errorAnalysis, ctx);

    } catch (handlingError) {
        // En cas d'erreur dans le gestionnaire d'erreurs lui-même
        logger.error('Erreur dans le gestionnaire d\'erreurs:', handlingError);
        
        // Tenter une dernière réponse simple
        try {
            await ctx.reply('Une erreur inattendue est survenue. Veuillez réessayer plus tard.');
        } catch (finalError) {
            logger.error('Échec de la réponse finale:', finalError);
        }
    }
};

// Analyser l'erreur pour déterminer le type et la sévérité
function analyzeError(error) {
    let errorType = 'UNKNOWN';
    let severity = 'low';
    let userMessage = 'Une erreur est survenue. Veuillez réessayer.';
    let needsCleanup = false;

    // Déterminer le type d'erreur
    for (const [key, description] of Object.entries(knownErrors)) {
        if (error.message.includes(key) || error.name.includes(key)) {
            errorType = key;
            break;
        }
    }

    // Configurer la réponse selon le type d'erreur
    switch (errorType) {
        case 'ETELEGRAM':
            if (error.code === 403) {
                severity = 'low';
                userMessage = 'Impossible d\'envoyer le message. Le bot a peut-être été bloqué.';
            } else if (error.code === 429) {
                severity = 'medium';
                userMessage = 'Trop de requêtes. Veuillez patienter quelques minutes.';
            } else {
                severity = 'high';
                userMessage = 'Erreur de communication avec Telegram. Réessayez plus tard.';
            }
            break;

        case 'EMONGO':
            severity = 'high';
            userMessage = 'Erreur de service. Veuillez réessayer plus tard.';
            needsCleanup = true;
            break;

        case 'EPAYMENT':
            severity = 'high';
            userMessage = 'Erreur lors du traitement du paiement. Veuillez réessayer ou contacter le support.';
            break;

        case 'EVALIDATION':
            severity = 'low';
            userMessage = 'Les données fournies ne sont pas valides. Veuillez vérifier et réessayer.';
            break;

        case 'EACCESS':
            severity = 'medium';
            userMessage = 'Vous n\'avez pas les permissions nécessaires pour cette action.';
            break;

        case 'EFILE':
            severity = 'medium';
            userMessage = 'Erreur lors du traitement du fichier. Veuillez réessayer.';
            needsCleanup = true;
            break;

        case 'ETIMEDOUT':
            severity = 'low';
            userMessage = 'La requête a pris trop de temps. Veuillez réessayer.';
            break;

        case 'ENOTFOUND':
            severity = 'low';
            userMessage = 'La ressource demandée n\'existe pas.';
            break;

        default:
            severity = 'medium';
            needsCleanup = true;
    }

    return {
        type: errorType,
        severity,
        originalError: error,
        userMessage,
        needsCleanup,
        timestamp: new Date()
    };
}

// Stocker l'erreur pour analyse
async function storeError(errorAnalysis, ctx) {
    try {
        const ErrorLog = require('../models/ErrorLog');
        await ErrorLog.create({
            type: errorAnalysis.type,
            severity: errorAnalysis.severity,
            message: errorAnalysis.originalError.message,
            stack: errorAnalysis.originalError.stack,
            context: {
                userId: ctx.from?.id,
                chatId: ctx.chat?.id,
                updateType: ctx.updateType,
                state: ctx.session?.state
            },
            timestamp: errorAnalysis.timestamp
        });
    } catch (error) {
        logger.error('Erreur lors du stockage de l\'erreur:', error);
    }
}

// Notifier les administrateurs
async function notifyAdmins(errorAnalysis, ctx) {
    try {
        const User = require('../models/User');
        const admins = await User.find({ role: 'admin' });

        const message = 
            `🚨 *Erreur Critique Détectée*\n\n` +
            `Type: ${errorAnalysis.type}\n` +
            `Sévérité: ${errorAnalysis.severity}\n` +
            `Message: ${errorAnalysis.originalError.message}\n` +
            `Utilisateur: ${ctx.from?.id}\n` +
            `Chat: ${ctx.chat?.id}\n` +
            `Date: ${errorAnalysis.timestamp.toISOString()}\n\n` +
            `Action requise !`;

        for (const admin of admins) {
            try {
                await ctx.telegram.sendMessage(admin.telegramId, message, {
                    parse_mode: 'Markdown'
                });
            } catch (error) {
                logger.error('Erreur lors de la notification admin:', {
                    adminId: admin.telegramId,
                    error
                });
            }
        }
    } catch (error) {
        logger.error('Erreur lors de la notification des admins:', error);
    }
}

// Envoyer une réponse appropriée à l'utilisateur
async function sendUserResponse(errorAnalysis, ctx) {
    try {
        // Message de base
        let message = errorAnalysis.userMessage;

        // Ajouter un ID de référence pour le support
        const errorRef = generateErrorReference();
        message += `\n\nRéférence: ${errorRef}`;

        // Ajouter des boutons selon le type d'erreur
        const buttons = [];

        switch (errorAnalysis.type) {
            case 'EPAYMENT':
                buttons.push([
                    { text: '💳 Réessayer le paiement', callback_data: 'retry_payment' },
                    { text: '📞 Contacter le support', callback_data: 'contact_support' }
                ]);
                break;

            case 'EACCESS':
                buttons.push([
                    { text: '🔑 Vérifier les accès', callback_data: 'check_access' },
                    { text: '📞 Contacter le support', callback_data: 'contact_support' }
                ]);
                break;

            case 'EFILE':
                buttons.push([
                    { text: '🔄 Réessayer', callback_data: 'retry_upload' },
                    { text: '📋 Voir les instructions', callback_data: 'upload_help' }
                ]);
                break;

            default:
                if (errorAnalysis.severity === 'high') {
                    buttons.push([
                        { text: '📞 Contacter le support', callback_data: 'contact_support' }
                    ]);
                }
        }

        // Envoyer la réponse
        await ctx.reply(message, {
            reply_markup: buttons.length > 0 ? {
                inline_keyboard: buttons
            } : undefined
        });

    } catch (error) {
        logger.error('Erreur lors de l\'envoi de la réponse:', error);
        
        // Tenter une réponse simplifiée en dernier recours
        try {
            await ctx.reply('Une erreur est survenue. Veuillez réessayer plus tard.');
        } catch (finalError) {
            logger.error('Échec de la réponse finale:', finalError);
        }
    }
}

// Nettoyer après l'erreur si nécessaire
async function cleanup(errorAnalysis, ctx) {
    if (!errorAnalysis.needsCleanup) return;

    try {
        // Nettoyer la session si nécessaire
        if (ctx.session) {
            // Sauvegarder certaines informations importantes
            const importantData = {
                user: ctx.session.user,
                lastActivity: ctx.session.lastActivity
            };

            // Réinitialiser la session
            ctx.session = {
                ...importantData,
                restored: true,
                lastError: {
                    type: errorAnalysis.type,
                    timestamp: errorAnalysis.timestamp
                }
            };
        }

        // Nettoyer les fichiers temporaires si nécessaire
        if (errorAnalysis.type === 'EFILE') {
            await cleanupTempFiles(ctx);
        }

        // Annuler les opérations en cours si nécessaire
        if (ctx.session?.currentOperation) {
            await cancelCurrentOperation(ctx);
        }

    } catch (error) {
        logger.error('Erreur lors du nettoyage:', error);
    }
}

// Nettoyer les fichiers temporaires
async function cleanupTempFiles(ctx) {
    try {
        const fs = require('fs').promises;
        const path = require('path');

        if (ctx.session?.tempFiles) {
            for (const filePath of ctx.session.tempFiles) {
                try {
                    await fs.unlink(path.join(__dirname, '../temp', filePath));
                } catch (error) {
                    logger.error('Erreur lors de la suppression du fichier:', {
                        filePath,
                        error
                    });
                }
            }
            delete ctx.session.tempFiles;
        }
    } catch (error) {
        logger.error('Erreur lors du nettoyage des fichiers:', error);
    }
}

// Annuler l'opération en cours
async function cancelCurrentOperation(ctx) {
    try {
        const operation = ctx.session.currentOperation;

        switch (operation?.type) {
            case 'payment':
                await cancelPayment(operation.paymentId);
                break;
            case 'order':
                await cancelOrder(operation.orderId);
                break;
            case 'upload':
                await cancelUpload(operation.uploadId);
                break;
            // Ajouter d'autres cas selon les besoins
        }

        delete ctx.session.currentOperation;
    } catch (error) {
        logger.error('Erreur lors de l\'annulation de l\'opération:', error);
    }
}

// Générer une référence d'erreur unique
function generateErrorReference() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `ERR-${timestamp}-${random}`.toUpperCase();
}

// Fonctions d'annulation spécifiques
async function cancelPayment(paymentId) {
    try {
        const Payment = require('../models/Payment');
        await Payment.findByIdAndUpdate(paymentId, {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancellationReason: 'Erreur système'
        });
    } catch (error) {
        logger.error('Erreur lors de l\'annulation du paiement:', error);
    }
}

async function cancelOrder(orderId) {
    try {
        const Order = require('../models/Order');
        await Order.findByIdAndUpdate(orderId, {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancellationReason: 'Erreur système'
        });
    } catch (error) {
        logger.error('Erreur lors de l\'annulation de la commande:', error);
    }
}

async function cancelUpload(uploadId) {
    try {
        const Upload = require('../models/Upload');
        await Upload.findByIdAndUpdate(uploadId, {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancellationReason: 'Erreur système'
        });
    } catch (error) {
        logger.error('Erreur lors de l\'annulation de l\'upload:', error);
    }
}

module.exports = errorHandler;