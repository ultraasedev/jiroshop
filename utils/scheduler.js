const schedule = require('node-schedule');
const logger = require('./logger');
const config = require('./config');
const cache = require('./cache');

class Scheduler {
    constructor() {
        this.jobs = new Map();
        this.defaultTasks = new Map();
        this.scheduledJobs = new Map();
        
        // État d'exécution des tâches
        this.runningTasks = new Set();
        this.taskHistory = new Map();
        this.maxHistoryPerTask = 100;

        this.initialize();
    }

    // Initialiser le planificateur
    async initialize() {
        try {
            // Ajouter les tâches par défaut
            this.addDefaultTasks();

            // Charger les tâches depuis la base de données
            await this.loadTasks();

            // Restaurer les tâches planifiées
            await this.restoreScheduledTasks();

            logger.info('Planificateur initialisé');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation du planificateur:', error);
            throw error;
        }
    }

    // Ajouter les tâches par défaut
    addDefaultTasks() {
        // Nettoyage des fichiers temporaires
        this.defaultTasks.set('cleanupTemp', {
            name: 'Nettoyage des fichiers temporaires',
            handler: async () => {
                const fileManager = require('./fileManager');
                await fileManager.cleanTempFiles();
            },
            schedule: '0 0 * * *' // Tous les jours à minuit
        });

        // Backup de la base de données
        this.defaultTasks.set('databaseBackup', {
            name: 'Backup de la base de données',
            handler: async () => {
                const backup = require('./backup');
                await backup.createBackup();
            },
            schedule: '0 1 * * *' // Tous les jours à 1h du matin
        });

        // Nettoyage du cache
        this.defaultTasks.set('cleanupCache', {
            name: 'Nettoyage du cache',
            handler: async () => {
                await cache.cleanup();
            },
            schedule: '0 2 * * *' // Tous les jours à 2h du matin
        });

        // Maintenance des sessions
        this.defaultTasks.set('sessionMaintenance', {
            name: 'Maintenance des sessions',
            handler: async () => {
                const session = require('./session');
                await session.cleanup();
            },
            schedule: '0 */6 * * *' // Toutes les 6 heures
        });
    }

    // Charger les tâches depuis la base de données
    async loadTasks() {
        try {
            const ScheduledTask = require('../models/ScheduledTask');
            const tasks = await ScheduledTask.find({ active: true });

            for (const task of tasks) {
                this.jobs.set(task.id, {
                    name: task.name,
                    schedule: task.schedule,
                    handler: this.createTaskHandler(task),
                    active: task.active,
                    lastRun: task.lastRun,
                    nextRun: null,
                    metadata: task.metadata
                });
            }

            logger.info(`${tasks.length} tâches chargées`);
        } catch (error) {
            logger.error('Erreur lors du chargement des tâches:', error);
            throw error;
        }
    }

    // Créer un handler pour une tâche
    createTaskHandler(task) {
        return async () => {
            if (this.runningTasks.has(task.id)) {
                logger.warn(`La tâche ${task.name} est déjà en cours d'exécution`);
                return;
            }

            this.runningTasks.add(task.id);
            const startTime = Date.now();

            try {
                // Exécuter la tâche
                await eval(task.code);

                // Mettre à jour les statistiques
                const duration = Date.now() - startTime;
                await this.updateTaskStats(task.id, {
                    success: true,
                    duration,
                    timestamp: startTime
                });

                logger.info(`Tâche ${task.name} exécutée en ${duration}ms`);
            } catch (error) {
                logger.error(`Erreur lors de l'exécution de la tâche ${task.name}:`, error);
                
                await this.updateTaskStats(task.id, {
                    success: false,
                    error: error.message,
                    timestamp: startTime
                });
            } finally {
                this.runningTasks.delete(task.id);
            }
        };
    }

