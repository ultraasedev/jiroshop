const logger = require('./logger');
const redis = require('ioredis');
const config = require('./config');

class Queue {
    constructor() {
        this.client = new redis({
            host: config.get('redis.host', 'localhost'),
            port: config.get('redis.port', 6379),
            password: config.get('redis.password'),
            db: config.get('redis.db', 0)
        });
        this.prefix = 'queue:';
        this.handlers = new Map();
        this.isProcessing = false;
        this.retryDelay = 5000;
        this.maxRetries = 3;
    }

    // Ajouter une tâche à la queue
    async add(queueName, data, options = {}) {
        try {
            const job = {
                id: this.generateJobId(),
                data,
                options: {
                    priority: options.priority || 0,
                    delay: options.delay || 0,
                    retries: options.retries || this.maxRetries,
                    timeout: options.timeout || 30000
                },
                status: 'pending',
                createdAt: Date.now(),
                attempts: 0
            };

            const key = `${this.prefix}${queueName}`;
            await this.client.lpush(key, JSON.stringify(job));
            logger.debug(`Tâche ajoutée à la queue ${queueName}:`, { jobId: job.id });

            return job;
        } catch (error) {
            logger.error('Erreur lors de l\'ajout à la queue:', error);
            throw error;
        }
    }

    // Traiter les tâches d'une queue
    async process(queueName, handler) {
        this.handlers.set(queueName, handler);

        if (!this.isProcessing) {
            this.isProcessing = true;
            this.startProcessing(queueName);
        }
    }

    // Démarrer le traitement des tâches
    async startProcessing(queueName) {
        while (this.isProcessing) {
            try {
                const key = `${this.prefix}${queueName}`;
                const jobData = await this.client.brpop(key, 0);

                if (!jobData) continue;

                const job = JSON.parse(jobData[1]);
                const handler = this.handlers.get(queueName);

                if (!handler) {
                    logger.error(`Pas de handler pour la queue ${queueName}`);
                    continue;
                }

                await this.processJob(job, handler, queueName);
            } catch (error) {
                logger.error('Erreur lors du traitement de la queue:', error);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            }
        }
    }

    // Traiter une tâche spécifique
    async processJob(job, handler, queueName) {
        try {
            job.status = 'processing';
            job.startedAt = Date.now();
            job.attempts += 1;

            const result = await Promise.race([
                handler(job.data),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Timeout')), job.options.timeout);
                })
            ]);

            job.status = 'completed';
            job.completedAt = Date.now();
            job.result = result;

