import axios from "axios"
import {logError} from "./utils/log"
import {tryCatchFinallyUtil} from "./utils/error"
import WebSocket from "ws"
import {fixDecimalPlaces} from "./utils/number"
import {buySignalStrikeNotification, sendApeInNotification, startServiceNotification} from "./utils/telegram"
import {config} from "dotenv"

// Load .env properties
config()

const SUPPORTED_QUOTE_ASSETS: string[] = String(process.env.KUCOIN_QUOTE_ASSETS).split(",")
const getBaseAssetName = (tradingPair: string): string => {
    const regExp: RegExp = new RegExp(`^(\\w+)`+String(process.env.KUCOIN_BASE_QUOTE_SEPARATOR)+`(` + SUPPORTED_QUOTE_ASSETS.join('|') + `)$`)
    return tradingPair.replace(regExp, '$1')
}
const getQuoteAssetName = (tradingPair: string): string => {
    return tradingPair.replace(getBaseAssetName(tradingPair), '')
}
const hasSupportedQuoteAsset = (tradingPair: string): boolean => {
    return SUPPORTED_QUOTE_ASSETS.reduce((previousValue, currentValue) => {
        return previousValue || (tradingPair.search(currentValue) !== -1 && tradingPair.endsWith(currentValue))
    }, false)
}
const shouldNotify = (symbol: string): boolean => {
    const baseAsset: string = getBaseAssetName(symbol)
    const quoteAsset: string = getQuoteAssetName(symbol).replace(process.env.KUCOIN_BASE_QUOTE_SEPARATOR, "")
    let notify: boolean = true
    let i: number = 0
    while (quoteAsset !== SUPPORTED_QUOTE_ASSETS[i]) {
        if (symbols.hasOwnProperty(`${baseAsset}${process.env.KUCOIN_BASE_QUOTE_SEPARATOR}${SUPPORTED_QUOTE_ASSETS[i]}`)) {
            notify = false
            break
        }
        i++
    }
    return notify
}

let webSocket: WebSocket
const webSocketConfig = {
    url: "",
    token: "",
    pingInterval: 0,
    pingTimeout: 0
}
const symbols: {
    [symbol: string]: {
        notificationBuyPrice: number
        notificationStrikeCount: number
        notificationStrikeTimeoutId: NodeJS.Timeout
        notificationStrikeUnitPrice: number
        apeInPercentage: number
        apeInTimeoutId: NodeJS.Timeout
    }
} = {}

