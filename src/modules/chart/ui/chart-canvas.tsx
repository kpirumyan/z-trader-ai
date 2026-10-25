import styles from "./chart-canvas.module.css";

export interface ChartCanvasProps {
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly symbol: string;
  readonly candlesCount: number;
}

export function ChartCanvas({
  containerRef,
  isLoading,
  error,
  symbol,
  candlesCount,
}: ChartCanvasProps) {
  return (
    <div ref={containerRef} className={styles.canvasContainer} data-testid="chart-canvas-container">
      {isLoading && (
        <div className={styles.overlay} data-testid="chart-loading">
          <span>Loading chart data...</span>
        </div>
      )}

      {error && (
        <div className={styles.errorOverlay} data-testid="chart-error">
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && candlesCount === 0 && (
        <div className={styles.overlay} data-testid="chart-empty">
          <span>No market data available for {symbol}</span>
        </div>
      )}
    </div>
  );
}
