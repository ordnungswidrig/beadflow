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

export function Sidebar({ selectedNode, allIssues, onFocusId }) {
  const issue = selectedNode?.data?.issue;
  const byId = Object.fromEntries((allIssues || []).map((i) => [i.id, i]));

  const deps = Array.isArray(issue?.dependencies) ? issue.dependencies : [];
  const blockedBy = deps.map((d) => byId[d.depends_on_id]).filter(Boolean);
  const blocks = allIssues
    ? allIssues.filter((i) =>
        Array.isArray(i.dependencies) &&
        i.dependencies.some((d) => d.depends_on_id === issue?.id)
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
          </div>

          {issue.description && (
            <Field label="Description">
              <p className="sb-desc">{issue.description}</p>
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

          {issue.notes && (
            <Field label="Notes">
              <p className="sb-desc">{issue.notes}</p>
            </Field>
          )}
        </div>
      )}
    </aside>
  );
}
