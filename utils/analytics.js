const moment = require('moment');
const logger = require('./logger');
const metrics = require('./metrics');
const cache = require('./cache');

class AnalyticsManager {
    constructor() {
        this.analysisTypes = {
            SALES: 'sales',
            USER_BEHAVIOR: 'user_behavior',
            PRODUCTS: 'products',
            PAYMENTS: 'payments',
            PERFORMANCE: 'performance'
        };

        this.timeFrames = {
            HOURLY: 'hour',
            DAILY: 'day',
            WEEKLY: 'week',
            MONTHLY: 'month'
        };

        this.initialize();
    }

    // Initialisation
    async initialize() {
        try {
            // Initialiser le cache pour les analyses
            await this.initializeCache();

            logger.info('Gestionnaire d\'analytics initialisé');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation des analytics:', error);
        }
    }

    // Initialiser le cache
    async initializeCache() {
        try {
            // Créer un index pour les analyses en cache
            await cache.client.set('analytics:last_update', Date.now());
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation du cache:', error);
        }
    }

    // Analyser les ventes
    async analyzeSales(startDate, endDate, options = {}) {
        try {
            const Order = require('../models/Order');
            const query = {
                createdAt: {
                    $gte: moment(startDate).toDate(),
                    $lte: moment(endDate).toDate()
                },
                status: { $in: ['completed', 'delivered'] }
            };

            const orders = await Order.find(query).populate('products.product');

            const analysis = {
                overview: await this.getSalesOverview(orders),
                trends: await this.getSalesTrends(orders, options.timeFrame),
                products: await this.getProductAnalysis(orders),
                customers: await this.getCustomerAnalysis(orders),
                performance: await this.getPerformanceMetrics(orders)
            };

            // Calculer les insights
            analysis.insights = await this.generateSalesInsights(analysis);

            return analysis;
        } catch (error) {
            logger.error('Erreur lors de l\'analyse des ventes:', error);
            throw error;
        }
    }

    // Obtenir l'aperçu des ventes
    async getSalesOverview(orders) {
        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((sum, order) => sum + order.payment.amount.total, 0);
        const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        const uniqueCustomers = new Set(orders.map(order => order.user.id)).size;
        const totalItems = orders.reduce((sum, order) => 
            sum + order.products.reduce((s, p) => s + p.quantity, 0), 0);

        return {
            totalOrders,
            totalRevenue,
            averageOrderValue,
            uniqueCustomers,
            totalItems,
            conversionRate: await this.calculateConversionRate(orders)
        };
    }

    // Obtenir les tendances des ventes
    async getSalesTrends(orders, timeFrame = this.timeFrames.DAILY) {
        const trends = new Map();
        const format = this.getDateFormat(timeFrame);

        orders.forEach(order => {
            const key = moment(order.createdAt).format(format);
            if (!trends.has(key)) {
                trends.set(key, {
                    orders: 0,
                    revenue: 0,
                    items: 0
                });
            }
            const stats = trends.get(key);
            stats.orders++;
            stats.revenue += order.payment.amount.total;
            stats.items += order.products.reduce((sum, p) => sum + p.quantity, 0);
        });

        // Calculer les variations
        return {
            data: Array.from(trends.entries()).map(([date, stats]) => ({
                date,
                ...stats,
                averageOrderValue: stats.orders > 0 ? stats.revenue / stats.orders : 0
            })),
            growth: this.calculateGrowth(trends)
        };
    }

