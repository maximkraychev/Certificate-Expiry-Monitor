import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionStore } from '../../src/web/session';
import { createTestDb } from '../helpers';

describe('createSessionStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts no cleanup timer when clearing is off (the upstream store ignores clear: false)', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const db = createTestDb();

    createSessionStore(db, false);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    db.close();
  });

  it('starts an unref’d cleanup timer when clearing is on', () => {
    const unref = vi.fn();
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation((() => ({ unref })) as unknown as typeof setInterval);
    const db = createTestDb();

    createSessionStore(db, true);

    expect(setIntervalSpy).toHaveBeenCalledOnce();
    expect(unref).toHaveBeenCalledOnce();
    db.close();
  });

  it('keeps sessions in a sessions table in the app database', () => {
    const db = createTestDb();
    createSessionStore(db, false);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()).toEqual({
      name: 'sessions',
    });
    db.close();
  });
});
