// Callback I/O has its own single-flight lane. Slow callbacks must not hold up
// MCP reads/replies, and shutdown must drain it before releasing the database.
export class DeliveryWorker {
  constructor(bridge, intervalMs = 1000) {
    this.bridge = bridge;
    this.closed = false;
    this.job = null;
    this.timer = setInterval(() => { void this.kick(); }, intervalMs);
    this.timer.unref();
  }
  kick() {
    if (this.closed || this.job) return this.job ?? Promise.resolve();
    this.job = Promise.resolve()
      .then(() => this.bridge.deliver({ shouldStop: () => this.closed }))
      .catch(() => {})
      .finally(() => { this.job = null; });
    return this.job;
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.job;
  }
}
