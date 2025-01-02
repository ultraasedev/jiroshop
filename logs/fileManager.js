const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');
const config = require('../config/bot');

class FileManager {
    constructor() {
        this.uploadDir = path.join(__dirname, '../uploads');
        this.tempDir = path.join(__dirname, '../temp');
        this.allowedMimeTypes = new Set([
            'image/jpeg',
            'image/png',
            'image/gif',
            'application/pdf',
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ]);
        this.maxFileSize = 10 * 1024 * 1024; // 10MB
        this.initializeDirs();
    }

    // Initialiser les dossiers nécessaires
    async initializeDirs() {
        try {
            const directories = [
                this.uploadDir,
                this.tempDir,
                path.join(this.uploadDir, 'products'),
                path.join(this.uploadDir, 'proofs'),
                path.join(this.uploadDir, 'documents'),
                path.join(this.uploadDir, 'profiles'),
                path.join(this.uploadDir, 'tickets'),
                path.join(this.uploadDir, 'backups')
            ];

            for (const dir of directories) {
                await this.ensureDir(dir);
            }
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation des dossiers:', error);
            throw new Error('Impossible d\'initialiser les dossiers de stockage');
        }
    }

    // S'assurer qu'un dossier existe
    async ensureDir(dir) {
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    // Sauvegarder un fichier
    async saveFile(file, options = {}) {
        try {
            const {
                type = 'temp',
                originalName = '',
                prefix = '',
                metadata = {},
                validateContent = true
            } = options;

            if (validateContent) {
                await this.validateFile(file);
            }

            const fileExt = path.extname(originalName).toLowerCase();
            const fileName = this.generateFileName(prefix, fileExt);
            const savePath = path.join(
                type === 'temp' ? this.tempDir : this.uploadDir,
                type === 'temp' ? '' : type,
                fileName
            );

            // Si c'est une image, optimiser avant sauvegarde
            if (file.mimetype && file.mimetype.startsWith('image/')) {
                await this.optimizeImage(file.buffer, savePath);
            } else {
                await fs.writeFile(savePath, file.buffer || file);
            }

            const fileHash = await this.calculateFileHash(savePath);
            const fileStats = await fs.stat(savePath);

            const fileMetadata = {
                originalName,
                type,
                size: fileStats.size,
                hash: fileHash,
                mimetype: file.mimetype || await this.getMimeType(savePath),
                createdAt: new Date(),
                ...metadata
            };

            await this.saveFileMetadata(fileName, fileMetadata);

            return {
                fileName,
                path: savePath,
                hash: fileHash,
                metadata: fileMetadata
            };
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde du fichier:', error);
            throw new Error('Impossible de sauvegarder le fichier');
        }
    }

    // Optimiser une image
    async optimizeImage(buffer, outputPath) {
        const sharp = require('sharp');
        try {
            await sharp(buffer)
                .resize(2000, 2000, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({ quality: 85, progressive: true })
                .toFile(outputPath);
        } catch (error) {
            logger.error('Erreur lors de l\'optimisation de l\'image:', error);
            throw new Error('Impossible d\'optimiser l\'image');
        }
    }

    // Générer un nom de fichier unique
    generateFileName(prefix, extension) {
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        return `${prefix}${timestamp}-${random}${extension}`;
    }

    // Calculer le hash d'un fichier
    async calculateFileHash(filePath) {
        try {
            const fileBuffer = await fs.readFile(filePath);
            return crypto.createHash('sha256').update(fileBuffer).digest('hex');
        } catch (error) {
            logger.error('Erreur lors du calcul du hash:', error);
            throw error;
        }
    }

    // Obtenir le type MIME d'un fichier
    async getMimeType(filePath) {
        const fileType = require('file-type');
        try {
            const buffer = await fs.readFile(filePath);
            const type = await fileType.fromBuffer(buffer);
            return type ? type.mime : 'application/octet-stream';
        } catch (error) {
            logger.error('Erreur lors de la détection du type MIME:', error);
            return 'application/octet-stream';
        }
    }

    // Valider un fichier
    async validateFile(file) {
        const errors = [];

        // Vérifier la présence du fichier
        if (!file || (!file.buffer && !Buffer.isBuffer(file))) {
            errors.push('Fichier invalide ou manquant');
        }

        const fileSize = file.size || (file.buffer ? file.buffer.length : file.length);
        if (fileSize > this.maxFileSize) {
            errors.push(`Fichier trop volumineux (maximum ${this.maxFileSize / 1024 / 1024}MB)`);
        }

        // Vérifier le type MIME
        const mimeType = file.mimetype || await this.getMimeType(file.path);
        if (!this.allowedMimeTypes.has(mimeType)) {
            errors.push('Type de fichier non autorisé');
        }

        if (errors.length > 0) {
            throw new Error(errors.join(', '));
        }

        return true;
    }

    // Sauvegarder les métadonnées d'un fichier
    async saveFileMetadata(fileName, metadata) {
        try {
            const metadataPath = path.join(this.uploadDir, 'metadata.json');
            let allMetadata = {};

            try {
                const existing = await fs.readFile(metadataPath, 'utf8');
                allMetadata = JSON.parse(existing);
            } catch {
                // Le fichier n'existe pas encore
            }

            allMetadata[fileName] = {
                ...metadata,
                updatedAt: new Date()
            };

            await fs.writeFile(metadataPath, JSON.stringify(allMetadata, null, 2));
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde des métadonnées:', error);
        }
    }

    // Lire un fichier
    async readFile(fileName, type = '') {
        try {
            const filePath = path.join(
                type ? this.uploadDir : this.tempDir,
                type,
                fileName
            );

            return await fs.readFile(filePath);
        } catch (error) {
            logger.error('Erreur lors de la lecture du fichier:', error);
            throw new Error('Impossible de lire le fichier');
        }
    }

    // Supprimer un fichier
    async deleteFile(fileName, type = '') {
        try {
            const filePath = path.join(
                type ? this.uploadDir : this.tempDir,
                type,
                fileName
            );

            await fs.unlink(filePath);
            await this.deleteFileMetadata(fileName);
            return true;
        } catch (error) {
            logger.error('Erreur lors de la suppression du fichier:', error);
            throw new Error('Impossible de supprimer le fichier');
        }
    }

    // Supprimer les métadonnées d'un fichier
    async deleteFileMetadata(fileName) {
        try {
            const metadataPath = path.join(this.uploadDir, 'metadata.json');
            let allMetadata = {};

            try {
                const existing = await fs.readFile(metadataPath, 'utf8');
                allMetadata = JSON.parse(existing);
                delete allMetadata[fileName];
                await fs.writeFile(metadataPath, JSON.stringify(allMetadata, null, 2));
            } catch (error) {
                logger.error('Erreur lors de la suppression des métadonnées:', error);
            }
        } catch (error) {
            logger.error('Erreur lors de la suppression des métadonnées:', error);
        }
    }

    // Déplacer un fichier
    async moveFile(sourcePath, targetPath) {
        try {
            await fs.rename(sourcePath, targetPath);

            // Mettre à jour les métadonnées
            const fileName = path.basename(sourcePath);
            const metadata = await this.getFileMetadata(fileName);
            
            if (metadata) {
                metadata.path = targetPath;
                metadata.movedAt = new Date();
                await this.saveFileMetadata(fileName, metadata);
            }

            return true;
        } catch (error) {
            logger.error('Erreur lors du déplacement du fichier:', error);
            throw new Error('Impossible de déplacer le fichier');
        }
    }

    // Copier un fichier
    async copyFile(sourcePath, targetPath) {
        try {
            await fs.copyFile(sourcePath, targetPath);
            
            // Copier les métadonnées
            const sourceFileName = path.basename(sourcePath);
            const targetFileName = path.basename(targetPath);
            const metadata = await this.getFileMetadata(sourceFileName);
            
            if (metadata) {
                metadata.copiedFrom = sourceFileName;
                metadata.copiedAt = new Date();
                metadata.path = targetPath;
                await this.saveFileMetadata(targetFileName, metadata);
            }

            return true;
        } catch (error) {
            logger.error('Erreur lors de la copie du fichier:', error);
            throw new Error('Impossible de copier le fichier');
        }
    }

    // Obtenir les métadonnées d'un fichier
    async getFileMetadata(fileName) {
        try {
            const metadataPath = path.join(this.uploadDir, 'metadata.json');
            const content = await fs.readFile(metadataPath, 'utf8');
            const allMetadata = JSON.parse(content);
            return allMetadata[fileName] || null;
        } catch {
            return null;
        }
    }

    // Vérifier si un fichier existe
    async fileExists(fileName, type = '') {
        try {
            const filePath = path.join(
                type ? this.uploadDir : this.tempDir,
                type,
                fileName
            );
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    // Obtenir la liste des fichiers
    async listFiles(type = '', options = {}) {
        const {
            filter = null,
            sort = 'name',
            order = 'asc',
            limit = 100,
            offset = 0
        } = options;

        try {
            const dir = path.join(type ? this.uploadDir : this.tempDir, type);
            let files = await fs.readdir(dir);

            if (filter) {
                files = files.filter(file => file.includes(filter));
            }

            const filesWithStats = await Promise.all(
                files.map(async file => {
                    const filePath = path.join(dir, file);
                    const stats = await fs.stat(filePath);
                    const metadata = await this.getFileMetadata(file);
                    return {
                        name: file,
                        path: filePath,
                        size: stats.size,
                        created: stats.birthtime,
                        modified: stats.mtime,
                        metadata
                    };
                })
            );

            // Trier les fichiers
            filesWithStats.sort((a, b) => {
                const aValue = a[sort];
                const bValue = b[sort];
                return order === 'asc' ? 
                    (aValue > bValue ? 1 : -1) : 
                    (aValue < bValue ? 1 : -1);
            });

            return filesWithStats.slice(offset, offset + limit);
        } catch (error) {
            logger.error('Erreur lors de la liste des fichiers:', error);
            throw new Error('Impossible de lister les fichiers');
        }
    }

    // Nettoyer les fichiers temporaires
    async cleanTempFiles(maxAge = 24 * 60 * 60 * 1000) {
        try {
            const files = await fs.readdir(this.tempDir);
            const now = Date.now();
            let cleaned = 0;

            for (const file of files) {
                const filePath = path.join(this.tempDir, file);
                const stats = await fs.stat(filePath);

                if (now - stats.mtimeMs > maxAge) {
                    await fs.unlink(filePath);
                    cleaned++;
                    logger.debug(`Fichier temporaire supprimé: ${file}`);
                }
            }

            logger.info(`${cleaned} fichiers temporaires nettoyés`);
            return cleaned;
        } catch (error) {
            logger.error('Erreur lors du nettoyage des fichiers temporaires:', error);
            throw new Error('Impossible de nettoyer les fichiers temporaires');
        }
    }

    // Créer une sauvegarde
    async createBackup(options = {}) {
        const {
            includeTemp = false,
            compressFiles = true
        } = options;

        try {
            const backupDir = path.join(this.uploadDir, 'backups');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = `backup-${timestamp}`;
            const backupPath = path.join(backupDir, backupName);

            // Créer le dossier de sauvegarde
            await this.ensureDir(backupPath);

            // Copier les fichiers
            const directories = [
                { src: this.uploadDir, dest: path.join(backupPath, 'uploads') }
            ];

            if (includeTemp) {
                directories.push({
                    src: this.tempDir,
                    dest: path.join(backupPath, 'temp')
                });
            }

            for (const dir of directories) {
                await this.copyDirectory(dir.src, dir.dest);
            }

            // Compresser si demandé
            if (compressFiles) {
                const archiver = require('archiver');
                const output = fs.createWriteStream(`${backupPath}.zip`);
                const archive = archiver('zip', {
                    zlib: { level: 9 }
                });

                await new Promise((resolve, reject) => {
                    output.on('close', resolve);
                    archive.on('error', reject);

                    archive.pipe(output);
                    archive.directory(backupPath, false);
                    archive.finalize();
                });

                // Supprimer le dossier non compressé
                await this.deleteDirectory(backupPath);
                
                return `${backupPath}.zip`;
            }

            return backupPath;
        } catch (error) {
            logger.error('Erreur lors de la création de la sauvegarde:', error);
            throw new Error('Impossible de créer la sauvegarde');
        }
    }

    // Copier un dossier récursivement
    async copyDirectory(src, dest) {
        await this.ensureDir(dest);
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

    // Supprimer un dossier récursivement
    async deleteDirectory(dir) {
        if (!dir.includes(this.uploadDir) && !dir.includes(this.tempDir)) {
            throw new Error('Opération non autorisée');
        }

        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.deleteDirectory(fullPath);
            } else {
                await fs.unlink(fullPath);
            }
        }

        await fs.rmdir(dir);
    }

    // Restaurer une sauvegarde
    async restoreBackup(backupPath) {
        try {
            if (path.extname(backupPath) === '.zip') {
                const extract = require('extract-zip');
                const tempExtractPath = path.join(this.tempDir, 'restore-temp');
                
                await this.ensureDir(tempExtractPath);
                await extract(backupPath, { dir: tempExtractPath });

                // La sauvegarde est maintenant dans tempExtractPath
                backupPath = tempExtractPath;
            }

            // Vérifier la structure de la sauvegarde
            const backupStructure = await this.validateBackupStructure(backupPath);
            if (!backupStructure.isValid) {
                throw new Error(`Structure de sauvegarde invalide: ${backupStructure.error}`);
            }

            // Sauvegarder les dossiers actuels
            const timestamp = Date.now();
            const oldUploadDir = `${this.uploadDir}_old_${timestamp}`;
            const oldTempDir = `${this.tempDir}_old_${timestamp}`;

            await fs.rename(this.uploadDir, oldUploadDir);
            await fs.rename(this.tempDir, oldTempDir);

            try {
                // Restaurer les dossiers
                await this.copyDirectory(
                    path.join(backupPath, 'uploads'),
                    this.uploadDir
                );
                
                if (await this.fileExists(path.join(backupPath, 'temp'))) {
                    await this.copyDirectory(
                        path.join(backupPath, 'temp'),
                        this.tempDir
                    );
                }

                // Supprimer les anciens dossiers
                await this.deleteDirectory(oldUploadDir);
                await this.deleteDirectory(oldTempDir);

                logger.info('Sauvegarde restaurée avec succès');
                return true;
            } catch (error) {
                // En cas d'erreur, restaurer les anciens dossiers
                await this.deleteDirectory(this.uploadDir);
                await this.deleteDirectory(this.tempDir);
                await fs.rename(oldUploadDir, this.uploadDir);
                await fs.rename(oldTempDir, this.tempDir);
                throw error;
            }
        } catch (error) {
            logger.error('Erreur lors de la restauration de la sauvegarde:', error);
            throw new Error('Impossible de restaurer la sauvegarde');
        }
    }

    // Valider la structure d'une sauvegarde
    async validateBackupStructure(backupPath) {
        try {
            const requiredDirs = ['uploads'];
            const requiredFiles = ['uploads/metadata.json'];

            for (const dir of requiredDirs) {
                const dirPath = path.join(backupPath, dir);
                const stats = await fs.stat(dirPath);
                if (!stats.isDirectory()) {
                    return {
                        isValid: false,
                        error: `Le dossier requis ${dir} n'existe pas`
                    };
                }
            }

            for (const file of requiredFiles) {
                const filePath = path.join(backupPath, file);
                const stats = await fs.stat(filePath);
                if (!stats.isFile()) {
                    return {
                        isValid: false,
                        error: `Le fichier requis ${file} n'existe pas`
                    };
                }
            }

            return { isValid: true };
        } catch (error) {
            return {
                isValid: false,
                error: error.message
            };
        }
    }

    // Récupérer les statistiques d'utilisation
    async getStats() {
        try {
            const uploadStats = await this.getDirectoryStats(this.uploadDir);
            const tempStats = await this.getDirectoryStats(this.tempDir);

            return {
                uploads: uploadStats,
                temp: tempStats,
                totalSize: uploadStats.totalSize + tempStats.totalSize,
                totalFiles: uploadStats.totalFiles + tempStats.totalFiles,
                lastBackup: await this.getLastBackupDate()
            };
        } catch (error) {
            logger.error('Erreur lors de la récupération des statistiques:', error);
            throw new Error('Impossible de récupérer les statistiques');
        }
    }

    // Récupérer les statistiques d'un dossier
    async getDirectoryStats(dir) {
        let totalSize = 0;
        let totalFiles = 0;
        let oldestFile = null;
        let newestFile = null;

        const processDir = async (currentDir) => {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    await processDir(fullPath);
                } else {
                    totalFiles++;
                    const stats = await fs.stat(fullPath);
                    totalSize += stats.size;

                    if (!oldestFile || stats.birthtime < oldestFile.time) {
                        oldestFile = {
                            path: fullPath,
                            time: stats.birthtime
                        };
                    }

                    if (!newestFile || stats.birthtime > newestFile.time) {
                        newestFile = {
                            path: fullPath,
                            time: stats.birthtime
                        };
                    }
                }
            }
        };

        await processDir(dir);

        return {
            totalSize,
            totalFiles,
            oldestFile,
            newestFile
        };
    }

    // Récupérer la date de la dernière sauvegarde
    async getLastBackupDate() {
        try {
            const backupDir = path.join(this.uploadDir, 'backups');
            const files = await fs.readdir(backupDir);

            if (files.length === 0) return null;

            const backupFiles = files
                .filter(f => f.startsWith('backup-'))
                .map(f => ({
                    name: f,
                    time: new Date(f.split('-').slice(1).join('-').replace('.zip', ''))
                }));

            if (backupFiles.length === 0) return null;

            backupFiles.sort((a, b) => b.time - a.time);
            return backupFiles[0].time;
        } catch {
            return null;
        }
    }

    // Rotation des logs
    async rotateLogs() {
        try {
            const logFiles = await fs.readdir(this.uploadDir);
            const now = Date.now();
            const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 jours

            for (const file of logFiles) {
                if (!file.endsWith('.log')) continue;

                const filePath = path.join(this.uploadDir, file);
                const stats = await fs.stat(filePath);

                if (now - stats.mtimeMs > maxAge) {
                    const archivePath = path.join(
                        this.uploadDir,
                        'archives',
                        `${file}.${stats.mtime.toISOString().split('T')[0]}`
                    );

                    await this.ensureDir(path.join(this.uploadDir, 'archives'));
                    await fs.rename(filePath, archivePath);
                }
            }
        } catch (error) {
            logger.error('Erreur lors de la rotation des logs:', error);
        }
    }

    // Initialisation du nettoyage automatique
    initializeAutoCleaning() {
        // Nettoyage des fichiers temporaires toutes les 6 heures
        setInterval(() => this.cleanTempFiles(), 6 * 60 * 60 * 1000);
        
        // Rotation des logs tous les jours
        setInterval(() => this.rotateLogs(), 24 * 60 * 60 * 1000);
    }
}

// Exporter une instance unique
module.exports = new FileManager();