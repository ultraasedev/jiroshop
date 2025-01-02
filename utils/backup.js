const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');
const logger = require('./logger');
const config = require('./config');
const mongoose = require('mongoose');

class BackupManager {
    constructor() {
        this.backupDir = path.join(__dirname, '../backups');
        this.tempDir = path.join(__dirname, '../temp');
        this.maxBackups = config.get('backup.maxBackups', 10);
        this.compression = config.get('backup.compression', 'zip');
        this.retentionDays = config.get('backup.retentionDays', 30);

        this.initialize();
    }

    // Initialiser le gestionnaire de sauvegardes
    async initialize() {
        try {
            await this.ensureDirectories();
            logger.info('Gestionnaire de sauvegardes initialisé');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation des sauvegardes:', error);
        }
    }

    // S'assurer que les dossiers nécessaires existent
    async ensureDirectories() {
        try {
            await fs.mkdir(this.backupDir, { recursive: true });
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            logger.error('Erreur lors de la création des dossiers:', error);
            throw error;
        }
    }

    // Créer une sauvegarde complète
    async createBackup(options = {}) {
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const backupPath = path.join(this.backupDir, `backup-${timestamp}`);

        try {
            // Créer le dossier de sauvegarde
            await fs.mkdir(backupPath);

            // Sauvegarder la base de données
            await this.backupDatabase(backupPath);

            // Sauvegarder les fichiers si demandé
            if (options.includeFiles) {
                await this.backupFiles(backupPath);
            }

            // Sauvegarder la configuration
            await this.backupConfig(backupPath);

            // Créer l'archive
            const archivePath = await this.createArchive(backupPath);

            // Nettoyer le dossier temporaire
            await this.cleanupTempFiles(backupPath);

            // Nettoyer les anciennes sauvegardes
            await this.cleanupOldBackups();

            logger.info('Sauvegarde créée avec succès:', archivePath);
            return archivePath;
        } catch (error) {
            logger.error('Erreur lors de la création de la sauvegarde:', error);
            await this.cleanupTempFiles(backupPath);
            throw error;
        }
    }

    // Sauvegarder la base de données
    async backupDatabase(backupPath) {
        try {
            const collections = await mongoose.connection.db.listCollections().toArray();
            const dbBackupPath = path.join(backupPath, 'database');
            await fs.mkdir(dbBackupPath);

            for (const collection of collections) {
                const data = await mongoose.connection.db
                    .collection(collection.name)
                    .find({})
                    .toArray();

                await fs.writeFile(
                    path.join(dbBackupPath, `${collection.name}.json`),
                    JSON.stringify(data, null, 2)
                );
            }

            logger.info('Base de données sauvegardée');
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde de la base de données:', error);
            throw error;
        }
    }

    // Sauvegarder les fichiers
    async backupFiles(backupPath) {
        try {
            const uploadsDir = path.join(__dirname, '../uploads');
            const filesBackupPath = path.join(backupPath, 'files');
            
            await this.copyDirectory(uploadsDir, filesBackupPath);
            logger.info('Fichiers sauvegardés');
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde des fichiers:', error);
            throw error;
        }
    }

    // Sauvegarder la configuration
    async backupConfig(backupPath) {
        try {
            const configData = {
                app: config.getAll(),
                timestamp: new Date(),
                version: process.env.npm_package_version
            };

            await fs.writeFile(
                path.join(backupPath, 'config.json'),
                JSON.stringify(configData, null, 2)
            );

            logger.info('Configuration sauvegardée');
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde de la configuration:', error);
            throw error;
        }
    }

    // Créer une archive de la sauvegarde
    async createArchive(sourcePath) {
        return new Promise((resolve, reject) => {
            const archivePath = `${sourcePath}.${this.compression}`;
            const output = fs.createWriteStream(archivePath);
            const archive = archiver(this.compression, {
                zlib: { level: 9 }
            });

            output.on('close', () => {
                logger.info(`Archive créée: ${archive.pointer()} bytes`);
                resolve(archivePath);
            });

            archive.on('error', (error) => {
                logger.error('Erreur lors de la création de l\'archive:', error);
                reject(error);
            });

            archive.pipe(output);
            archive.directory(sourcePath, false);
            archive.finalize();
        });
    }

    // Restaurer une sauvegarde
    async restore(backupPath, options = {}) {
        const restorePath = path.join(this.tempDir, 'restore-' + Date.now());

        try {
            // Extraire l'archive
            await this.extractArchive(backupPath, restorePath);

            // Valider la structure de la sauvegarde
            await this.validateBackup(restorePath);

            // Restaurer la base de données
            if (!options.skipDatabase) {
                await this.restoreDatabase(restorePath);
            }

            // Restaurer les fichiers
            if (!options.skipFiles && await this.directoryExists(path.join(restorePath, 'files'))) {
                await this.restoreFiles(restorePath);
            }

            // Restaurer la configuration
            if (!options.skipConfig) {
                await this.restoreConfig(restorePath);
            }

            logger.info('Restauration terminée avec succès');
            return true;
        } catch (error) {
            logger.error('Erreur lors de la restauration:', error);
            throw error;
        } finally {
            await this.cleanupTempFiles(restorePath);
        }
    }

    // Extraire une archive
    async extractArchive(archivePath, targetPath) {
        const extract = require('extract-zip');
        await extract(archivePath, { dir: targetPath });
    }

