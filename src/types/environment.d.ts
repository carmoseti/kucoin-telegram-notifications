export {}

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            KUCOIN_REST_BASE_URL :string
            KUCOIN_QUOTE_ASSETS :string
            KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT :string
            KUCOIN_NOTIFICATIONS_STRIKE_TIMEOUT_MINS :string
            KUCOIN_SYMBOL_UPDATE_INTERVAL_MINS :string
            KUCOIN_SYMBOL_CURRENCIES_SPLIT_CHARACTER :string
            KUCOIN_WEB_SOCKET_CONNECTION_MESSAGES_PER_SECOND_MAX_COUNT :string
            KUCOIN_WEB_SOCKET_CONNECTION_SUBSCRIPTION_TOPICS_MAX_COUNT :string
            TELEGRAM_API_URL :string
            TELEGRAM_BOT_CHAT_ID :string
            TELEGRAM_BOT_TOKEN_SECRET :string
            TELEGRAM_APE_IN_BOT_TOKEN_SECRET :string
            APE_IN_START_PERCENTAGE :string
            APE_IN_INCREMENT_PERCENTAGE :string
            APE_IN_PERCENT_TIMEOUT_HRS :string
            EMAIL_HOST :string
            EMAIL_PORT :string
            EMAIL_PROTOCOL :string
            EMAIL_USER :string
            EMAIL_PASSWORD :string
            EMAIL_SENDER_NAME :string
            EMAIL_RECEIVER_NAME :string
            EMAIL_RECEIVER_ADDRESS :string
            EMAIL_RECEIVER_CC :string
            USER_NAME :string
        }
    }
}
