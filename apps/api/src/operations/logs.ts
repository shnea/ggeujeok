import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../config.js';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
const messages = {
  'request.failed': 'API 요청 처리 실패',
  'platform.files.failed': '플랫폼 파일 요청 실패',
  'worker.failed': '백그라운드 작업 실패',
  'retention.completed': '보존 기간 정리 완료',
  'service.started': '서비스 시작',
} as const;
type Event = keyof typeof messages;
type Metadata = { requestId?: string; platformRequestId?: string; status?: number; component?: 'api' | 'worker' | 'files' | 'retention'; count?: number };
type Entry = { service: string; level: 'INFO' | 'ERROR'; message: string; timestamp: string; requestId?: string; attributes: Record<string, string | number> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Accept fixed events and explicit scalar fields only. Never serialize exceptions or request bodies.
export function logEntry(event: Event, metadata: Metadata = {}): Entry {
  const attributes: Record<string, string | number> = {};
  if (['api', 'worker', 'files', 'retention'].includes(metadata.component || '')) attributes.component = metadata.component!;
  if (Number.isInteger(metadata.status) && metadata.status! >= 100 && metadata.status! <= 599) attributes.status = metadata.status!;
  if (Number.isSafeInteger(metadata.count) && metadata.count! >= 0) attributes.count = metadata.count!;
  if (uuid.test(metadata.platformRequestId || '')) attributes.platformRequestId = metadata.platformRequestId!;
  const requestId = metadata.requestId || requestContext.getStore()?.requestId;
  return { service: 'ggeujeok', level: event.endsWith('.failed') ? 'ERROR' : 'INFO',
    message: messages[event] || '운영 이벤트', timestamp: new Date().toISOString(),
    ...(uuid.test(requestId || '') ? { requestId } : {}), attributes };
}

export class OperationalLogs {
  private queue: Entry[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private dropped = 0;
  private failedBatches = 0;
  constructor(private readonly send: typeof fetch = fetch,
    private readonly local: (value: unknown) => void = value => console.info(JSON.stringify(value)),
    private readonly key = config.PLATFORM_API_KEY) {}

  write(event: Event, metadata: Metadata = {}) {
    const entry = logEntry(event, metadata);
    this.local(entry);
    if (!this.key) return;
    if (this.queue.length >= 200) {
      this.dropped++;
      if (this.dropped === 1 || this.dropped % 50 === 0) this.local({ level: 'WARN', event: 'logs.queue_full', ...this.stats() });
      return;
    }
    this.queue.push(entry);
  }
  stats() { return { queued: this.queue.length, dropped: this.dropped, failedBatches: this.failedBatches }; }
  start() {
    if (!this.timer) { this.timer = setInterval(() => { void this.flush(); }, 2000); this.timer.unref(); }
  }
  flush() {
    if (!this.pending) this.pending = this.sendBatch().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async sendBatch() {
    const entries = this.queue.splice(0, 10);
    if (!entries.length) return;
    const signal = AbortSignal.timeout(5000);
    let accepted = false;
    for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
      try {
        const base = new URL(config.PLATFORM_URL);
        if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) break;
        const response = await this.send(new URL('/api/v1/logs', base), { method: 'POST', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', 'X-Platform-Key': this.key }, body: JSON.stringify({ entries }) });
        await response.body?.cancel();
        if (response.status === 202) { accepted = true; break; }
        if (response.status !== 429 && response.status < 500) break;
      } catch { /* A bounded retry can duplicate an accepted log; logs are not audit evidence. */ }
      if (attempt < 2) try { await delay(250 * 2 ** attempt, undefined, { signal }); } catch { break; }
    }
    if (!accepted) {
      this.failedBatches++; this.dropped += entries.length;
      this.local({ level: 'ERROR', event: 'logs.delivery_failed', ...this.stats() });
    }
  }
  async onApplicationShutdown() { await this.stop(); }
  async stop() {
    clearInterval(this.timer);
    await this.flush();
    if (this.queue.length) { this.dropped += this.queue.length; this.queue = []; this.local({ level: 'WARN', event: 'logs.shutdown_remaining', ...this.stats() }); }
  }
}
export const logs = new OperationalLogs();