    // Analyser les produits
    async getProductAnalysis(orders) {
        const productStats = new Map();

        // Collecter les statistiques par produit
        orders.forEach(order => {
            order.products.forEach(item => {
                const productId = item.product._id.toString();
                if (!productStats.has(productId)) {
                    productStats.set(productId, {
                        product: item.product,
                        quantity: 0,
                        revenue: 0,
                        orders: 0
                    });
                }
                const stats = productStats.get(productId);
                stats.quantity += item.quantity;
                stats.revenue += item.price * item.quantity;
                stats.orders++;
            });
        });

        // Calculer les métriques supplémentaires
        const products = Array.from(productStats.values()).map(stats => ({
            ...stats,
            averageOrderValue: stats.orders > 0 ? stats.revenue / stats.orders : 0,
            attachmentRate: stats.orders / orders.length
        }));

        return {
            topProducts: products.sort((a, b) => b.revenue - a.revenue).slice(0, 10),
            productCategories: await this.analyzeProductCategories(products),
            recommendations: await this.generateProductRecommendations(products, orders)
        };
    }

    // Analyser les catégories de produits
    async analyzeProductCategories(products) {
        const categoryStats = new Map();

        products.forEach(product => {
            const category = product.product.category;
            if (!categoryStats.has(category)) {
                categoryStats.set(category, {
                    revenue: 0,
                    quantity: 0,
                    products: 0
                });
            }
            const stats = categoryStats.get(category);
            stats.revenue += product.revenue;
            stats.quantity += product.quantity;
            stats.products++;
        });

        return Array.from(categoryStats.entries()).map(([category, stats]) => ({
            category,
            ...stats,
            averagePrice: stats.revenue / stats.quantity
        }));
    }

    // Analyser le comportement des clients
    async getCustomerAnalysis(orders) {
        const customers = new Map();

        // Collecter les données par client
        orders.forEach(order => {
            const userId = order.user.id;
            if (!customers.has(userId)) {
                customers.set(userId, {
                    orders: 0,
                    totalSpent: 0,
                    products: new Set(),
                    lastOrder: null,
                    firstOrder: order.createdAt
                });
            }
            const stats = customers.get(userId);
            stats.orders++;
            stats.totalSpent += order.payment.amount.total;
            order.products.forEach(item => stats.products.add(item.product._id.toString()));
            stats.lastOrder = order.createdAt;
        });

        // Calculer les segments et métriques
        const customerList = Array.from(customers.entries()).map(([userId, stats]) => ({
            userId,
            ...stats,
            products: stats.products.size,
            averageOrderValue: stats.totalSpent / stats.orders,
            daysSinceLastOrder: moment().diff(moment(stats.lastOrder), 'days'),
            customerLifespan: moment(stats.lastOrder).diff(moment(stats.firstOrder), 'days')
        }));

        return {
            segments: this.segmentCustomers(customerList),
            cohortAnalysis: await this.analyzeCohorts(customerList, orders),
            retentionAnalysis: await this.analyzeRetention(customerList, orders),
            ltv: this.calculateCustomerLTV(customerList)
        };
    }

    // Segmenter les clients
    segmentCustomers(customers) {
        const segments = {
            new: [],
            active: [],
            loyal: [],
            risk: [],
            lost: []
        };

        customers.forEach(customer => {
            if (customer.daysSinceLastOrder <= 30) {
                if (customer.orders === 1) {
                    segments.new.push(customer);
                } else {
                    segments.active.push(customer);
                }
            } else if (customer.orders >= 5) {
                segments.loyal.push(customer);
            } else if (customer.daysSinceLastOrder <= 90) {
                segments.risk.push(customer);
            } else {
                segments.lost.push(customer);
            }
        });

        return {
            segments,
            distribution: {
                new: segments.new.length,
                active: segments.active.length,
                loyal: segments.loyal.length,
                risk: segments.risk.length,
                lost: segments.lost.length
            }
        };
    }

