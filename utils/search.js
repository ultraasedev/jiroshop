const logger = require('./logger');
const cache = require('./cache');

class SearchManager {
    constructor() {
        this.searchableModels = new Map();
        this.indexedFields = new Map();
        this.searchCache = new Map();
        this.searchTimeout = 1000 * 60 * 5; // 5 minutes
        
        // Options de recherche par défaut
        this.defaultOptions = {
            limit: 10,
            page: 1,
            sort: { score: -1 },
            fuzzy: true,
            highlightFields: true,
            cacheResults: true
        };

        this.initialize();
    }

    // Initialiser le gestionnaire de recherche
    async initialize() {
        try {
            // Configurer les modèles recherchables
            this.registerSearchableModels();
            
            // Créer les index de recherche
            await this.createSearchIndexes();

            logger.info('Gestionnaire de recherche initialisé');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation de la recherche:', error);
        }
    }

    // Enregistrer les modèles recherchables
    registerSearchableModels() {
        // Produits
        this.addSearchableModel('Product', {
            fields: ['name', 'description', 'category'],
            weights: {
                name: 10,
                description: 5,
                category: 3
            },
            populate: ['category'],
            analyzer: this.productAnalyzer
        });

        // Commandes
        this.addSearchableModel('Order', {
            fields: ['orderNumber', 'status', 'user.username'],
            weights: {
                orderNumber: 10,
                'user.username': 5,
                status: 3
            },
            populate: ['user', 'products.product']
        });

        // Utilisateurs
        this.addSearchableModel('User', {
            fields: ['username', 'profile.firstName', 'profile.lastName', 'profile.email'],
            weights: {
                username: 10,
                'profile.email': 8,
                'profile.firstName': 5,
                'profile.lastName': 5
            }
        });
    }

    // Ajouter un modèle recherchable
    addSearchableModel(modelName, options) {
        this.searchableModels.set(modelName, {
            ...options,
            analyzer: options.analyzer || this.defaultAnalyzer
        });

        // Indexer les champs
        options.fields.forEach(field => {
            if (!this.indexedFields.has(modelName)) {
                this.indexedFields.set(modelName, new Set());
            }
            this.indexedFields.get(modelName).add(field);
        });
    }

    // Créer les index de recherche
    async createSearchIndexes() {
        try {
            for (const [modelName, options] of this.searchableModels.entries()) {
                const Model = require(`../models/${modelName}`);
                
                // Créer les index textuels
                const textIndexFields = {};
                options.fields.forEach(field => {
                    textIndexFields[field] = options.weights[field] || 1;
                });

                await Model.collection.createIndex(
                    textIndexFields,
                    {
                        weights: options.weights,
                        name: `${modelName.toLowerCase()}_search_index`
                    }
                );

                logger.info(`Index créé pour ${modelName}`);
            }
        } catch (error) {
            logger.error('Erreur lors de la création des index:', error);
        }
    }

    // Rechercher
    async search(modelName, query, options = {}) {
        try {
            // Vérifier si le modèle est recherchable
            if (!this.searchableModels.has(modelName)) {
                throw new Error(`Modèle ${modelName} non recherchable`);
            }

            // Fusionner les options avec les options par défaut
            const searchOptions = {
                ...this.defaultOptions,
                ...options
            };

            // Vérifier le cache
            const cacheKey = this.generateCacheKey(modelName, query, searchOptions);
            if (searchOptions.cacheResults) {
                const cached = await this.getFromCache(cacheKey);
                if (cached) return cached;
            }

            // Préparer la requête
            const searchQuery = await this.prepareSearchQuery(modelName, query, searchOptions);

            // Exécuter la recherche
            const results = await this.executeSearch(modelName, searchQuery, searchOptions);

            // Mettre en cache les résultats
            if (searchOptions.cacheResults) {
                await this.cacheResults(cacheKey, results);
            }

            return results;
        } catch (error) {
            logger.error('Erreur lors de la recherche:', error);
            throw error;
        }
    }

    // Préparer la requête de recherche
    async prepareSearchQuery(modelName, query, options) {
        const modelOptions = this.searchableModels.get(modelName);
        const analyzedQuery = await modelOptions.analyzer(query);

        const searchQuery = {
            $text: {
                $search: analyzedQuery,
                $caseSensitive: false,
                $diacriticSensitive: false
            }
        };

        // Ajouter les filtres supplémentaires
        if (options.filters) {
            Object.assign(searchQuery, options.filters);
        }

        return searchQuery;
    }

