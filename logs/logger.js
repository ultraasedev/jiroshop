const winston = require('winston');
const path = require('path');
const fs = require('fs');
const moment = require('moment');

// Créer le dossier des logs s'il n'existe pas
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Format personnalisé pour les logs
const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}] : ${message}`;
    
    if (Object.keys(metadata).length > 0) {
        msg += `\nMetadata: ${JSON.stringify(metadata, null, 2)}`;
    }
    
    return msg;
});

// Format pour les logs de transactions
const transactionFormat = winston.format.printf(({ level, message, timestamp, transactionId, userId, amount }) => {
    return `${timestamp} [${level.toUpperCase()}] [TX:${transactionId}] [User:${userId}] [Amount:${amount}] : ${message}`;
});

// Créer les différents transports
const transports = [
    // Logs console en développement
    new winston.transports.Console({
        level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            customFormat
        )
    }),

    // Logs d'erreurs
    new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: winston.format.combine(
            winston.format.timestamp(),
            customFormat
        ),
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }),

    // Logs généraux
    new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        format: winston.format.combine(
            winston.format.timestamp(),
            customFormat
        ),
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }),

    // Logs de transactions
    new winston.transports.File({
        filename: path.join(logDir, 'transactions.log'),
        format: winston.format.combine(
            winston.format.timestamp(),
            transactionFormat
        ),
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }),

    // Logs de sécurité
    new winston.transports.File({
        filename: path.join(logDir, 'security.log'),
        level: 'warn',
        format: winston.format.combine(
            winston.format.timestamp(),
            customFormat
        ),
        maxsize: 5242880, // 5MB
        maxFiles: 5
    })
];

// Créer le logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    transports,
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logDir, 'exceptions.log')
        })
    ],
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(logDir, 'rejections.log')
        })
    ]
});

// Fonction pour nettoyer les vieux logs
const cleanOldLogs = () => {
    const MAX_LOG_AGE = 30; // jours
    const now = moment();

    fs.readdir(logDir, (err, files) => {
        if (err) {
            logger.error('Erreur lors de la lecture du dossier des logs:', err);
            return;
        }

        files.forEach(file => {
            const filePath = path.join(logDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    logger.error('Erreur lors de la lecture des stats du fichier:', err);
                    return;
                }

                const fileAge = moment(stats.mtime);
                if (now.diff(fileAge, 'days') > MAX_LOG_AGE) {
                    fs.unlink(filePath, err => {
                        if (err) {
                            logger.error('Erreur lors de la suppression du vieux log:', err);
                        } else {
                            logger.debug('Vieux log supprimé:', file);
                        }
                    });
                }
            });
        });
    });
};

// Nettoyer les vieux logs une fois par jour
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);

// Ajouter des méthodes utilitaires au logger
logger.transaction = (level, message, transactionData) => {
    logger.log({
        level,
        message,
        ...transactionData
    });
};

logger.security = (level, message, securityData) => {
    logger.log({
        level,
        message,
        type: 'security',
        ...securityData
    });
};

logger.audit = (action, userId, details) => {
    logger.info(action, {
        type: 'audit',
        userId,
        timestamp: new Date(),
        ...details
    });
};

// Fonction pour obtenir le chemin d'un fichier de log spécifique
logger.getLogPath = (logType = 'combined') => {
    return path.join(logDir, `${logType}.log`);
};

// Fonction pour obtenir les N dernières lignes d'un fichier de log
logger.getTailLog = async (logType = 'combined', lines = 100) => {
    const logPath = logger.getLogPath(logType);
    const exec = require('util').promisify(require('child_process').exec);
    
    try {
        const { stdout } = await exec(`tail -n ${lines} ${logPath}`);
        return stdout;
    } catch (error) {
        logger.error('Erreur lors de la lecture des dernières lignes du log:', error);
        return '';
    }
};

module.exports = logger;