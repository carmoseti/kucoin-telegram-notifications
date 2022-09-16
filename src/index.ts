import axios, {AxiosResponse} from "axios"
import {config} from "dotenv"
import {logError} from "./utils/log"
import {
    KuCoinPublicTokenResponse,
    KuCoinSymbolsResponse, KuCoinWebSocketResponse, KuCoinTelegramSymbols,
    KuCoinTelegramWebSocketConnections, KuCoinTelegramTradingPairs
} from "index"
import WebSocket from "ws"
import {sleep} from "./utils/sleep"
import {
    buySignalStrikeNotification, sendApeInNotification,
    startServiceNotification,
} from "./utils/telegram"
import {fixDecimalPlaces, getDecimalPlacesFromIncrement} from "./utils/number"
import {tryCatchFinallyUtil} from "./utils/error"

// Load .env variables
config()

// Global Variables
let KUCOIN_TELEGRAM_WEB_SOCKET_CONNECTIONS: KuCoinTelegramWebSocketConnections = {}
let KUCOIN_TELEGRAM_SYMBOLS: KuCoinTelegramSymbols = {}
let KUCOIN_TELEGRAM_TRADING_PAIRS: KuCoinTelegramTradingPairs = {}
let KUCOIN_SNAPSHOT_SUBSCRIPTIONS_TRACKER: Record<string, string> = {}
let KUCOIN_SNAPSHOT_UNSUBSCRIPTIONS_TRACKER: Record<string, string> = {}
let KUCOIN_TELEGRAM_GET_SYMBOLS_INTERVAL_ID: NodeJS.Timeout

const getSymbolFromTopic = (topic: string, topicType: 'ticker' | 'snapshot') => {
    const regExp: RegExp = new RegExp(`^(/market/` + topicType + `:)(.+)$`)
    return topic.replace(regExp, '$2')
}

const resetRun = () => {
    KUCOIN_TELEGRAM_WEB_SOCKET_CONNECTIONS = {}
    KUCOIN_TELEGRAM_SYMBOLS = {}
    KUCOIN_TELEGRAM_TRADING_PAIRS = {}
    KUCOIN_SNAPSHOT_SUBSCRIPTIONS_TRACKER = {}
    KUCOIN_SNAPSHOT_UNSUBSCRIPTIONS_TRACKER = {}

    clearInterval(KUCOIN_TELEGRAM_GET_SYMBOLS_INTERVAL_ID)
    run()
}

