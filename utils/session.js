const crypto = require('crypto');
const logger = require('./logger');
const cache = require('./cache');
const config = require('./config');

class Session {
    constructor() {
        this.defaultTTL = config.get('bot.sessionTTL', 3600);
        this.prefix = 'session:';
    }

    // Générer un ID de session
    generateId() {
        return crypto.randomBytes(32).toString('hex');
    }

    // Créer une session
    async create(userId, data = {}) {
        try {
            const sessionId = this.generateId();
            const session = {
                id: sessionId,
                userId,
                data,
                createdAt: Date.now(),
                lastActivity: Date.now()
            };

            await cache.set(`${this.prefix}${sessionId}`, session, this.defaultTTL);
            return session;
        } catch (error) {
            logger.error('Erreur création session:', error);
            throw new Error('Impossible de créer la session');
        }
    }

    // Récupérer une session
    async get(sessionId) {
        try {
            const session = await cache.get(`${this.prefix}${sessionId}`);
            if (!session) {
                return null;
            }

            // Mettre à jour la dernière activité
            session.lastActivity = Date.now();
            await this.update(sessionId, session);

            return session;
        } catch (error) {
            logger.error('Erreur récupération session:', error);
            return null;
        }
    }

    // Mettre à jour une session
    async update(sessionId, data) {
        try {
            const session = await this.get(sessionId);
            if (!session) {
                throw new Error('Session non trouvée');
            }

            const updatedSession = {
                ...session,
                data: { ...session.data, ...data },
                lastActivity: Date.now()
            };

            await cache.set(`${this.prefix}${sessionId}`, updatedSession, this.defaultTTL);
            return updatedSession;
        } catch (error) {
            logger.error('Erreur mise à jour session:', error);
            throw new Error('Impossible de mettre à jour la session');
        }
    }

    // Supprimer une session
    async delete(sessionId) {
        try {
            await cache.delete(`${this.prefix}${sessionId}`);
            return true;
        } catch (error) {
            logger.error('Erreur suppression session:', error);
            return false;
        }
    }

    // Nettoyer les sessions expirées
    async cleanup() {
        try {
            const pattern = `${this.prefix}*`;
            const keys = await cache.client.keys(pattern);
            const now = Date.now();
            let cleaned = 0;

            for (const key of keys) {
                const session = await cache.get(key.replace(this.prefix, ''));
                if (session && now - session.lastActivity > this.defaultTTL * 1000) {
                    await cache.delete(key.replace(this.prefix, ''));
                    cleaned++;
                }
            }

            logger.info(`${cleaned} sessions nettoyées`);
            return cleaned;
        } catch (error) {
            logger.error('Erreur nettoyage sessions:', error);
            return 0;
        }
    }

    // Récupérer les sessions d'un utilisateur
    async getUserSessions(userId) {
        try {
            const pattern = `${this.prefix}*`;
            const keys = await cache.client.keys(pattern);
            const sessions = [];

            for (const key of keys) {
                const session = await cache.get(key.replace(this.prefix, ''));
                if (session && session.userId === userId) {
                    sessions.push(session);
                }
            }

            return sessions;
        } catch (error) {
            logger.error('Erreur récupération sessions utilisateur:', error);
            return [];
        }
    }

    // Vérifier si une session est valide
    async isValid(sessionId) {
        try {
            const session = await this.get(sessionId);
            if (!session) return false;

            const age = Date.now() - session.createdAt;
            return age < this.defaultTTL * 1000;
        } catch (error) {
            logger.error('Erreur vérification validité session:', error);
            return false;
        }
    }

    // Prolonger une session
    async extend(sessionId, duration = this.defaultTTL) {
        try {
            const session = await this.get(sessionId);
            if (!session) {
                throw new Error('Session non trouvée');
            }

            await cache.updateTTL(`${this.prefix}${sessionId}`, duration);
            return true;
        } catch (error) {
            logger.error('Erreur prolongation session:', error);
            return false;
        }
    }

    // Middleware de session pour Telegram
    middleware() {
        return async (ctx, next) => {
            try {
                // Récupérer ou créer une session
                if (!ctx.session) {
                    const userId = ctx.from?.id;
                    if (userId) {
                        const existingSessions = await this.getUserSessions(userId);
                        if (existingSessions.length > 0) {
                            ctx.session = existingSessions[0].data;
                        } else {
                            const session = await this.create(userId);
                            ctx.session = session.data;
                        }
                    }
                }

                await next();

                // Mettre à jour la session après le traitement
                if (ctx.session) {
                    const userId = ctx.from?.id;
                    if (userId) {
                        const existingSessions = await this.getUserSessions(userId);
                        if (existingSessions.length > 0) {
                            await this.update(existingSessions[0].id, ctx.session);
                        }
                    }
                }
            } catch (error) {
                logger.error('Erreur middleware session:', error);
                await next();
            }
        };
    }

    // Démarrer le nettoyage automatique
    startCleanupTask(interval = 3600000) { // 1 heure par défaut
        setInterval(() => {
            this.cleanup().catch(error => {
                logger.error('Erreur tâche nettoyage sessions:', error);
            });
        }, interval);
    }
}

module.exports = new Session();