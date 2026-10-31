import type { Response } from 'express';

export function renderNotFound(res: Response): void {
  res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
}
