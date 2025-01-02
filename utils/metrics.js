const logger = require('./logger');
const cache = require('./cache');
const config = require('./config');
const moment = require('moment');

class MetricsManager {
    constructor() {
        this.metrics = new Map();
        this.counters = new Map();
        this.gauges = new Map();
        this.histograms = new Map();
        this.retention = {
            raw: 24 * 60 * 60, // 24 heures en secondes
            minute: 7 * 24 * 60 * 60, // 7 jours
            hour: 30 * 24 * 60 * 60, // 30 jours
            day: 365 * 24 * 60 * 60 // 1 an
        };

        this.aggregationIntervals = ['minute', 'hour', 'day'];
        this.initialize();
    }

    // Initialiser le gestionnaire de métriques
    async initialize() {
        try {
            // Restaurer les métriques persistantes
            await this.restoreMetrics();

            // Démarrer l'agrégation périodique
            this.startAggregation();

            logger.info('Gestionnaire de métriques initialisé');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation des métriques:', error);
        }
    }

    // Restaurer les métriques
    async restoreMetrics() {
        try {
            // Restaurer depuis Redis
            const allMetrics = await cache.client.hgetall('metrics');
            
            for (const [key, value] of Object.entries(allMetrics || {})) {
                const [type, name] = key.split(':');
                const data = JSON.parse(value);

                switch (type) {
                    case 'counter':
                        this.counters.set(name, data);
                        break;
                    case 'gauge':
                        this.gauges.set(name, data);
                        break;
                    case 'histogram':
                        this.histograms.set(name, data);
                        break;
                }
            }
        } catch (error) {
            logger.error('Erreur lors de la restauration des métriques:', error);
        }
    }

    // Démarrer l'agrégation périodique
    startAggregation() {
        // Agréger toutes les minutes
        setInterval(() => this.aggregateMetrics('minute'), 60 * 1000);

        // Agréger toutes les heures
        setInterval(() => this.aggregateMetrics('hour'), 60 * 60 * 1000);

        // Agréger tous les jours
        setInterval(() => this.aggregateMetrics('day'), 24 * 60 * 60 * 1000);
    }

    // Incrémenter un compteur
    async incrementCounter(name, value = 1, tags = {}) {
        try {
            const timestamp = Date.now();
            const key = this.formatMetricKey('counter', name, tags);

            if (!this.counters.has(key)) {
                this.counters.set(key, {
                    value: 0,
                    history: []
                });
            }

            const counter = this.counters.get(key);
            counter.value += value;
            counter.history.push({
                value,
                timestamp
            });

            // Nettoyer l'historique
            this.cleanHistory(counter.history, this.retention.raw);

            // Sauvegarder
            await this.saveMetric('counter', key, counter);

            return counter.value;
        } catch (error) {
            logger.error('Erreur lors de l\'incrémentation du compteur:', error);
            throw error;
        }
    }

    // Définir une jauge
    async setGauge(name, value, tags = {}) {
        try {
            const timestamp = Date.now();
            const key = this.formatMetricKey('gauge', name, tags);

            if (!this.gauges.has(key)) {
                this.gauges.set(key, {
                    value,
                    history: []
                });
            }

            const gauge = this.gauges.get(key);
            gauge.value = value;
            gauge.history.push({
                value,
                timestamp
            });

            // Nettoyer l'historique
            this.cleanHistory(gauge.history, this.retention.raw);

            // Sauvegarder
            await this.saveMetric('gauge', key, gauge);

            return value;
        } catch (error) {
            logger.error('Erreur lors de la définition de la jauge:', error);
            throw error;
        }
    }

    // Enregistrer une valeur dans un histogramme
    async recordHistogram(name, value, tags = {}) {
        try {
            const timestamp = Date.now();
            const key = this.formatMetricKey('histogram', name, tags);

            if (!this.histograms.has(key)) {
                this.histograms.set(key, {
                    count: 0,
                    sum: 0,
                    min: Infinity,
                    max: -Infinity,
                    values: [],
                    history: []
                });
            }

            const histogram = this.histograms.get(key);
            histogram.count++;
            histogram.sum += value;
            histogram.min = Math.min(histogram.min, value);
            histogram.max = Math.max(histogram.max, value);
            histogram.values.push(value);

            histogram.history.push({
                value,
                timestamp
            });

            // Nettoyer l'historique
            this.cleanHistory(histogram.history, this.retention.raw);

            // Calculer les percentiles
            histogram.percentiles = this.calculatePercentiles(histogram.values);

            // Sauvegarder
            await this.saveMetric('histogram', key, histogram);

            return histogram;
        } catch (error) {
            logger.error('Erreur lors de l\'enregistrement dans l\'histogramme:', error);
            throw error;
        }
    }

