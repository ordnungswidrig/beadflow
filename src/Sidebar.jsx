const STATUS_COLOR = {
  open: '#5b8dee',
  in_progress: '#f0a500',
  closed: '#4caf78',
};

const PRIORITY_LABEL = ['Critical', 'High', 'Medium', 'Low', 'Backlog'];

function Field({ label, children }) {
  return (
    <div className="sb-field">
      <div className="sb-field__label">{label}</div>
      <div className="sb-field__value">{children}</div>
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function Sidebar({ selectedNode, allIssues, onFocusId, onAddVisible }) {
  const issue = selectedNode?.data?.issue;
  const byId = Object.fromEntries((allIssues || []).map((i) => [i.id, i]));

  const deps = Array.isArray(issue?.dependencies) ? issue.dependencies : [];
  const blockedBy = deps
    .filter((d) => d.type !== 'parent-child')
    .map((d) => byId[d.depends_on_id])
    .filter(Boolean);
  const blocks = allIssues
    ? allIssues.filter((i) =>
        Array.isArray(i.dependencies) &&
        i.dependencies.some((d) => d.type !== 'parent-child' && d.depends_on_id === issue?.id)
      )
    : [];
  const children = allIssues
    ? allIssues.filter((i) =>
        Array.isArray(i.dependencies) &&
        i.dependencies.some((d) => d.type === 'parent-child' && d.depends_on_id === issue?.id)
      )
    : [];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="wordmark">bead<span>flow</span></span>
      </div>

      {!issue ? (
        <div className="sidebar-body">
          <div className="sidebar-empty-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="7" cy="7" r="2" fill="currentColor" opacity="0.4" />
            </svg>
          </div>
          <div className="sidebar-empty-label">Select a node</div>
          <div className="sidebar-empty-hint">
            click any node in the graph<br />to view issue details
          </div>
        </div>
      ) : (
        <div className="sidebar-detail">
          <div className="sb-id">{issue.id}</div>
          <div className="sb-title">{issue.title}</div>

          <div className="sb-badges">
            <span
              className="sb-badge"
              style={{
                background: (STATUS_COLOR[issue.status] || '#888') + '22',
                color: STATUS_COLOR[issue.status] || '#888',
              }}
            >
              {issue.status}
            </span>
            <span className="sb-badge sb-badge--neutral">
              P{issue.priority} · {PRIORITY_LABEL[issue.priority] ?? ''}
            </span>
            {issue.issue_type && (
              <span className="sb-badge sb-badge--neutral">{issue.issue_type}</span>
            )}
          </div>

          {issue.description && (
            <Field label="Description">
              <p className="sb-desc">{issue.description}</p>
            </Field>
          )}

          {issue.acceptance_criteria && (
            <Field label="Acceptance Criteria">
              <p className="sb-desc">{issue.acceptance_criteria}</p>
            </Field>
          )}

          {issue.notes && (
            <Field label="Notes">
              <p className="sb-desc">{issue.notes}</p>
            </Field>
          )}

          {issue.design && (
            <Field label="Design">
              <p className="sb-desc">{issue.design}</p>
            </Field>
          )}

          {issue.close_reason && (
            <Field label="Close Reason">
              <p className="sb-desc">{issue.close_reason}</p>
            </Field>
          )}

          {blockedBy.length > 0 && (
            <Field label={`Blocked by (${blockedBy.length})`}>
              {blockedBy.map((dep) => (
                <button key={dep.id} className="sb-dep sb-dep--btn" onClick={() => onFocusId?.(dep.id)}>
                  <span className="sb-dep__id">{dep.id}</span>
                  <span className="sb-dep__title">{dep.title}</span>
                </button>
              ))}
            </Field>
          )}

          {blocks.length > 0 && (
            <Field label={`Blocks (${blocks.length})`}>
              {blocks.map((dep) => (
                <button key={dep.id} className="sb-dep sb-dep--btn" onClick={() => onFocusId?.(dep.id)}>
                  <span className="sb-dep__id">{dep.id}</span>
                  <span className="sb-dep__title">{dep.title}</span>
                </button>
              ))}
            </Field>
          )}

          {children.length > 0 && (
            <Field label={`Children (${children.length})`}>
              {children.map((child) => (
                <button
                  key={child.id}
                  className="sb-dep sb-dep--btn"
                  onClick={() => { onAddVisible?.(child.id); onFocusId?.(child.id); }}
                >
                  <span className="sb-dep__id">{child.id}</span>
                  <span className="sb-dep__title">{child.title}</span>
                </button>
              ))}
            </Field>
          )}

          <div className="sb-meta">
            {issue.assignee && (
              <div className="sb-meta__row">
                <span className="sb-meta__key">Assignee</span>
                <span className="sb-meta__val">{issue.assignee}</span>
              </div>
            )}
            {issue.created_by && (
              <div className="sb-meta__row">
                <span className="sb-meta__key">Created by</span>
                <span className="sb-meta__val">{issue.created_by}</span>
              </div>
            )}
            {issue.created_at && (
              <div className="sb-meta__row">
                <span className="sb-meta__key">Created</span>
                <span className="sb-meta__val">{fmtDate(issue.created_at)}</span>
              </div>
            )}
            {issue.started_at && (
              <div className="sb-meta__row">
                <span className="sb-meta__key">Started</span>
                <span className="sb-meta__val">{fmtDate(issue.started_at)}</span>
              </div>
            )}
            {issue.closed_at && (
              <div className="sb-meta__row">
                <span className="sb-meta__key">Closed</span>
                <span className="sb-meta__val">{fmtDate(issue.closed_at)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