const getSymbolsData = () => {
    tryCatchFinallyUtil(() => {
        axios.get(`${process.env.KUCOIN_REST_BASE_URL}/api/v1/symbols`)
            .then((data: AxiosResponse<KuCoinSymbolsResponse>) => {
                // Initial at startup
                if (Object.entries(KUCOIN_TELEGRAM_SYMBOLS).length === 0) {
                    for (let a = 0; a < data.data.data.length; a++) {
                        const tradePair = data.data.data[a]
                        const [baseCurrency] = tradePair.symbol.split(`${process.env.KUCOIN_SYMBOL_CURRENCIES_SPLIT_CHARACTER}`)
                        if (KUCOIN_TELEGRAM_SYMBOLS[baseCurrency]) {
                            KUCOIN_TELEGRAM_SYMBOLS[baseCurrency] = {
                                ...KUCOIN_TELEGRAM_SYMBOLS[baseCurrency],
                                [tradePair.quoteCurrency]: tradePair
                            }
                        } else {
                            KUCOIN_TELEGRAM_SYMBOLS[baseCurrency] = {
                                [tradePair.quoteCurrency]: tradePair
                            }
                        }
                    }
                    processTradingPairs()
                }
                // Subsequent (Post-startup)
                else {
                    const newKuCoinSymbols: KuCoinTelegramSymbols = {}
                    for (let a = 0; a < data.data.data.length; a++) {
                        const tradePair = data.data.data[a]
                        const [baseCurrency,quoteCurrency] = tradePair.symbol.split(`${process.env.KUCOIN_SYMBOL_CURRENCIES_SPLIT_CHARACTER}`)
                        if (!KUCOIN_TELEGRAM_SYMBOLS[baseCurrency]) {
                            // New
                            if (newKuCoinSymbols[baseCurrency]) {
                                newKuCoinSymbols[baseCurrency] = {
                                    ...newKuCoinSymbols[baseCurrency],
                                    [tradePair.quoteCurrency]: tradePair
                                }
                            } else {
                                newKuCoinSymbols[baseCurrency] = {
                                    [tradePair.quoteCurrency]: tradePair
                                }
                            }
                        } else {
                            if (!KUCOIN_TELEGRAM_SYMBOLS[baseCurrency][quoteCurrency]) {
                                newKuCoinSymbols[baseCurrency] = {
                                    ...KUCOIN_TELEGRAM_SYMBOLS[baseCurrency],
                                    [quoteCurrency]: tradePair
                                }
                            }
                        }
                    }

                    const deleteKuCoinSymbols: KuCoinTelegramSymbols = {}
                    const apiKuCoinSymbols: KuCoinTelegramSymbols = {}

                    for (let a = 0; a < data.data.data.length; a++) {
                        const tradePair = data.data.data[a]
                        const [baseCurrency] = tradePair.symbol.split(`${process.env.KUCOIN_SYMBOL_CURRENCIES_SPLIT_CHARACTER}`)
                        if (apiKuCoinSymbols[baseCurrency]) {
                            apiKuCoinSymbols[baseCurrency] = {
                                ...apiKuCoinSymbols[baseCurrency],
                                [tradePair.quoteCurrency]: tradePair
                            }
                        } else {
                            apiKuCoinSymbols[baseCurrency] = {
                                [tradePair.quoteCurrency]: tradePair
                            }
                        }
                    }
                    const rgTraderKuCoinSymbolsEntries: Array<[string, KuCoinTelegramSymbols[""]]> = Object.entries(KUCOIN_TELEGRAM_SYMBOLS)

                    for (let a = 0; a < rgTraderKuCoinSymbolsEntries.length; a++) {
                        const [baseCurrency, tradePair] = rgTraderKuCoinSymbolsEntries[a]
                        if (!apiKuCoinSymbols[baseCurrency]) {
                            deleteKuCoinSymbols[baseCurrency] = tradePair
                        } else {
                            if (KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency]) {
                                if (!apiKuCoinSymbols[baseCurrency][KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].quoteCurrency]) {
                                    deleteKuCoinSymbols[baseCurrency] = tradePair
                                } else {
                                    if (!apiKuCoinSymbols[baseCurrency][KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].quoteCurrency].enableTrading) {
                                        deleteKuCoinSymbols[baseCurrency] = tradePair
                                    }
                                }
                            }
                        }
                    }

                    KUCOIN_TELEGRAM_SYMBOLS = {...apiKuCoinSymbols}

                    processTradingPairs(newKuCoinSymbols, deleteKuCoinSymbols)
                }
            })
            .catch((error) => {
                logError(`getSymbolsData.axios() - ${error}`)
                getSymbolsData()
            })
    }, (e) => {
        logError(`getSymbolsData() - ${e}`)
        getSymbolsData()
    })
}