    // Exécuter la recherche
    async executeSearch(modelName, searchQuery, options) {
        const Model = require(`../models/${modelName}`);
        const modelOptions = this.searchableModels.get(modelName);

        // Calculer le skip pour la pagination
        const skip = (options.page - 1) * options.limit;

        // Préparer l'agrégation
        const aggregation = [
            { $match: searchQuery },
            {
                $addFields: {
                    score: { $meta: "textScore" }
                }
            }
        ];

        // Ajouter les populations si nécessaire
        if (modelOptions.populate) {
            modelOptions.populate.forEach(field => {
                aggregation.push({ $lookup: this.createLookup(field) });
            });
        }

        // Ajouter le tri
        if (options.sort) {
            aggregation.push({ $sort: options.sort });
        }

        // Ajouter la pagination
        aggregation.push(
            { $skip: skip },
            { $limit: options.limit }
        );

        // Exécuter l'agrégation
        const results = await Model.aggregate(aggregation);

        // Calculer le total
        const total = await Model.countDocuments(searchQuery);

        // Mettre en évidence les champs si demandé
        if (options.highlightFields) {
            this.highlightResults(results, query, modelOptions.fields);
        }

        return {
            results,
            total,
            page: options.page,
            totalPages: Math.ceil(total / options.limit),
            hasMore: skip + results.length < total
        };
    }

    // Créer un lookup pour la population
    createLookup(field) {
        const [localField, foreignField = '_id'] = field.split(':');
        const foreignModel = field.split('.')[0];

        return {
            from: foreignModel.toLowerCase() + 's',
            localField: localField,
            foreignField: foreignField,
            as: localField
        };
    }

    // Mettre en évidence les résultats
    highlightResults(results, query, fields) {
        const terms = query.split(/\s+/);
        const regex = new RegExp(`(${terms.join('|')})`, 'gi');

        results.forEach(result => {
            fields.forEach(field => {
                const value = this.getNestedValue(result, field);
                if (typeof value === 'string') {
                    const highlighted = value.replace(
                        regex,
                        '<span class="highlight">$1</span>'
                    );
                    this.setNestedValue(result, `${field}_highlighted`, highlighted);
                }
            });
        });
    }

    // Analyser par défaut
    async defaultAnalyzer(query) {
        // Nettoyer la requête
        query = query.trim().toLowerCase();

        // Remplacer les caractères spéciaux
        query = query.replace(/[^\w\s]/g, ' ');

        // Supprimer les mots vides
        const stopWords = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du']);
        query = query.split(/\s+/)
            .filter(word => !stopWords.has(word))
            .join(' ');

        return query;
    }

    // Analyser les produits
    async productAnalyzer(query) {
        // Utiliser l'analyseur par défaut
        query = await this.defaultAnalyzer(query);

        // Ajouter la gestion des synonymes
        const synonyms = {
            'pc': 'ordinateur',
            'laptop': 'portable',
            'phone': 'téléphone',
            // Ajouter d'autres synonymes selon les besoins
        };

        // Remplacer les synonymes
        Object.entries(synonyms).forEach(([word, synonym]) => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            query = query.replace(regex, `${word} ${synonym}`);
        });

        return query;
    }

    // Gérer le cache
    generateCacheKey(modelName, query, options) {
        const key = `search:${modelName}:${query}:${JSON.stringify(options)}`;
        return crypto.createHash('md5').update(key).digest('hex');
    }

    // Obtenir du cache
    async getFromCache(key) {
        try {
            const cached = await cache.get(`search:${key}`);
            if (cached) {
                logger.debug('Résultats trouvés dans le cache:', key);
                return JSON.parse(cached);
            }
            return null;
        } catch (error) {
            logger.error('Erreur lors de la lecture du cache:', error);
            return null;
        }
    }

    // Mettre en cache
    async cacheResults(key, results) {
        try {
            await cache.set(
                `search:${key}`,
                JSON.stringify(results),
                this.searchTimeout
            );
        } catch (error) {
            logger.error('Erreur lors de la mise en cache:', error);
        }
    }

    // Nettoyer le cache
    async clearCache(modelName = null) {
        try {
            if (modelName) {
                const pattern = `search:${modelName}:*`;
                const keys = await cache.client.keys(pattern);
                if (keys.length > 0) {
                    await cache.client.del(...keys);
                }
            } else {
                const keys = await cache.client.keys('search:*');
                if (keys.length > 0) {
                    await cache.client.del(...keys);
                }
            }
            logger.info('Cache de recherche nettoyé');
        } catch (error) {
            logger.error('Erreur lors du nettoyage du cache:', error);
        }
    }

    // Utilitaires
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => 
            current ? current[key] : undefined, obj
        );
    }

    setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => {
            if (!(key in current)) current[key] = {};
            return current[key];
        }, obj);
        target[lastKey] = value;
    }
}

module.exports = new SearchManager();