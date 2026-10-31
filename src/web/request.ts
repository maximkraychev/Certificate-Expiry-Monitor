import type { Request } from 'express';

/** A form field as a string. Missing fields and repeated fields (arrays) become ''. */
export function bodyString(req: Request, name: string): string {
  const value: unknown = req.body?.[name];
  return typeof value === 'string' ? value : '';
}

/** The `:id` route parameter as a positive integer, or undefined when it isn't one (the route then 404s). */
export function paramId(req: Request): number | undefined {
  const value: unknown = req.params.id;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}
