const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const crypto = require('crypto');
const logger = require('./logger');
const config = require('./config');

class MediaManager {
    constructor() {
        this.mediaDir = path.join(__dirname, '../media');
        this.cacheDir = path.join(__dirname, '../media/cache');
        this.tempDir = path.join(__dirname, '../temp');
        
        // Types de médias supportés
        this.supportedTypes = {
            images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
            videos: ['.mp4', '.mov', '.avi', '.webm'],
            audio: ['.mp3', '.wav', '.m4a', '.ogg']
        };

        // Configuration des tailles d'images
        this.imageSizes = {
            thumbnail: { width: 150, height: 150 },
            small: { width: 300, height: 300 },
            medium: { width: 600, height: 600 },
            large: { width: 1200, height: 1200 }
        };

        this.initialize();
    }

    // Initialisation
    async initialize() {
        try {
            // Créer les dossiers nécessaires
            await this.createDirectories();

            // Configuration de sharp
            sharp.cache(false);
            sharp.concurrency(1);

            logger.info('Gestionnaire de médias initialisé');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation du gestionnaire de médias:', error);
            throw error;
        }
    }

    // Créer les dossiers nécessaires
    async createDirectories() {
        const directories = [
            this.mediaDir,
            this.cacheDir,
            this.tempDir,
            path.join(this.mediaDir, 'images'),
            path.join(this.mediaDir, 'videos'),
            path.join(this.mediaDir, 'audio'),
            path.join(this.cacheDir, 'thumbnails'),
            path.join(this.cacheDir, 'previews')
        ];

        for (const dir of directories) {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    // Télécharger un média
    async upload(file, options = {}) {
        try {
            // Valider le fichier
            const validationResult = await this.validateFile(file);
            if (!validationResult.isValid) {
                throw new Error(validationResult.error);
            }

            // Générer un nom de fichier unique
            const fileName = this.generateFileName(file.originalname);
            const fileType = this.getFileType(file.originalname);
            const subDir = this.getSubDirectory(fileType);
            
            const filePath = path.join(this.mediaDir, subDir, fileName);

            // Traiter et sauvegarder le fichier selon son type
            switch (fileType) {
                case 'image':
                    await this.processAndSaveImage(file.buffer, filePath, options);
                    break;
                case 'video':
                    await this.processAndSaveVideo(file.buffer, filePath, options);
                    break;
                case 'audio':
                    await this.processAndSaveAudio(file.buffer, filePath, options);
                    break;
                default:
                    throw new Error('Type de fichier non supporté');
            }

            // Générer les métadonnées
            const metadata = await this.generateMetadata(filePath, fileType);

            // Sauvegarder les métadonnées
            await this.saveMetadata(fileName, metadata);

            return {
                fileName,
                path: filePath,
                type: fileType,
                metadata
            };
        } catch (error) {
            logger.error('Erreur lors de l\'upload du média:', error);
            throw error;
        }
    }

    // Valider un fichier
    async validateFile(file) {
        try {
            // Vérifier la présence du fichier
            if (!file || !file.buffer) {
                return { isValid: false, error: 'Fichier manquant' };
            }

            // Vérifier la taille
            const maxSize = config.get('media.maxSize', 50 * 1024 * 1024); // 50MB par défaut
            if (file.size > maxSize) {
                return { isValid: false, error: 'Fichier trop volumineux' };
            }

            // Vérifier le type
            const ext = path.extname(file.originalname).toLowerCase();
            const isSupported = Object.values(this.supportedTypes)
                .some(types => types.includes(ext));

            if (!isSupported) {
                return { isValid: false, error: 'Type de fichier non supporté' };
            }

            return { isValid: true };
        } catch (error) {
            logger.error('Erreur lors de la validation du fichier:', error);
            return { isValid: false, error: 'Erreur de validation' };
        }
    }

    // Traiter et sauvegarder une image
    async processAndSaveImage(buffer, filePath, options = {}) {
        try {
            let image = sharp(buffer);

            // Redimensionnement si nécessaire
            if (options.resize) {
                image = image.resize(
                    options.resize.width,
                    options.resize.height,
                    {
                        fit: options.resize.fit || 'inside',
                        withoutEnlargement: true
                    }
                );
            }

            // Optimisation
            if (options.optimize !== false) {
                image = image.jpeg({ quality: 85, progressive: true })
                          .png({ compressionLevel: 9 });
            }

            // Sauvegarder l'image
            await image.toFile(filePath);

            // Générer les versions redimensionnées si nécessaire
            if (options.generateSizes !== false) {
                await this.generateImageSizes(buffer, filePath);
            }
        } catch (error) {
            logger.error('Erreur lors du traitement de l\'image:', error);
            throw error;
        }
    }

    // Traiter et sauvegarder une vidéo
    async processAndSaveVideo(buffer, filePath, options = {}) {
        try {
            // Sauvegarder la vidéo temporairement
            const tempPath = path.join(this.tempDir, path.basename(filePath));
            await fs.writeFile(tempPath, buffer);

            return new Promise((resolve, reject) => {
                let command = ffmpeg(tempPath);

                // Définir le codec
                if (options.codec) {
                    command = command.videoCodec(options.codec);
                }

                // Redimensionner si nécessaire
                if (options.resize) {
                    command = command.size(`${options.resize.width}x${options.resize.height}`);
                }

                // Définir le bitrate
                if (options.bitrate) {
                    command = command.videoBitrate(options.bitrate);
                }

                command
                    .on('end', async () => {
                        await fs.unlink(tempPath);
                        resolve();
                    })
                    .on('error', async (error) => {
                        await fs.unlink(tempPath);
                        reject(error);
                    })
                    .save(filePath);
            });
        } catch (error) {
            logger.error('Erreur lors du traitement de la vidéo:', error);
            throw error;
        }
    }

    // Traiter et sauvegarder un audio
    async processAndSaveAudio(buffer, filePath, options = {}) {
        try {
            // Sauvegarder l'audio temporairement
            const tempPath = path.join(this.tempDir, path.basename(filePath));
            await fs.writeFile(tempPath, buffer);

            return new Promise((resolve, reject) => {
                let command = ffmpeg(tempPath);

                // Définir le codec
                if (options.codec) {
                    command = command.audioCodec(options.codec);
                }

                // Définir le bitrate
                if (options.bitrate) {
                    command = command.audioBitrate(options.bitrate);
                }

                command
                    .on('end', async () => {
                        await fs.unlink(tempPath);
                        resolve();
                    })
                    .on('error', async (error) => {
                        await fs.unlink(tempPath);
                        reject(error);
                    })
                    .save(filePath);
            });
        } catch (error) {
            logger.error('Erreur lors du traitement de l\'audio:', error);
            throw error;
        }
    }

    // Générer les différentes tailles d'images
    async generateImageSizes(buffer, originalPath) {
        try {
            const tasks = Object.entries(this.imageSizes).map(async ([size, dimensions]) => {
                const fileName = path.basename(originalPath);
                const sizePath = path.join(
                    this.cacheDir,
                    size,
                    fileName
                );

                await sharp(buffer)
                    .resize(dimensions.width, dimensions.height, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: 80, progressive: true })
                    .toFile(sizePath);
            });

            await Promise.all(tasks);
        } catch (error) {
            logger.error('Erreur lors de la génération des tailles d\'image:', error);
            throw error;
        }
    }

    // Générer une miniature
    async generateThumbnail(filePath, options = {}) {
        try {
            const fileType = this.getFileType(filePath);
            const thumbnailPath = path.join(
                this.cacheDir,
                'thumbnails',
                path.basename(filePath)
            );

            switch (fileType) {
                case 'image':
                    await sharp(filePath)
                        .resize(150, 150, { fit: 'cover' })
                        .jpeg({ quality: 80 })
                        .toFile(thumbnailPath);
                    break;

                case 'video':
                    return new Promise((resolve, reject) => {
                        ffmpeg(filePath)
                            .screenshots({
                                timestamps: ['00:00:01'],
                                filename: path.basename(thumbnailPath),
                                folder: path.dirname(thumbnailPath),
                                size: '150x150'
                            })
                            .on('end', resolve)
                            .on('error', reject);
                    });

                default:
                    throw new Error('Type de fichier non supporté pour les miniatures');
            }

            return thumbnailPath;
        } catch (error) {
            logger.error('Erreur lors de la génération de la miniature:', error);
            throw error;
        }
    }

    // Obtenir les métadonnées d'un fichier
    async generateMetadata(filePath, fileType) {
        try {
            const stats = await fs.stat(filePath);
            const basicMetadata = {
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                type: fileType
            };

            switch (fileType) {
                case 'image':
                    const imageInfo = await sharp(filePath).metadata();
                    return {
                        ...basicMetadata,
                        width: imageInfo.width,
                        height: imageInfo.height,
                        format: imageInfo.format,
                        space: imageInfo.space,
                        channels: imageInfo.channels,
                        depth: imageInfo.depth,
                        density: imageInfo.density,
                        hasAlpha: imageInfo.hasAlpha,
                        orientation: imageInfo.orientation
                    };

                case 'video':
                    return new Promise((resolve, reject) => {
                        ffmpeg.ffprobe(filePath, (error, metadata) => {
                            if (error) reject(error);
                            resolve({
                                ...basicMetadata,
                                duration: metadata.format.duration,
                                bitrate: metadata.format.bit_rate,
                                codec: metadata.streams[0].codec_name,
                                width: metadata.streams[0].width,
                                height: metadata.streams[0].height,
                                fps: metadata.streams[0].r_frame_rate
                            });
                        });
                    });

                case 'audio':
                    return new Promise((resolve, reject) => {
                        ffmpeg.ffprobe(filePath, (error, metadata) => {
                            if (error) reject(error);
                            resolve({
                                ...basicMetadata,
                                duration: metadata.format.duration,
                                bitrate: metadata.format.bit_rate,
                                codec: metadata.streams[0].codec_name,
                                channels: metadata.streams[0].channels,
                                sampleRate: metadata.streams[0].sample_rate
                            });
                        });
                    });

                default:
                    return basicMetadata;
            }
        } catch (error) {
            logger.error('Erreur lors de la génération des métadonnées:', error);
            throw error;
        }
    }

    // Sauvegarder les métadonnées
    async saveMetadata(fileName, metadata) {
        try {
            const metadataPath = path.join(this.mediaDir, 'metadata.json');
            let allMetadata = {};

            try {
                const content = await fs.readFile(metadataPath, 'utf8');
                allMetadata = JSON.parse(content);
            } catch {
                // Le fichier n'existe pas encore
            }

            allMetadata[fileName] = {
                ...metadata,
                lastUpdated: new Date()
            };

            await fs.writeFile(
                metadataPath,
                JSON.stringify(allMetadata, null, 2)
            );
        } catch (error) {
            logger.error('Erreur lors de la sauvegarde des métadonnées:', error);
            throw error;
        }
    }

    // Générer un nom de fichier unique
    generateFileName(originalName) {
        const ext = path.extname(originalName);
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        return `${timestamp}-${random}${ext}`;
    }

    // Obtenir le type de fichier
    getFileType(filePath) {
        const ext = path.extname(filePath).toLowerCase();

        if (this.supportedTypes.images.includes(ext)) return 'image';
        if (this.supportedTypes.videos.includes(ext)) return 'video';
        if (this.supportedTypes.audio.includes(ext)) return 'audio';

        return 'unknown';
    }

    // Obtenir le sous-dossier pour un type de fichier
    getSubDirectory(fileType) {
        const subDirs = {
            image: 'images',
            video: 'videos',
            audio: 'audio'
        };
        return subDirs[fileType] || 'other';
    }

    // Supprimer un média
    async delete(fileName) {
        try {
            const fileType = this.getFileType(fileName);
            const subDir = this.getSubDirectory(fileType);

            // Supprimer le fichier principal
            const filePath = path.join(this.mediaDir, subDir, fileName);
            await fs.unlink(filePath);

            // Supprimer les fichiers cachés associés
            await this.deleteCachedFiles(fileName);

            // Supprimer les métadonnées
            await this.deleteMetadata(fileName);

            logger.info(`Média supprimé: ${fileName}`);
            return true;
        } catch (error) {
            logger.error('Erreur lors de la suppression du média:', error);
            throw error;
        }
    }

    // Supprimer les fichiers en cache
    async deleteCachedFiles(fileName) {
        try {
            // Supprimer les différentes tailles d'images
            for (const size of Object.keys(this.imageSizes)) {
                const sizePath = path.join(this.cacheDir, size, fileName);
                await fs.unlink(sizePath).catch(() => {}); // Ignorer si le fichier n'existe pas
            }

            // Supprimer la miniature
            const thumbnailPath = path.join(this.cacheDir, 'thumbnails', fileName);
            await fs.unlink(thumbnailPath).catch(() => {});

            // Supprimer les previews
            const previewPath = path.join(this.cacheDir, 'previews', fileName);
            await fs.unlink(previewPath).catch(() => {});
        } catch (error) {
            logger.error('Erreur lors de la suppression des fichiers en cache:', error);
        }
    }

    // Supprimer les métadonnées
    async deleteMetadata(fileName) {
        try {
            const metadataPath = path.join(this.mediaDir, 'metadata.json');
            let allMetadata = {};

            try {
                const content = await fs.readFile(metadataPath, 'utf8');
                allMetadata = JSON.parse(content);
            } catch {
                return;
            }

            delete allMetadata[fileName];
            await fs.writeFile(metadataPath, JSON.stringify(allMetadata, null, 2));
        } catch (error) {
            logger.error('Erreur lors de la suppression des métadonnées:', error);
        }
    }

    // Obtenir une version redimensionnée
    async getResizedVersion(fileName, size) {
        try {
            if (!this.imageSizes[size]) {
                throw new Error('Taille non valide');
            }

            const fileType = this.getFileType(fileName);
            if (fileType !== 'image') {
                throw new Error('Seules les images peuvent être redimensionnées');
            }

            const cachePath = path.join(this.cacheDir, size, fileName);
            
            // Vérifier si la version existe déjà en cache
            try {
                await fs.access(cachePath);
                return cachePath;
            } catch {
                // La version n'existe pas, la créer
                const originalPath = path.join(this.mediaDir, 'images', fileName);
                const dimensions = this.imageSizes[size];

                await sharp(originalPath)
                    .resize(dimensions.width, dimensions.height, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: 80, progressive: true })
                    .toFile(cachePath);

                return cachePath;
            }
        } catch (error) {
            logger.error('Erreur lors de l\'obtention de la version redimensionnée:', error);
            throw error;
        }
    }

