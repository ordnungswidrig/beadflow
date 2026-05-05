import { useInternalNode } from '@xyflow/react';

const NODE_W = 240;
const NODE_H = 90;

function getNodeCenter(node) {
  const { width = NODE_W, height = NODE_H } = node.measured || {};
  return {
    x: node.internals.positionAbsolute.x + width / 2,
    y: node.internals.positionAbsolute.y + height / 2,
    w: width,
    h: height,
  };
}

// Returns border attachment point and outward normal at that point
function borderPoint(center, target) {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return { x: center.x, y: center.y, nx: 0, ny: -1 };
  const hw = center.w / 2;
  const hh = center.h / 2;
  if (Math.abs(dx) * hh > Math.abs(dy) * hw) {
    const sx = Math.sign(dx);
    return { x: center.x + sx * hw, y: center.y + dy * (hw / Math.abs(dx)), nx: sx, ny: 0 };
  } else {
    const sy = Math.sign(dy);
    return { x: center.x + dx * (hh / Math.abs(dy)), y: center.y + sy * hh, nx: 0, ny: sy };
  }
}

const ARROW_ID = 'beadflow-arrow';
const ARROW_SIZE = 8;

const TYPE_STROKE = {
  bug:     'rgba(220,85,85,0.5)',
  feature: 'rgba(167,139,250,0.5)',
  task:    'rgba(150,150,180,0.4)',
};
const PRIORITY_WIDTH = [2.5, 2, 1.5, 1.2, 0.8];
const PRIORITY_DASH = {
  task: '6,3',    // dashed
  feature: null,  // solid
  bug: '2,3',     // dotted
};

export function FloatingEdge({ id, source, target, data }) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const sc = getNodeCenter(sourceNode);
  const tc = getNodeCenter(targetNode);
  const sp = borderPoint(sc, tc);
  const tp = borderPoint(tc, sc);

  const dist = Math.sqrt((tp.x - sp.x) ** 2 + (tp.y - sp.y) ** 2) || 1;
  const handle = Math.max(60, dist * 0.4);

  const cx1 = sp.x + sp.nx * handle;
  const cy1 = sp.y + sp.ny * handle;
  const cx2 = tp.x + tp.nx * handle;
  const cy2 = tp.y + tp.ny * handle;

  // Path ends at arrowhead base (L px outside border), tip touches the border
  const ARROW_L = 9;
  const path = `M${sp.x},${sp.y} C${cx1},${cy1} ${cx2},${cy2} ${tp.x + tp.nx * ARROW_L},${tp.y + tp.ny * ARROW_L}`;

  // Cubic bezier midpoint at t=0.5
  const mx = (sp.x + 3*cx1 + 3*cx2 + tp.x) / 8;
  const my = (sp.y + 3*cy1 + 3*cy2 + tp.y) / 8;
  const depType = data?.depType;

  return (
    <>
      <defs>
        <marker
          id={ARROW_ID}
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(150,150,180,0.7)" />
        </marker>
      </defs>
      <path
        id={id}
        d={path}
        fill="none"
        strokeWidth={data?.critical ? 2 : (data?.closed ? 0.8 : (PRIORITY_WIDTH[data?.priority ?? 2] ?? 1.5))}
        stroke={data?.critical ? '#f0a500' : (data?.closed ? 'rgba(120,120,120,0.2)' : (TYPE_STROKE[data?.issueType] || TYPE_STROKE.task))}
        strokeDasharray={data?.critical ? undefined : (data?.closed ? '3,4' : (PRIORITY_DASH[data?.issueType] || undefined))}
        style={{ pointerEvents: 'none', cursor: 'default' }}
      />
      {/* Arrowhead polygon at tp, pointing inward along -normal */}
      {(() => {
        // Tip touches the border, base extends outward along the normal
        const px = -tp.ny; const py = tp.nx;  // perpendicular
        const L = 9; const W = 4;
        const tip = { x: tp.x, y: tp.y };
        const b1  = { x: tp.x + tp.nx * L + px * W, y: tp.y + tp.ny * L + py * W };
        const b2  = { x: tp.x + tp.nx * L - px * W, y: tp.y + tp.ny * L - py * W };
        const fill = data?.critical ? '#f0a500' : (data?.closed ? 'rgba(120,120,120,0.2)' : (TYPE_STROKE[data?.issueType] || TYPE_STROKE.task));
        return (
          <polygon
            points={`${tip.x},${tip.y} ${b1.x},${b1.y} ${b2.x},${b2.y}`}
            fill={fill}
            style={{ pointerEvents: 'none' }}
          />
        );
      })()}
      {depType && (
        <>
          <rect
            x={mx - 20} y={my - 8}
            width={40} height={16}
            rx={8}
            className="edge-label-pill"
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={mx} y={my}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
            fontSize="8"
            fontFamily="'IBM Plex Mono', monospace"
            letterSpacing="0.06em"
            fill={data?.closed ? '#555' : '#aaaabb'}
          >
            {depType}
          </text>
        </>
      )}
    </>
  );
}

// No longer needed — marker is defined inline in each edge
export function ArrowMarkerDef() { return null; }
