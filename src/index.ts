import axios from "axios";
import {logError} from "./utils/log";
import {tryCatchFinallyUtil} from "./utils/error";
import WebSocket from "ws";
import {fixDecimalPlaces} from "./utils/number";
import {
    accountBalanceNotification,
    buySignalStrikeNotification,
    buyUnitsNotification,
    sellLossNotification,
    sellProfitNotification,
    startServiceNotification
} from "./utils/telegram";
import {config} from "dotenv";

// Load .env properties
config();

const SUPPORTED_QUOTE_ASSETS: string[] = String(process.env.KUCOIN_QUOTE_ASSETS).split(",");
const getBaseAssetName = (tradingPair: string) => {
    let baseAssetName: string = tradingPair;

    // tslint:disable-next-line:prefer-for-of
    for (let i = 0; i < SUPPORTED_QUOTE_ASSETS.length; i++) {
        if (tradingPair.startsWith(SUPPORTED_QUOTE_ASSETS[i])) {
            return SUPPORTED_QUOTE_ASSETS[i];
        }
    }

    SUPPORTED_QUOTE_ASSETS.forEach((quoteAsset: string) => {
        baseAssetName = baseAssetName.replace(quoteAsset, '')
    });
    return baseAssetName;
}
const getQuoteAssetName = (tradingPair: string, baseAsset: string = "") => {
    if (!baseAsset) {
        return tradingPair.replace(getBaseAssetName(tradingPair), '')
    } else {
        return tradingPair.replace(baseAsset, '')
    }
}
const hasSupportedQuoteAsset = (tradingPair: string): boolean => {
    return SUPPORTED_QUOTE_ASSETS.reduce((previousValue, currentValue) => {
        return previousValue || (tradingPair.search(currentValue) !== -1 && tradingPair.endsWith(currentValue))
    }, false)
}

let webSocket: WebSocket;
const webSocketConfig = {
    url: "",
    token: "",
    pingInterval: 0,
    pingTimeout: 0
};
const symbols: {
    [symbol: string]: {
        amount: number
        buyPrice: number
        notificationBuyPrice: number
        notificationStrikeCount: number
        notificationStrikeTimeoutId: NodeJS.Timeout
        notificationStrikeUnitPrice: number
        tradingMinimumTime: number
        trailingSellPrice: number
        trailingSellPriceIntervalId: NodeJS.Timeout
        units: number
    }
} = {}

let ACCOUNT_USDT_BALANCE: number = 1000
export const buyUSDTTransaction = (time: number, Data: { [p: string]: any }) => {
    if (time > symbols[Data.subject].tradingMinimumTime &&
        ACCOUNT_USDT_BALANCE >= Number(process.env.TRADING_USDT_MIN_AMOUNT) &&
        !symbols[Data.subject].units
    ) {
        const tradingFunds: number = Number(process.env.TRADING_USDT_MIN_AMOUNT)
        const buyPrice: number = Number(Data.data.price)
        const units: number = fixDecimalPlaces((tradingFunds / buyPrice))

        ACCOUNT_USDT_BALANCE -= tradingFunds
        symbols[Data.subject].amount = tradingFunds
        symbols[Data.subject].buyPrice = buyPrice
        symbols[Data.subject].trailingSellPrice = fixDecimalPlaces(Number(process.env.TRADING_TRAILING_SELL_PCT) * buyPrice, 20)
        symbols[Data.subject].units = units

        buyUnitsNotification(Data.subject, units, buyPrice, 'USDT')

        symbols[Data.subject].trailingSellPriceIntervalId = setInterval(
            () => {
                symbols[Data.subject].trailingSellPrice = fixDecimalPlaces(
                    (1 + Number(process.env.TRADING_TRAILING_SELL_BUMP_PCT)) *
                    symbols[Data.subject].trailingSellPrice, 20);
            }, 1000 * 60 * Number(process.env.TRADING_TRAILING_SELL_BUMP_INTERVAL_MINS)
        )
    }
}

