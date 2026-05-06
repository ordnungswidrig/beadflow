import { useCallback, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

function md(text) {
  if (!text) return '';
  return DOMPurify.sanitize(marked.parse(text));
}

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

const MIN_W = 180;
const MAX_W = 600;
const DEFAULT_W = 300;

function useSidebarResize() {
  const widthRef = useRef(Number(localStorage.getItem('sidebar-width')) || DEFAULT_W);
  const sidebarRef = useRef(null);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarRef.current?.offsetWidth ?? widthRef.current;

    const onMove = (me) => {
      const delta = startX - me.clientX;
      const next = Math.min(MAX_W, Math.max(MIN_W, startW + delta));
      widthRef.current = next;
      if (sidebarRef.current) sidebarRef.current.style.width = `${next}px`;
    };
    const onUp = () => {
      localStorage.setItem('sidebar-width', widthRef.current);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  return { sidebarRef, onMouseDown, initialWidth: widthRef.current };
}

export function Sidebar({ selectedNode, allIssues, onFocusId, onAddVisible }) {
  const { sidebarRef, onMouseDown, initialWidth } = useSidebarResize();
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
    <aside className="sidebar" ref={sidebarRef} style={{ width: initialWidth }}>
      <div className="sidebar-resize-handle" onMouseDown={onMouseDown} />
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
              <div className="sb-md" dangerouslySetInnerHTML={{ __html: md(issue.description) }} />
            </Field>
          )}

          {issue.acceptance_criteria && (
            <Field label="Acceptance Criteria">
              <div className="sb-md" dangerouslySetInnerHTML={{ __html: md(issue.acceptance_criteria) }} />
            </Field>
          )}

          {issue.notes && (
            <Field label="Notes">
              <div className="sb-md" dangerouslySetInnerHTML={{ __html: md(issue.notes) }} />
            </Field>
          )}

          {issue.design && (
            <Field label="Design">
              <div className="sb-md" dangerouslySetInnerHTML={{ __html: md(issue.design) }} />
            </Field>
          )}

          {issue.close_reason && (
            <Field label="Close Reason">
              <div className="sb-md" dangerouslySetInnerHTML={{ __html: md(issue.close_reason) }} />
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
