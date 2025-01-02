const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');
const config = require('./config');
const events = require('events');

class PluginManager extends events.EventEmitter {
    constructor() {
        super();
        this.plugins = new Map();
        this.hooks = new Map();
        this.pluginsDir = path.join(__dirname, '../plugins');
        this.pluginConfigs = new Map();
        this.enabled = config.get('plugins.enabled', true);
    }

    // Initialiser le gestionnaire de plugins
    async initialize() {
        try {
            if (!this.enabled) {
                logger.info('Le système de plugins est désactivé');
                return;
            }

            // Créer le dossier des plugins s'il n'existe pas
            await this.ensurePluginsDirectory();

            // Charger les configurations des plugins
            await this.loadPluginConfigs();

            // Charger les plugins
            await this.loadPlugins();

            logger.info(`${this.plugins.size} plugins chargés`);
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation des plugins:', error);
            throw error;
        }
    }

    // S'assurer que le dossier des plugins existe
    async ensurePluginsDirectory() {
        try {
            await fs.access(this.pluginsDir);
        } catch {
            await fs.mkdir(this.pluginsDir, { recursive: true });
            logger.info('Dossier des plugins créé');
        }
    }

    // Charger les configurations des plugins
    async loadPluginConfigs() {
        try {
            const configPath = path.join(this.pluginsDir, 'config.json');
            try {
                const configData = await fs.readFile(configPath, 'utf8');
                const configs = JSON.parse(configData);
                Object.entries(configs).forEach(([name, config]) => {
                    this.pluginConfigs.set(name, config);
                });
            } catch (e) {
                // Créer un fichier de configuration par défaut
                await fs.writeFile(configPath, JSON.stringify({}, null, 2));
            }
        } catch (error) {
            logger.error('Erreur lors du chargement des configurations des plugins:', error);
        }
    }

    // Charger tous les plugins
    async loadPlugins() {
        try {
            const files = await fs.readdir(this.pluginsDir);
            
            for (const file of files) {
                if (file.endsWith('.js')) {
                    await this.loadPlugin(path.join(this.pluginsDir, file));
                }
            }
        } catch (error) {
            logger.error('Erreur lors du chargement des plugins:', error);
            throw error;
        }
    }

    // Charger un plugin spécifique
    async loadPlugin(pluginPath) {
        try {
            // Charger le module du plugin
            const plugin = require(pluginPath);
            const pluginName = path.basename(pluginPath, '.js');

            // Vérifier la validité du plugin
            if (!this.validatePlugin(plugin)) {
                throw new Error(`Plugin invalide: ${pluginName}`);
            }

            // Obtenir la configuration du plugin
            const pluginConfig = this.pluginConfigs.get(pluginName) || {};

            // Initialiser le plugin
            if (typeof plugin.initialize === 'function') {
                await plugin.initialize(pluginConfig);
            }

            // Enregistrer les hooks du plugin
            if (plugin.hooks) {
                this.registerHooks(pluginName, plugin.hooks);
            }

            // Stocker le plugin
            this.plugins.set(pluginName, plugin);

            logger.info(`Plugin chargé: ${pluginName}`);
        } catch (error) {
            logger.error(`Erreur lors du chargement du plugin: ${pluginPath}`, error);
        }
    }

    // Valider un plugin
    validatePlugin(plugin) {
        // Vérifier les propriétés requises
        const requiredProps = ['name', 'version', 'description'];
        return requiredProps.every(prop => plugin[prop]);
    }

    // Enregistrer les hooks d'un plugin
    registerHooks(pluginName, hooks) {
        Object.entries(hooks).forEach(([event, handler]) => {
            if (!this.hooks.has(event)) {
                this.hooks.set(event, new Map());
            }
            this.hooks.get(event).set(pluginName, handler);
        });
    }

    // Exécuter un hook
    async executeHook(event, ...args) {
        if (!this.hooks.has(event)) return;

        const handlers = this.hooks.get(event);
        const results = [];

        for (const [pluginName, handler] of handlers) {
            try {
                const result = await handler(...args);
                results.push({ pluginName, result });
            } catch (error) {
                logger.error(`Erreur lors de l'exécution du hook ${event} du plugin ${pluginName}:`, error);
            }
        }

        return results;
    }