export const sellUSDTTransaction = (Data: { [p: string]: any }, time: number) => {
    const symbol = symbols[Data.subject];
    const sellAmount = fixDecimalPlaces(
        symbol.units * symbol.trailingSellPrice, 20
    );
    if (sellAmount > symbol.amount) {
        // Profit
        const profit: number = sellAmount - symbol.amount;
        const profitPCT: number = fixDecimalPlaces((profit / symbol.amount) * 100, 8)
        sellProfitNotification(Data.subject, symbol.units, profit, 'USDT', profitPCT)
    } else {
        // Loss
        const loss: number = symbol.amount - sellAmount;
        const lossPCT: number = fixDecimalPlaces((loss / symbol.amount) * 100, 8)
        sellLossNotification(Data.subject, symbol.units, loss, 'USDT', lossPCT)
    }

    ACCOUNT_USDT_BALANCE += sellAmount
    clearInterval(symbol.trailingSellPriceIntervalId)

    symbols[Data.subject] = {
        amount: 0,
        buyPrice: 0,
        notificationBuyPrice: 0,
        notificationStrikeCount: 0,
        notificationStrikeTimeoutId: undefined,
        notificationStrikeUnitPrice: 0,
        tradingMinimumTime: time + (Number(process.env.TRADING_NEW_SYMBOL_TIMEOUT_MINS) * 60 * 1000),
        trailingSellPrice: 0,
        trailingSellPriceIntervalId: undefined,
        units: 0
    }

    accountBalanceNotification(ACCOUNT_USDT_BALANCE, 'USDT')
}