    // Obtenir une URL temporaire
    async getTemporaryUrl(fileName, options = {}) {
        try {
            const fileType = this.getFileType(fileName);
            const subDir = this.getSubDirectory(fileType);
            const filePath = path.join(this.mediaDir, subDir, fileName);

            // Vérifier si le fichier existe
            await fs.access(filePath);

            // Générer un token temporaire
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = Date.now() + (options.duration || 3600) * 1000;

            // Stocker le token en cache
            await this.storeTemporaryToken(token, {
                fileName,
                path: filePath,
                expiresAt
            });

            return {
                token,
                url: `/media/temp/${token}/${fileName}`,
                expiresAt
            };
        } catch (error) {
            logger.error('Erreur lors de la génération de l\'URL temporaire:', error);
            throw error;
        }
    }

    // Stocker un token temporaire
    async storeTemporaryToken(token, data) {
        try {
            // Utiliser Redis ou un autre système de cache
            const cache = require('./cache');
            await cache.set(`media_token:${token}`, data, 3600); // 1 heure par défaut
        } catch (error) {
            logger.error('Erreur lors du stockage du token temporaire:', error);
            throw error;
        }
    }

    // Vérifier un token temporaire
    async verifyTemporaryToken(token) {
        try {
            const cache = require('./cache');
            const data = await cache.get(`media_token:${token}`);

            if (!data) {
                return null;
            }

            if (Date.now() > data.expiresAt) {
                await cache.delete(`media_token:${token}`);
                return null;
            }

            return data;
        } catch (error) {
            logger.error('Erreur lors de la vérification du token temporaire:', error);
            return null;
        }
    }

