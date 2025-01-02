const crypto = require('crypto');
const logger = require('./logger');

class CryptoUtil {
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.keyLength = 32; // 256 bits
        this.ivLength = 16; // 128 bits
        this.saltLength = 64;
        this.tagLength = 16;
        this.iterations = 100000;
        this.digest = 'sha512';
        this.encoding = 'hex';
    }

    // Générer une clé aléatoire
    generateKey() {
        return crypto.randomBytes(this.keyLength).toString(this.encoding);
    }

    // Générer un vecteur d'initialisation
    generateIV() {
        return crypto.randomBytes(this.ivLength);
    }

    // Dériver une clé à partir d'un mot de passe
    async deriveKey(password, salt) {
        try {
            if (!salt) {
                salt = crypto.randomBytes(this.saltLength);
            }

            const key = await new Promise((resolve, reject) => {
                crypto.pbkdf2(
                    password,
                    salt,
                    this.iterations,
                    this.keyLength,
                    this.digest,
                    (err, key) => {
                        if (err) reject(err);
                        resolve(key);
                    }
                );
            });

            return {
                key: key.toString(this.encoding),
                salt: salt.toString(this.encoding)
            };
        } catch (error) {
            logger.error('Erreur lors de la dérivation de clé:', error);
            throw new Error('Impossible de dériver la clé');
        }
    }

    // Chiffrer des données
    encrypt(data, key) {
        try {
            // Convertir la clé en buffer si nécessaire
            if (typeof key === 'string') {
                key = Buffer.from(key, this.encoding);
            }

            const iv = this.generateIV();
            const cipher = crypto.createCipheriv(this.algorithm, key, iv);
            
            let encrypted = cipher.update(data, 'utf8', this.encoding);
            encrypted += cipher.final(this.encoding);
            
            const authTag = cipher.getAuthTag();

            return {
                encrypted,
                iv: iv.toString(this.encoding),
                authTag: authTag.toString(this.encoding)
            };
        } catch (error) {
            logger.error('Erreur lors du chiffrement:', error);
            throw new Error('Impossible de chiffrer les données');
        }
    }

    // Déchiffrer des données
    decrypt(encryptedData, key, iv, authTag) {
        try {
            // Convertir les paramètres en buffers si nécessaire
            if (typeof key === 'string') {
                key = Buffer.from(key, this.encoding);
            }
            if (typeof iv === 'string') {
                iv = Buffer.from(iv, this.encoding);
            }
            if (typeof authTag === 'string') {
                authTag = Buffer.from(authTag, this.encoding);
            }

            const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
            decipher.setAuthTag(authTag);
            
            let decrypted = decipher.update(encryptedData, this.encoding, 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted;
        } catch (error) {
            logger.error('Erreur lors du déchiffrement:', error);
            throw new Error('Impossible de déchiffrer les données');
        }
    }

    // Générer une signature numérique
    sign(data, privateKey) {
        try {
            const sign = crypto.createSign('SHA256');
            sign.update(data);
            sign.end();
            return sign.sign(privateKey, this.encoding);
        } catch (error) {
            logger.error('Erreur lors de la signature:', error);
            throw new Error('Impossible de signer les données');
        }
    }

    // Vérifier une signature numérique
    verify(data, signature, publicKey) {
        try {
            const verify = crypto.createVerify('SHA256');
            verify.update(data);
            verify.end();
            return verify.verify(publicKey, signature, this.encoding);
        } catch (error) {
            logger.error('Erreur lors de la vérification de la signature:', error);
            throw new Error('Impossible de vérifier la signature');
        }
    }

    // Générer une paire de clés RSA
    generateKeyPair() {
        return new Promise((resolve, reject) => {
            crypto.generateKeyPair('rsa', {
                modulusLength: 4096,
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem'
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem'
                }
            }, (err, publicKey, privateKey) => {
                if (err) {
                    logger.error('Erreur lors de la génération des clés:', err);
                    reject(new Error('Impossible de générer les clés'));
                } else {
                    resolve({ publicKey, privateKey });
                }
            });
        });
    }

    // Chiffrer avec RSA
    encryptRSA(data, publicKey) {
        try {
            return crypto.publicEncrypt(
                {
                    key: publicKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256'
                },
                Buffer.from(data)
            ).toString(this.encoding);
        } catch (error) {
            logger.error('Erreur lors du chiffrement RSA:', error);
            throw new Error('Impossible de chiffrer avec RSA');
        }
    }

    // Déchiffrer avec RSA
    decryptRSA(encryptedData, privateKey) {
        try {
            return crypto.privateDecrypt(
                {
                    key: privateKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256'
                },
                Buffer.from(encryptedData, this.encoding)
            ).toString('utf8');
        } catch (error) {
            logger.error('Erreur lors du déchiffrement RSA:', error);
            throw new Error('Impossible de déchiffrer avec RSA');
        }
    }

    // Générer un hachage sécurisé
    hash(data, algorithm = 'sha256') {
        try {
            return crypto
                .createHash(algorithm)
                .update(data)
                .digest(this.encoding);
        } catch (error) {
            logger.error('Erreur lors du hachage:', error);
            throw new Error('Impossible de générer le hash');
        }
    }

    // Hacher avec sel
    hashWithSalt(data, salt = null) {
        try {
            if (!salt) {
                salt = crypto.randomBytes(this.saltLength).toString(this.encoding);
            }

            const hash = this.hash(data + salt);

            return {
                hash,
                salt
            };
        } catch (error) {
            logger.error('Erreur lors du hachage avec sel:', error);
            throw new Error('Impossible de générer le hash avec sel');
        }
    }

    // Vérifier un hash avec sel
    verifyHashWithSalt(data, hash, salt) {
        try {
            const newHash = this.hash(data + salt);
            return newHash === hash;
        } catch (error) {
            logger.error('Erreur lors de la vérification du hash:', error);
            throw new Error('Impossible de vérifier le hash');
        }
    }

    // Chiffrer un fichier
    async encryptFile(inputPath, outputPath, key) {
        const fs = require('fs').promises;
        try {
            const data = await fs.readFile(inputPath);
            const encrypted = this.encrypt(data, key);
            
            // Sauvegarder les données chiffrées et les métadonnées
            await fs.writeFile(outputPath, JSON.stringify({
                data: encrypted.encrypted,
                iv: encrypted.iv,
                authTag: encrypted.authTag
            }));

            return true;
        } catch (error) {
            logger.error('Erreur lors du chiffrement du fichier:', error);
            throw new Error('Impossible de chiffrer le fichier');
        }
    }

    // Déchiffrer un fichier
    async decryptFile(inputPath, outputPath, key) {
        const fs = require('fs').promises;
        try {
            const encryptedData = JSON.parse(await fs.readFile(inputPath, 'utf8'));
            const decrypted = this.decrypt(
                encryptedData.data,
                key,
                encryptedData.iv,
                encryptedData.authTag
            );
            
            await fs.writeFile(outputPath, decrypted);
            return true;
        } catch (error) {
            logger.error('Erreur lors du déchiffrement du fichier:', error);
            throw new Error('Impossible de déchiffrer le fichier');
        }
    }

    // Générer un token JWT
    generateJWT(payload, secretKey, options = {}) {
        try {
            const header = {
                alg: 'HS256',
                typ: 'JWT'
            };

            const now = Math.floor(Date.now() / 1000);
            const claims = {
                iat: now,
                ...options.claims
            };

            if (options.expiresIn) {
                claims.exp = now + options.expiresIn;
            }

            const encodedHeader = Buffer
                .from(JSON.stringify(header))
                .toString('base64url');
            const encodedPayload = Buffer
                .from(JSON.stringify({ ...payload, ...claims }))
                .toString('base64url');

            const signature = crypto
                .createHmac('sha256', secretKey)
                .update(`${encodedHeader}.${encodedPayload}`)
                .digest('base64url');

            return `${encodedHeader}.${encodedPayload}.${signature}`;
        } catch (error) {
            logger.error('Erreur lors de la génération du JWT:', error);
            throw new Error('Impossible de générer le JWT');
        }
    }

    // Vérifier un token JWT
    verifyJWT(token, secretKey) {
        try {
            const [encodedHeader, encodedPayload, signature] = token.split('.');

            // Vérifier la signature
            const expectedSignature = crypto
                .createHmac('sha256', secretKey)
                .update(`${encodedHeader}.${encodedPayload}`)
                .digest('base64url');

            if (signature !== expectedSignature) {
                throw new Error('Signature invalide');
            }

            // Décoder et vérifier le token
            const payload = JSON.parse(
                Buffer.from(encodedPayload, 'base64url').toString()
            );

            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) {
                throw new Error('Token expiré');
            }

            return payload;
        } catch (error) {
            logger.error('Erreur lors de la vérification du JWT:', error);
            throw new Error('Token invalide');
        }
    }

    // Générer un UUID v4
    generateUUID() {
        return crypto.randomUUID();
    }

    // Générer un token aléatoire
    generateToken(length = 32) {
        return crypto.randomBytes(length).toString(this.encoding);
    }

    // Générer un mot de passe sécurisé
    generateSecurePassword(options = {}) {
        const {
            length = 16,
            includeUpperCase = true,
            includeLowerCase = true,
            includeNumbers = true,
            includeSpecialChars = true
        } = options;

        const upperChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
        const numbers = '0123456789';
        const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';

        let chars = '';
        if (includeLowerCase) chars += lowerChars;
        if (includeUpperCase) chars += upperChars;
        if (includeNumbers) chars += numbers;
        if (includeSpecialChars) chars += specialChars;

        let password = '';
        const randomBytes = crypto.randomBytes(length);

        for (let i = 0; i < length; i++) {
            password += chars[randomBytes[i] % chars.length];
        }

        return password;
    }
}

// Exporter une instance unique
module.exports = new CryptoUtil();