    // Calculer les percentiles
    calculatePercentiles(values) {
        const sorted = [...values].sort((a, b) => a - b);
        return {
            p50: this.percentile(sorted, 50),
            p75: this.percentile(sorted, 75),
            p90: this.percentile(sorted, 90),
            p95: this.percentile(sorted, 95),
            p99: this.percentile(sorted, 99)
        };
    }

    // Calculer un percentile
    percentile(sorted, p) {
        if (sorted.length === 0) return 0;
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[index];
    }

    // Agréger les métriques
    async aggregateMetrics(interval) {
        try {
            const timestamp = Date.now();
            const windowStart = this.getWindowStart(timestamp, interval);

            // Agréger les compteurs
            for (const [key, counter] of this.counters) {
                const aggregated = this.aggregateHistory(counter.history, windowStart, interval);
                await this.saveAggregatedMetric('counter', key, aggregated, interval);
            }

            // Agréger les jauges
            for (const [key, gauge] of this.gauges) {
                const aggregated = this.aggregateHistory(gauge.history, windowStart, interval);
                await this.saveAggregatedMetric('gauge', key, aggregated, interval);
            }

            // Agréger les histogrammes
            for (const [key, histogram] of this.histograms) {
                const aggregated = this.aggregateHistory(histogram.history, windowStart, interval);
                await this.saveAggregatedMetric('histogram', key, aggregated, interval);
            }

            logger.debug(`Métriques agrégées pour l'intervalle ${interval}`);
        } catch (error) {
            logger.error('Erreur lors de l\'agrégation des métriques:', error);
        }
    }

    // Obtenir le début d'une fenêtre de temps
    getWindowStart(timestamp, interval) {
        const date = moment(timestamp);
        switch (interval) {
            case 'minute':
                return date.startOf('minute').valueOf();
            case 'hour':
                return date.startOf('hour').valueOf();
            case 'day':
                return date.startOf('day').valueOf();
            default:
                throw new Error(`Intervalle invalide: ${interval}`);
        }
    }

    // Agréger l'historique
    aggregateHistory(history, windowStart, interval) {
        const windowEnd = windowStart + this.getWindowDuration(interval);
        const values = history.filter(h => 
            h.timestamp >= windowStart && h.timestamp < windowEnd
        ).map(h => h.value);

        if (values.length === 0) return null;

        return {
            timestamp: windowStart,
            count: values.length,
            sum: values.reduce((a, b) => a + b, 0),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            min: Math.min(...values),
            max: Math.max(...values),
            percentiles: this.calculatePercentiles(values)
        };
    }

    // Obtenir la durée d'une fenêtre
    getWindowDuration(interval) {
        switch (interval) {
            case 'minute':
                return 60 * 1000;
            case 'hour':
                return 60 * 60 * 1000;
            case 'day':
                return 24 * 60 * 60 * 1000;
            default:
                throw new Error(`Intervalle invalide: ${interval}`);
        }
    }

    // Sauvegarder une métrique
    async saveMetric(type, key, data) {
        try {
            await cache.client.hset('metrics', `${type}:${key}`, JSON.stringify(data));
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde de la métrique:', error);
        }
    }

    // Sauvegarder une métrique agrégée
    async saveAggregatedMetric(type, key, data, interval) {
        if (!data) return;

        try {
            const aggregateKey = `metrics:${type}:${key}:${interval}`;
            await cache.client.zadd(
                aggregateKey,
                data.timestamp,
                JSON.stringify(data)
            );

            // Nettoyer les anciennes données
            const cutoff = Date.now() - this.retention[interval] * 1000;
            await cache.client.zremrangebyscore(aggregateKey, 0, cutoff);
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde de la métrique agrégée:', error);
        }
    }

    // Nettoyer l'historique
    cleanHistory(history, retention) {
        const cutoff = Date.now() - retention * 1000;
        const index = history.findIndex(h => h.timestamp >= cutoff);
        
        if (index > 0) {
            history.splice(0, index);
        }
    }

