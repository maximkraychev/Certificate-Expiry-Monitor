import { Router } from 'express';
import type { Database } from '../../db/connection';
import { addRecipient, listRecipients, removeRecipient, type RecipientDeps } from '../../services/recipients';
import { renderNotFound } from '../errors';
import { bodyString, paramId } from '../request';
import { setFlash } from '../session';

export function recipientRoutes(db: Database, deps: RecipientDeps): Router {
  const router = Router();

  router.get('/recipients', (_req, res) => {
    res.render('recipients', { title: 'Recipients', recipients: listRecipients(db) });
  });

  router.post('/recipients', (req, res) => {
    const added = addRecipient(db, bodyString(req, 'email'), deps);
    if (added.ok) {
      setFlash(req, 'success', `Added ${added.recipient.email}. Alerts will be sent there.`);
    } else {
      setFlash(req, 'error', added.error);
    }
    res.redirect('/recipients');
  });

  router.post('/recipients/:id/delete', (req, res) => {
    const id = paramId(req);
    const removed = id === undefined ? undefined : removeRecipient(db, id);
    if (!removed) {
      renderNotFound(res);
      return;
    }
    setFlash(req, 'success', `Removed ${removed.email}.`);
    res.redirect('/recipients');
  });

  return router;
}
