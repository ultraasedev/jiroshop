// permissions.js
// Gestion des permissions pour le bot e-shop Telegram

const ROLES = {
    ADMIN: 'admin',
    USER: 'user',
    MODERATOR: 'moderator'
};

const PERMISSIONS = {
    // Permissions liées aux produits
    CREATE_PRODUCT: 'create:product',
    EDIT_PRODUCT: 'edit:product',
    DELETE_PRODUCT: 'delete:product',
    VIEW_PRODUCT: 'view:product',
    
    // Permissions liées aux catégories
    MANAGE_CATEGORIES: 'manage:categories',
    
    // Permissions liées aux paiements
    MANAGE_PAYMENTS: 'manage:payments',
    VIEW_PAYMENTS: 'view:payments',
    
    // Permissions liées aux promotions
    MANAGE_PROMOTIONS: 'manage:promotions',
    
    // Permissions liées aux paramètres
    MANAGE_SETTINGS: 'manage:settings',
    
    // Permissions liées aux fichiers
    MANAGE_FILES: 'manage:files',
    VIEW_FILES: 'view:files',
};

// Map des permissions par rôle
const ROLE_PERMISSIONS = {
    [ROLES.ADMIN]: Object.values(PERMISSIONS), // Admin a toutes les permissions
    [ROLES.MODERATOR]: [
        PERMISSIONS.VIEW_PRODUCT,
        PERMISSIONS.VIEW_PAYMENTS,
        PERMISSIONS.VIEW_FILES,
        PERMISSIONS.MANAGE_FILES
    ],
    [ROLES.USER]: [
        PERMISSIONS.VIEW_PRODUCT,
        PERMISSIONS.VIEW_FILES
    ]
};

class PermissionsManager {
    constructor() {
        this.userPermissions = new Map();
    }

    // Ajouter un rôle à un utilisateur
    async addUserRole(userId, role) {
        if (!ROLES[role.toUpperCase()]) {
            throw new Error(`Role invalide: ${role}`);
        }
        
        const userPerms = this.userPermissions.get(userId) || new Set();
        ROLE_PERMISSIONS[role].forEach(perm => userPerms.add(perm));
        this.userPermissions.set(userId, userPerms);
        
        return true;
    }

    // Vérifier si un utilisateur a une permission spécifique
    async hasPermission(userId, permission) {
        const userPerms = this.userPermissions.get(userId);
        if (!userPerms) return false;
        
        return userPerms.has(permission);
    }

    // Vérifier si un utilisateur est admin
    async isAdmin(userId) {
        const userPerms = this.userPermissions.get(userId);
        if (!userPerms) return false;
        
        return Array.from(userPerms).length === ROLE_PERMISSIONS[ROLES.ADMIN].length;
    }

    // Ajouter une permission spécifique à un utilisateur
    async addPermission(userId, permission) {
        if (!PERMISSIONS[permission]) {
            throw new Error(`Permission invalide: ${permission}`);
        }
        
        const userPerms = this.userPermissions.get(userId) || new Set();
        userPerms.add(PERMISSIONS[permission]);
        this.userPermissions.set(userId, userPerms);
        
        return true;
    }

    // Retirer une permission à un utilisateur
    async removePermission(userId, permission) {
        const userPerms = this.userPermissions.get(userId);
        if (!userPerms) return false;
        
        userPerms.delete(PERMISSIONS[permission]);
        return true;
    }

    // Obtenir toutes les permissions d'un utilisateur
    async getUserPermissions(userId) {
        return Array.from(this.userPermissions.get(userId) || []);
    }

    // Middleware pour vérifier les permissions
    checkPermission(permission) {
        return async (ctx, next) => {
            const userId = ctx.from.id;
            const hasPermission = await this.hasPermission(userId, permission);
            
            if (!hasPermission) {
                await ctx.reply('Vous n\'avez pas les permissions nécessaires pour effectuer cette action.');
                return;
            }
            
            return next();
        };
    }
}

// Création d'une instance unique du gestionnaire de permissions
const permissionsManager = new PermissionsManager();

module.exports = {
    permissionsManager,
    ROLES,
    PERMISSIONS
};