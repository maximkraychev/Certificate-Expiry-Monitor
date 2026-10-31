import type { FetchCertificate } from '../core/certFetcher';
import { evaluate } from '../core/notificationRules';
import type { NotifiedStatus } from '../core/status';
import type { Database } from '../db/connection';
import { insertNotification, type NotificationLog } from '../db/repositories/notifications';
import { listTargets, updateLastNotifiedStatus } from '../db/repositories/targets';
import { buildDigest, type DigestItem, type SendMail } from '../mail/digest';
import { checkTarget } from './checks';
import { listRecipients } from './recipients';
import { formatHostPort } from './targets';

export interface NotificationDeps {
  fetchCertificate: FetchCertificate;
  sendMail: SendMail;
  now: () => Date;
}

export interface NotificationRunResult {
  checked: number;
  triggered: DigestItem[];
  /** Addresses the digest reached. */
  sent: string[];
  /** Addresses whose send was rejected, with the reason. */
  failed: { email: string; error: string }[];
  log: NotificationLog;
}

/**
 * The daily job: check every target, decide which ones trigger (decision 6), mail one digest to each
 * recipient, and log the run (decision 8). `last_notified_status` for triggered targets is written only once
 * at least one send succeeded (decision 7). Changes that never alert (reset on OK, silent lowering) are
 * written straight away, since they don't depend on anyone having been told.
 */
export async function runNotificationJob(db: Database, deps: NotificationDeps): Promise<NotificationRunResult> {
  const triggered: DigestItem[] = [];
  const pendingUpdates: { targetId: number; status: NotifiedStatus | null }[] = [];
  let checked = 0;

  for (const target of listTargets(db)) {
    const check = await checkTarget(db, target.id, deps);
    if (!check) continue; // deleted while the job ran
    checked++;

    const decision = evaluate(target.lastNotifiedStatus, check.status);
    const changed = decision.newLastNotified !== target.lastNotifiedStatus;
    if (decision.trigger) {
      triggered.push({
        host: target.host,
        port: target.port,
        status: check.status,
        daysLeft: check.daysLeft,
        validTo: check.validTo,
        error: check.error,
      });
      if (changed) pendingUpdates.push({ targetId: target.id, status: decision.newLastNotified });
    } else if (changed) {
      updateLastNotifiedStatus(db, target.id, decision.newLastNotified);
    }
  }

  const finish = (summary: string, sent: string[] = [], failed: NotificationRunResult['failed'] = []) => {
    const log = insertNotification(db, {
      sentAt: deps.now().toISOString(),
      recipientsCount: sent.length,
      summary,
    });
    return { checked, triggered, sent, failed, log };
  };

  if (triggered.length === 0) {
    return finish(`nothing triggered (${checked} checked)`);
  }

  const triggeredSummary = `triggered: ${triggered.map((item) => `${formatHostPort(item)} ${item.status}`).join(', ')}`;
  const recipients = listRecipients(db);
  if (recipients.length === 0) {
    return finish(`no recipients; ${triggeredSummary}`);
  }

  const digest = buildDigest(triggered, deps.now());
  const results = await Promise.allSettled(recipients.map((recipient) => deps.sendMail(recipient.email, digest)));
  const sent: string[] = [];
  const failed: NotificationRunResult['failed'] = [];
  results.forEach((result, i) => {
    const email = recipients[i].email;
    if (result.status === 'fulfilled') {
      sent.push(email);
    } else {
      failed.push({ email, error: errorMessage(result.reason) });
    }
  });

  if (sent.length > 0) {
    db.transaction(() => {
      for (const update of pendingUpdates) updateLastNotifiedStatus(db, update.targetId, update.status);
    })();
  }

  let summary = triggeredSummary;
  if (failed.length > 0) {
    summary += `; failed: ${failed.map((f) => `${f.email} (${f.error})`).join(', ')}`;
  }
  return finish(summary, sent, failed);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