const initialize = () => {
    // Obtain Server List and temporary public token
    axios.post(`${process.env.KUCOIN_REST_API_URL}/api/v1/bullet-public`)
        .then((response) => {
            tryCatchFinallyUtil(
                () => {
                    webSocketConfig.token = response.data.data.token;
                    webSocketConfig.url = response.data.data.instanceServers[0].endpoint;
                    webSocketConfig.pingInterval = response.data.data.instanceServers[0].pingInterval;
                    webSocketConfig.pingTimeout = response.data.data.instanceServers[0].pingTimeout;

                    webSocket = new WebSocket(`${webSocketConfig.url}?token=${webSocketConfig.token}`);

                    let pingIntervalId: NodeJS.Timeout;
                    const clearPingIntervalId = () => {
                        if (pingIntervalId) {
                            clearInterval(pingIntervalId);
                            pingIntervalId = undefined;
                        }
                    }

                    let pongTimeoutId: NodeJS.Timeout;
                    const clearPongTimeoutId = () => {
                        if (pongTimeoutId) {
                            clearTimeout(pongTimeoutId);
                            pongTimeoutId = undefined;
                        }
                    }

                    pingIntervalId = setInterval(() => {
                        webSocket.ping(JSON.stringify({
                            id: new Date().getTime(),
                            type: "ping"
                        }));

                        pongTimeoutId = setTimeout(() => {
                            webSocket.terminate();
                        }, webSocketConfig.pingTimeout) as NodeJS.Timeout;
                    }, webSocketConfig.pingInterval) as NodeJS.Timeout;

                    webSocket.on("open", () => {
                        // Subscribe
                        webSocket.send(JSON.stringify({
                            id: new Date().getTime(),
                            type: "subscribe",
                            topic: `/market/ticker:all`,
                            response: true
                        }));
                    });

                    webSocket.on("pong", (data: Buffer) => {
                        clearPongTimeoutId();
                    });

                    webSocket.on("message", (data) => {
                        tryCatchFinallyUtil(
                            () => {
                                const Data = JSON.parse(data.toString());
                                const time: number = new Date().getTime();

                                if (Data.subject && hasSupportedQuoteAsset(Data.subject)) {
                                    if (!symbols[Data.subject]) {
                                        symbols[Data.subject] = {
                                            amount: 0,
                                            buyPrice: 0,
                                            notificationBuyPrice: 0,
                                            notificationStrikeCount: 0,
                                            notificationStrikeTimeoutId: undefined,
                                            notificationStrikeUnitPrice: 0,
                                            tradingMinimumTime: time + (Number(process.env.TRADING_NEW_SYMBOL_TIMEOUT_MINS) * 60 * 1000),
                                            trailingSellPrice: 0,
                                            trailingSellPriceIntervalId: undefined,
                                            units: 0
                                        };
                                    } else {
                                        let symbol = symbols[Data.subject];
                                        // Notifications
                                        const newNotificationBuyPrice: number = symbol.notificationStrikeCount === 0 ?
                                            fixDecimalPlaces((1.00 + Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT)) * Data.data.price, 20) :
                                            fixDecimalPlaces(symbol.notificationBuyPrice + symbol.notificationStrikeUnitPrice, 20);

                                        if (symbol.notificationBuyPrice) {
                                            if (newNotificationBuyPrice < symbol.notificationBuyPrice) {
                                                symbols[Data.subject].notificationBuyPrice = newNotificationBuyPrice;
                                            }
                                        } else {
                                            symbols[Data.subject].notificationBuyPrice = newNotificationBuyPrice;
                                        }

                                        symbol = symbols[Data.subject];
                                        if (Data.data.price >= symbol.notificationBuyPrice && symbol.notificationBuyPrice !== 0) {
                                            symbols[Data.subject].notificationStrikeCount += 1;
                                            symbol = symbols[Data.subject];
                                            if (symbol.notificationStrikeCount === 1) {
                                                symbols[Data.subject].notificationStrikeUnitPrice = fixDecimalPlaces((symbol.notificationBuyPrice * Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT)) / (1.00 + Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT)), 20);
                                            }

                                            symbol = symbols[Data.subject];
                                            if (symbol.notificationStrikeCount > 1) {
                                                const baseAsset: string = getBaseAssetName(Data.subject).replace(process.env.KUCOIN_BASE_QUOTE_SEPARATOR, "");
                                                const quoteAsset: string = getQuoteAssetName(Data.subject).replace(process.env.KUCOIN_BASE_QUOTE_SEPARATOR, "");
                                                let shouldNotify: boolean = true;
                                                let i: number = 0;
                                                while (quoteAsset !== SUPPORTED_QUOTE_ASSETS[i]) {
                                                    if (symbols.hasOwnProperty(`${baseAsset}${process.env.KUCOIN_BASE_QUOTE_SEPARATOR}${SUPPORTED_QUOTE_ASSETS[i]}`)) {
                                                        shouldNotify = false;
                                                        break;
                                                    }
                                                    i++;
                                                }
                                                if (shouldNotify) buySignalStrikeNotification(Data.subject, Number(Data.data.price), symbol.notificationStrikeCount, Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_UNIT_PERCENT), getQuoteAssetName(Data.subject));

                                                // Buy USDT transaction
                                                if (quoteAsset === "USDT") {
                                                    buyUSDTTransaction(time, Data)
                                                }
                                            }

                                            if (symbol.notificationStrikeTimeoutId) clearTimeout(symbol.notificationStrikeTimeoutId);
                                            symbols[Data.subject].notificationStrikeTimeoutId = setTimeout(
                                                () => {
                                                    symbols[Data.subject].notificationStrikeCount = 0;
                                                    symbols[Data.subject].notificationBuyPrice = 0;
                                                    symbols[Data.subject].notificationStrikeUnitPrice = 0;

                                                    clearTimeout(symbols[Data.subject].notificationStrikeTimeoutId);
                                                    symbols[Data.subject].notificationStrikeTimeoutId = undefined;
                                                }, 1000 * 60 * Number(process.env.KUCOIN_NOTIFICATIONS_STRIKE_TIMEOUT_MINS) * symbol.notificationStrikeCount
                                            ) as NodeJS.Timeout;
                                            symbol = symbols[Data.subject];
                                            symbols[Data.subject].notificationBuyPrice = symbol.notificationBuyPrice + symbol.notificationStrikeUnitPrice
                                        }

                                        // Trail current price
                                        if (symbol.trailingSellPrice) {
                                            const newTrailingSellPrice: number = fixDecimalPlaces(
                                                (1 + Number(process.env.TRADING_TRAILING_SELL_BUMP_PCT)) * Number(Data.data.price), 20)
                                            if (newTrailingSellPrice > symbol.trailingSellPrice) {
                                                symbols[Data.subject].trailingSellPrice = newTrailingSellPrice
                                            }
                                        }

                                        // Sell USDT transaction
                                        if (Data.data.price < symbol.trailingSellPrice) {
                                            sellUSDTTransaction(Data, time)
                                        }
                                    }
                                }
                            },
                            (e) => {
                                webSocket.terminate();
                                logError(`initialize() web socket onMessage() error : ${e}`);
                            }
                        );
                    });

                    webSocket.on('error', (error => {
                        webSocket.terminate();
                        logError(`initialize() web socket onError() : ${error}`);
                    }));

                    webSocket.on('close', ((code, reason) => {
                        clearPingIntervalId();
                        if (code === 1006) { // ws.terminate()
                            webSocket = undefined;
                            initialize();
                        }
                    }));
                },
                (e) => {
                    logError(`initialize.response() error : ${e}`);
                }
            );
        }, (reason) => {
            logError(`initialize() error : ${reason}`);
        })
        .catch((reason) => {
            logError(`initialize() error : ${reason}`);
        });
}

// Program
startServiceNotification();
accountBalanceNotification(ACCOUNT_USDT_BALANCE, 'USDT')
initialize();

setInterval(() => {
    if (webSocket) {
        webSocket.terminate();
    } else {
        initialize();
    }

}, 1000 * 60 * 60 * Number(process.env.KUCOIN_WEBSOCKET_FORCE_TERMINATE_HRS)); // Every 6hrs force terminate websocket connection