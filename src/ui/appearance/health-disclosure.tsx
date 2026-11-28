import type { ThemeAuditReport } from '../../core/theming/audit';
import { Badge, Disclosure } from '../primitives';

export interface AuditState {
  readonly report: ThemeAuditReport;
  readonly runCount: number;
  readonly ranAt: string;
  readonly lastAction: 'audit' | 'heal';
  readonly healedCount?: number;
  readonly beforeScore?: number;
}

export interface ThemeHealthDisclosureProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly jumpId?: string;
  readonly auditState: AuditState | null;
  readonly hasHeal: boolean;
  readonly onRunAudit: () => void;
  readonly onRunHeal: () => void;
}

export function ThemeHealthDisclosure({
  open,
  onToggle,
  jumpId,
  auditState,
  hasHeal,
  onRunAudit,
  onRunHeal,
}: ThemeHealthDisclosureProps) {
  const auditReport = auditState?.report ?? null;
  const healableCount = auditReport
    ? auditReport.summary.contrast + auditReport.summary.polarityLeak
    : null;
  const geometryIssues = auditReport
    ? auditReport.summary.layoutShift + auditReport.summary.headerOcclusion
    : 0;
  const healDisabled = healableCount === 0;
  const healNeedsAttention = healableCount !== null && healableCount > 0;

  return (
    <Disclosure
      label="Theme health & layout check"
      badge={
        auditReport ? (
          <Badge tone={auditReport.violations.length === 0 ? 'success' : 'warning'}>
            {auditReport.score}%
          </Badge>
        ) : undefined
      }
      open={open}
      onToggle={onToggle}
      {...(jumpId ? { jumpId } : {})}
    >
      <div className="theme-drawer-pad">
        <div className="theme-actions">
          <span className="theme-audit-subtitle">
            Adaptive theming automatically heals new elements and contrast on every visit.
          </span>
          <div className="theme-audit-buttons">
            <button className="button" type="button" onClick={onRunAudit}>
              Audit page
            </button>
            {hasHeal && (
              <button
                className={healNeedsAttention ? 'button theme-heal-ready' : 'button'}
                type="button"
                disabled={healDisabled}
                title={
                  healDisabled
                    ? 'No contrast or unthemed surface issues to heal'
                    : 'Re-compile adaptive styles and fix contrast or unthemed surfaces now'
                }
                onClick={onRunHeal}
              >
                Auto-heal now
              </button>
            )}
          </div>
        </div>
        {auditState && auditReport && (
          <div
            key={auditState.runCount}
            className="theme-audit-result"
            data-healthy={auditReport.violations.length === 0 ? 'true' : 'false'}
            role="status"
          >
            <div className="theme-audit-bar-row">
              <span className="theme-audit-score">
                <strong>{auditReport.score}% coverage</strong> ({auditReport.totalChecked} elements
                checked)
              </span>
              <span className="theme-audit-time">Checked {auditState.ranAt}</span>
            </div>
            <div className="theme-audit-meter" aria-hidden="true">
              <div
                className="theme-audit-meter-fill"
                style={{ width: `${Math.max(0, Math.min(100, auditReport.score))}%` }}
              />
            </div>
            {auditState.lastAction === 'heal' && (
              <p className="theme-audit-feedback">
                {(() => {
                  if (auditState.healedCount && auditState.healedCount > 0) {
                    const delta =
                      auditState.beforeScore !== undefined &&
                      auditState.beforeScore !== auditReport.score
                        ? ` (${auditState.beforeScore}% → ${auditReport.score}%)`
                        : '';
                    const noun = auditState.healedCount === 1 ? 'element' : 'elements';
                    return `Fixed ${auditState.healedCount} ${noun} on this page${delta}. Adaptive healing stays active automatically on future visits.`;
                  }
                  if (healableCount === 0) {
                    return 'Re-compiled styles and scanned the page — no unhealed contrast or surface issues found.';
                  }
                  const remaining = healableCount ?? 0;
                  const phrase = remaining === 1 ? 'issue needs' : 'issues need';
                  return `Re-compiled styles — ${remaining} remaining contrast/surface ${phrase} a higher-contrast palette or custom CSS.`;
                })()}
              </p>
            )}
            <p className="theme-audit-summary">
              <span data-has-issue={auditReport.summary.contrast > 0 ? 'true' : undefined}>
                {auditReport.summary.contrast} contrast
              </span>
              ,{' '}
              <span data-has-issue={auditReport.summary.polarityLeak > 0 ? 'true' : undefined}>
                {auditReport.summary.polarityLeak} unthemed surfaces
              </span>
              ,{' '}
              <span data-has-issue={auditReport.summary.layoutShift > 0 ? 'true' : undefined}>
                {auditReport.summary.layoutShift} layout shifts
              </span>
              ,{' '}
              <span data-has-issue={auditReport.summary.headerOcclusion > 0 ? 'true' : undefined}>
                {auditReport.summary.headerOcclusion} header overlaps
              </span>
              .
            </p>
            {geometryIssues > 0 && auditState.lastAction === 'heal' && (
              <p className="theme-audit-note">
                Layout shifts and header overlaps are reported for inspection and are not
                auto-modified.
              </p>
            )}
            {auditReport.violations.length > 0 && (
              <ul className="theme-audit-list">
                {(() => {
                  const seen = new Map<string, number>();
                  return auditReport.violations.slice(0, 6).map((v) => {
                    const base = `${v.kind}:${v.selector}:${v.detail}`;
                    const count = (seen.get(base) ?? 0) + 1;
                    seen.set(base, count);
                    return (
                      <li key={`${base}#${count}`}>
                        <code>{v.selector}</code> ({v.kind}): {v.detail}
                      </li>
                    );
                  });
                })()}
              </ul>
            )}
          </div>
        )}
      </div>
    </Disclosure>
  );
}
