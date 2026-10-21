import { DEMO_CANDLES } from "@/app/constants/chart";

export function Chart({ symbol }: { symbol: string }) {
  const minimum = Math.min(...DEMO_CANDLES.map((candle) => candle.low)) - 0.5;
  const maximum = Math.max(...DEMO_CANDLES.map((candle) => candle.high)) + 0.5;
  const priceY = (price: number) => 156 - ((price - minimum) / (maximum - minimum)) * 140;

  return (
    <figure className="demo-chart">
      <figcaption className="demo-content-heading">
        <strong>{symbol}</strong>
        <span>Demo data</span>
      </figcaption>
      <svg
        className="candlestick-chart"
        role="img"
        aria-label={`Candlestick chart for ${symbol}`}
        viewBox="0 0 320 184"
        width="320"
        height="184"
      >
        <desc>Static demonstration of eight one-minute candles. Prices are illustrative.</desc>
        {[100, 102, 104].map((price) => (
          <g key={price} className="chart-grid">
            <line x1="8" x2="274" y1={priceY(price)} y2={priceY(price)} />
            <text x="282" y={priceY(price) + 4}>
              {price}
            </text>
          </g>
        ))}
        {DEMO_CANDLES.map((candle, index) => (
          <g
            key={candle.time}
            className={candle.close >= candle.open ? "candle candle-up" : "candle candle-down"}
          >
            <title>{`${candle.time}: Open ${candle.open}, High ${candle.high}, Low ${candle.low}, Close ${candle.close}`}</title>
            <line
              x1={24 + index * 32}
              x2={24 + index * 32}
              y1={priceY(candle.high)}
              y2={priceY(candle.low)}
            />
            <rect
              x={16 + index * 32}
              y={priceY(Math.max(candle.open, candle.close))}
              width="16"
              height={Math.max(1, Math.abs(priceY(candle.open) - priceY(candle.close)))}
            />
          </g>
        ))}
        <g className="chart-time-label">
          <text x="8" y="178">
            09:30
          </text>
          <text x="232" y="178">
            09:37
          </text>
        </g>
      </svg>
    </figure>
  );
}
