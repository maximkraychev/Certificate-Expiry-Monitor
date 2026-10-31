import { Router } from 'express';
import type { Database } from '../../db/connection';
import type { CheckResult } from '../../db/repositories/checkResults';
import { checkTarget, getHistory, type CheckDeps } from '../../services/checks';
import { hasRecipients } from '../../services/recipients';
import { addTarget, deleteTarget, formatHostPort, getTarget, listTargetsWithLatestCheck } from '../../services/targets';
import { renderNotFound } from '../errors';
import { bodyString, paramId } from '../request';
import { setFlash } from '../session';

export function targetRoutes(db: Database, deps: CheckDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.render('dashboard', {
      title: 'Dashboard',
      targets: listTargetsWithLatestCheck(db),
      hasRecipients: hasRecipients(db),
    });
  });

  router.post('/targets', async (req, res) => {
    const added = addTarget(db, { host: bodyString(req, 'host'), port: bodyString(req, 'port') }, deps);
    if (!added.ok) {
      setFlash(req, 'error', added.error);
      res.redirect('/');
      return;
    }

    // The first check runs right away so the new row isn't blank (decision 4).
    const check = await checkTarget(db, added.target.id, deps);
    const name = formatHostPort(added.target);
    setFlash(req, 'success', check ? `Added ${name}. ${describeCheck(check)}` : `Added ${name}.`);
    res.redirect('/');
  });

  router.get('/targets/:id', (req, res) => {
    const id = paramId(req);
    const target = id === undefined ? undefined : getTarget(db, id);
    if (!target) {
      renderNotFound(res);
      return;
    }
    const history = getHistory(db, target.id);
    res.render('target', { title: formatHostPort(target), target, latestCheck: history[0] ?? null, history });
  });

  router.post('/targets/:id/check', async (req, res) => {
    const id = paramId(req);
    const target = id === undefined ? undefined : getTarget(db, id);
    const check = target && (await checkTarget(db, target.id, deps));
    if (!target || !check) {
      renderNotFound(res);
      return;
    }
    setFlash(req, check.status === 'ERROR' ? 'error' : 'success', `${formatHostPort(target)}: ${describeCheck(check)}`);
    // Only a fixed choice of pages to go back to, so the field can't be used as an open redirect.
    res.redirect(bodyString(req, 'from') === 'details' ? `/targets/${target.id}` : '/');
  });

  router.post('/targets/:id/delete', (req, res) => {
    const id = paramId(req);
    const target = id === undefined ? undefined : getTarget(db, id);
    if (!target || !deleteTarget(db, target.id)) {
      renderNotFound(res);
      return;
    }
    setFlash(req, 'success', `Stopped monitoring ${formatHostPort(target)}.`);
    res.redirect('/');
  });

  return router;
}

function describeCheck(check: CheckResult): string {
  if (check.status === 'ERROR') return `Check failed: ${check.error ?? 'unknown error'}`;
  return `Status ${check.status}, ${check.daysLeft} days left.`;
}