    // Analyser les cohortes
    async analyzeCohorts(customers, orders) {
        const cohorts = new Map();

        // Grouper par mois d'acquisition
        customers.forEach(customer => {
            const cohortKey = moment(customer.firstOrder).format('YYYY-MM');
            if (!cohorts.has(cohortKey)) {
                cohorts.set(cohortKey, {
                    customers: 0,
                    retention: new Map(),
                    revenue: 0
                });
            }
            const cohort = cohorts.get(cohortKey);
            cohort.customers++;
        });

        // Calculer la rétention pour chaque cohorte
        orders.forEach(order => {
            const customer = customers.find(c => c.userId === order.user.id);
            if (!customer) return;

            const cohortKey = moment(customer.firstOrder).format('YYYY-MM');
            const orderMonth = moment(order.createdAt).format('YYYY-MM');
            const cohort = cohorts.get(cohortKey);
            
            if (!cohort.retention.has(orderMonth)) {
                cohort.retention.set(orderMonth, {
                    customers: 0,
                    revenue: 0
                });
            }
            const retention = cohort.retention.get(orderMonth);
            retention.customers++;
            retention.revenue += order.payment.amount.total;
        });

        return Array.from(cohorts.entries()).map(([date, data]) => ({
            cohort: date,
            size: data.customers,
            retention: Array.from(data.retention.entries()).map(([month, stats]) => ({
                month,
                rate: (stats.customers / data.customers) * 100,
                revenue: stats.revenue
            }))
        }));
    }

    // Analyser la rétention
    async analyzeRetention(customers, orders) {
        const periods = {
            '30d': 30,
            '60d': 60,
            '90d': 90,
            '180d': 180,
            '365d': 365
        };

        const retention = {};

        for (const [period, days] of Object.entries(periods)) {
            const cutoffDate = moment().subtract(days, 'days');
            const eligibleCustomers = customers.filter(c => 
                moment(c.firstOrder).isBefore(cutoffDate)
            );

            const activeCustomers = eligibleCustomers.filter(c =>
                moment(c.lastOrder).isAfter(cutoffDate)
            );

            retention[period] = {
                rate: eligibleCustomers.length > 0 ?
                    (activeCustomers.length / eligibleCustomers.length) * 100 : 0,
                active: activeCustomers.length,
                total: eligibleCustomers.length
            };
        }

        return retention;
    }

    // Calculer la valeur à vie des clients
    calculateCustomerLTV(customers) {
        if (customers.length === 0) return 0;

        const totalRevenue = customers.reduce((sum, customer) => 
            sum + customer.totalSpent, 0);
        const averageLifespan = customers.reduce((sum, customer) => 
            sum + customer.customerLifespan, 0) / customers.length;

        return {
            average: totalRevenue / customers.length,
            projected: (totalRevenue / customers.length) * (365 / averageLifespan),
            distribution: this.calculateLTVDistribution(customers)
        };
    }

    // Calculer la distribution de la valeur à vie des clients
    calculateLTVDistribution(customers) {
        const sortedLTV = customers
            .map(c => c.totalSpent)
            .sort((a, b) => a - b);

        return {
            min: sortedLTV[0],
            max: sortedLTV[sortedLTV.length - 1],
            median: this.calculateMedian(sortedLTV),
            percentiles: {
                25: this.calculatePercentile(sortedLTV, 25),
                50: this.calculatePercentile(sortedLTV, 50),
                75: this.calculatePercentile(sortedLTV, 75),
                90: this.calculatePercentile(sortedLTV, 90)
            }
        };
    }

    // Générer des recommandations de produits
    async generateProductRecommendations(products, orders) {
        // Analyser les associations de produits
        const associations = await this.analyzeProductAssociations(orders);

        // Trouver les opportunités de vente croisée
        const crossSellOpportunities = this.findCrossSellOpportunities(
            products,
            associations
        );

        // Identifier les produits sous-performants
        const underperforming = products
            .filter(p => p.quantity < (products.reduce((sum, p) => 
                sum + p.quantity, 0) / products.length) * 0.5)
            .map(p => ({
                ...p,
                reason: 'Low sales volume',
                recommendation: 'Consider price adjustment or promotion'
            }));

        return {
            crossSell: crossSellOpportunities,
            underperforming,
            trending: this.identifyTrendingProducts(products, orders)
        };
    }