    // Formater une clé de métrique
    formatMetricKey(type, name, tags = {}) {
        const tagString = Object.entries(tags)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join(',');

        return tagString ? `${name}{${tagString}}` : name;
    }

    // Obtenir une métrique
    async getMetric(type, name, tags = {}) {
        try {
            const key = this.formatMetricKey(type, name, tags);
            const data = await cache.client.hget('metrics', `${type}:${key}`);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error('Erreur lors de la récupération de la métrique:', error);
            return null;
        }
    }

    // Obtenir l'historique d'une métrique
    async getMetricHistory(type, name, tags = {}, interval = 'minute', options = {}) {
        try {
            const key = this.formatMetricKey(type, name, tags);
            const aggregateKey = `metrics:${type}:${key}:${interval}`;

            const { start = 0, end = '+inf' } = options;
            const results = await cache.client.zrangebyscore(
                aggregateKey,
                start,
                end
            );

            return results.map(r => JSON.parse(r));
        } catch (error) {
            logger.error('Erreur lors de la récupération de l\'historique:', error);
            return [];
        }
    }

    // Obtenir toutes les métriques
    async getAllMetrics() {
        try {
            const metrics = {
                counters: {},
                gauges: {},
                histograms: {}
            };

            const allMetrics = await cache.client.hgetall('metrics');
            
            for (const [key, value] of Object.entries(allMetrics || {})) {
                const [type, ...rest] = key.split(':');
                const name = rest.join(':');
                const data = JSON.parse(value);

                switch (type) {
                    case 'counter':
                        metrics.counters[name] = data;
                        break;
                    case 'gauge':
                        metrics.gauges[name] = data;
                        break;
                    case 'histogram':
                        metrics.histograms[name] = data;
                        break;
                }
            }

            return metrics;
        } catch (error) {
            logger.error('Erreur lors de la récupération des métriques:', error);
            return null;
        }
    }

    // Réinitialiser une métrique
    async resetMetric(type, name, tags = {}) {
        try {
            const key = this.formatMetricKey(type, name, tags);

            // Supprimer la métrique
            await cache.client.hdel('metrics', `${type}:${key}`);

            // Supprimer les agrégations
            for (const interval of this.aggregationIntervals) {
                const aggregateKey = `metrics:${type}:${key}:${interval}`;
                await cache.client.del(aggregateKey);
            }

            // Supprimer de la mémoire
            switch (type) {
                case 'counter':
                    this.counters.delete(key);
                    break;
                case 'gauge':
                    this.gauges.delete(key);
                    break;
                case 'histogram':
                    this.histograms.delete(key);
                    break;
            }

            return true;
        } catch (error) {
            logger.error('Erreur lors de la réinitialisation de la métrique:', error);
            return false;
        }
    }

    // Réinitialiser toutes les métriques
    async resetAllMetrics() {
        try {
            // Supprimer toutes les métriques de Redis
            const keys = await cache.client.keys('metrics*');
            if (keys.length > 0) {
                await cache.client.del(...keys);
            }

            // Réinitialiser les métriques en mémoire
            this.counters.clear();
            this.gauges.clear();
            this.histograms.clear();

            logger.info('Toutes les métriques ont été réinitialisées');
            return true;
        } catch (error) {
            logger.error('Erreur lors de la réinitialisation des métriques:', error);
            return false;
        }
    }

    // Exporter les métriques
    async exportMetrics(format = 'json') {
        try {
            const metrics = await this.getAllMetrics();

            switch (format.toLowerCase()) {
                case 'json':
                    return JSON.stringify(metrics, null, 2);
                
                case 'prometheus':
                    return this.formatPrometheusMetrics(metrics);
                
                case 'influx':
                    return this.formatInfluxMetrics(metrics);
                
                default:
                    throw new Error(`Format d'export non supporté: ${format}`);
            }
        } catch (error) {
            logger.error('Erreur lors de l\'export des métriques:', error);
            throw error;
        }
    }

