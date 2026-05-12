/**
 * Observability: Metrics (T070)
 * In-process counters and histograms for feed pipeline operations.
 * Uses a simple in-memory accumulator pattern; replace with OpenTelemetry/Prometheus in production.
 */

export interface MetricsSnapshot {
  feed_sync_total: number;
  feed_sync_success: number;
  feed_sync_error: number;
  feed_sync_skipped: number;
  feed_simulation_latency_ms_sum: number;
  feed_simulation_latency_ms_count: number;
  feed_dispatch_latency_ms_sum: number;
  feed_dispatch_latency_ms_count: number;
  feed_queue_depth: number;
}

class MetricsRegistry {
  private counters: MetricsSnapshot = {
    feed_sync_total: 0,
    feed_sync_success: 0,
    feed_sync_error: 0,
    feed_sync_skipped: 0,
    feed_simulation_latency_ms_sum: 0,
    feed_simulation_latency_ms_count: 0,
    feed_dispatch_latency_ms_sum: 0,
    feed_dispatch_latency_ms_count: 0,
    feed_queue_depth: 0,
  };

  increment(name: keyof Pick<MetricsSnapshot, 'feed_sync_total' | 'feed_sync_success' | 'feed_sync_error' | 'feed_sync_skipped'>, by = 1): void {
    this.counters[name] += by;
  }

  recordSimulationLatency(ms: number): void {
    this.counters.feed_simulation_latency_ms_sum += ms;
    this.counters.feed_simulation_latency_ms_count += 1;
  }

  recordDispatchLatency(ms: number): void {
    this.counters.feed_dispatch_latency_ms_sum += ms;
    this.counters.feed_dispatch_latency_ms_count += 1;
  }

  setQueueDepth(depth: number): void {
    this.counters.feed_queue_depth = depth;
  }

  snapshot(): MetricsSnapshot {
    return { ...this.counters };
  }

  avgSimulationLatencyMs(): number | null {
    const { feed_simulation_latency_ms_count: count, feed_simulation_latency_ms_sum: sum } = this.counters;
    return count > 0 ? sum / count : null;
  }

  avgDispatchLatencyMs(): number | null {
    const { feed_dispatch_latency_ms_count: count, feed_dispatch_latency_ms_sum: sum } = this.counters;
    return count > 0 ? sum / count : null;
  }
}

export const metrics = new MetricsRegistry();
