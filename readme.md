# Configuration Bot Telegram
BOT_TOKEN=votre_token_telegram
ADMIN_USER_IDS=123456,789012  # IDs des administrateurs séparés par des virgules

# Configuration Base de données
MONGODB_URI=mongodb://localhost:27017/telegram-shop-bot

# Configuration PayPal
PAYPAL_CLIENT_ID=votre_client_id_paypal
PAYPAL_CLIENT_SECRET=votre_secret_paypal
PAYPAL_MODE=sandbox  # ou 'live' pour la production

# Configuration Crypto
CRYPTO_NETWORK=testnet  # ou 'mainnet' pour la production
BTC_WALLET=votre_adresse_btc
ETH_WALLET=votre_adresse_eth

# Configuration Stripe (optionnel)
STRIPE_SECRET_KEY=votre_clé_secrète_stripe
STRIPE_WEBHOOK_SECRET=votre_secret_webhook_stripe

# Configuration Logger
LOG_LEVEL=debug  # debug, info, warn, error

# Configuration du serveur
PORT=3000
NODE_ENV=development  # ou 'production'