    // Valider une sauvegarde
    async validateBackup(backupPath) {
        try {
            const requiredFiles = ['config.json'];
            const requiredDirs = ['database'];

            for (const file of requiredFiles) {
                const filePath = path.join(backupPath, file);
                if (!await this.fileExists(filePath)) {
                    throw new Error(`Fichier requis manquant: ${file}`);
                }
            }

            for (const dir of requiredDirs) {
                const dirPath = path.join(backupPath, dir);
                if (!await this.directoryExists(dirPath)) {
                    throw new Error(`Dossier requis manquant: ${dir}`);
                }
            }

            return true;
        } catch (error) {
            logger.error('Validation de la sauvegarde échouée:', error);
            throw error;
        }
    }

    // Restaurer la base de données
    async restoreDatabase(restorePath) {
        try {
            const dbPath = path.join(restorePath, 'database');
            const files = await fs.readdir(dbPath);

            for (const file of files) {
                if (!file.endsWith('.json')) continue;

                const collectionName = path.basename(file, '.json');
                const data = JSON.parse(
                    await fs.readFile(path.join(dbPath, file), 'utf8')
                );

                const collection = mongoose.connection.db.collection(collectionName);
                
                // Supprimer les données existantes
                await collection.deleteMany({});
                
                // Insérer les nouvelles données
                if (data.length > 0) {
                    await collection.insertMany(data);
                }
            }

            logger.info('Base de données restaurée');
        } catch (error) {
            logger.error('Erreur lors de la restauration de la base de données:', error);
            throw error;
        }
    }

    // Restaurer les fichiers
    async restoreFiles(restorePath) {
        try {
            const sourcePath = path.join(restorePath, 'files');
            const targetPath = path.join(__dirname, '../uploads');

            // Sauvegarder les fichiers existants
            const backupPath = `${targetPath}_backup_${Date.now()}`;
            if (await this.directoryExists(targetPath)) {
                await fs.rename(targetPath, backupPath);
            }

            try {
                await this.copyDirectory(sourcePath, targetPath);
                logger.info('Fichiers restaurés');

                // Supprimer la sauvegarde temporaire
                await this.cleanupTempFiles(backupPath);
            } catch (error) {
                // En cas d'erreur, restaurer la sauvegarde
                if (await this.directoryExists(backupPath)) {
                    await fs.rm(targetPath, { recursive: true, force: true });
                    await fs.rename(backupPath, targetPath);
                }
                throw error;
            }
        } catch (error) {
            logger.error('Erreur lors de la restauration des fichiers:', error);
            throw error;
        }
    }

    // Restaurer la configuration
    async restoreConfig(restorePath) {
        try {
            const configPath = path.join(restorePath, 'config.json');
            const configData = JSON.parse(await fs.readFile(configPath, 'utf8'));

            // Ne restaurer que les paramètres autorisés
            const allowedKeys = ['app', 'smtp', 'payment'];
            const filteredConfig = {};

            for (const key of allowedKeys) {
                if (configData[key]) {
                    filteredConfig[key] = configData[key];
                }
            }

            await config.updateConfig(filteredConfig);
            logger.info('Configuration restaurée');
        } catch (error) {
            logger.error('Erreur lors de la restauration de la configuration:', error);
            throw error;
        }
    }

    // Nettoyer les fichiers temporaires
    async cleanupTempFiles(dirPath) {
        try {
            if (await this.directoryExists(dirPath)) {
                await fs.rm(dirPath, { recursive: true, force: true });
            }
        } catch (error) {
            logger.error('Erreur lors du nettoyage des fichiers temporaires:', error);
        }
    }

    // Nettoyer les anciennes sauvegardes
    async cleanupOldBackups() {
        try {
            const files = await fs.readdir(this.backupDir);
            const backups = files
                .filter(f => f.startsWith('backup-') && f.endsWith(`.${this.compression}`))
                .map(f => ({
                    name: f,
                    path: path.join(this.backupDir, f),
                    time: fs.stat(path.join(this.backupDir, f)).birthtime
                }));

            // Trier par date
            backups.sort((a, b) => b.time - a.time);

            // Supprimer les sauvegardes excédentaires
            if (backups.length > this.maxBackups) {
                const toDelete = backups.slice(this.maxBackups);
                for (const backup of toDelete) {
                    await fs.unlink(backup.path);
                    logger.info(`Ancienne sauvegarde supprimée: ${backup.name}`);
                }
            }
        } catch (error) {
            logger.error('Erreur lors du nettoyage des anciennes sauvegardes:', error);
        }
    }

    // Vérifier si un fichier existe
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    // Vérifier si un dossier existe
    async directoryExists(dirPath) {
        try {
            const stats = await fs.stat(dirPath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    // Copier un dossier récursivement
    async copyDirectory(src, dest) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirectory(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }

    // Planifier des sauvegardes automatiques
    scheduleBackups(cron = '0 0 * * *') { // Par défaut: tous les jours à minuit
        const schedule = require('node-schedule');
        
        schedule.scheduleJob(cron, async () => {
            try {
                await this.createBackup({ includeFiles: true });
                logger.info('Sauvegarde automatique effectuée');
            } catch (error) {
                logger.error('Erreur lors de la sauvegarde automatique:', error);
            }
        });
    }
}

module.exports = new BackupManager();