import { useState } from 'react';
import { Position } from '@xyflow/react';

const STATUS_COLOR = {
  open: '#5b8dee',
  in_progress: '#f0a500',
  closed: '#4caf78',
};

// Per-type accent hue (overrides status color for the top border)
const TYPE_ACCENT = {
  bug:      '#e05555',
  feature:  '#a78bfa',
  task:     '#5b8dee',
  epic:     '#a78bfa',
  chore:    '#5b8dee',
  decision: '#f0a500',
};

const TYPE_ICON = {
  bug:      '⬡',
  feature:  '◈',
  task:     '◻',
  epic:     '◆',
  chore:    '◻',
  decision: '◇',
};

const PRIORITY_LABEL = ['P0', 'P1', 'P2', 'P3', 'P4'];

// Priority → top border thickness and node opacity (for open issues)
const PRIORITY_BORDER = [3, 2.5, 2, 1.5, 1];
const PRIORITY_OPACITY = [1, 0.92, 0.82, 0.7, 0.55];

export function BeadNode({ data, selected }) {
  const { issue, inCount, outCount, childOpenCount, childClosedCount, parentCount, isLast, onCriticalPath, expand, closeNode, expandChildren, expandParent, pruneNode } = data;
  const [openChildrenExpanded, setOpenChildrenExpanded] = useState(false);
  const isClosed = issue.status === 'closed';
  const isEpic = issue.issue_type === 'epic';
  const statusColor = isClosed ? '#555' : (STATUS_COLOR[issue.status] || '#888');
  const typeAccent = isClosed ? '#444' : (TYPE_ACCENT[issue.issue_type] || TYPE_ACCENT.task);
  const icon = TYPE_ICON[issue.issue_type] || '◻';
  const priority = issue.priority ?? 2;
  const priorityLabel = PRIORITY_LABEL[priority] ?? `P${priority}`;
  const borderWidth = isClosed ? 1 : (isEpic ? Math.max(3, PRIORITY_BORDER[priority] ?? 2) + 1 : (PRIORITY_BORDER[priority] ?? 2));
  const nodeOpacity = isClosed ? 1 : (PRIORITY_OPACITY[priority] ?? 0.8);

  return (
    <div
      className={`bead-node bead-node--${issue.issue_type || 'task'}${selected ? ' bead-node--selected' : ''}${onCriticalPath ? ' bead-node--critical' : ''}${isEpic ? ' bead-node--epic' : ''}${issue.status === 'in_progress' ? ' bead-node--in-progress' : ''}`}
      style={{
        '--node-color': typeAccent,
        '--status-color': statusColor,
        '--top-border': `${borderWidth}px`,
        opacity: nodeOpacity,
        filter: isClosed ? 'saturate(0.2) brightness(0.85)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />

      {outCount > 0 && (
        <button
          className="expand-btn expand-btn--top"
          onClick={(e) => { e.stopPropagation(); expand(issue.id, 'out'); }}
          title={`Show ${outCount} dependenc${outCount > 1 ? 'ies' : 'y'}`}
        >
          +{outCount}
        </button>
      )}

      {parentCount > 0 && (
        <button
          className="expand-btn expand-btn--left"
          onClick={(e) => { e.stopPropagation(); expandParent(issue.id); }}
          title="Show parent epic"
        >
          +{parentCount}
        </button>
      )}

      {(childOpenCount > 0 || childClosedCount > 0) && (
        <button
          className={`expand-btn expand-btn--right${openChildrenExpanded || childOpenCount === 0 ? ' expand-btn--secondary' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!openChildrenExpanded && childOpenCount > 0) {
              expandChildren(issue.id, false);
              setOpenChildrenExpanded(true);
            } else {
              expandChildren(issue.id, true);
            }
          }}
          title={openChildrenExpanded
            ? `Show ${childClosedCount} closed child${childClosedCount !== 1 ? 'ren' : ''}`
            : childOpenCount > 0
              ? `Show ${childOpenCount} open${childClosedCount > 0 ? ` / ${childClosedCount} closed` : ''} child${childOpenCount + childClosedCount !== 1 ? 'ren' : ''}`
              : `Show ${childClosedCount} closed child${childClosedCount !== 1 ? 'ren' : ''}`}
        >
          {openChildrenExpanded
            ? `+${childClosedCount}`
            : childOpenCount > 0
              ? (childClosedCount > 0 ? `+${childOpenCount}/${childClosedCount}` : `+${childOpenCount}`)
              : `+${childClosedCount}`}
        </button>
      )}

      <div className="bead-node__header">
        <span className="bead-node__id">
          <span className="bead-node__type-icon">{icon}</span>
          {issue.id}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="bead-node__priority">{priorityLabel}</span>
          {!isLast && (
            <button
              className="bead-node__close"
              onClick={(e) => { e.stopPropagation(); closeNode(issue.id); }}
              title="Remove node"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="bead-node__title">{issue.title}</div>

      <div className="bead-node__footer">
        <span
          className="bead-node__status"
          style={issue.status === 'in_progress'
            ? { color: statusColor }
            : { background: statusColor + '22', color: statusColor }}
        >
          {issue.status}
        </span>
        <div className="bead-node__actions">
          {issue.metadata?.claude_session_id && (
            <span
              className="bead-node__claude-dot"
              title={`Claude session: ${issue.metadata.claude_session_id}`}
            />
          )}
          {!isLast && (
            <button
              className="bead-node__action-btn"
              onClick={(e) => { e.stopPropagation(); pruneNode(issue.id); }}
              title="Hide closed neighbors"
            >
              ⊙
            </button>
          )}
        </div>
      </div>

      {inCount > 0 && (
        <button
          className="expand-btn expand-btn--bottom"
          onClick={(e) => { e.stopPropagation(); expand(issue.id, 'in'); }}
          title={`Show ${inCount} dependent${inCount > 1 ? 's' : ''}`}
        >
          +{inCount}
        </button>
      )}
    </div>
  );
}