    // Restaurer les tâches planifiées
    async restoreScheduledTasks() {
        try {
            // Restaurer les tâches par défaut
            for (const [id, task] of this.defaultTasks) {
                await this.scheduleTask(id, task.handler, task.schedule);
            }

            // Restaurer les tâches personnalisées
            for (const [id, task] of this.jobs) {
                if (task.active) {
                    await this.scheduleTask(id, task.handler, task.schedule);
                }
            }
        } catch (error) {
            logger.error('Erreur lors de la restauration des tâches:', error);
            throw error;
        }
    }

    // Planifier une tâche
    async scheduleTask(taskId, handler, cronExpression) {
        try {
            // Annuler la tâche si elle existe déjà
            if (this.scheduledJobs.has(taskId)) {
                this.scheduledJobs.get(taskId).cancel();
            }

            // Créer le job
            const job = schedule.scheduleJob(cronExpression, async () => {
                await this.executeTask(taskId, handler);
            });

            // Calculer la prochaine exécution
            const nextRun = job.nextInvocation();

            // Sauvegarder le job
            this.scheduledJobs.set(taskId, job);

            // Mettre à jour la tâche
            if (this.jobs.has(taskId)) {
                this.jobs.get(taskId).nextRun = nextRun;
            }

            logger.info(`Tâche planifiée: ${taskId}, prochaine exécution: ${nextRun}`);
            return nextRun;
        } catch (error) {
            logger.error('Erreur lors de la planification de la tâche:', error);
            throw error;
        }
    }

    // Exécuter une tâche
    async executeTask(taskId, handler) {
        if (this.runningTasks.has(taskId)) {
            logger.warn(`La tâche ${taskId} est déjà en cours d'exécution`);
            return;
        }

        this.runningTasks.add(taskId);
        const startTime = Date.now();

        try {
            await handler();
            
            // Mettre à jour les statistiques
            await this.updateTaskStats(taskId, {
                success: true,
                duration: Date.now() - startTime,
                timestamp: startTime
            });

            return true;
        } catch (error) {
            logger.error(`Erreur lors de l'exécution de la tâche ${taskId}:`, error);
            
            await this.updateTaskStats(taskId, {
                success: false,
                error: error.message,
                timestamp: startTime
            });

            return false;
        } finally {
            this.runningTasks.delete(taskId);
        }
    }

    // Mettre à jour les statistiques d'une tâche
    async updateTaskStats(taskId, stats) {
        try {
            // Mettre à jour l'historique
            if (!this.taskHistory.has(taskId)) {
                this.taskHistory.set(taskId, []);
            }

            const history = this.taskHistory.get(taskId);
            history.unshift(stats);

            // Limiter la taille de l'historique
            if (history.length > this.maxHistoryPerTask) {
                history.pop();
            }

            // Mettre à jour la base de données
            const ScheduledTask = require('../models/ScheduledTask');
            await ScheduledTask.findByIdAndUpdate(taskId, {
                lastRun: stats.timestamp,
                $push: {
                    history: {
                        $each: [stats],
                        $slice: -this.maxHistoryPerTask
                    }
                }
            });
        } catch (error) {
            logger.error('Erreur lors de la mise à jour des statistiques:', error);
        }
    }

    // Ajouter une nouvelle tâche
    async addTask(task) {
        try {
            const ScheduledTask = require('../models/ScheduledTask');
            const newTask = await ScheduledTask.create({
                name: task.name,
                schedule: task.schedule,
                code: task.code,
                active: true,
                metadata: task.metadata
            });

            // Ajouter la tâche à la liste
            this.jobs.set(newTask.id, {
                name: newTask.name,
                schedule: newTask.schedule,
                handler: this.createTaskHandler(newTask),
                active: true,
                lastRun: null,
                nextRun: null,
                metadata: newTask.metadata
            });

            // Planifier la tâche
            await this.scheduleTask(
                newTask.id,
                this.createTaskHandler(newTask),
                newTask.schedule
            );

            logger.info(`Nouvelle tâche ajoutée: ${newTask.name}`);
            return newTask;
        } catch (error) {
            logger.error('Erreur lors de l\'ajout de la tâche:', error);
            throw error;
        }
    }