    // Formater les métriques pour Prometheus
    formatPrometheusMetrics(metrics) {
        let output = '';

        // Formater les compteurs
        for (const [name, counter] of Object.entries(metrics.counters)) {
            output += `# TYPE ${name} counter\n`;
            output += `${name} ${counter.value}\n`;
        }

        // Formater les jauges
        for (const [name, gauge] of Object.entries(metrics.gauges)) {
            output += `# TYPE ${name} gauge\n`;
            output += `${name} ${gauge.value}\n`;
        }

        // Formater les histogrammes
        for (const [name, histogram] of Object.entries(metrics.histograms)) {
            output += `# TYPE ${name} histogram\n`;
            output += `${name}_count ${histogram.count}\n`;
            output += `${name}_sum ${histogram.sum}\n`;
            
            for (const [percentile, value] of Object.entries(histogram.percentiles)) {
                output += `${name}{quantile="${percentile.substr(1)}"} ${value}\n`;
            }
        }

        return output;
    }

    // Formater les métriques pour InfluxDB
    formatInfluxMetrics(metrics) {
        const timestamp = Date.now() * 1000000; // Nanosecondes
        let output = '';

        // Formater les compteurs
        for (const [name, counter] of Object.entries(metrics.counters)) {
            output += `${name},type=counter value=${counter.value} ${timestamp}\n`;
        }

        // Formater les jauges
        for (const [name, gauge] of Object.entries(metrics.gauges)) {
            output += `${name},type=gauge value=${gauge.value} ${timestamp}\n`;
        }

        // Formater les histogrammes
        for (const [name, histogram] of Object.entries(metrics.histograms)) {
            output += `${name},type=histogram count=${histogram.count},`;
            output += `sum=${histogram.sum},`;
            output += `min=${histogram.min},`;
            output += `max=${histogram.max}`;
            
            for (const [percentile, value] of Object.entries(histogram.percentiles)) {
                output += `,${percentile}=${value}`;
            }
            
            output += ` ${timestamp}\n`;
        }

        return output;
    }

    // Obtenir des statistiques sur les métriques
    async getStats() {
        try {
            const metrics = await this.getAllMetrics();
            
            return {
                counters: {
                    count: Object.keys(metrics.counters).length,
                    total: Object.values(metrics.counters)
                        .reduce((sum, c) => sum + c.value, 0)
                },
                gauges: {
                    count: Object.keys(metrics.gauges).length,
                    average: Object.values(metrics.gauges)
                        .reduce((sum, g) => sum + g.value, 0) / 
                        Object.keys(metrics.gauges).length || 0
                },
                histograms: {
                    count: Object.keys(metrics.histograms).length,
                    totalSamples: Object.values(metrics.histograms)
                        .reduce((sum, h) => sum + h.count, 0)
                },
                lastAggregation: await this.getLastAggregationTime(),
                memoryUsage: process.memoryUsage().heapUsed
            };
        } catch (error) {
            logger.error('Erreur lors du calcul des statistiques:', error);
            return null;
        }
    }

    // Obtenir la dernière heure d'agrégation
    async getLastAggregationTime() {
        try {
            // Prendre la dernière métrique agrégée
            const lastAggregation = await cache.client.get('metrics:last_aggregation');
            return lastAggregation ? parseInt(lastAggregation) : null;
        } catch (error) {
            logger.error('Erreur lors de la récupération de la dernière agrégation:', error);
            return null;
        }
    }

    // Tâches de maintenance périodiques
    async runMaintenance() {
        try {
            // Nettoyer les anciennes données
            for (const interval of this.aggregationIntervals) {
                const cutoff = Date.now() - this.retention[interval] * 1000;
                
                const pattern = `metrics:*:${interval}`;
                const keys = await cache.client.keys(pattern);
                
                for (const key of keys) {
                    await cache.client.zremrangebyscore(key, 0, cutoff);
                }
            }

            // Compacter l'historique
            this.compactHistory();

            logger.info('Maintenance des métriques effectuée');
        } catch (error) {
            logger.error('Erreur lors de la maintenance des métriques:', error);
        }
    }

    // Compacter l'historique
    compactHistory() {
        // Compacter les compteurs
        for (const counter of this.counters.values()) {
            this.cleanHistory(counter.history, this.retention.raw);
        }

        // Compacter les jauges
        for (const gauge of this.gauges.values()) {
            this.cleanHistory(gauge.history, this.retention.raw);
        }

        // Compacter les histogrammes
        for (const histogram of this.histograms.values()) {
            this.cleanHistory(histogram.history, this.retention.raw);
            
            // Limiter le nombre de valeurs stockées
            if (histogram.values.length > 1000) {
                histogram.values = histogram.values.slice(-1000);
            }
        }
    }
}

module.exports = new MetricsManager();

            