const processTradingPairs = (newSubscribeSymbols ?: KuCoinTelegramSymbols, unsubscribeSymbols ?: KuCoinTelegramSymbols) => {
    tryCatchFinallyUtil(async () => {
        const markets: string[] = `${process.env.KUCOIN_QUOTE_ASSETS}`.split(",")
        const maximumWebSocketSubscriptions: number = Number(`${process.env.KUCOIN_WEB_SOCKET_CONNECTION_SUBSCRIPTION_TOPICS_MAX_COUNT}`)
        const rgKuCoinSymbolsEntries = Object.entries(KUCOIN_TELEGRAM_SYMBOLS)
        for (let a = 0; a < markets.length; a++) {
            const quoteCurrency: string = markets[a]
            for (let b = 0; b < rgKuCoinSymbolsEntries.length; b++) {
                const [baseCurrency, value] = rgKuCoinSymbolsEntries[b]
                if (!KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency]) {
                    if (KUCOIN_TELEGRAM_SYMBOLS[baseCurrency][quoteCurrency]) {
                        const tradePair = value[quoteCurrency]
                        if (tradePair.enableTrading) {
                            KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency] = {
                                webSocketConnectionId: "",
                                symbol: tradePair.symbol,
                                quoteCurrency,
                                baseDecimalPlaces: getDecimalPlacesFromIncrement(parseFloat(tradePair.baseIncrement)),
                                quoteDecimalPlaces: getDecimalPlacesFromIncrement(parseFloat(tradePair.priceIncrement)),
                                snapshotSubscriptionAckInterval: undefined,
                                snapshotUnsubscriptionAckInterval: undefined,
                                notificationBuyPrice: 0,
                                notificationStrikeCount: 0,
                                notificationStrikeTimeoutId: undefined,
                                notificationStrikeUnitPrice: 0,
                                apeInPercentage: Number(process.env.APE_IN_START_PERCENTAGE),
                                apeInTimeoutId: undefined
                            }
                        }
                    }
                }
            }
        }

        // Initial at startup
        if (!newSubscribeSymbols && !unsubscribeSymbols) {
            const rgTradingPairsArray: Array<[string, KuCoinTelegramTradingPairs[""]]> = Object.entries(KUCOIN_TELEGRAM_TRADING_PAIRS)
            const totalTradingPairsCount: number = rgTradingPairsArray.length
            const totalWebSocketConnectionsCount: number = Math.ceil(totalTradingPairsCount / maximumWebSocketSubscriptions)

            for (let a = 0; a < totalWebSocketConnectionsCount; a++) {
                const rgTradingPairsForSubscription: Array<[string, KuCoinTelegramTradingPairs[""]]> = rgTradingPairsArray.slice(
                    a * maximumWebSocketSubscriptions, (a * maximumWebSocketSubscriptions) + maximumWebSocketSubscriptions
                )
                initiateSubscriptions(rgTradingPairsForSubscription)
            }
        }
        // Subsequent
        else {
            const unsubscribeSymbolsEntries: Array<[string, KuCoinTelegramSymbols[""]]> = Object.entries(unsubscribeSymbols)
            if (unsubscribeSymbolsEntries.length > 0) {
                const handleTradingPairUnsubscription = (webSocketConnectionId: string, baseCurrency: string, tradePair: KuCoinTelegramTradingPairs[""], subscriptionType: 'snapshot') => {
                    const unsubscriptionId: string = `${new Date().getTime()}`
                    // Unsubscribe
                    KUCOIN_TELEGRAM_WEB_SOCKET_CONNECTIONS[webSocketConnectionId].webSocket.send(JSON.stringify({
                        id: unsubscriptionId,
                        type: "unsubscribe",
                        topic: `/market/${subscriptionType}:${tradePair.symbol}`,
                        response: true
                    }))
                    if (subscriptionType === 'snapshot') KUCOIN_SNAPSHOT_UNSUBSCRIPTIONS_TRACKER[unsubscriptionId] = baseCurrency
                }

                for (let a = 0; a < unsubscribeSymbolsEntries.length; a++) {
                    const [baseCurrency] = unsubscribeSymbolsEntries[a]
                    const tradePair: KuCoinTelegramTradingPairs[""] = KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency]
                    if (tradePair) {
                        handleTradingPairUnsubscription(tradePair.webSocketConnectionId, baseCurrency, tradePair, 'snapshot')

                        KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].snapshotUnsubscriptionAckInterval = setInterval(() => {
                            const previousUnsubscriptionId: string = Object.entries(KUCOIN_SNAPSHOT_UNSUBSCRIPTIONS_TRACKER).filter(([_, v]) => v === baseCurrency)[0][0]
                            delete KUCOIN_SNAPSHOT_UNSUBSCRIPTIONS_TRACKER[previousUnsubscriptionId]

                            handleTradingPairUnsubscription(tradePair.webSocketConnectionId, baseCurrency, tradePair, "snapshot")
                        }, Math.floor(1000 / Number(process.env.KUCOIN_WEB_SOCKET_CONNECTION_MESSAGES_PER_SECOND_MAX_COUNT)) * Object.entries(KUCOIN_TELEGRAM_TRADING_PAIRS).length)

                        await sleep(Math.floor(
                            1000 / Number(process.env.KUCOIN_WEB_SOCKET_CONNECTION_MESSAGES_PER_SECOND_MAX_COUNT)
                        ))
                    }
                }
            }

            const newSubscribeSymbolsEntries: Array<[string, KuCoinTelegramSymbols[""]]> = Object.entries(newSubscribeSymbols)
            if (newSubscribeSymbolsEntries.length > 0) {
                for (let a = 0; a < newSubscribeSymbolsEntries.length; a++) {
                    const [baseCurrency] = newSubscribeSymbolsEntries[a]
                    const tradePair: KuCoinTelegramTradingPairs[""] = KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency]
                    const websockets: Array<[string, KuCoinTelegramWebSocketConnections[""]]> = Object.entries(KUCOIN_TELEGRAM_WEB_SOCKET_CONNECTIONS)

                    if (tradePair) {
                        for (let b = 0; b < websockets.length; b++) {
                            const [webSocketConnectionId, websocket] = websockets[b]
                            if (!(websocket.numberOfActiveSubscriptions === maximumWebSocketSubscriptions)) {
                                const subscriptionId: string = `${new Date().getTime()}`
                                // Subscribe
                                KUCOIN_TELEGRAM_WEB_SOCKET_CONNECTIONS[webSocketConnectionId].webSocket.send(JSON.stringify({
                                    id: subscriptionId,
                                    type: "subscribe",
                                    topic: `/market/snapshot:${tradePair.symbol}`,
                                    response: false
                                }))

                                KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].webSocketConnectionId = webSocketConnectionId
                                KUCOIN_TELEGRAM_WEB_SOCKET_CONNECTIONS[webSocketConnectionId].numberOfActiveSubscriptions += 1

                                delete newSubscribeSymbols[baseCurrency]

                                await sleep(Math.floor(
                                    1000 / Number(process.env.KUCOIN_WEB_SOCKET_CONNECTION_MESSAGES_PER_SECOND_MAX_COUNT)
                                ) * 3)

                                break
                            }
                        }

                        if (newSubscribeSymbols[baseCurrency]) {
                            break
                        }
                    }
                }

                // Initiate subscriptions of unsubscribed new symbols
                const rgTradingPairsArray: Array<[string, KuCoinTelegramTradingPairs[""]]> = Object.entries(KUCOIN_TELEGRAM_TRADING_PAIRS).filter(([key]) => !!newSubscribeSymbols[key])
                const totalTradingPairsCount: number = rgTradingPairsArray.length
                const totalWebSocketConnectionsCount: number = Math.ceil(totalTradingPairsCount / maximumWebSocketSubscriptions)
                for (let a = 0; a < totalWebSocketConnectionsCount; a++) {
                    const rgTradingPairsForSubscription: Array<[string, KuCoinTelegramTradingPairs[""]]> = rgTradingPairsArray.slice(
                        a * maximumWebSocketSubscriptions, (a * maximumWebSocketSubscriptions) + maximumWebSocketSubscriptions
                    )
                    initiateSubscriptions(rgTradingPairsForSubscription)
                }
            }
        }
    }, (e) => {
        logError(`processTradingPairs() - ${e}`)
        resetRun()
    })
}

