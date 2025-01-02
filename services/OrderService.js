// services/OrderService.js
const Order = require('../models/Order');
const CartService = require('./CartService');
const PaymentService = require('./PaymentService');
const { eventManager } = require('../utils/events');
const { notificationManager } = require('../utils/notifications');
const { Validator } = require('../utils/validation');

class OrderService {
    async createOrder(userId, cartId, paymentMethodId) {
        try {
            const cart = await CartService.getCartById(cartId);
            const validation = await CartService.validateCart(cart);
            
            if (!validation.isValid) {
                throw new Error(`Invalid cart: ${validation.errors.join(', ')}`);
            }

            const order = new Order({
                user: userId,
                items: cart.items.map(item => ({
                    product: item.product._id,
                    quantity: item.quantity,
                    price: item.price,
                    customFields: item.customFields
                })),
                payment: {
                    method: paymentMethodId,
                    amount: cart.summary
                },
                status: 'pending'
            });

            await order.save();
            await CartService.clearCart(cartId);
            await eventManager.emitEvent('order_created', { orderId: order._id });

            return order;
        } catch (error) {
            throw new Error(`Error creating order: ${error.message}`);
        }
    }

    async processOrder(orderId) {
        const order = await Order.findById(orderId);
        
        if (order.payment.status !== 'completed') {
            throw new Error('Payment must be completed before processing');
        }

        try {
            await order.updateStatus('processing');
            await this.processOrderItems(order);
            await notificationManager.sendOrderNotification(order.user, 'order_processing', { orderId });
            
            return order;
        } catch (error) {
            throw new Error(`Error processing order: ${error.message}`);
        }
    }

    async processOrderItems(order) {
        for (const item of order.items) {
            if (item.product.type === 'instant_delivery') {
                await this.handleInstantDelivery(order, item);
            } else {
                await this.handleManualDelivery(order, item);
            }
        }
    }

    async handleInstantDelivery(order, item) {
        try {
            const deliveryResult = await this.generateDeliveryContent(item);
            item.deliveryStatus = 'completed';
            item.deliveryData = deliveryResult;
            await order.save();
            
            await notificationManager.sendOrderNotification(
                order.user,
                'item_delivered',
                { orderId: order._id, itemId: item._id }
            );
        } catch (error) {
            throw new Error(`Instant delivery failed: ${error.message}`);
        }
    }

    async handleManualDelivery(order, item) {
        try {
            item.deliveryStatus = 'pending';
            await order.save();
            
            await notificationManager.notifyAdmins(
                'new_manual_delivery',
                { orderId: order._id, itemId: item._id }
            );
        } catch (error) {
            throw new Error(`Manual delivery setup failed: ${error.message}`);
        }
    }

    async completeOrder(orderId) {
        const order = await Order.findById(orderId);
        
        if (!order.canBeCompleted()) {
            throw new Error('Order cannot be completed');
        }

        try {
            await order.updateStatus('completed');
            await notificationManager.sendOrderNotification(
                order.user,
                'order_completed',
                { orderId }
            );
            
            return order;
        } catch (error) {
            throw new Error(`Error completing order: ${error.message}`);
        }
    }

    async cancelOrder(orderId, reason) {
        const order = await Order.findById(orderId);
        
        if (!order.canBeCancelled()) {
            throw new Error('Order cannot be cancelled');
        }

        try {
            await order.updateStatus('cancelled', reason);
            await this.handleOrderCancellation(order);
            
            return order;
        } catch (error) {
            throw new Error(`Error cancelling order: ${error.message}`);
        }
    }

    async handleOrderCancellation(order) {
        if (order.payment.status === 'completed') {
            await PaymentService.processRefund(order);
        }
        
        await notificationManager.sendOrderNotification(
            order.user,
            'order_cancelled',
            { orderId: order._id }
        );
    }

    async getOrderDetails(orderId, userId) {
        const order = await Order.findById(orderId)
            .populate('items.product')
            .populate('payment.method');
            
        if (order.user.toString() !== userId) {
            throw new Error('Unauthorized access to order');
        }
        
        return order;
    }

    async getUserOrders(userId, options = {}) {
        const query = { user: userId };
        
        if (options.status) {
            query.status = options.status;
        }
        
        return Order.find(query)
            .sort({ createdAt: -1 })
            .limit(options.limit || 10)
            .skip(options.skip || 0);
    }

    async generateOrderStats(startDate, endDate) {
        return Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    total: { $sum: '$payment.amount.total' }
                }
            }
        ]);
    }
}

module.exports = new OrderService();