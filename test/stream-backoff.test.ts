import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryAfterMs, streamWallet } from '../src/index.js';

describe('retryAfterMs', () => {
  it('reads delta seconds and HTTP dates, capped at 5 minutes', () => {
    expect(retryAfterMs('51')).toBe(51_000);
    expect(retryAfterMs(null)).toBe(0);
    expect(retryAfterMs('garbage')).toBe(0);
    expect(retryAfterMs('9999')).toBe(300_000);
    expect(retryAfterMs(new Date(1_000_000 + 20_000).toUTCString(), 1_000_000)).toBe(20_000);
  });
});

describe('streamWallet rate limiting', () => {
  afterEach(() => vi.useRealTimers());

  it('waits out a 429 Retry-After before reconnecting, and stop() ends the wait at once', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const statuses: string[] = [];
    const stop = streamWallet({
      wallet: '0x0000000000000000000000000000000000000001',
      fetch: async () => {
        calls++;
        return new Response(null, { status: 429, headers: { 'retry-after': '51' } });
      },
      onState: () => {},
      onStatus: (s) => statuses.push(s),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(calls).toBe(2);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe('stopped');
  });
});