const initiateSubscriptions = (rgTradingPairs: Array<[string, KuCoinTelegramTradingPairs[""]]>) => {
    tryCatchFinallyUtil(
        () => {
            axios.post(`${process.env.KUCOIN_REST_BASE_URL}/api/v1/bullet-public`)
                .then((data: AxiosResponse<KuCoinPublicTokenResponse>) => {
                    openWebSocketConnection(data.data, rgTradingPairs)
                })
                .catch((error) => {
                    logError(`initiateSubscriptions.axios() - ${error}`)
                    initiateSubscriptions(rgTradingPairs)
                })
        }, (e) => {
            logError(`initiateSubscriptions() - ${e}`)
            initiateSubscriptions(rgTradingPairs)
        }
    )
}

const openWebSocketConnection = (kuCoinPublicTokenResponse: KuCoinPublicTokenResponse, rgTradingPairs: Array<[string, KuCoinTelegramTradingPairs[""]]>) => {
    const webSocketConnectionId: string = `${new Date().getTime()}`

    tryCatchFinallyUtil(() => {
        const webSocket: WebSocket = new WebSocket(`${kuCoinPublicTokenResponse.data.instanceServers[0].endpoint}?token=${kuCoinPublicTokenResponse.data.token}`)

        KUCOIN_TELEGRAM_WEB_SOCKET_CONNECTIONS[webSocketConnectionId] = {
            webSocket,
            numberOfActiveSubscriptions: 0
        }

        const handleTradingPairSubscription = (baseCurrency: string, tradingPair: KuCoinTelegramTradingPairs[""], subscriptionType: 'snapshot') => {
            const subscriptionId: string = `${new Date().getTime()}`
            // Subscribe
            webSocket.send(JSON.stringify({
                id: subscriptionId,
                type: "subscribe",
                topic: `/market/${subscriptionType}:${tradingPair.symbol}`,
                response: true
            }))
            if (subscriptionType === 'snapshot') KUCOIN_SNAPSHOT_SUBSCRIPTIONS_TRACKER[subscriptionId] = baseCurrency
        }

        let pingIntervalId: NodeJS.Timeout
        const clearPingIntervalId = () => {
            if (pingIntervalId) {
                clearInterval(pingIntervalId)
                pingIntervalId = undefined
            }
        }

        let pongTimeoutId: NodeJS.Timeout
        const clearPongTimeoutId = () => {
            if (pongTimeoutId) {
                clearTimeout(pongTimeoutId)
                pongTimeoutId = undefined
            }
        }

        pingIntervalId = setInterval(() => {
            webSocket.ping(JSON.stringify({
                id: new Date().getTime(),
                type: "ping"
            }))

            pongTimeoutId = setTimeout(() => {
                webSocket.terminate()
            }, kuCoinPublicTokenResponse.data.instanceServers[0].pingTimeout) as NodeJS.Timeout
        }, kuCoinPublicTokenResponse.data.instanceServers[0].pingInterval) as NodeJS.Timeout

        webSocket.on("pong", (_: Buffer) => {
            clearPongTimeoutId()
        })

        webSocket.on("open", async () => {
            for (let a = 0; a < rgTradingPairs.length; a++) {
                const [baseCurrency, rgTradePair] = rgTradingPairs[a]

                if (KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency]) {
                    handleTradingPairSubscription(baseCurrency, rgTradePair, 'snapshot')

                    KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].snapshotSubscriptionAckInterval = setInterval(() => {
                        if (Object.entries(KUCOIN_SNAPSHOT_SUBSCRIPTIONS_TRACKER).filter(([_, v]) => v === baseCurrency)[0]) {
                            const previousSubscriptionId: string = Object.entries(KUCOIN_SNAPSHOT_SUBSCRIPTIONS_TRACKER).filter(([_, v]) => v === baseCurrency)[0][0]
                            delete KUCOIN_SNAPSHOT_SUBSCRIPTIONS_TRACKER[previousSubscriptionId]
                        }

                        handleTradingPairSubscription(baseCurrency, rgTradePair, 'snapshot')
                    }, Math.floor(1000 / Number(process.env.KUCOIN_WEB_SOCKET_CONNECTION_MESSAGES_PER_SECOND_MAX_COUNT)) * rgTradingPairs.length)

                    await sleep(Math.floor(
                        1000 / Number(process.env.KUCOIN_WEB_SOCKET_CONNECTION_MESSAGES_PER_SECOND_MAX_COUNT)
                    ))
                }
            }
        })

        webSocket.on("message", (data) => {
            const response: KuCoinWebSocketResponse = JSON.parse(data.toString())
            if (response.type === "welcome") {
                /*console.log(JSON.stringify(response))*/
            }
            if (response.type === "ack") {
                if (KUCOIN_SNAPSHOT_SUBSCRIPTIONS_TRACKER[response.id]) {
                    clearInterval(KUCOIN_TELEGRAM_TRADING_PAIRS[KUCOIN_SNAPSHOT_SUBSCRIPTIONS_TRACKER[response.id]].snapshotSubscriptionAckInterval)
                    KUCOIN_TELEGRAM_TRADING_PAIRS[KUCOIN_SNAPSHOT_SUBSCRIPTIONS_TRACKER[response.id]].snapshotSubscriptionAckInterval = undefined

                    delete KUCOIN_SNAPSHOT_SUBSCRIPTIONS_TRACKER[response.id]
                }

                if (KUCOIN_SNAPSHOT_UNSUBSCRIPTIONS_TRACKER[response.id]) {
                    clearInterval(KUCOIN_TELEGRAM_TRADING_PAIRS[KUCOIN_SNAPSHOT_UNSUBSCRIPTIONS_TRACKER[response.id]].snapshotUnsubscriptionAckInterval)
                    KUCOIN_TELEGRAM_TRADING_PAIRS[KUCOIN_SNAPSHOT_UNSUBSCRIPTIONS_TRACKER[response.id]].snapshotUnsubscriptionAckInterval = undefined

                    delete KUCOIN_TELEGRAM_TRADING_PAIRS[KUCOIN_SNAPSHOT_UNSUBSCRIPTIONS_TRACKER[response.id]]
                    delete KUCOIN_SNAPSHOT_UNSUBSCRIPTIONS_TRACKER[response.id]
                }
            }
            if (response.type === "message") {
                if (response.subject === "trade.snapshot") {
                    const symbol: string = getSymbolFromTopic(response.topic, 'snapshot')
                    const [baseCurrency, quoteCurrency] = symbol.split(`${process.env.KUCOIN_SYMBOL_CURRENCIES_SPLIT_CHARACTER}`) // ETH-USDT
                    let tradingPair = KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency]
                    if (tradingPair) {
                        // Notification Service
                        const newNotificationBuyPrice: number = tradingPair.notificationStrikeCount === 0 ?
                            fixDecimalPlaces((1.00 + Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT)) * Number(response.data.data.lastTradedPrice), tradingPair.quoteDecimalPlaces) :
                            fixDecimalPlaces(tradingPair.notificationBuyPrice + tradingPair.notificationStrikeUnitPrice, tradingPair.quoteDecimalPlaces)

                        if (tradingPair.notificationBuyPrice) {
                            if (newNotificationBuyPrice < tradingPair.notificationBuyPrice) {
                                KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationBuyPrice = newNotificationBuyPrice
                            }
                        } else {
                            KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationBuyPrice = newNotificationBuyPrice
                        }

                        tradingPair = KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency]
                        if ((Number(response.data.data.lastTradedPrice) >= tradingPair.notificationBuyPrice) && (tradingPair.notificationBuyPrice !== 0)) {
                            KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationStrikeCount += 1
                            tradingPair = KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency]
                            if (tradingPair.notificationStrikeCount === 1) {
                                KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationStrikeUnitPrice = fixDecimalPlaces((tradingPair.notificationBuyPrice * Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT)) / (1.00 + Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT)), tradingPair.quoteDecimalPlaces)
                            }

                            tradingPair = KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency]
                            if (tradingPair.notificationStrikeCount > 1) {
                                buySignalStrikeNotification(symbol, Number(response.data.data.lastTradedPrice), tradingPair.notificationStrikeCount, Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT), quoteCurrency)
                            }

                            if (tradingPair.notificationStrikeTimeoutId) clearTimeout(tradingPair.notificationStrikeTimeoutId)
                            KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationStrikeTimeoutId = setTimeout(
                                () => {
                                    KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationStrikeCount = 0
                                    KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationBuyPrice = 0
                                    KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationStrikeUnitPrice = 0

                                    clearTimeout(KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationStrikeTimeoutId)
                                    KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationStrikeTimeoutId = undefined
                                }, 1000 * 60 * Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_TIMEOUT_MINS) * tradingPair.notificationStrikeCount
                            ) as NodeJS.Timeout
                            tradingPair = KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency]
                            KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].notificationBuyPrice = tradingPair.notificationBuyPrice + tradingPair.notificationStrikeUnitPrice
                        }

                        // APE-IN service
                        const percentChange: number = Math.round(((response.data.data.lastTradedPrice - response.data.data.high) / response.data.data.high) * 10000) / 100
                        if (percentChange < tradingPair.apeInPercentage) {
                            sendApeInNotification(response.data.data.symbol, percentChange)

                            // Set next percentage
                            KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].apeInPercentage = tradingPair.apeInPercentage + Number(process.env.APE_IN_INCREMENT_PERCENTAGE)
                            if (tradingPair.apeInTimeoutId) {
                                clearTimeout(tradingPair.apeInTimeoutId)
                            }
                            KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].apeInTimeoutId = setTimeout(() => {
                                // Reset notification percentage
                                KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].apeInPercentage = Number(process.env.APE_IN_START_PERCENTAGE)

                                clearTimeout(KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].apeInTimeoutId)
                                KUCOIN_TELEGRAM_TRADING_PAIRS[baseCurrency].apeInTimeoutId = undefined
                            }, 1000 * 60 * 60 * Number(process.env.APE_IN_PERCENT_TIMEOUT_HRS))
                        }
                    }
                }
            }
        })

        webSocket.on('error', (error => {
            logError(`openWebSocketConnection().webSocket.error() - ${error}`)
            webSocket.terminate()
        }))

        webSocket.on('close', ((code, reason) => {
            logError(`openWebSocketConnection().webSocket.close() - ${code} => ${reason}`)
            clearPingIntervalId()

            delete KUCOIN_TELEGRAM_WEB_SOCKET_CONNECTIONS[webSocketConnectionId]
            if (rgTradingPairs.length > Object.entries(KUCOIN_TELEGRAM_TRADING_PAIRS).filter(([_, v]) => v.webSocketConnectionId === webSocketConnectionId).length) {
                initiateSubscriptions(rgTradingPairs)
            } else {
                initiateSubscriptions(Object.entries(KUCOIN_TELEGRAM_TRADING_PAIRS).filter(([_, v]) => v.webSocketConnectionId === webSocketConnectionId))
            }
        }))
    }, (e) => {
        logError(`openWebSocketConnection() - ${e}`)
        if (rgTradingPairs.length > Object.entries(KUCOIN_TELEGRAM_TRADING_PAIRS).filter(([_, v]) => v.webSocketConnectionId === webSocketConnectionId).length) {
            initiateSubscriptions(rgTradingPairs)
        } else {
            initiateSubscriptions(Object.entries(KUCOIN_TELEGRAM_TRADING_PAIRS).filter(([_, v]) => v.webSocketConnectionId === webSocketConnectionId))
        }
    })
}

// Run!
const run = () => {
    startServiceNotification()

    getSymbolsData()

    KUCOIN_TELEGRAM_GET_SYMBOLS_INTERVAL_ID = setInterval(() => {
        getSymbolsData()
    }, 1000 * 60 * Number(process.env.KUCOIN_SYMBOL_UPDATE_INTERVAL_MINS)) // Every 10min update our symbols. In case of new listings.
}

run()