    // Analyser les associations de produits
    async analyzeProductAssociations(orders) {
        const associations = new Map();

        orders.forEach(order => {
            if (order.products.length < 2) return;

            // Créer toutes les paires possibles de produits
            for (let i = 0; i < order.products.length; i++) {
                for (let j = i + 1; j < order.products.length; j++) {
                    const pair = [
                        order.products[i].product._id.toString(),
                        order.products[j].product._id.toString()
                    ].sort().join('_');

                    if (!associations.has(pair)) {
                        associations.set(pair, {
                            count: 0,
                            revenue: 0,
                            products: [
                                order.products[i].product,
                                order.products[j].product
                            ]
                        });
                    }

                    const stats = associations.get(pair);
                    stats.count++;
                    stats.revenue += 
                        order.products[i].price * order.products[i].quantity +
                        order.products[j].price * order.products[j].quantity;
                }
            }
        });

        return Array.from(associations.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
    }

    // Trouver les opportunités de vente croisée
    findCrossSellOpportunities(products, associations) {
        return associations.map(association => ({
            products: association.products,
            confidence: association.count / products.find(p => 
                p.product._id.toString() === association.products[0]._id.toString()
            ).orders,
            support: association.count / products.length,
            lift: (association.count * products.length) / (
                products.find(p => 
                    p.product._id.toString() === association.products[0]._id.toString()
                ).orders *
                products.find(p => 
                    p.product._id.toString() === association.products[1]._id.toString()
                ).orders
            )
        }))
        .sort((a, b) => b.lift - a.lift)
        .slice(0, 5);
    }

    // Identifier les produits tendance
    identifyTrendingProducts(products, orders) {
        const recentOrders = orders.filter(order => 
            moment(order.createdAt).isAfter(moment().subtract(30, 'days'))
        );

        const recentStats = new Map();

        recentOrders.forEach(order => {
            order.products.forEach(item => {
                const productId = item.product._id.toString();
                if (!recentStats.has(productId)) {
                    recentStats.set(productId, {
                        quantity: 0,
                        revenue: 0
                    });
                }
                const stats = recentStats.get(productId);
                stats.quantity += item.quantity;
                stats.revenue += item.price * item.quantity;
            });
        });

        return products.map(product => {
            const recentSales = recentStats.get(product.product._id.toString()) || { 
                quantity: 0, 
                revenue: 0 
            };
            const avgMonthlyQuantity = product.quantity / (
                moment().diff(moment(orders[0].createdAt), 'months') || 1
            );

            return {
                product: product.product,
                trend: (recentSales.quantity / avgMonthlyQuantity) - 1,
                recentSales: recentSales.quantity,
                averageMonthlySales: avgMonthlyQuantity
            };
        })
        .filter(p => p.trend > 0.2)
        .sort((a, b) => b.trend - a.trend)
        .slice(0, 5);
    }

    // Générer des insights sur les ventes
    async generateSalesInsights(analysis) {
        const insights = [];

        // Insights sur les revenus
        if (analysis.overview) {
            const revenueGrowth = this.calculateGrowthRate(analysis.trends.data, 'revenue');
            if (revenueGrowth > 0.1) {
                insights.push({
                    type: 'positive',
                    category: 'revenue',
                    message: `Croissance du revenu de ${(revenueGrowth * 100).toFixed(1)}% sur la période`,
                    importance: 'high'
                });
            }
        }

        // Insights sur les produits
        if (analysis.products.topProducts.length > 0) {
            const topProduct = analysis.products.topProducts[0];
            insights.push({
                type: 'info',
                category: 'products',
                message: `Le produit le plus vendu est "${topProduct.product.name}" avec ${topProduct.quantity} unités vendues`,
                importance: 'medium'
            });
        }

        // Insights sur la rétention client
        const retentionRates = analysis.customers.retentionAnalysis;
        if (retentionRates['30d'].rate < 20) {
            insights.push({
                type: 'negative',
                category: 'retention',
                message: 'Taux de rétention à 30 jours faible, nécessite une attention particulière',
                importance: 'high'
            });
        }

        // Insights sur les segments clients
        const segments = analysis.customers.segments.distribution;
        if (segments.risk > segments.active) {
            insights.push({
                type: 'warning',
                category: 'customers',
                message: 'Nombre élevé de clients à risque de désengagement',
                importance: 'high'
            });
        }

        return insights;
    }

    // Analyser les performances générales
    async analyzePerformance(startDate, endDate, options = {}) {
        try {
            const performance = {
                orders: await this.analyzeOrderPerformance(startDate, endDate),
                system: await this.analyzeSystemPerformance(startDate, endDate),
                errors: await this.analyzeErrors(startDate, endDate)
            };

            // Calculer les scores de performance
            performance.scores = this.calculatePerformanceScores(performance);

            return performance;
        } catch (error) {
            logger.error('Erreur lors de l\'analyse des performances:', error);
            throw error;
        }
    }

    // Analyser la performance des commandes
    async analyzeOrderPerformance(startDate, endDate) {
        const Order = require('../models/Order');
        const orders = await Order.find({
            createdAt: {
                $gte: startDate,
                $lte: endDate
            }
        });

        const processingTimes = orders.map(order => ({
            total: moment(order.updatedAt).diff(moment(order.createdAt)),
            payment: this.calculatePaymentTime(order),
            processing: this.calculateProcessingTime(order),
            delivery: this.calculateDeliveryTime(order)
        }));

        return {
            averageProcessingTime: this.calculateAverage(
                processingTimes.map(t => t.total)
            ),
            averagePaymentTime: this.calculateAverage(
                processingTimes.map(t => t.payment)
            ),
            averageDeliveryTime: this.calculateAverage(
                processingTimes.map(t => t.delivery)
            ),
            successRate: (orders.filter(o => 
                o.status === 'completed'
            ).length / orders.length) * 100
        };
    }

    // Analyser la performance système
    async analyzeSystemPerformance(startDate, endDate) {
        const metrics = await this.getSystemMetrics(startDate, endDate);

        return {
            responseTime: {
                average: this.calculateAverage(metrics.responseTimes),
                p95: this.calculatePercentile(metrics.responseTimes, 95),
                trend: this.calculateTrend(metrics.responseTimes)
            },
            errors: {
                count: metrics.errors.length,
                rate: (metrics.errors.length / metrics.totalRequests) * 100,
                topErrors: this.getTopErrors(metrics.errors)
            },
            availability: this.calculateAvailability(metrics.downtime)
        };
    }

    // Obtenir les métriques système
    async getSystemMetrics(startDate, endDate) {
        const metrics = await cache.client.hgetall('system_metrics');
        return {
            responseTimes: JSON.parse(metrics.response_times || '[]'),
            errors: JSON.parse(metrics.errors || '[]'),
            totalRequests: parseInt(metrics.total_requests || '0'),
            downtime: JSON.parse(metrics.downtime || '[]')
        };
    }

    // Analyser les erreurs
    async analyzeErrors(startDate, endDate) {
        const ErrorLog = require('../models/ErrorLog');
        const errors = await ErrorLog.find({
            timestamp: {
                $gte: startDate,
                $lte: endDate
            }
        });

        const errorsByType = this.groupBy(errors, 'type');
        const errorTrends = this.analyzeErrorTrends(errors);

        return {
            total: errors.length,
            byType: Object.entries(errorsByType).map(([type, errors]) => ({
                type,
                count: errors.length,
                percentage: (errors.length / errors.length) * 100
            })),
            trends: errorTrends,
            criticalErrors: errors.filter(e => e.severity === 'critical')
        };
    }

    // Calculer les scores de performance
    calculatePerformanceScores(performance) {
        return {
            orderProcessing: this.calculateOrderProcessingScore(performance.orders),
            systemHealth: this.calculateSystemHealthScore(performance.system),
            errorRate: this.calculateErrorScore(performance.errors),
            overall: this.calculateOverallScore(performance)
        };
    }

    // Calculer le score de traitement des commandes
    calculateOrderProcessingScore(orderPerformance) {
        const weights = {
            processingTime: 0.4,
            paymentTime: 0.3,
            deliveryTime: 0.2,
            successRate: 0.1
        };

        const scores = {
            processingTime: this.normalizeScore(
                orderPerformance.averageProcessingTime,
                [0, 86400000], // 0 à 24h en ms
                true
            ),
            paymentTime: this.normalizeScore(
                orderPerformance.averagePaymentTime,
                [0, 3600000], // 0 à 1h en ms
                true
            ),
            deliveryTime: this.normalizeScore(
                orderPerformance.averageDeliveryTime,
                [0, 259200000], // 0 à 3 jours en ms
                true
            ),
            successRate: this.normalizeScore(
                orderPerformance.successRate,
                [0, 100]
            )
        };

        return Object.entries(weights).reduce((total, [key, weight]) => 
            total + (scores[key] * weight), 0
        );
    }

    // Calculer le score de santé système
    calculateSystemHealthScore(systemPerformance) {
        const weights = {
            responseTime: 0.3,
            errorRate: 0.4,
            availability: 0.3
        };

        const scores = {
            responseTime: this.normalizeScore(
                systemPerformance.responseTime.average,
                [0, 1000], // 0 à 1s en ms
                true
            ),
            errorRate: this.normalizeScore(
                systemPerformance.errors.rate,
                [0, 5], // 0 à 5%
                true
            ),
            availability: this.normalizeScore(
                systemPerformance.availability,
                [95, 100] // 95% à 100%
            )
        };

        return Object.entries(weights).reduce((total, [key, weight]) => 
            total + (scores[key] * weight), 0
        );
    }

    // Calculer le score d'erreur
    calculateErrorScore(errors) {
        return this.normalizeScore(
            errors.criticalErrors.length,
            [0, 10],
            true
        );
    }

    // Calculer le score global
    calculateOverallScore(performance) {
        const scores = performance.scores;
        return (
            scores.orderProcessing * 0.4 +
            scores.systemHealth * 0.4 +
            scores.errorRate * 0.2
        );
    }

    // Normaliser un score
    normalizeScore(value, range, inverse = false) {
        const [min, max] = range;
        let normalized = (value - min) / (max - min);
        normalized = Math.max(0, Math.min(1, normalized));
        return inverse ? 1 - normalized : normalized;
    }

    // Utilitaires
    calculateMedian(values) {
        const sorted = values.sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);

        if (sorted.length % 2) {
            return sorted[middle];
        }

        return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    calculatePercentile(values, percentile) {
        const sorted = values.sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[index];
    }

    calculateAverage(values) {
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    calculateGrowth(data) {
        const values = Array.from(data.values());
        const first = values[0];
        const last = values[values.length - 1];
        return {
            absolute: last - first,
            percentage: ((last - first) / first) * 100
        };
    }

    groupBy(array, key) {
        return array.reduce((groups, item) => {
            const value = item[key];
            if (!groups[value]) groups[value] = [];
            groups[value].push(item);
            return groups;
        }, {});
    }

    getDateFormat(timeFrame) {
        switch (timeFrame) {
            case this.timeFrames.HOURLY:
                return 'YYYY-MM-DD HH:00';
            case this.timeFrames.DAILY:
                return 'YYYY-MM-DD';
            case this.timeFrames.WEEKLY:
                return 'YYYY-[W]WW';
            case this.timeFrames.MONTHLY:
                return 'YYYY-MM';
            default:
                return 'YYYY-MM-DD';
        }
    }
}

module.exports = new AnalyticsManager();