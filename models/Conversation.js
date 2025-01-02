// models/Conversation.js
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const messageSchema = new mongoose.Schema({
    messageId: {
        type: String,
        required: true
    },
    senderId: {
        type: String,
        required: true
    },
    senderType: {
        type: String,
        enum: ['user', 'admin', 'system'],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    attachments: [{
        type: {
            type: String,
            enum: ['photo', 'document', 'video', 'voice']
        },
        fileId: String,
        caption: String
    }],
    replyTo: String, // ID du message auquel celui-ci répond
    forwarded: Boolean,
    isRead: {
        type: Boolean,
        default: false
    },
    readBy: [{
        userId: String,
        timestamp: Date
    }]
}, {
    timestamps: true
});

const conversationSchema = new mongoose.Schema({
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        unique: true
    },
    channelId: {
        type: String,
        required: true,
        unique: true
    },
    status: {
        type: String,
        enum: ['active', 'archived', 'deleted'],
        default: 'active'
    },
    participants: [{
        userId: String,
        role: {
            type: String,
            enum: ['user', 'admin', 'support'],
            required: true
        },
        joinedAt: {
            type: Date,
            default: Date.now
        },
        lastSeen: Date
    }],
    categories: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    }],
    messages: [messageSchema],
    metadata: {
        lastMessageAt: Date,
        lastMessageBy: String,
        messageCount: {
            type: Number,
            default: 0
        },
        unreadCount: {
            user: {
                type: Number,
                default: 0
            },
            admin: {
                type: Number,
                default: 0
            }
        }
    },
    settings: {
        notifications: {
            user: {
                type: Boolean,
                default: true
            },
            admin: {
                type: Boolean,
                default: true
            }
        },
        autoClose: {
            enabled: {
                type: Boolean,
                default: true
            },
            afterDays: {
                type: Number,
                default: 30
            }
        }
    }
}, {
    timestamps: true
});

// Indexes
conversationSchema.index({ orderId: 1 });
conversationSchema.index({ channelId: 1 });
conversationSchema.index({ status: 1 });
conversationSchema.index({ 'metadata.lastMessageAt': -1 });

// Middleware pré-sauvegarde
conversationSchema.pre('save', function(next) {
    if (this.isModified('messages')) {
        this.metadata.messageCount = this.messages.length;
        this.metadata.lastMessageAt = new Date();
        
        // Mettre à jour les compteurs de messages non lus
        const unreadMessages = this.messages.filter(m => !m.isRead);
        this.metadata.unreadCount = {
            user: unreadMessages.filter(m => m.senderType === 'admin').length,
            admin: unreadMessages.filter(m => m.senderType === 'user').length
        };
    }
    next();
});

// Méthodes d'instance
conversationSchema.methods = {
    // Ajouter un message
    async addMessage(messageData) {
        this.messages.push({
            ...messageData,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        });
        
        // Mettre à jour les métadonnées
        this.metadata.lastMessageAt = new Date();
        this.metadata.lastMessageBy = messageData.senderId;
        
        await this.save();
        return this.messages[this.messages.length - 1];
    },

   // Marquer les messages comme lus
   async markAsRead(userId, upToMessageId = null) {
    const messagesToMark = upToMessageId
        ? this.messages.filter(m => m.messageId <= upToMessageId)
        : this.messages;

    messagesToMark.forEach(message => {
        if (!message.readBy.find(r => r.userId === userId)) {
            message.readBy.push({
                userId,
                timestamp: new Date()
            });
            message.isRead = true;
        }
    });

    // Mettre à jour les compteurs
    const userRole = this.participants.find(p => p.userId === userId)?.role;
    if (userRole === 'admin') {
        this.metadata.unreadCount.admin = 0;
    } else {
        this.metadata.unreadCount.user = 0;
    }

    await this.save();
},

// Ajouter un participant
async addParticipant(userId, role) {
    if (!this.participants.find(p => p.userId === userId)) {
        this.participants.push({
            userId,
            role,
            joinedAt: new Date()
        });
        await this.save();
    }
},

// Supprimer un participant
async removeParticipant(userId) {
    this.participants = this.participants.filter(p => p.userId !== userId);
    await this.save();
},

// Archiver la conversation
async archive() {
    if (this.status === 'active') {
        this.status = 'archived';
        await this.save();
    }
},

// Réactiver la conversation
async reactivate() {
    if (this.status === 'archived') {
        this.status = 'active';
        await this.save();
    }
},

// Supprimer la conversation
async softDelete() {
    this.status = 'deleted';
    await this.save();
},

// Obtenir les messages non lus
getUnreadMessages(userId) {
    return this.messages.filter(m => 
        !m.readBy.find(r => r.userId === userId)
    );
},

// Obtenir le dernier message
getLastMessage() {
    return this.messages[this.messages.length - 1];
},

// Vérifier si un utilisateur est participant
isParticipant(userId) {
    return this.participants.some(p => p.userId === userId);
},

// Obtenir le rôle d'un participant
getParticipantRole(userId) {
    return this.participants.find(p => p.userId === userId)?.role;
},

// Mettre à jour les paramètres
async updateSettings(settings) {
    Object.assign(this.settings, settings);
    await this.save();
}
};

// Méthodes statiques
conversationSchema.statics = {
// Trouver les conversations actives par utilisateur
async findActiveByUser(userId) {
    return this.find({
        'participants.userId': userId,
        status: 'active'
    }).sort({ 'metadata.lastMessageAt': -1 });
},

// Trouver les conversations par catégorie
async findByCategory(categoryId) {
    return this.find({
        categories: categoryId,
        status: 'active'
    });
},

// Obtenir les statistiques des conversations
async getStats() {
    return this.aggregate([
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                avgMessages: { $avg: '$metadata.messageCount' }
            }
        }
    ]);
},

// Archiver les conversations inactives
async archiveInactive(days = 30) {
    const date = new Date();
    date.setDate(date.getDate() - days);

    return this.updateMany(
        {
            status: 'active',
            'metadata.lastMessageAt': { $lt: date },
            'settings.autoClose.enabled': true
        },
        { $set: { status: 'archived' } }
    );
}
};

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;