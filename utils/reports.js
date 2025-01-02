const fs = require('fs').promises;
const path = require('path');
const moment = require('moment');
const logger = require('./logger');
const metrics = require('./metrics');
const config = require('./config');

class ReportManager {
    constructor() {
        this.reportsDir = path.join(__dirname, '../reports');
        this.templatesDir = path.join(__dirname, '../templates/reports');
        // Types de rapports disponibles
        this.reportTypes = {
            DAILY: 'daily',
            WEEKLY: 'weekly',
            MONTHLY: 'monthly',
            CUSTOM: 'custom'
        };

        // Formats de sortie supportés
        this.outputFormats = {
            JSON: 'json',
            CSV: 'csv',
            PDF: 'pdf',
            HTML: 'html'
        };

        this.initialize();
    }

    // Initialiser le gestionnaire de rapports
    async initialize() {
        try {
            await this.ensureDirectories();
            await this.loadTemplates();
            logger.info('Gestionnaire de rapports initialisé');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation du gestionnaire de rapports:', error);
        }
    }

    // Assurer l'existence des dossiers nécessaires
    async ensureDirectories() {
        try {
            await fs.mkdir(this.reportsDir, { recursive: true });
            await fs.mkdir(this.templatesDir, { recursive: true });
        } catch (error) {
            logger.error('Erreur lors de la création des dossiers:', error);
            throw error;
        }
    }

    // Charger les templates de rapports
    async loadTemplates() {
        try {
            this.templates = new Map();
            const files = await fs.readdir(this.templatesDir);

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const content = await fs.readFile(
                        path.join(this.templatesDir, file),
                        'utf8'
                    );
                    const template = JSON.parse(content);
                    this.templates.set(template.name, template);
                }
            }

