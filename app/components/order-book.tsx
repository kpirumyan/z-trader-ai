import { DEMO_PRICE_LEVELS } from "@/app/constants/order-book";

export function OrderBook({ symbol }: { symbol: string }) {
  return (
    <table className="market-table order-book">
      <caption>
        <strong>{symbol} · Level II</strong>
        <span>Demo data</span>
      </caption>
      <thead>
        <tr>
          <th scope="col">Bid size</th>
          <th scope="col">Price</th>
          <th scope="col">Ask size</th>
        </tr>
      </thead>
      <tbody>
        {DEMO_PRICE_LEVELS.map((level) => (
          <tr key={level.price}>
            <td className={level.bidSize ? "market-buy" : undefined}>{level.bidSize}</td>
            <td>{level.price.toFixed(2)}</td>
            <td className={level.askSize ? "market-sell" : undefined}>{level.askSize}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
