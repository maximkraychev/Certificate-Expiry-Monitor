import { describe, expect, it } from 'vitest';
import { checkCredentials } from '../../src/services/auth';

const config = { adminUsername: 'admin', adminPassword: 's3cret' };

describe('checkCredentials', () => {
  it('accepts the configured username and password', () => {
    expect(checkCredentials(config, 'admin', 's3cret')).toBe(true);
  });

  it.each([
    ['wrong username', 'root', 's3cret'],
    ['wrong password', 'admin', 'nope'],
    ['both wrong', 'root', 'nope'],
    ['empty values', '', ''],
    ['a longer password with the right prefix', 'admin', 's3cret!'],
    ['different case', 'Admin', 's3cret'],
    ['swapped fields', 's3cret', 'admin'],
  ])('rejects %s', (_label, username, password) => {
    expect(checkCredentials(config, username, password)).toBe(false);
  });

  it('handles non-ASCII credentials', () => {
    const unicode = { adminUsername: 'админ', adminPassword: 'пароль🔑' };
    expect(checkCredentials(unicode, 'админ', 'пароль🔑')).toBe(true);
    expect(checkCredentials(unicode, 'админ', 'пароль')).toBe(false);
  });
});
