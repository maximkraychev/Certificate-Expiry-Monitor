import type { Status } from '../core/status';
import { formatHostPort } from '../services/targets';
import { formatDate, formatDateTime } from '../web/format';

export interface DigestItem {
  host: string;
  port: number;
  status: Status;
  daysLeft: number | null;
  /** ISO-8601 UTC. */
  validTo: string | null;
  error: string | null;
}

export interface Digest {
  subject: string;
  text: string;
  html: string;
}

/** Sends one digest to one address. Rejects when the send fails. */
export type SendMail = (to: string, digest: Digest) => Promise<void>;

/** Digest order, worst first. ERROR goes after the date statuses. */
const ORDER: readonly Status[] = ['EXPIRED', 'CRITICAL', 'WARNING', 'ERROR', 'OK'];

/** The email for one scheduler run: every triggered target, worst first, in a table. */
export function buildDigest(items: readonly DigestItem[], now: Date): Digest {
  const sorted = [...items].sort(
    (a, b) =>
      ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
      a.host.localeCompare(b.host) ||
      a.port - b.port,
  );

  const counts = ORDER.map((status) => [status, sorted.filter((item) => item.status === status).length] as const)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status}`);
  const subject = `Certificate alert: ${counts.join(', ')}`;
  const intro = `Certificate check of ${formatDateTime(now.toISOString())} (Europe/Sofia).`;

  const rows = sorted.map((item) => ({
    target: formatHostPort(item),
    status: item.status,
    daysLeft: item.daysLeft === null ? '—' : String(item.daysLeft),
    expires: formatDate(item.validTo),
    error: item.status === 'ERROR' ? (item.error ?? 'Unknown error') : null,
  }));

  const text = [
    intro,
    '',
    ...rows.map((row) =>
      row.error === null
        ? `${row.target}  ${row.status}  ${row.daysLeft} days left  expires ${row.expires}`
        : `${row.target}  ${row.status}  ${row.error}`,
    ),
    '',
  ].join('\n');

  const cell = 'style="padding:4px 8px;border:1px solid #ccc;text-align:left"';
  const htmlRows = rows
    .map((row) => {
      const details =
        row.error === null
          ? `<td ${cell}>${row.daysLeft}</td><td ${cell}>${escapeHtml(row.expires)}</td>`
          : `<td ${cell} colspan="2">${escapeHtml(row.error)}</td>`;
      return `<tr><td ${cell}>${escapeHtml(row.target)}</td><td ${cell}>${row.status}</td>${details}</tr>`;
    })
    .join('\n');
  const html = `<p>${escapeHtml(intro)}</p>
<table style="border-collapse:collapse">
<thead><tr><th ${cell}>Target</th><th ${cell}>Status</th><th ${cell}>Days left</th><th ${cell}>Expires</th></tr></thead>
<tbody>
${htmlRows}
</tbody>
</table>
`;

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
