import { createHash, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config';

type Credentials = Pick<Config, 'adminUsername' | 'adminPassword'>;

/**
 * Constant-time check of the single admin login. Hashing first gives equal-length buffers for
 * `timingSafeEqual`, and both comparisons always run so the timing doesn't reveal which one failed.
 */
export function checkCredentials(config: Credentials, username: string, password: string): boolean {
  const usernameOk = timingSafeEqual(sha256(username), sha256(config.adminUsername));
  const passwordOk = timingSafeEqual(sha256(password), sha256(config.adminPassword));
  return (Number(usernameOk) & Number(passwordOk)) === 1;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
