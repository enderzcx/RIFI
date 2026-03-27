import { getPortfolio } from '@/lib/chain/portfolio'
import { getPrice } from '@/lib/chain/price'

export async function GET() {
  try {
    const [portfolio, priceData] = await Promise.all([
      getPortfolio(),
      getPrice(),
    ])

    const wethValue = Number(portfolio.weth.formatted) * priceData.price
    const ethValue = Number(portfolio.eth.formatted) * priceData.price
    const usdcValue = Number(portfolio.usdc.formatted)
    const totalValue = wethValue + ethValue + usdcValue

    return Response.json({
      ...portfolio,
      price: priceData.price,
      totalValueUSD: totalValue.toFixed(2),
    })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
