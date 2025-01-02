const winston = require('winston');
const moment = require('moment');

// Format personnalisé pour les logs
const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    const date = moment(timestamp).format('YYYY-MM-DD HH:mm:ss');
    let msg = `${date} [${level.toUpperCase()}]: ${message}`;
    
    if (Object.keys(metadata).length > 0) {
        msg += ` | ${JSON.stringify(metadata)}`;
    }
    return msg;
});

// Configuration du logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
        customFormat
    ),
    transports: [
        // Log dans la console
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                customFormat
            )
        }),
        // Log dans un fichier par date
        new winston.transports.File({
            filename: `logs/error-${moment().format('YYYY-MM-DD')}.log`,
            level: 'error'
        }),
        new winston.transports.File({
            filename: `logs/combined-${moment().format('YYYY-MM-DD')}.log`
        })
    ],
    exceptionHandlers: [
        new winston.transports.File({
            filename: `logs/exceptions-${moment().format('YYYY-MM-DD')}.log`
        })
    ],
    rejectionHandlers: [
        new winston.transports.File({
            filename: `logs/rejections-${moment().format('YYYY-MM-DD')}.log`
        })
    ]
});

// Fonction pour nettoyer les vieux logs
const cleanOldLogs = () => {
    // Garder les logs pendant 30 jours
    const maxAge = moment().subtract(30, 'days');
    
    // Implémenter la logique de nettoyage ici
    // Utiliser fs pour lister et supprimer les vieux fichiers de log
};

// Nettoyer les logs une fois par jour
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);

module.exports = logger;