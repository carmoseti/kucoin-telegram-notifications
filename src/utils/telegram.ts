import axios from "axios";

export const startServiceNotification = () => {
    axios.post(`${process.env.TELEGRAM_API_URL}/${process.env.TELEGRAM_BOT_TOKEN_SECRET}/sendMessage`, {
        chat_id: process.env.TELEGRAM_BOT_CHAT_ID,
        text: `Hello ${process.env.USER_NAME}. Notification service is starting...`,
        parse_mode: "HTML"
    }, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
}

export const buySignalStrikeNotification = (symbol: string, price: number, strikeCount: number, strikeUnitPCT: number, quoteAsset: string) => {
    const printPrice = price.toLocaleString(['en-UK', 'en-US'], {
        maximumFractionDigits: 20,
    })

    const printStrikePCT: number = Math.floor(strikeUnitPCT * strikeCount * 100);

    axios.post(`${process.env.TELEGRAM_API_URL}/${process.env.TELEGRAM_BOT_TOKEN_SECRET}/sendMessage`, {
        chat_id: process.env.TELEGRAM_BOT_CHAT_ID,
        text: `${process.env.USER_NAME}, Checkout this trading pair => <b>${symbol.toUpperCase()}</b> currently at price <b>${printPrice} ${quoteAsset.replace("-", "")}</b>. It could be PUMPING!!! Strike count => ${strikeCount}. Percentage increase => ${printStrikePCT}%`,
        parse_mode: "HTML"
    }, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
}

export const buyUnitsNotification = (symbol: string, units: number, price: number, quoteAsset: string) => {
    const printUnits = units.toLocaleString(['en-UK', 'en-US'], {
        maximumFractionDigits: 20,
    })

    const printPrice = price.toLocaleString(['en-UK', 'en-US'], {
        maximumFractionDigits: 20,
    })

    axios.post(`${process.env.TELEGRAM_API_URL}/${process.env.TELEGRAM_BOT_TOKEN_SECRET}/sendMessage`, {
        chat_id: process.env.TELEGRAM_BOT_CHAT_ID,
        text: `${process.env.USER_NAME}, <b>${printUnits} ${symbol.toUpperCase()}</b> bought at price <b>${printPrice} ${quoteAsset.replace("-", "")}</b>`,
        parse_mode: "HTML"
    }, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
}

export const sellProfitNotification = (symbol: string, units: number, price: number, quoteAsset: string, percentage: number) => {
    const printUnits = units.toLocaleString(['en-UK', 'en-US'], {
        maximumFractionDigits: 20,
    })

    const printPrice = price.toLocaleString(['en-UK', 'en-US'], {
        maximumFractionDigits: 20,
    })

    const printPercentage = percentage.toLocaleString(['en-UK', 'en-US'], {
        maximumFractionDigits: 4,
    })

    axios.post(`${process.env.TELEGRAM_API_URL}/${process.env.TELEGRAM_BOT_TOKEN_SECRET}/sendMessage`, {
        chat_id: process.env.TELEGRAM_BOT_CHAT_ID,
        text: `${process.env.USER_NAME}, <b>${printUnits} ${symbol.toUpperCase()}</b> sold at price <b>${printPrice} ${quoteAsset.replace("-", "")}</b>. PROFIT => <b>${printPercentage}%</b>`,
        parse_mode: "HTML"
    }, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
}

export const sellLossNotification = (symbol: string, units: number, price: number, quoteAsset: string, percentage: number) => {
    const printUnits = units.toLocaleString(['en-UK', 'en-US'], {
        maximumFractionDigits: 20,
    })

    const printPrice = price.toLocaleString(['en-UK', 'en-US'], {
        maximumFractionDigits: 20,
    })

    const printPercentage = percentage.toLocaleString(['en-UK', 'en-US'], {
        maximumFractionDigits: 4,
    })

    axios.post(`${process.env.TELEGRAM_API_URL}/${process.env.TELEGRAM_BOT_TOKEN_SECRET}/sendMessage`, {
        chat_id: process.env.TELEGRAM_BOT_CHAT_ID,
        text: `${process.env.USER_NAME}, <b>${printUnits} ${symbol.toUpperCase()}</b> sold at price <b>${printPrice} ${quoteAsset.replace("-", "")}</b>. LOSS => <b>${printPercentage}%</b>`,
        parse_mode: "HTML"
    }, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
}

export const accountBalanceNotification = (amount :number, currency :string) => {
    const printAmount = amount.toLocaleString(['en-UK', 'en-US'], {
        maximumFractionDigits: 20,
    })

    axios.post(`${process.env.TELEGRAM_API_URL}/${process.env.TELEGRAM_BOT_TOKEN_SECRET}/sendMessage`, {
        chat_id: process.env.TELEGRAM_BOT_CHAT_ID,
        text: `${process.env.USER_NAME}, current account balance => <b>${printAmount} ${currency}</b>`,
        parse_mode: "HTML"
    }, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
}