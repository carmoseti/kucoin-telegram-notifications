import WebSocket from "ws"

export type KuCoinPublicTokenResponse = {
    code: string
    data: {
        token: string
        instanceServers: Array<{
            endpoint: string
            encrypt: boolean
            protocol: string
            pingInterval: number
            pingTimeout: number
        }>
    }
}

export type KuCoinSymbolsResponse = {
    "code": string
    "data": Array<{
        symbol: string
        name: string
        baseCurrency: string
        quoteCurrency: string
        feeCurrency: string
        market: string
        baseMinSize: string
        quoteMinSize: string
        baseMaxSize: string
        quoteMaxSize: string
        baseIncrement: string
        quoteIncrement: string
        priceIncrement: string
        priceLimitRate: string
        minFunds: string
        isMarginEnabled: boolean
        enableTrading: boolean
    }>
}

export type KuCoinWebSocketResponse = {
    type: "welcome" | "ack" | "message"
    id?: string
    subject?: "trade.ticker" | "trade.snapshot"
    topic?: string
    data: {
        bestAsk?: string
        bestAskSize?: string
        bestBid?: string
        bestBidSize?: string
        price?: string
        sequence?: string
        size?: string
        data?: {
            averagePrice: number
            baseCurrency: string
            board: number
            buy: number
            changePrice: number
            changeRate: number
            close: number
            datetime: number
            high: number
            lastTradedPrice: number
            low: number
            makerCoefficient: number
            makerFeeRate: number
            marginTrade: boolean
            mark: number
            market: string
            markets: Array<string>,
            open: number
            quoteCurrency: string
            sell: number
            sort: number
            symbol: string
            symbolCode: string
            takerCoefficient: number
            takerFeeRate: number
            trading: boolean
            vol: number
            volValue: number
        }
        time: number
    }
}

export type KuCoinTelegramTradingPairs = Record<string, {
    webSocketConnectionId: string
    symbol: string
    quoteCurrency: string
    baseDecimalPlaces: number
    quoteDecimalPlaces: number
    snapshotSubscriptionAckInterval: NodeJS.Timeout
    snapshotUnsubscriptionAckInterval: NodeJS.Timeout
    tickerSubscriptionAckInterval: NodeJS.Timeout
    tickerUnsubscriptionAckInterval: NodeJS.Timeout
    notificationBuyPrice :number
    notificationStrikeCount :number
    notificationStrikeTimeoutId :NodeJS.Timeout
    notificationStrikeUnitPrice :number
    apeInPercentage :number
    apeInTimeoutId :NodeJS.Timeout
}>

export type KuCoinTelegramWebSocketConnections = {
    [id: string]: {
        webSocket: WebSocket
        numberOfActiveSubscriptions: number
    }
}

export type KuCoinTelegramSymbols = {
    [baseCurrency: string]: {
        [quoteCurrency: string]: {
            symbol: string
            name: string
            baseCurrency: string
            quoteCurrency: string
            feeCurrency: string
            market: string
            baseMinSize: string
            quoteMinSize: string
            baseMaxSize: string
            quoteMaxSize: string
            baseIncrement: string
            quoteIncrement: string
            priceIncrement: string
            priceLimitRate: string
            minFunds: string
            isMarginEnabled: boolean
            enableTrading: boolean
        }
    }
}