            await this.saveJobResult(queueName, job);
            logger.debug(`Tâche ${job.id} terminée:`, { queueName, result });
        } catch (error) {
            logger.error(`Erreur lors du traitement de la tâche ${job.id}:`, error);

            if (job.attempts < job.options.retries) {
                await this.retryJob(queueName, job);
            } else {
                job.status = 'failed';
                job.error = error.message;
                await this.saveJobResult(queueName, job);
            }
        }
    }

    // Réessayer une tâche
    async retryJob(queueName, job) {
        try {
            const delay = Math.min(
                this.retryDelay * Math.pow(2, job.attempts - 1),
                30000
            );

            setTimeout(async () => {
                const key = `${this.prefix}${queueName}`;
                await this.client.lpush(key, JSON.stringify(job));
            }, delay);

            logger.debug(`Tâche ${job.id} programmée pour retry:`, {
                queueName,
                attempts: job.attempts,
                delay
            });
        } catch (error) {
            logger.error('Erreur lors du retry de la tâche:', error);
        }
    }

    // Sauvegarder le résultat d'une tâche
    async saveJobResult(queueName, job) {
        try {
            const resultKey = `${this.prefix}${queueName}:results:${job.id}`;
            await this.client.setex(
                resultKey,
                86400,  // expire après 24h
                JSON.stringify(job)
            );
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde du résultat:', error);
        }
    }

    // Obtenir le résultat d'une tâche
    async getJobResult(queueName, jobId) {
        try {
            const resultKey = `${this.prefix}${queueName}:results:${jobId}`;
            const result = await this.client.get(resultKey);
            return result ? JSON.parse(result) : null;
        } catch (error) {
            logger.error('Erreur lors de la récupération du résultat:', error);
            return null;
        }
    }

    // Arrêter le traitement des queues
    async stop() {
        this.isProcessing = false;
        await this.client.quit();
        logger.info('Traitement des queues arrêté');
    }

    // Générer un ID unique pour une tâche
    generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Obtenir les statistiques d'une queue
    async getStats(queueName) {
        try {
            const key = `${this.prefix}${queueName}`;
            const length = await this.client.llen(key);
            
            const resultsPattern = `${this.prefix}${queueName}:results:*`;
            const resultKeys = await this.client.keys(resultsPattern);
            
            let completed = 0;
            let failed = 0;

            for (const key of resultKeys) {
                const job = JSON.parse(await this.client.get(key));
                if (job.status === 'completed') completed++;
                if (job.status === 'failed') failed++;
            }

            return {
                pending: length,
                completed,
                failed,
                total: length + completed + failed
            };
        } catch (error) {
            logger.error('Erreur lors de la récupération des stats:', error);
            return null;
        }
    }

    // Nettoyer les vieux résultats
    async cleanOldResults(queueName, maxAge = 86400) {
        try {
            const pattern = `${this.prefix}${queueName}:results:*`;
            const keys = await this.client.keys(pattern);
            let cleaned = 0;

            for (const key of keys) {
                const job = JSON.parse(await this.client.get(key));
                const age = Date.now() - job.completedAt;

                if (age > maxAge * 1000) {
                    await this.client.del(key);
                    cleaned++;
                }
            }

            logger.info(`${cleaned} vieux résultats nettoyés pour ${queueName}`);
            return cleaned;
        } catch (error) {
            logger.error('Erreur lors du nettoyage des résultats:', error);
            return 0;
        }
    }

    // Vider une queue
    async clear(queueName) {
        try {
            const key = `${this.prefix}${queueName}`;
            await this.client.del(key);
            
            const resultsPattern = `${this.prefix}${queueName}:results:*`;
            const resultKeys = await this.client.keys(resultsPattern);
            
            if (resultKeys.length > 0) {
                await this.client.del(...resultKeys);
            }

            logger.info(`Queue ${queueName} vidée`);
            return true;
        } catch (error) {
            logger.error('Erreur lors du vidage de la queue:', error);
            return false;
        }
    }

    // Obtenir toutes les tâches en attente
    async getPendingJobs(queueName) {
        try {
            const key = `${this.prefix}${queueName}`;
            const jobs = await this.client.lrange(key, 0, -1);
            return jobs.map(job => JSON.parse(job));
        } catch (error) {
            logger.error('Erreur lors de la récupération des tâches en attente:', error);
            return [];
        }
    }

    // Supprimer une tâche spécifique
    async removeJob(queueName, jobId) {
        try {
            const key = `${this.prefix}${queueName}`;
            const jobs = await this.client.lrange(key, 0, -1);
            
            for (let i = 0; i < jobs.length; i++) {
                const job = JSON.parse(jobs[i]);
                if (job.id === jobId) {
                    await this.client.lrem(key, 1, jobs[i]);
                    logger.debug(`Tâche ${jobId} supprimée de ${queueName}`);
                    return true;
                }
            }

            return false;
        } catch (error) {
            logger.error('Erreur lors de la suppression de la tâche:', error);
            return false;
        }
    }

    // Déplacer une tâche en tête de queue
    async prioritize(queueName, jobId) {
        try {
            const job = await this.removeJob(queueName, jobId);
            if (job) {
                job.options.priority = 1;
                await this.add(queueName, job.data, job.options);
                return true;
            }
            return false;
        } catch (error) {
            logger.error('Erreur lors de la priorisation de la tâche:', error);
            return false;
        }
    }
}

module.exports = new Queue();