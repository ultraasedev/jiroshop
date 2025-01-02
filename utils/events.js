// events.js
// Gestion des événements pour le bot e-shop Telegram

const EventEmitter = require('events');

class BotEventManager extends EventEmitter {
    constructor() {
        super();
        this.events = {
            // Événements liés aux produits
            PRODUCT_ADDED: 'product:added',
            PRODUCT_UPDATED: 'product:updated',
            PRODUCT_DELETED: 'product:deleted',
            
            // Événements liés aux commandes
            ORDER_CREATED: 'order:created',
            ORDER_UPDATED: 'order:updated',
            ORDER_COMPLETED: 'order:completed',
            ORDER_CANCELLED: 'order:cancelled',
            
            // Événements liés aux paiements
            PAYMENT_INITIATED: 'payment:initiated',
            PAYMENT_COMPLETED: 'payment:completed',
            PAYMENT_FAILED: 'payment:failed',
            
            // Événements liés au panier
            CART_UPDATED: 'cart:updated',
            CART_CLEARED: 'cart:cleared',
            
            // Événements liés aux utilisateurs
            USER_REGISTERED: 'user:registered',
            USER_UPDATED: 'user:updated',
            
            // Événements liés aux promotions
            PROMOTION_ADDED: 'promotion:added',
            PROMOTION_EXPIRED: 'promotion:expired'
        };
    }

    // Méthode pour émettre un événement avec logging
    async emitEvent(eventName, data) {
        console.log(`[EVENT] ${eventName}`, data);
        this.emit(eventName, data);
    }

    // Gestionnaire d'événements pour les produits
    async handleProductEvent(type, productData) {
        switch(type) {
            case this.events.PRODUCT_ADDED:
                await this.emitEvent(this.events.PRODUCT_ADDED, {
                    timestamp: Date.now(),
                    product: productData
                });
                break;
            case this.events.PRODUCT_UPDATED:
                await this.emitEvent(this.events.PRODUCT_UPDATED, {
                    timestamp: Date.now(),
                    product: productData
                });
                break;
            case this.events.PRODUCT_DELETED:
                await this.emitEvent(this.events.PRODUCT_DELETED, {
                    timestamp: Date.now(),
                    productId: productData.id
                });
                break;
        }
    }

    // Gestionnaire d'événements pour les commandes
    async handleOrderEvent(type, orderData) {
        const eventData = {
            timestamp: Date.now(),
            orderId: orderData.id,
            userId: orderData.userId,
            status: orderData.status
        };

        await this.emitEvent(type, eventData);
    }

    // Gestionnaire d'événements pour les paiements
    async handlePaymentEvent(type, paymentData) {
        const eventData = {
            timestamp: Date.now(),
            paymentId: paymentData.id,
            orderId: paymentData.orderId,
            userId: paymentData.userId,
            amount: paymentData.amount,
            method: paymentData.method,
            status: paymentData.status
        };

        await this.emitEvent(type, eventData);
    }

    // Gestionnaire d'événements pour le panier
    async handleCartEvent(type, cartData) {
        const eventData = {
            timestamp: Date.now(),
            userId: cartData.userId,
            items: cartData.items,
            total: cartData.total
        };

        await this.emitEvent(type, eventData);
    }

    // Méthode pour enregistrer des listeners personnalisés
    registerCustomListener(eventName, callback) {
        if (typeof callback !== 'function') {
            throw new Error('Le callback doit être une fonction');
        }

        this.on(eventName, async (data) => {
            try {
                await callback(data);
            } catch (error) {
                console.error(`Erreur dans le listener pour ${eventName}:`, error);
            }
        });
    }

    // Méthode pour supprimer tous les listeners d'un événement
    removeAllListeners(eventName) {
        super.removeAllListeners(eventName);
        console.log(`Tous les listeners de ${eventName} ont été supprimés`);
    }
}

// Création d'une instance unique du gestionnaire d'événements
const eventManager = new BotEventManager();

module.exports = {
    eventManager
};