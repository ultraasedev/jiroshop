const Redis = require('ioredis');
const logger = require('./logger');
const config = require('./config');

class Cache {
    constructor() {
        this.client = null;
        this.prefix = config.get('cache.prefix', 'shop:');
        this.defaultTTL = config.get('cache.ttl', 3600);
        this.initialize();
    }

    initialize() {
        try {
            this.client = new Redis({
                host: config.get('redis.host', 'localhost'),
                port: config.get('redis.port', 6379),
                password: config.get('redis.password'),
                db: config.get('redis.db', 0),
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                maxRetriesPerRequest: 3
            });

            this.client.on('error', (error) => {
                logger.error('Erreur Redis:', error);
            });

            this.client.on('connect', () => {
                logger.info('Connecté à Redis');
            });
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation du cache:', error);
        }
    }

    // Obtenir une clé avec préfixe
    getKey(key) {
        return `${this.prefix}${key}`;
    }

    // Mettre en cache
    async set(key, value, ttl = this.defaultTTL) {
        try {
            const cacheKey = this.getKey(key);
            const serializedValue = JSON.stringify(value);
            
            if (ttl) {
                await this.client.set(cacheKey, serializedValue, 'EX', ttl);
            } else {
                await this.client.set(cacheKey, serializedValue);
            }

            return true;
        } catch (error) {
            logger.error('Erreur lors de la mise en cache:', error);
            return false;
        }
    }

    // Récupérer du cache
    async get(key) {
        try {
            const cacheKey = this.getKey(key);
            const value = await this.client.get(cacheKey);
            
            if (!value) return null;
            
            return JSON.parse(value);
        } catch (error) {
            logger.error('Erreur lors de la récupération du cache:', error);
            return null;
        }
    }

    // Supprimer du cache
    async delete(key) {
        try {
            const cacheKey = this.getKey(key);
            await this.client.del(cacheKey);
            return true;
        } catch (error) {
            logger.error('Erreur lors de la suppression du cache:', error);
            return false;
        }
    }

    // Vider tout le cache
    async flush() {
        try {
            const pattern = `${this.prefix}*`;
            const keys = await this.client.keys(pattern);
            
            if (keys.length > 0) {
                await this.client.del(...keys);
            }
            
            return true;
        } catch (error) {
            logger.error('Erreur lors du vidage du cache:', error);
            return false;
        }
    }

    // Obtenir ou définir
    async getOrSet(key, callback, ttl = this.defaultTTL) {
        try {
            const cached = await this.get(key);
            if (cached !== null) return cached;

            const value = await callback();
            await this.set(key, value, ttl);
            
            return value;
        } catch (error) {
            logger.error('Erreur lors de getOrSet:', error);
            return null;
        }
    }

    // Vérifier si une clé existe
    async exists(key) {
        try {
            const cacheKey = this.getKey(key);
            return await this.client.exists(cacheKey);
        } catch (error) {
            logger.error('Erreur lors de la vérification d\'existence:', error);
            return false;
        }
    }

    // Obtenir le TTL d'une clé
    async getTTL(key) {
        try {
            const cacheKey = this.getKey(key);
            return await this.client.ttl(cacheKey);
        } catch (error) {
            logger.error('Erreur lors de la récupération du TTL:', error);
            return -1;
        }
    }

    // Mettre à jour le TTL d'une clé
    async updateTTL(key, ttl) {
        try {
            const cacheKey = this.getKey(key);
            return await this.client.expire(cacheKey, ttl);
        } catch (error) {
            logger.error('Erreur lors de la mise à jour du TTL:', error);
            return false;
        }
    }

    // Incrémenter une valeur
    async increment(key, amount = 1) {
        try {
            const cacheKey = this.getKey(key);
            return await this.client.incrby(cacheKey, amount);
        } catch (error) {
            logger.error('Erreur lors de l\'incrémentation:', error);
            return null;
        }
    }

    // Décrémenter une valeur
    async decrement(key, amount = 1) {
        try {
            const cacheKey = this.getKey(key);
            return await this.client.decrby(cacheKey, amount);
        } catch (error) {
            logger.error('Erreur lors de la décrémentation:', error);
            return null;
        }
    }

    // Ajouter à un ensemble
    async sadd(key, ...members) {
        try {
            const cacheKey = this.getKey(key);
            return await this.client.sadd(cacheKey, ...members);
        } catch (error) {
            logger.error('Erreur lors de l\'ajout à l\'ensemble:', error);
            return 0;
        }
    }

    // Supprimer d'un ensemble
    async srem(key, ...members) {
        try {
            const cacheKey = this.getKey(key);
            return await this.client.srem(cacheKey, ...members);
        } catch (error) {
            logger.error('Erreur lors de la suppression de l\'ensemble:', error);
            return 0;
        }
    }

    // Vérifier l'appartenance à un ensemble
    async sismember(key, member) {
        try {
            const cacheKey = this.getKey(key);
            return await this.client.sismember(cacheKey, member);
        } catch (error) {
            logger.error('Erreur lors de la vérification d\'appartenance:', error);
            return false;
        }
    }

    // Obtenir les membres d'un ensemble
    async smembers(key) {
        try {
            const cacheKey = this.getKey(key);
            return await this.client.smembers(cacheKey);
        } catch (error) {
            logger.error('Erreur lors de la récupération des membres:', error);
            return [];
        }
    }

    // Publier un message
    async publish(channel, message) {
        try {
            return await this.client.publish(channel, JSON.stringify(message));
        } catch (error) {
            logger.error('Erreur lors de la publication:', error);
            return 0;
        }
    }

    // S'abonner à un canal
    async subscribe(channel, callback) {
        try {
            const subscriber = this.client.duplicate();
            
            await subscriber.subscribe(channel);
            
            subscriber.on('message', (ch, message) => {
                try {
                    const data = JSON.parse(message);
                    callback(data);
                } catch (error) {
                    logger.error('Erreur lors du traitement du message:', error);
                }
            });

            return subscriber;
        } catch (error) {
            logger.error('Erreur lors de l\'abonnement:', error);
            return null;
        }
    }

    // Se désabonner d'un canal
    async unsubscribe(subscriber, channel) {
        try {
            await subscriber.unsubscribe(channel);
            subscriber.quit();
            return true;
        } catch (error) {
            logger.error('Erreur lors du désabonnement:', error);
            return false;
        }
    }

    // Fermer la connexion
    async close() {
        try {
            await this.client.quit();
            logger.info('Connexion Redis fermée');
            return true;
        } catch (error) {
            logger.error('Erreur lors de la fermeture de la connexion:', error);
            return false;
        }
    }
}

module.exports = new Cache();