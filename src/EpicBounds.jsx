// EpicGroupNode: rendered as a React Flow node of type 'epicGroup'
// positioned and sized to wrap all visible children of an epic
export function EpicGroupNode({ data }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 12,
        border: '1.5px dashed rgba(91,141,238,0.3)',
        background: 'rgba(91,141,238,0.04)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        position: 'relative',
      }}
    >
      <span style={{
        position: 'absolute',
        top: 8,
        left: 12,
        fontSize: 9,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'rgba(91,141,238,0.5)',
        fontFamily: 'var(--font)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>
        {data.label}
      </span>
    </div>
  );
}

const PAD = 32;

// Compute epicGroup nodes from allIssues + current RF node positions
export function computeEpicGroupNodes(allIssues, rfNodes) {
  if (!allIssues || rfNodes.length === 0) return [];

  const epicChildren = {};
  for (const issue of allIssues) {
    for (const dep of (issue.dependencies || [])) {
      if (dep.type === 'parent-child') {
        const epicId = dep.depends_on_id;
        (epicChildren[epicId] = epicChildren[epicId] || []).push(issue.id);
      }
    }
  }

  const nodeById = Object.fromEntries(rfNodes.map((n) => [n.id, n]));
  const groupNodes = [];

  for (const [epicId, childIds] of Object.entries(epicChildren)) {
    const epicNode = nodeById[epicId];
    const childNodes = childIds.map((id) => nodeById[id]).filter(Boolean);
    if (!epicNode || childNodes.length === 0) continue;

    const all = [epicNode, ...childNodes];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of all) {
      const w = n.measured?.width ?? n.width ?? 240;
      const h = n.measured?.height ?? n.height ?? 90;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
    }

    const epicIssue = allIssues.find((i) => i.id === epicId);
    groupNodes.push({
      id: `__group_${epicId}`,
      type: 'epicGroup',
      position: { x: minX - PAD, y: minY - PAD },
      style: { width: maxX - minX + PAD * 2, height: maxY - minY + PAD * 2 },
      data: { label: epicIssue?.title ?? epicId },
      selectable: false,
      draggable: false,
      zIndex: -1,
    });
  }

  return groupNodes;
}