    // Nettoyer le cache
    async cleanCache() {
        try {
            // Obtenir tous les fichiers en cache
            const cacheFiles = await this.getAllCacheFiles();
            let cleaned = 0;

            for (const file of cacheFiles) {
                const stats = await fs.stat(file);
                const age = Date.now() - stats.mtimeMs;

                // Supprimer les fichiers plus vieux que 30 jours
                if (age > 30 * 24 * 60 * 60 * 1000) {
                    await fs.unlink(file);
                    cleaned++;
                }
            }

            logger.info(`Cache nettoyé: ${cleaned} fichiers supprimés`);
            return cleaned;
        } catch (error) {
            logger.error('Erreur lors du nettoyage du cache:', error);
            throw error;
        }
    }

    // Obtenir tous les fichiers en cache
    async getAllCacheFiles() {
        const files = [];
        const readDirRecursive = async (dir) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await readDirRecursive(fullPath);
                } else {
                    files.push(fullPath);
                }
            }
        };

        await readDirRecursive(this.cacheDir);
        return files;
    }

    // Récupérer les statistiques d'utilisation
    async getStats() {
        try {
            const stats = {
                totalFiles: 0,
                totalSize: 0,
                byType: {
                    images: { count: 0, size: 0 },
                    videos: { count: 0, size: 0 },
                    audio: { count: 0, size: 0 }
                },
                cacheSize: 0
            };

            // Calculer pour chaque type
            for (const [type, subDir] of Object.entries({
                images: 'images',
                videos: 'videos',
                audio: 'audio'
            })) {
                const dir = path.join(this.mediaDir, subDir);
                const files = await fs.readdir(dir).catch(() => []);

                for (const file of files) {
                    const filePath = path.join(dir, file);
                    const fileStats = await fs.stat(filePath);
                    stats.byType[type].count++;
                    stats.byType[type].size += fileStats.size;
                    stats.totalFiles++;
                    stats.totalSize += fileStats.size;
                }
            }

            // Calculer la taille du cache
            const cacheFiles = await this.getAllCacheFiles();
            for (const file of cacheFiles) {
                const fileStats = await fs.stat(file);
                stats.cacheSize += fileStats.size;
            }

            return stats;
        } catch (error) {
            logger.error('Erreur lors du calcul des statistiques:', error);
            throw error;
        }
    }

    // Vérifier l'intégrité des fichiers médias
    async checkIntegrity() {
        try {
            const issues = [];
            const metadataPath = path.join(this.mediaDir, 'metadata.json');
            let metadata = {};

            try {
                const content = await fs.readFile(metadataPath, 'utf8');
                metadata = JSON.parse(content);
            } catch {
                issues.push('Fichier de métadonnées manquant ou corrompu');
            }

            // Vérifier chaque fichier
            for (const [fileName, fileMetadata] of Object.entries(metadata)) {
                const filePath = path.join(
                    this.mediaDir,
                    this.getSubDirectory(fileMetadata.type),
                    fileName
                );

                try {
                    await fs.access(filePath);

                    // Vérifier la taille
                    const stats = await fs.stat(filePath);
                    if (stats.size !== fileMetadata.size) {
                        issues.push(`Taille incorrecte pour ${fileName}`);
                    }

                    // Vérifier les fichiers en cache si nécessaire
                    if (fileMetadata.type === 'image') {
                        for (const size of Object.keys(this.imageSizes)) {
                            const cachePath = path.join(this.cacheDir, size, fileName);
                            try {
                                await fs.access(cachePath);
                            } catch {
                                issues.push(`Version ${size} manquante pour ${fileName}`);
                            }
                        }
                    }
                } catch {
                    issues.push(`Fichier manquant: ${fileName}`);
                }
            }

            return {
                isValid: issues.length === 0,
                issues
            };
        } catch (error) {
            logger.error('Erreur lors de la vérification de l\'intégrité:', error);
            throw error;
        }
    }

    // Réparer les problèmes d'intégrité
    async repair() {
        try {
            const { issues } = await this.checkIntegrity();
            const repairs = [];

            for (const issue of issues) {
                try {
                    if (issue.startsWith('Fichier manquant:')) {
                        // Supprimer les métadonnées des fichiers manquants
                        const fileName = issue.split(': ')[1];
                        await this.deleteMetadata(fileName);
                        repairs.push(`Métadonnées supprimées pour ${fileName}`);
                    }
                    else if (issue.startsWith('Version')) {
                        // Regénérer les versions manquantes
                        const match = issue.match(/Version (\w+) manquante pour (.+)/);
                        if (match) {
                            const [, size, fileName] = match;
                            await this.getResizedVersion(fileName, size);
                            repairs.push(`Version ${size} régénérée pour ${fileName}`);
                        }
                    }
                } catch (error) {
                    logger.error(`Erreur lors de la réparation: ${issue}`, error);
                }
            }

            return repairs;
        } catch (error) {
            logger.error('Erreur lors de la réparation:', error);
            throw error;
        }
    }
}

module.exports = new MediaManager();