    // Modifier une tâche
    async updateTask(taskId, updates) {
        try {
            const ScheduledTask = require('../models/ScheduledTask');
            const task = await ScheduledTask.findByIdAndUpdate(taskId, updates, { new: true });

            if (!task) {
                throw new Error('Tâche non trouvée');
            }

            // Mettre à jour la tâche en mémoire
            this.jobs.set(taskId, {
                ...this.jobs.get(taskId),
                ...updates,
                handler: this.createTaskHandler(task)
            });

            // Replanifier si nécessaire
            if (updates.schedule || updates.active !== undefined) {
                if (task.active) {
                    await this.scheduleTask(taskId, this.createTaskHandler(task), task.schedule);
                } else {
                    this.cancelTask(taskId);
                }
            }

            logger.info(`Tâche mise à jour: ${task.name}`);
            return task;
        } catch (error) {
            logger.error('Erreur lors de la mise à jour de la tâche:', error);
            throw error;
        }
    }

    // Supprimer une tâche
    async deleteTask(taskId) {
        try {
            // Annuler la tâche
            this.cancelTask(taskId);

            // Supprimer de la base de données
            const ScheduledTask = require('../models/ScheduledTask');
            await ScheduledTask.findByIdAndDelete(taskId);

            // Supprimer de la mémoire
            this.jobs.delete(taskId);
            this.taskHistory.delete(taskId);

            logger.info(`Tâche supprimée: ${taskId}`);
            return true;
        } catch (error) {
            logger.error('Erreur lors de la suppression de la tâche:', error);
            throw error;
        }
    }

    // Annuler une tâche
    cancelTask(taskId) {
        try {
            if (this.scheduledJobs.has(taskId)) {
                this.scheduledJobs.get(taskId).cancel();
                this.scheduledJobs.delete(taskId);
                return true;
            }
            return false;
        } catch (error) {
            logger.error('Erreur lors de l\'annulation de la tâche:', error);
            return false;
        }
    }

    // Obtenir les statistiques d'une tâche
    getTaskStats(taskId) {
        const task = this.jobs.get(taskId);
        if (!task) return null;

        const history = this.taskHistory.get(taskId) || [];
        const successCount = history.filter(h => h.success).length;

        return {
            name: task.name,
            active: task.active,
            lastRun: task.lastRun,
            nextRun: task.nextRun,
            successRate: history.length ? (successCount / history.length) * 100 : 0,
            averageDuration: history.length ? 
                history.reduce((acc, h) => acc + (h.duration || 0), 0) / history.length : 0,
            totalRuns: history.length,
            successfulRuns: successCount,
            failedRuns: history.length - successCount
        };
    }

    // Obtenir l'historique d'une tâche
    getTaskHistory(taskId) {
        return this.taskHistory.get(taskId) || [];
    }

    // Obtenir la liste des tâches
    getTasks() {
        return Array.from(this.jobs.entries()).map(([id, task]) => ({
            id,
            name: task.name,
            schedule: task.schedule,
            active: task.active,
            lastRun: task.lastRun,
            nextRun: task.nextRun,
            isRunning: this.runningTasks.has(id),
            metadata: task.metadata
        }));
    }

    // Exécuter une tâche manuellement
    async runTaskManually(taskId) {
        const task = this.jobs.get(taskId);
        if (!task) {
            throw new Error('Tâche non trouvée');
        }

        return await this.executeTask(taskId, task.handler);
    }

    // Arrêter toutes les tâches
    async stopAll() {
        for (const [taskId, job] of this.scheduledJobs) {
            job.cancel();
            this.scheduledJobs.delete(taskId);
        }
        this.runningTasks.clear();
        logger.info('Toutes les tâches ont été arrêtées');
    }
}

module.exports = new Scheduler();