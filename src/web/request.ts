import type { Request } from 'express';

/** A form field as a string. Missing fields and repeated fields (arrays) become ''. */
export function bodyString(req: Request, name: string): string {
  const value: unknown = req.body?.[name];
  return typeof value === 'string' ? value : '';
}