    // Désactiver un plugin
    async disablePlugin(pluginName) {
        try {
            const plugin = this.plugins.get(pluginName);
            if (!plugin) {
                throw new Error(`Plugin non trouvé: ${pluginName}`);
            }

            // Exécuter la méthode de désactivation si elle existe
            if (typeof plugin.disable === 'function') {
                await plugin.disable();
            }

            // Retirer les hooks du plugin
            for (const hookMap of this.hooks.values()) {
                hookMap.delete(pluginName);
            }

            // Retirer le plugin
            this.plugins.delete(pluginName);

            // Mettre à jour la configuration
            const config = this.pluginConfigs.get(pluginName) || {};
            config.enabled = false;
            await this.savePluginConfigs();

            logger.info(`Plugin désactivé: ${pluginName}`);
            return true;
        } catch (error) {
            logger.error(`Erreur lors de la désactivation du plugin ${pluginName}:`, error);
            return false;
        }
    }

    // Activer un plugin
    async enablePlugin(pluginName) {
        try {
            if (this.plugins.has(pluginName)) {
                return false; // Déjà activé
            }

            const pluginPath = path.join(this.pluginsDir, `${pluginName}.js`);
            await this.loadPlugin(pluginPath);

            // Mettre à jour la configuration
            const config = this.pluginConfigs.get(pluginName) || {};
            config.enabled = true;
            await this.savePluginConfigs();

            logger.info(`Plugin activé: ${pluginName}`);
            return true;
        } catch (error) {
            logger.error(`Erreur lors de l'activation du plugin ${pluginName}:`, error);
            return false;
        }
    }

    // Sauvegarder les configurations des plugins
    async savePluginConfigs() {
        try {
            const configPath = path.join(this.pluginsDir, 'config.json');
            const configs = Object.fromEntries(this.pluginConfigs);
            await fs.writeFile(configPath, JSON.stringify(configs, null, 2));
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde des configurations des plugins:', error);
        }
    }

    // Recharger un plugin
    async reloadPlugin(pluginName) {
        try {
            // Désactiver le plugin
            await this.disablePlugin(pluginName);

            // Nettoyer le cache
            const pluginPath = path.join(this.pluginsDir, `${pluginName}.js`);
            delete require.cache[require.resolve(pluginPath)];

            // Réactiver le plugin
            await this.enablePlugin(pluginName);

            logger.info(`Plugin rechargé: ${pluginName}`);
            return true;
        } catch (error) {
            logger.error(`Erreur lors du rechargement du plugin ${pluginName}:`, error);
            return false;
        }
    }

    // Obtenir la configuration d'un plugin
    getPluginConfig(pluginName) {
        return this.pluginConfigs.get(pluginName) || {};
    }

    // Mettre à jour la configuration d'un plugin
    async updatePluginConfig(pluginName, config) {
        try {
            this.pluginConfigs.set(pluginName, {
                ...this.getPluginConfig(pluginName),
                ...config
            });

            await this.savePluginConfigs();

            // Recharger le plugin si nécessaire
            const plugin = this.plugins.get(pluginName);
            if (plugin && typeof plugin.onConfigUpdate === 'function') {
                await plugin.onConfigUpdate(this.getPluginConfig(pluginName));
            }

            return true;
        } catch (error) {
            logger.error(`Erreur lors de la mise à jour de la configuration du plugin ${pluginName}:`, error);
            return false;
        }
    }

    // Obtenir les infos d'un plugin
    getPluginInfo(pluginName) {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) return null;

        return {
            name: plugin.name,
            version: plugin.version,
            description: plugin.description,
            author: plugin.author,
            enabled: true,
            config: this.getPluginConfig(pluginName),
            hooks: Array.from(this.hooks.entries())
                .filter(([, handlers]) => handlers.has(pluginName))
                .map(([event]) => event)
        };
    }

    // Obtenir la liste de tous les plugins
    listPlugins() {
        return Array.from(this.plugins.keys()).map(name => this.getPluginInfo(name));
    }

    // Vérifier si un plugin est chargé
    hasPlugin(pluginName) {
        return this.plugins.has(pluginName);
    }

    // Obtenir une instance de plugin
    getPlugin(pluginName) {
        return this.plugins.get(pluginName);
    }
}

module.exports = new PluginManager();