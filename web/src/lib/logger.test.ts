import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { log, newRequestId } from './logger';

describe('log', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('emits a JSON line with level, message, and fields', () => {
    log.info('user.created', { userId: 7 });
    expect(logSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(record).toMatchObject({ level: 'info', message: 'user.created', userId: 7 });
    expect(typeof record.time).toBe('string');
  });

  it('routes error records to console.error', () => {
    log.error('boom', { cause: 'x' });
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('routes warn records to console.warn', () => {
    log.warn('slow', { ms: 5000 });
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('suppresses records below the configured threshold', () => {
    process.env.LOG_LEVEL = 'warn';
    log.info('noise');
    log.warn('signal');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('accepts unknown LOG_LEVEL by falling back to info', () => {
    process.env.LOG_LEVEL = 'chatty';
    log.info('hi');
    expect(logSpy).toHaveBeenCalledOnce();
  });
});

describe('newRequestId', () => {
  it('returns a non-empty string', () => {
    const id = newRequestId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns unique ids on successive calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(newRequestId());
    expect(seen.size).toBe(50);
  });
});
