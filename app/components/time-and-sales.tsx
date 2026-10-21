import { DEMO_TRADES } from "@/app/constants/time-and-sales";

export function TimeAndSales({ symbol }: { symbol: string }) {
  return (
    <table className="market-table time-and-sales">
      <caption>
        <strong>{symbol} · T &amp; S</strong>
        <span>Demo data</span>
      </caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Price</th>
          <th scope="col">Size</th>
          <th scope="col">Side</th>
        </tr>
      </thead>
      <tbody>
        {DEMO_TRADES.map((trade) => (
          <tr key={trade.time}>
            <td>{trade.time}</td>
            <td>{trade.price.toFixed(2)}</td>
            <td>{trade.size}</td>
            <td className={trade.side === "Buy" ? "market-buy" : "market-sell"}>{trade.side}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
