import axios from "axios"
import {tryCatchFinallyUtil} from "./error"
import {logError} from "./log"
import {sleep} from "./sleep"

export const startServiceNotification = () => {
    tryCatchFinallyUtil(() => {
        axios.post(`${process.env.TELEGRAM_API_URL}/${process.env.TELEGRAM_BOT_TOKEN_SECRET}/sendMessage`, {
            chat_id: process.env.TELEGRAM_BOT_CHAT_ID,
            text: `Hello ${process.env.USER_NAME}. Notification service is starting...`,
            parse_mode: "HTML"
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        }).catch(async (e) => {
            logError(`Telegram.startServiceNotification.axios() ${e}`)
            await sleep(1000)
            startServiceNotification()
        })
    }, async (e) => {
        logError(`Telegram.startServiceNotification() ${e}`)
        await sleep(1000)
        startServiceNotification()
    })
}

export const buySignalStrikeNotification = (symbol: string, price: number, strikeCount: number, strikeUnitPCT: number, quoteAsset: string) => {
    tryCatchFinallyUtil(() => {
        const printPrice = price.toLocaleString(['en-UK', 'en-US'], {
            maximumFractionDigits: 20,
        })

        const printStrikePCT: number = Math.floor(strikeUnitPCT * strikeCount * 100)

        axios.post(`${process.env.TELEGRAM_API_URL}/${process.env.TELEGRAM_BOT_TOKEN_SECRET}/sendMessage`, {
            chat_id: process.env.TELEGRAM_BOT_CHAT_ID,
            text: `${process.env.USER_NAME}, Checkout this trading pair => <b>${symbol.toUpperCase()}</b> currently at price <b>${printPrice} ${quoteAsset.replace("-", "")}</b>. It could be PUMPING!!! Strike count => ${strikeCount}. Percentage increase => ${printStrikePCT}%`,
            parse_mode: "HTML"
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        }).catch(async (e) => {
            logError(`Telegram.buySignalStrikeNotification.axios() ${e}`)
            await sleep(1000)
            buySignalStrikeNotification(symbol, price, strikeCount, strikeUnitPCT, quoteAsset)
        })
    }, async (e) => {
        logError(`Telegram.buySignalStrikeNotification() ${e}`)
        await sleep(1000)
        buySignalStrikeNotification(symbol, price, strikeCount, strikeUnitPCT, quoteAsset)
    })
}

export const sendApeInNotification = (symbol: string, percentageChange: number) => {
    tryCatchFinallyUtil(() => {
        axios.post(`${process.env.TELEGRAM_API_URL}/${process.env.TELEGRAM_APE_IN_BOT_TOKEN_SECRET}/sendMessage`, {
            chat_id: process.env.TELEGRAM_BOT_CHAT_ID,
            text: `&#128161; <b>KUCOIN</b>\n\nHello ${process.env.USER_NAME}\nCheckout <b>${symbol}</b> currently with percentage change: <b>${percentageChange}%</b> in the last 24hrs`,
            parse_mode: "HTML"
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        }).catch(async (e) => {
            logError(`Telegram.sendApeInNotification.axios() ${e}`)
            await sleep(1000)
            sendApeInNotification(symbol, percentageChange)
        })
    }, async (e) => {
        logError(`Telegram.sendApeInNotification() ${e}`)
        await sleep(1000)
        sendApeInNotification(symbol, percentageChange)
    })
}