            logger.info(`${this.templates.size} templates de rapports chargés`);
        } catch (error) {
            logger.error('Erreur lors du chargement des templates:', error);
        }
    }

    // Générer un rapport
    async generateReport(options) {
        try {
            const {
                type = this.reportTypes.DAILY,
                template,
                startDate = moment().startOf('day'),
                endDate = moment().endOf('day'),
                format = this.outputFormats.JSON,
                filters = {}
            } = options;

            // Valider les options
            this.validateReportOptions(options);

            // Collecter les données
            const data = await this.collectData(type, startDate, endDate, filters);

            // Appliquer le template
            const reportContent = await this.applyTemplate(template, data);

            // Formater la sortie
            const formattedReport = await this.formatReport(reportContent, format);

            // Sauvegarder le rapport
            const reportPath = await this.saveReport(formattedReport, type, format);

            return {
                path: reportPath,
                type,
                format,
                startDate,
                endDate,
                generatedAt: new Date()
            };
        } catch (error) {
            logger.error('Erreur lors de la génération du rapport:', error);
            throw error;
        }
    }

    // Valider les options du rapport
    validateReportOptions(options) {
        const errors = [];

        if (!Object.values(this.reportTypes).includes(options.type)) {
            errors.push(`Type de rapport invalide: ${options.type}`);
        }

        if (options.template && !this.templates.has(options.template)) {
            errors.push(`Template non trouvé: ${options.template}`);
        }

        if (!Object.values(this.outputFormats).includes(options.format)) {
            errors.push(`Format de sortie invalide: ${options.format}`);
        }

        if (errors.length > 0) {
            throw new Error(`Options invalides: ${errors.join(', ')}`);
        }
    }

    // Collecter les données pour le rapport
    async collectData(type, startDate, endDate, filters = {}) {
        try {
            const data = {
                orders: await this.collectOrderData(startDate, endDate, filters),
                users: await this.collectUserData(startDate, endDate, filters),
                products: await this.collectProductData(startDate, endDate, filters),
                payments: await this.collectPaymentData(startDate, endDate, filters),
                metrics: await this.collectMetricsData(startDate, endDate, filters)
            };

            return {
                ...data,
                summary: this.generateSummary(data),
                metadata: {
                    type,
                    startDate,
                    endDate,
                    filters,
                    generatedAt: new Date()
                }
            };
        } catch (error) {
            logger.error('Erreur lors de la collecte des données:', error);
            throw error;
        }
    }

    // Collecter les données des commandes
    async collectOrderData(startDate, endDate, filters) {
        const Order = require('../models/Order');
        const query = {
            createdAt: {
                $gte: startDate.toDate(),
                $lte: endDate.toDate()
            }
        };

        if (filters.status) query.status = filters.status;

        const orders = await Order.find(query);

        return {
            total: orders.length,
            totalAmount: orders.reduce((sum, order) => sum + order.payment.amount.total, 0),
            byStatus: this.groupBy(orders, 'status'),
            byPaymentMethod: this.groupBy(orders, 'payment.method'),
            hourlyDistribution: this.getHourlyDistribution(orders, 'createdAt')
        };
    }

    // Collecter les données utilisateurs
    async collectUserData(startDate, endDate, filters) {
        const User = require('../models/User');
        const query = {
            createdAt: {
                $gte: startDate.toDate(),
                $lte: endDate.toDate()
            }
        };

        if (filters.status) query.status = filters.status;

        const users = await User.find(query);

        return {
            total: users.length,
            newUsers: users.filter(u => u.createdAt >= startDate).length,
            activeUsers: users.filter(u => u.lastActivity >= startDate).length,
            byStatus: this.groupBy(users, 'status'),
            retention: await this.calculateRetention(startDate, endDate)
        };
    }

    // Collecter les données des produits
    async collectProductData(startDate, endDate, filters) {
        const Product = require('../models/Product');
        const Order = require('../models/Order');

        // Obtenir les produits vendus dans la période
        const orders = await Order.find({
            createdAt: {
                $gte: startDate.toDate(),
                $lte: endDate.toDate()
            }
        }).populate('products.product');

        const productSales = new Map();
        orders.forEach(order => {
            order.products.forEach(item => {
                const productId = item.product._id.toString();
                if (!productSales.has(productId)) {
                    productSales.set(productId, {
                        product: item.product,
                        quantity: 0,
                        revenue: 0
                    });
                }
                const stats = productSales.get(productId);
                stats.quantity += item.quantity;
                stats.revenue += item.price * item.quantity;
            });
        });

        return {
            totalSales: Array.from(productSales.values())
                .reduce((sum, stat) => sum + stat.quantity, 0),
            totalRevenue: Array.from(productSales.values())
                .reduce((sum, stat) => sum + stat.revenue, 0),
            topProducts: Array.from(productSales.values())
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, 10)
        };
    }

    // Collecter les données des paiements
    async collectPaymentData(startDate, endDate, filters) {
        const Transaction = require('../models/Transaction');
        const query = {
            createdAt: {
                $gte: startDate.toDate(),
                $lte: endDate.toDate()
            }
        };

        if (filters.status) query.status = filters.status;

        const transactions = await Transaction.find(query);

        return {
            total: transactions.length,
            totalAmount: transactions.reduce((sum, tx) => sum + tx.amount.total, 0),
            byStatus: this.groupBy(transactions, 'status'),
            byMethod: this.groupBy(transactions, 'paymentMethod'),
            successRate: this.calculateSuccessRate(transactions)
        };
    }

    // Collecter les données des métriques
    async collectMetricsData(startDate, endDate, filters) {
        return {
            performance: await metrics.getMetricHistory('performance', startDate, endDate),
            errors: await metrics.getMetricHistory('errors', startDate, endDate),
            userActivity: await metrics.getMetricHistory('userActivity', startDate, endDate)
        };
    }

    // Générer un résumé des données
    generateSummary(data) {
        return {
            orderCount: data.orders.total,
            totalRevenue: data.orders.totalAmount,
            averageOrderValue: data.orders.total ? 
                data.orders.totalAmount / data.orders.total : 0,
            newUsers: data.users.newUsers,
            activeUsers: data.users.activeUsers,
            topSellingProduct: data.products.topProducts[0],
            paymentSuccessRate: data.payments.successRate
        };
    }

    // Appliquer un template au rapport
    async applyTemplate(templateName, data) {
        try {
            if (!templateName) return data;

            const template = this.templates.get(templateName);
            if (!template) {
                throw new Error(`Template non trouvé: ${templateName}`);
            }

            // Appliquer les transformations du template
            let report = { ...data };
            for (const transform of template.transforms) {
                report = await this.applyTransformation(transform, report);
            }

            // Appliquer la structure du template
            return this.structureData(report, template.structure);
        } catch (error) {
            logger.error('Erreur lors de l\'application du template:', error);
            throw error;
        }
    }

    // Appliquer une transformation aux données
    async applyTransformation(transform, data) {
        const transformations = {
            filter: (data, config) => this.filterData(data, config),
            sort: (data, config) => this.sortData(data, config),
            group: (data, config) => this.groupData(data, config),
            aggregate: (data, config) => this.aggregateData(data, config)
        };

        if (!transformations[transform.type]) {
            throw new Error(`Type de transformation invalide: ${transform.type}`);
        }

        return transformations[transform.type](data, transform.config);
    }

    // Structurer les données selon le template
    structureData(data, structure) {
        const structured = {};

        for (const [key, config] of Object.entries(structure)) {
            if (typeof config === 'string') {
                // Chemin simple
                structured[key] = this.getNestedValue(data, config);
            } else if (config.type === 'calculation') {
                // Calcul personnalisé
                structured[key] = this.calculateValue(data, config.formula);
            } else if (config.type === 'conditional') {
                // Valeur conditionnelle
                structured[key] = this.evaluateCondition(data, config.conditions);
            }
        }

        return structured;
    }

    // Formater le rapport dans le format demandé
    async formatReport(data, format) {
        const formatters = {
            [this.outputFormats.JSON]: data => JSON.stringify(data, null, 2),
            [this.outputFormats.CSV]: data => this.convertToCSV(data),
            [this.outputFormats.PDF]: data => this.generatePDF(data),
            [this.outputFormats.HTML]: data => this.generateHTML(data)
        };

        if (!formatters[format]) {
            throw new Error(`Format non supporté: ${format}`);
        }

        return formatters[format](data);
    }

    // Convertir les données en CSV
    convertToCSV(data) {
        const flatten = (obj, prefix = '') => {
            let result = {};
            for (const [key, value] of Object.entries(obj)) {
                const newKey = prefix ? `${prefix}.${key}` : key;
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    Object.assign(result, flatten(value, newKey));
                } else {
                    result[newKey] = value;
                }
            }
            return result;
        };

        const flatData = Array.isArray(data) ? 
            data.map(item => flatten(item)) : 
            [flatten(data)];

        const headers = Object.keys(flatData[0]);
        const rows = flatData.map(item => 
            headers.map(header => 
                JSON.stringify(item[header] || '')
            ).join(',')
        );

        return [headers.join(','), ...rows].join('\n');
    }

    // Générer un PDF
    async generatePDF(data) {
        try {
            const puppeteer = require('puppeteer');
            const html = this.generateHTML(data);

            const browser = await puppeteer.launch();
            const page = await browser.newPage();
            await page.setContent(html);
            
            const pdf = await page.pdf({
                format: 'A4',
                margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
            });

            await browser.close();
            return pdf;
        } catch (error) {
            logger.error('Erreur lors de la génération du PDF:', error);
            throw error;
        }
    }

    // Générer du HTML
    generateHTML(data) {
        const template = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Rapport ${moment().format('YYYY-MM-DD')}</title>
                <style>
                    body { font-family: Arial, sans-serif; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { padding: 8px; border: 1px solid #ddd; }
                    th { background-color: #f5f5f5; }
                    .header { margin-bottom: 20px; }
                    .summary { margin: 20px 0; }
                    .chart { margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Rapport ${data.metadata.type}</h1>
                    <p>Période: ${moment(data.metadata.startDate).format('L')} - ${moment(data.metadata.endDate).format('L')}</p>
                </div>
                <div class="summary">
                    <h2>Résumé</h2>
                    ${this.generateHTMLSummary(data.summary)}
                </div>
                <div class="details">
                    ${this.generateHTMLSections(data)}
                </div>
                <div class="footer">
                    <p>Généré le ${moment().format('LLLL')}</p>
                </div>
            </body>
            </html>
        `;

        return template;
    }

    // Générer le HTML du résumé
    generateHTMLSummary(summary) {
        return `
            <table>
                <tr>
                    <th>Métrique</th>
                    <th>Valeur</th>
                </tr>
                ${Object.entries(summary).map(([key, value]) => `
                    <tr>
                        <td>${this.formatKey(key)}</td>
                        <td>${this.formatValue(value)}</td>
                    </tr>
                `).join('')}
            </table>
        `;
    }

    // Générer le HTML des sections
    generateHTMLSections(data) {
        const sections = ['orders', 'users', 'products', 'payments', 'metrics'];
        
        return sections.map(section => {
            if (!data[section]) return '';

            return `
                <div class="section">
                    <h2>${this.formatKey(section)}</h2>
                    ${this.generateHTMLSection(data[section], section)}
                </div>
            `;
        }).join('');
    }

    // Générer le HTML d'une section
    generateHTMLSection(sectionData, sectionType) {
        if (typeof sectionData !== 'object') {
            return `<p>${this.formatValue(sectionData)}</p>`;
        }

        // Gérer différents types de sections
        switch (sectionType) {
            case 'orders':
                return this.generateOrdersSection(sectionData);
            case 'users':
                return this.generateUsersSection(sectionData);
            case 'products':
                return this.generateProductsSection(sectionData);
            case 'payments':
                return this.generatePaymentsSection(sectionData);
            case 'metrics':
                return this.generateMetricsSection(sectionData);
            default:
                return this.generateDefaultSection(sectionData);
        }
    }

    // Sauvegarder le rapport
    async saveReport(content, type, format) {
        try {
            const timestamp = moment().format('YYYY-MM-DD-HHmmss');
            const fileName = `report_${type}_${timestamp}.${format}`;
            const filePath = path.join(this.reportsDir, fileName);

            if (format === this.outputFormats.PDF) {
                await fs.writeFile(filePath, content);
            } else {
                await fs.writeFile(filePath, content, 'utf8');
            }

            logger.info(`Rapport sauvegardé: ${fileName}`);
            return filePath;
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde du rapport:', error);
            throw error;
        }
    }

    // Utilités
    groupBy(array, key) {
        return array.reduce((groups, item) => {
            const value = this.getNestedValue(item, key);
            if (!groups[value]) groups[value] = [];
            groups[value].push(item);
            return groups;
        }, {});
    }

    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => 
            current ? current[key] : undefined, obj);
    }

    getHourlyDistribution(array, dateField) {
        const distribution = new Array(24).fill(0);
        array.forEach(item => {
            const hour = moment(item[dateField]).hour();
            distribution[hour]++;
        });
        return distribution;
    }

    calculateSuccessRate(transactions) {
        const total = transactions.length;
        if (total === 0) return 0;
        
        const successful = transactions.filter(tx => 
            tx.status === 'completed'
        ).length;
        
        return (successful / total) * 100;
    }

    async calculateRetention(startDate, endDate) {
        const User = require('../models/User');
        const Order = require('../models/Order');

        // Calculer la rétention sur différentes périodes
        const periods = {
            '7d': moment(endDate).subtract(7, 'days'),
            '30d': moment(endDate).subtract(30, 'days'),
            '90d': moment(endDate).subtract(90, 'days')
        };

        const retention = {};
        
        for (const [period, date] of Object.entries(periods)) {
            const users = await User.find({
                createdAt: { $lte: date.toDate() }
            });

            const activeUsers = await Order.distinct('user.id', {
                createdAt: {
                    $gte: date.toDate(),
                    $lte: endDate.toDate()
                }
            });

            retention[period] = users.length ? 
                (activeUsers.length / users.length) * 100 : 0;
        }

        return retention;
    }

    formatKey(key) {
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .replace(/_/g, ' ');
    }

    formatValue(value) {
        if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                return value.toLocaleString();
            }
            return value.toFixed(2);
        }
        if (value instanceof Date) {
            return moment(value).format('L LT');
        }
        return value;
    }

    // Nettoyage des anciens rapports
    async cleanupOldReports(maxAge = 30) {
        try {
            const files = await fs.readdir(this.reportsDir);
            const now = moment();
            let cleaned = 0;

            for (const file of files) {
                const filePath = path.join(this.reportsDir, file);
                const stats = await fs.stat(filePath);
                const fileAge = moment().diff(moment(stats.mtime), 'days');

                if (fileAge > maxAge) {
                    await fs.unlink(filePath);
                    cleaned++;
                }
            }

            logger.info(`${cleaned} anciens rapports nettoyés`);
            return cleaned;
        } catch (error) {
            logger.error('Erreur lors du nettoyage des rapports:', error);
            throw error;
        }
    }

    // Planifier des rapports automatiques
    scheduleReports(config) {
        const schedule = require('node-schedule');

        for (const reportConfig of config) {
            schedule.scheduleJob(reportConfig.schedule, async () => {
                try {
                    await this.generateReport(reportConfig);
                    logger.info(`Rapport automatique généré: ${reportConfig.type}`);
                } catch (error) {
                    logger.error('Erreur lors de la génération du rapport automatique:', error);
                }
            });
        }
    }
}

module.exports = new ReportManager();