const notificationService = () => {
    webSocket = new WebSocket(`${webSocketConfig.url}?token=${webSocketConfig.token}`)

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
        }, webSocketConfig.pingTimeout) as NodeJS.Timeout
    }, webSocketConfig.pingInterval) as NodeJS.Timeout

    webSocket.on("open", () => {
        // Subscribe
        webSocket.send(JSON.stringify({
            id: new Date().getTime(),
            type: "subscribe",
            topic: `/market/ticker:all`,
            response: true
        }))
        const markets: string[] = `${process.env.KUCOIN_MARKETS}`.split(',')
        for (const market of markets) {
            webSocket.send(JSON.stringify({
                id: new Date().getTime(),
                type: "subscribe",
                topic: `/market/snapshot:${market}`,
                response: true
            }))
        }
    })

    webSocket.on("pong", (data: Buffer) => {
        clearPongTimeoutId()
    })

    webSocket.on("message", (data) => {
        tryCatchFinallyUtil(
            () => {
                const Data = JSON.parse(data.toString())

                if (Data.subject === 'trade.snapshot') {
                    // Handle snapshot
                    const apeInParameters = symbols[Data.data.data.symbol]
                    const percentChange :number = Math.round(((Number(Data.data.data.lastTradedPrice) - Number(Data.data.data.high))/Number(Data.data.data.high)) * 10000) / 100
                    if (apeInParameters && (percentChange < apeInParameters.apeInPercentage) &&
                        // Avoid false -100% notifications from new-listings
                        percentChange !== 100) {
                        if (shouldNotify(Data.data.data.symbol)) sendApeInNotification(Data.data.data.symbol, percentChange)

                        // Set next percentage
                        apeInParameters.apeInPercentage = apeInParameters.apeInPercentage + Number(process.env.APE_IN_INCREMENT_PERCENTAGE)
                        if (apeInParameters.apeInTimeoutId) {
                            clearTimeout(apeInParameters.apeInTimeoutId)
                        }
                        apeInParameters.apeInTimeoutId = setTimeout(() => {
                            // Reset notification percentage
                            apeInParameters.apeInPercentage = Number(process.env.APE_IN_START_PERCENTAGE)

                            clearTimeout(apeInParameters.apeInTimeoutId)
                            apeInParameters.apeInTimeoutId = undefined
                        }, 1000 * 60 * 60 * Number(process.env.APE_IN_PERCENT_TIMEOUT_HRS))
                    }
                } else {
                    if (Data.subject && hasSupportedQuoteAsset(Data.subject)) {
                        if (!symbols[Data.subject]) {
                            symbols[Data.subject] = {
                                notificationBuyPrice: 0,
                                notificationStrikeCount: 0,
                                notificationStrikeTimeoutId: undefined,
                                notificationStrikeUnitPrice: 0,
                                apeInPercentage: Number(process.env.APE_IN_START_PERCENTAGE),
                                apeInTimeoutId: undefined
                            }
                        } else {
                            let symbol = symbols[Data.subject]
                            // Notifications
                            const newNotificationBuyPrice: number = symbol.notificationStrikeCount === 0 ?
                                fixDecimalPlaces((1.00 + Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT)) * Data.data.price, 12) :
                                fixDecimalPlaces(symbol.notificationBuyPrice + symbol.notificationStrikeUnitPrice, 12)

                            if (symbol.notificationBuyPrice) {
                                if (newNotificationBuyPrice < symbol.notificationBuyPrice) {
                                    symbols[Data.subject].notificationBuyPrice = newNotificationBuyPrice
                                }
                            } else {
                                symbols[Data.subject].notificationBuyPrice = newNotificationBuyPrice
                            }

                            symbol = symbols[Data.subject]
                            if (Data.data.price >= symbol.notificationBuyPrice && symbol.notificationBuyPrice !== 0) {
                                symbols[Data.subject].notificationStrikeCount += 1
                                symbol = symbols[Data.subject]
                                if (symbol.notificationStrikeCount === 1) {
                                    symbols[Data.subject].notificationStrikeUnitPrice = fixDecimalPlaces((symbol.notificationBuyPrice * Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT)) / (1.00 + Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT)), 12)
                                }

                                symbol = symbols[Data.subject]
                                if (symbol.notificationStrikeCount > 1) {
                                    if (shouldNotify(Data.subject)) buySignalStrikeNotification(Data.subject, Number(Data.data.price), symbol.notificationStrikeCount, Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT), getQuoteAssetName(Data.subject))
                                }

                                if (symbol.notificationStrikeTimeoutId) clearTimeout(symbol.notificationStrikeTimeoutId)
                                symbols[Data.subject].notificationStrikeTimeoutId = setTimeout(
                                    () => {
                                        symbols[Data.subject].notificationStrikeCount = 0
                                        symbols[Data.subject].notificationBuyPrice = 0
                                        symbols[Data.subject].notificationStrikeUnitPrice = 0

                                        clearTimeout(symbols[Data.subject].notificationStrikeTimeoutId)
                                        symbols[Data.subject].notificationStrikeTimeoutId = undefined
                                    }, 1000 * 60 * Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_TIMEOUT_MINS) * symbol.notificationStrikeCount
                                ) as NodeJS.Timeout
                                symbol = symbols[Data.subject]
                                symbols[Data.subject].notificationBuyPrice = symbol.notificationBuyPrice + symbol.notificationStrikeUnitPrice
                            }
                        }
                    }
                }
            },
            (e) => {
                webSocket.terminate()
                logError(`initialize() web socket onMessage() error : ${e}`)
            }
        )
    })

    webSocket.on('error', (error => {
        webSocket.terminate()
        logError(`initialize() web socket onError() : ${error}`)
    }))

    webSocket.on('close', ((code, reason) => {
        clearPingIntervalId()
        if (code === 1006) { // ws.terminate()
            webSocket = undefined
            initialize()
        }
    }))
}

const initialize = () => {
    // Obtain Server List and temporary public token
    axios.post(`${process.env.KUCOIN_REST_API_URL}/api/v1/bullet-public`)
        .then((response) => {
            tryCatchFinallyUtil(
                () => {
                    webSocketConfig.token = response.data.data.token
                    webSocketConfig.url = response.data.data.instanceServers[0].endpoint
                    webSocketConfig.pingInterval = response.data.data.instanceServers[0].pingInterval
                    webSocketConfig.pingTimeout = response.data.data.instanceServers[0].pingTimeout

                    notificationService()
                },
                (e) => {
                    logError(`initialize.response() error : ${e}`)
                }
            )
        }, (reason) => {
            logError(`initialize() error : ${reason}`)
        })
        .catch((reason) => {
            logError(`initialize() error : ${reason}`)
        })
}

// Program
startServiceNotification()
initialize()

setInterval(() => {
    if (webSocket) {
        webSocket.terminate()
    } else {
        initialize()
    }

}, 1000 * 60 * 60 * Number(process.env.KUCOIN_WEBSOCKET_FORCE_TERMINATE_HRS)) // Every 6hrs force terminate websocket connection