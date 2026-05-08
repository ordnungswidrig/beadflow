import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceCenter,
  forceY,
  forceRadial,
} from 'd3-force';

const NODE_W = 240;
const NODE_H = 90;
const EPIC_W = 320;
const EPIC_H = 110;

// Find connected components (undirected) among a set of node ids and edges
function findClusters(ids, edges) {
  const parent = Object.fromEntries(ids.map((id) => [id, id]));
  function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
  function union(a, b) { parent[find(a)] = find(b); }
  for (const e of edges) {
    if (parent[e.source] !== undefined && parent[e.target] !== undefined)
      union(e.source, e.target);
  }
  const clusters = {};
  for (const id of ids) {
    const root = find(id);
    (clusters[root] = clusters[root] || []).push(id);
  }
  return Object.values(clusters);
}

// dep shape from bd export: {issue_id, depends_on_id, type}
// type='parent-child' = epic membership, not a blocking edge
function isBlockingDep(dep) {
  return dep.type !== 'parent-child';
}

function buildIndex(issues) {
  const byId = {};
  for (const issue of issues) byId[issue.id] = issue;
  const outgoing = {}; // id -> [ids this depends on (blockers)]
  const incoming = {}; // id -> [ids blocked by this]
  for (const issue of issues) {
    outgoing[issue.id] = outgoing[issue.id] || [];
    incoming[issue.id] = incoming[issue.id] || [];
    if (!Array.isArray(issue.dependencies)) continue;
    for (const dep of issue.dependencies) {
      if (!isBlockingDep(dep)) continue;
      const src = dep.depends_on_id; // blocker
      const tgt = dep.issue_id;      // blocked
      outgoing[tgt] = outgoing[tgt] || [];
      incoming[src] = incoming[src] || [];
      outgoing[tgt].push(src);
      incoming[src].push(tgt);
    }
  }
  return { byId, outgoing, incoming };
}

export function useBeadGraph(allIssues, setRfNodes, showCritical = false, selectedId = null) {
  const { byId, outgoing, incoming } = useMemo(
    () => (allIssues.length ? buildIndex(allIssues) : { byId: {}, outgoing: {}, incoming: {} }),
    [allIssues]
  );

  const [visibleIds, setVisibleIds] = useState(new Set());
  const [initialized, setInitialized] = useState(false);
  const prevIssueCountRef = useRef(0);
  const simRef = useRef(null);
  const simNodesRef = useRef([]);
  const prevNodeIdsRef = useRef(new Set());

  useEffect(() => {
    // Re-seed if issue list changed (e.g. after reload)
    if (allIssues.length > 0 && allIssues.length !== prevIssueCountRef.current) {
      prevIssueCountRef.current = allIssues.length;
      setInitialized(false);
      prevNodeIdsRef.current = new Set();
    }
  }, [allIssues.length]);

  useEffect(() => {
    if (!initialized && allIssues.length > 0) {
      const nonClosed = allIssues.filter((i) => i.status !== 'closed');
      const nonClosedIds = new Set(nonClosed.map((i) => i.id));

      // Build parent set: id -> true if it has a parent among non-closed issues
      const hasParent = new Set();
      for (const issue of nonClosed) {
        for (const dep of (issue.dependencies || [])) {
          if (dep.type === 'parent-child' && nonClosedIds.has(dep.depends_on_id)) {
            hasParent.add(issue.id);
          }
        }
      }

      // Root nodes: no blocking predecessors and no parent among non-closed
      const roots = nonClosed.filter((i) => {
        const blockers = (outgoing[i.id] || []).filter((dep) => nonClosedIds.has(dep));
        return blockers.length === 0 && !hasParent.has(i.id);
      });

      // Also include in-progress nodes
      const inProgress = nonClosed.filter((i) => i.status === 'in_progress');

      const seed = new Set([
        ...roots.map((i) => i.id),
        ...inProgress.map((i) => i.id),
      ]);

      // Expand seed with critical path nodes: nodes on shortest blocking paths between seed nodes
      // Build blocking adjacency among non-closed issues
      const adj = {}; // id -> [blocked-by-id (outgoing = blockers of id)]
      const radj = {}; // id -> [ids this blocks]
      for (const id of nonClosedIds) { adj[id] = []; radj[id] = []; }
      for (const issue of nonClosed) {
        for (const dep of (issue.dependencies || [])) {
          if (dep.type === 'parent-child') continue;
          const blocker = dep.depends_on_id;
          const blocked = dep.issue_id;
          if (nonClosedIds.has(blocker) && nonClosedIds.has(blocked)) {
            adj[blocked].push(blocker);   // blocked depends on blocker
            radj[blocker].push(blocked);  // blocker blocks blocked
          }
        }
      }

      // For each pair of seed nodes, find if there's a path through intermediate nodes
      // BFS from each seed node forward (via radj = who this node blocks) to find reachable seed nodes
      // Any node on a path between two seed nodes gets added
      const criticalIntermediate = new Set();
      for (const startId of seed) {
        // BFS forward tracking paths
        const visited = new Map(); // id -> predecessor
        const queue = [startId];
        visited.set(startId, null);
        while (queue.length) {
          const cur = queue.shift();
          for (const next of (radj[cur] || [])) {
            if (!visited.has(next)) {
              visited.set(next, cur);
              queue.push(next);
            }
            // If next is another seed node, trace back and mark intermediates
            if (seed.has(next) && next !== startId) {
              let trace = visited.get(next);
              while (trace && trace !== startId) {
                criticalIntermediate.add(trace);
                trace = visited.get(trace);
              }
            }
          }
        }
      }

      const visible = new Set([...seed, ...criticalIntermediate]);
      if (visible.size === 0) allIssues.forEach((i) => visible.add(i.id));
      setVisibleIds(visible);
      setInitialized(true);
    }
  }, [allIssues, initialized, outgoing]);

  const expand = useCallback((id, direction) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      const neighbors = direction === 'in' ? incoming[id] : outgoing[id];
      for (const n of neighbors || []) next.add(n);
      return next;
    });
  }, [incoming, outgoing]);

  const closeNode = useCallback((id) => {
    setVisibleIds((prev) => {
      if (prev.size <= 1) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Focus: center on node, expand all 1st-level connections both directions (including closed)
  const focus = useCallback((id) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      for (const n of (incoming[id] || [])) next.add(n);
      for (const n of (outgoing[id] || [])) next.add(n);
      return next;
    });
  }, [incoming, outgoing]);

  const hideClosed = useCallback(() => {
    setVisibleIds((prev) => {
      const next = new Set([...prev].filter((id) => byId[id]?.status !== 'closed'));
      return next.size > 0 ? next : prev;
    });
  }, [byId]);

  const pruneToSelected = useCallback((selectedId) => {
    if (!selectedId) return;
    setVisibleIds((prev) => {
      const next = new Set(prev);
      // blocking neighbors
      const neighbors = new Set([...(incoming[selectedId] || []), ...(outgoing[selectedId] || [])]);
      // parent-child neighbors
      for (const issue of allIssues) {
        for (const dep of (issue.dependencies || [])) {
          if (dep.type !== 'parent-child') continue;
          if (dep.depends_on_id === selectedId) neighbors.add(issue.id);
          if (issue.id === selectedId) neighbors.add(dep.depends_on_id);
        }
      }
      for (const n of neighbors) {
        if (byId[n]?.status === 'closed') next.delete(n);
      }
      return next;
    });
  }, [incoming, outgoing, byId, allIssues]);

  const showAll = useCallback(() => {
    setVisibleIds(new Set(allIssues.map((i) => i.id)));
  }, [allIssues]);

  const addVisible = useCallback((id) => {
    setVisibleIds((prev) => new Set([...prev, id]));
  }, []);

  const expandChildren = useCallback((id, closedOnly = false) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      for (const issue of allIssues) {
        for (const dep of (issue.dependencies || [])) {
          if (dep.type === 'parent-child' && dep.depends_on_id === id) {
            if (!closedOnly || issue.status === 'closed') next.add(issue.id);
          }
        }
      }
      return next;
    });
  }, [allIssues]);

  const expandParent = useCallback((id) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      for (const issue of allIssues) {
        for (const dep of (issue.dependencies || [])) {
          if (dep.type === 'parent-child' && dep.issue_id === id) next.add(dep.depends_on_id);
        }
      }
      return next;
    });
  }, [allIssues]);

  // Expand all neighbors of a node including parent-child relations
  const expandRelated = useCallback((id) => {
    if (!id) return;
    setVisibleIds((prev) => {
      const next = new Set(prev);
      // blocking edges (already in incoming/outgoing)
      for (const n of (incoming[id] || [])) next.add(n);
      for (const n of (outgoing[id] || [])) next.add(n);
      // parent-child: find all issues where dep.depends_on_id === id or issue.id === id
      for (const issue of allIssues) {
        for (const dep of (issue.dependencies || [])) {
          if (dep.type === 'parent-child') {
            if (dep.depends_on_id === id) next.add(issue.id); // child of id
            if (issue.id === id) next.add(dep.depends_on_id); // parent of id
          }
        }
      }
      return next;
    });
  }, [incoming, outgoing, allIssues]);

  // Recompute edges whenever visibleIds changes
  const { edges, nodeData } = useMemo(() => {
    const ids = [...visibleIds];
    const visibleSet = new Set(ids);

    const seenEdges = new Set();
    // First pass: collect visible blocking edges (directed: blocker→blocked) and epic memberships
    const blockingOut = {};  // blocker id -> Set of blocked ids
    const epicChildren = {}; // epicId -> Set of visible child ids
    for (const issue of allIssues) {
      if (!Array.isArray(issue.dependencies)) continue;
      for (const dep of issue.dependencies) {
        const src = dep.depends_on_id; // blocker / epic
        const tgt = dep.issue_id;      // blocked / child
        if (!visibleSet.has(src) || !visibleSet.has(tgt)) continue;
        if (dep.type === 'parent-child') {
          if (!epicChildren[src]) epicChildren[src] = new Set();
          epicChildren[src].add(tgt);
        } else {
          if (!blockingOut[src]) blockingOut[src] = new Set();
          blockingOut[src].add(tgt);
        }
      }
    }

    // For each epic, compute which children are reachable from another sibling via blocking edges
    // (i.e. there's a blocker→...→child path entirely within the sibling set)
    const reachableViaBlocking = {}; // epicId -> Set of child ids reachable through siblings
    for (const [epicId, children] of Object.entries(epicChildren)) {
      const reachable = new Set();
      const queue = [];
      // Seed: any child that is blocked by another sibling
      for (const child of children) {
        for (const blocker of children) {
          if (blocker !== child && blockingOut[blocker]?.has(child)) {
            if (!reachable.has(child)) { reachable.add(child); queue.push(child); }
          }
        }
      }
      // BFS: propagate through siblings
      while (queue.length) {
        const cur = queue.shift();
        for (const next of (blockingOut[cur] || [])) {
          if (children.has(next) && !reachable.has(next)) {
            reachable.add(next);
            queue.push(next);
          }
        }
      }
      reachableViaBlocking[epicId] = reachable;
    }

    const edges = [];
    const suppressedPCEdges = new Map(); // key -> edge obj, for critical path restoration
    for (const issue of allIssues) {
      if (!Array.isArray(issue.dependencies)) continue;
      for (const dep of issue.dependencies) {
        const src = dep.depends_on_id;
        const tgt = dep.issue_id;
        const key = `${src}->${tgt}`;
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        if (!visibleSet.has(src) || !visibleSet.has(tgt)) continue;
        const srcIssue = byId[src];
        const tgtIssue = byId[tgt];
        const edgeClosed = srcIssue?.status === 'closed' && tgtIssue?.status === 'closed';
        if (dep.type === 'parent-child') {
          // src=epic, tgt=child — suppress if child is reachable from a sibling via blocking edges
          if (reachableViaBlocking[src]?.has(tgt)) {
            suppressedPCEdges.set(key, { id: key, source: src, target: tgt, type: 'floating',
              data: { depType: 'parent-child', closed: edgeClosed, critical: false } });
            continue;
          }
          edges.push({
            id: key, source: src, target: tgt, type: 'floating',
            data: { depType: 'parent-child', closed: edgeClosed, critical: false },
          });
        } else {
          edges.push({
            id: key, source: src, target: tgt, type: 'floating',
            data: {
              issueType: srcIssue?.issue_type || 'task',
              priority: srcIssue?.priority ?? 2,
              closed: edgeClosed,
              depType: dep.type || 'blocks',
              critical: false,
            },
          });
        }
      }
    }

    // Mark critical edges after path is computed (mutate data in place below)
    // Compute critical path: longest chain through visible DAG
    // edges go src→tgt (src blocks tgt), so we traverse src→tgt
    const criticalNodes = new Set();
    const criticalEdges = new Set();
    if (ids.length > 1) {
      // Build adjacency for visible nodes — include suppressed parent-child edges for path tracing
      const adj = {}; // id -> [tgt]
      const radj = {}; // id -> [src]
      for (const id of ids) { adj[id] = []; radj[id] = []; }
      for (const e of edges) {
        adj[e.source]?.push(e.target);
        radj[e.target]?.push(e.source);
      }
      // Note: suppressed parent-child edges are intentionally excluded from path computation
      // because the sibling blocking chain that caused suppression provides a longer path.

      const selectedIssue = byId[selectedId];
      const isEpicSelected = selectedIssue?.issue_type === 'epic';

      if (selectedId && visibleSet.has(selectedId) && !isEpicSelected) {
        // Non-epic selected: show upstream path to longest root + downstream path to longest leaf
        const upDist = {}; const upPrev = {};
        for (const id of ids) { upDist[id] = -Infinity; upPrev[id] = null; }
        // Topological sort over the full visible graph for proper DAG longest-path
        const topoAll = (() => {
          const inD = {}; for (const id of ids) inD[id] = 0;
          for (const id of ids) for (const t of (adj[id] || [])) inD[t] = (inD[t] || 0) + 1;
          const q = ids.filter((id) => !inD[id]); const t = []; const vs = new Set(q);
          while (q.length) { const u = q.shift(); t.push(u); for (const v of (adj[u] || [])) { inD[v]--; if (inD[v] === 0 && !vs.has(v)) { vs.add(v); q.push(v); } } }
          return t;
        })();

        // Upstream: longest path from a root to selectedId (traverse reverse topo)
        upDist[selectedId] = 0;
        for (const u of [...topoAll].reverse()) {
          if (upDist[u] === -Infinity) continue;
          for (const src of (radj[u] || [])) {
            if (upDist[src] < upDist[u] - 1) { upDist[src] = upDist[u] - 1; upPrev[src] = u; }
          }
        }
        const upReachable = ids.filter((id) => upDist[id] > -Infinity);
        const root = upReachable.length ? upReachable.reduce((a, b) => upDist[a] <= upDist[b] ? a : b) : selectedId;
        let cur = root;
        while (cur) {
          criticalNodes.add(cur);
          if (upPrev[cur]) criticalEdges.add(`${cur}->${upPrev[cur]}`);
          cur = upPrev[cur];
        }

        // Downstream: longest path from selectedId to a leaf
        const dnDist = {}; const dnPrev = {};
        for (const id of ids) { dnDist[id] = -Infinity; dnPrev[id] = null; }
        dnDist[selectedId] = 0;
        for (const u of topoAll) {
          if (dnDist[u] === -Infinity) continue;
          for (const tgt of (adj[u] || [])) {
            if (dnDist[tgt] < dnDist[u] + 1) { dnDist[tgt] = dnDist[u] + 1; dnPrev[tgt] = u; }
          }
        }
        const dnReachable = ids.filter((id) => dnDist[id] > -Infinity);
        const leaf = dnReachable.length ? dnReachable.reduce((a, b) => dnDist[a] >= dnDist[b] ? a : b) : selectedId;
        cur = leaf;
        while (cur) {
          criticalNodes.add(cur);
          if (dnPrev[cur]) criticalEdges.add(`${dnPrev[cur]}->${cur}`);
          cur = dnPrev[cur];
        }
      } else if (isEpicSelected) {
        // Epic selected: longest chain scoped to the epic's subtree
        const subtree = new Set([selectedId]);
        const q = [selectedId];
        while (q.length) {
          const u = q.shift();
          for (const v of (adj[u] || [])) { if (!subtree.has(v)) { subtree.add(v); q.push(v); } }
        }
        let scopeIds = ids.filter((id) => subtree.has(id));
        const dist = {}; const prev = {};
        const scopeSet = new Set(scopeIds);
        for (const id of scopeIds) { dist[id] = 1; prev[id] = null; }
        const inDeg = {};
        for (const id of scopeIds) inDeg[id] = 0;
        for (const e of edges) { if (scopeSet.has(e.source) && scopeSet.has(e.target)) inDeg[e.target]++; }
        const queue = scopeIds.filter((id) => !inDeg[id]);
        const topo = [];
        const vis = new Set(queue);
        while (queue.length) {
          const u = queue.shift(); topo.push(u);
          for (const v of (adj[u] || [])) {
            if (!scopeSet.has(v)) continue;
            inDeg[v]--;
            if (inDeg[v] === 0 && !vis.has(v)) { vis.add(v); queue.push(v); }
          }
        }
        for (const u of topo) {
          for (const v of (adj[u] || [])) {
            if (!scopeSet.has(v)) continue;
            if (dist[u] + 1 > dist[v]) { dist[v] = dist[u] + 1; prev[v] = u; }
          }
        }
        let endNode = scopeIds.reduce((a, b) => dist[a] >= dist[b] ? a : b);
        let cur = endNode;
        while (cur) {
          criticalNodes.add(cur);
          if (prev[cur]) criticalEdges.add(`${prev[cur]}->${cur}`);
          cur = prev[cur];
        }
      }
    }

    // Mark critical edges (only when highlight is enabled)
    for (const e of edges) e.data.critical = showCritical && criticalEdges.has(e.id);
    // Restore suppressed parent-child edges that lie on the critical path
    if (showCritical) {
      for (const [key, e] of suppressedPCEdges) {
        if (criticalEdges.has(key)) {
          e.data.critical = true;
          edges.push(e);
        }
      }
    }

    // Count hidden parent-child neighbors per node
    const hiddenChildOpen = {};   // epicId -> count of hidden open children
    const hiddenChildClosed = {}; // epicId -> count of hidden closed children
    const hiddenParent = {};      // childId -> 1 if parent is hidden
    for (const issue of allIssues) {
      for (const dep of (issue.dependencies || [])) {
        if (dep.type !== 'parent-child') continue;
        const parent = dep.depends_on_id;
        const child = dep.issue_id;
        if (visibleSet.has(parent) && !visibleSet.has(child)) {
          const childIssue = byId[child];
          if (childIssue?.status === 'closed') {
            hiddenChildClosed[parent] = (hiddenChildClosed[parent] || 0) + 1;
          } else {
            hiddenChildOpen[parent] = (hiddenChildOpen[parent] || 0) + 1;
          }
        }
        if (visibleSet.has(child) && !visibleSet.has(parent)) {
          hiddenParent[child] = (hiddenParent[child] || 0) + 1;
        }
      }
    }

    const nodeData = ids.map((id) => ({
      id,
      issue: byId[id],
      onCriticalPath: showCritical && criticalNodes.has(id),
      inCount: (incoming[id] || []).filter((n) => !visibleSet.has(n)).length,
      outCount: (outgoing[id] || []).filter((n) => !visibleSet.has(n)).length,
      childOpenCount: hiddenChildOpen[id] || 0,
      childClosedCount: hiddenChildClosed[id] || 0,
      parentCount: hiddenParent[id] || 0,
      isLast: ids.length === 1,
    }));

    return { edges, nodeData };
  }, [visibleIds, allIssues, byId, incoming, outgoing, showCritical, selectedId]);

  // Run/restart the force simulation whenever the visible set changes
  useEffect(() => {
    if (nodeData.length === 0) return;

    const currentIds = new Set(nodeData.map((n) => n.id));
    const prevIds = prevNodeIdsRef.current;
    const hasNewNodes = [...currentIds].some((id) => !prevIds.has(id));
    prevNodeIdsRef.current = currentIds;

    // If only nodes were removed (no new nodes), just drop them from the sim without relayout
    if (!hasNewNodes && simRef.current) {
      simNodesRef.current = simNodesRef.current.filter((n) => currentIds.has(n.id));
      setRfNodes(simNodesRef.current.map((n, i) => {
        const nd = nodeData[i];
        const isEpic = nd?.issue?.issue_type === 'epic';
        const w = isEpic ? EPIC_W : NODE_W;
        const h = isEpic ? EPIC_H : NODE_H;
        return {
          id: n.id,
          position: { x: n.x - w / 2, y: n.y - h / 2 },
          selected: n.id === selectedId,
          data: {
            issue: nd?.issue,
            inCount: nd?.inCount ?? 0,
            outCount: nd?.outCount ?? 0,
            childOpenCount: nd?.childOpenCount ?? 0,
            childClosedCount: nd?.childClosedCount ?? 0,
            parentCount: nd?.parentCount ?? 0,
            isLast: nd?.isLast ?? false,
            expand, closeNode, focus, expandRelated, expandChildren, expandParent, pruneNode: pruneToSelected,
          },
          type: 'bead',
        };
      }));
      return;
    }

    // Find clusters for initial placement and cohesion force
    const clusters = findClusters(nodeData.map((n) => n.id), edges);
    const clusterCount = clusters.length;

    // Place cluster centers on a circle, nodes within each cluster on a smaller circle
    const clusterRadius = clusterCount > 1 ? Math.max(250, clusterCount * 120) : 0;
    const clusterCenter = {};  // id -> {x, y} of its cluster center
    clusters.forEach((members, ci) => {
      const angle = (2 * Math.PI * ci) / clusterCount;
      const cx = clusterCount > 1 ? Math.cos(angle) * clusterRadius : 0;
      const cy = clusterCount > 1 ? Math.sin(angle) * clusterRadius : 0;
      const innerR = Math.max(80, members.length * 40);
      members.forEach((id, mi) => {
        const a = (2 * Math.PI * mi) / members.length;
        clusterCenter[id] = { cx, cy, x: cx + Math.cos(a) * innerR, y: cy + Math.sin(a) * innerR };
      });
    });

    // Preserve positions of nodes already in the sim; place new ones at cluster positions
    const prevById = Object.fromEntries(simNodesRef.current.map((n) => [n.id, n]));
    const simNodes = nodeData.map(({ id }) => {
      const prev = prevById[id];
      const init = clusterCenter[id] || { x: 0, y: 0 };
      return prev
        ? { id, x: prev.x, y: prev.y, vx: prev.vx ?? 0, vy: prev.vy ?? 0, cx: init.cx, cy: init.cy }
        : { id, x: init.x, y: init.y, vx: 0, vy: 0, cx: init.cx, cy: init.cy };
    });
    simNodesRef.current = simNodes;

    // Establish full node objects before the sim ticks so the tick handler only needs to update positions
    setRfNodes(simNodes.map((n, i) => {
      const nd = nodeData[i];
      const isEpic = nd?.issue?.issue_type === 'epic';
      const w = isEpic ? EPIC_W : NODE_W;
      const h = isEpic ? EPIC_H : NODE_H;
      return {
        id: n.id,
        position: { x: n.x - w / 2, y: n.y - h / 2 },
        selected: n.id === selectedId,
        data: {
          issue: nd?.issue,
          inCount: nd?.inCount ?? 0,
          outCount: nd?.outCount ?? 0,
          childOpenCount: nd?.childOpenCount ?? 0,
          childClosedCount: nd?.childClosedCount ?? 0,
          parentCount: nd?.parentCount ?? 0,
          isLast: nd?.isLast ?? false,
          expand, closeNode, focus, expandRelated, expandChildren, expandParent, pruneNode: pruneToSelected,
        },
        type: 'bead',
      };
    }));

    const simNodeById = Object.fromEntries(simNodes.map((n) => [n.id, n]));
    const links = edges
      .map((e) => ({ source: simNodeById[e.source], target: simNodeById[e.target], depType: e.data?.depType }))
      .filter((l) => l.source && l.target);

    if (simRef.current) simRef.current.stop();

    const n = simNodes.length;
    // Scale forces to node count: less repulsion and tighter links for large graphs
    const chargeStrength = Math.max(-300, -500 * Math.min(1, 10 / n));
    const baseDistance = Math.max(160, 280 * Math.min(1, 12 / n));
    // Hard bound: keep nodes within a radius proportional to sqrt(n)
    const boundR = Math.max(400, 180 * Math.sqrt(n));

    const sim = forceSimulation(simNodes)
      .force('link', forceLink(links)
        .distance((l) => l.depType === 'parent-child' ? baseDistance * 1.8 : baseDistance)
        .strength((l) => l.depType === 'parent-child' ? 0.3 : 0.9)
      )
      .force('charge', forceManyBody().strength(chargeStrength))
      .force('collide', forceCollide((n) => {
        const nd = nodeData.find((d) => d.id === n.id);
        const isEpic = nd?.issue?.issue_type === 'epic';
        // Use half the diagonal so rectangular nodes don't overlap; extra padding for edge labels
        const w = isEpic ? EPIC_W : NODE_W;
        const h = isEpic ? EPIC_H : NODE_H;
        return Math.sqrt(w * w + h * h) * 0.55;
      }))
      .force('center', forceCenter(0, 0).strength(0.05))
      // Hard bounding force — prevent nodes from flying off screen
      .force('bound', (() => {
        function force() {
          for (const n of simNodes) {
            const d = Math.sqrt(n.x * n.x + n.y * n.y);
            if (d > boundR) {
              const scale = boundR / d;
              n.x *= scale;
              n.y *= scale;
              n.vx *= 0.5;
              n.vy *= 0.5;
            }
          }
        }
        force.initialize = () => {};
        return force;
      })())
      // Pull each node toward its cluster center to prevent clusters drifting apart
      .force('cluster', (() => {
        function force(alpha) {
          for (const n of simNodes) {
            n.vx += (n.cx - n.x) * 0.04 * alpha;
            n.vy += (n.cy - n.y) * 0.04 * alpha;
          }
        }
        force.initialize = () => {};
        return force;
      })())
      .force('y', (() => {
        // Compute topological depth on blocking edges only (parent-child ignored)
        const blockingLinks = links.filter((l) => l.depType !== 'parent-child');
        const depth = {};
        const ids = simNodes.map((n) => n.id);
        for (const id of ids) depth[id] = 0;
        // Kahn-style relaxation: depth[blocked] = max(depth[blocker] + 1)
        for (let pass = 0; pass < ids.length; pass++) {
          let changed = false;
          for (const l of blockingLinks) {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            if (depth[sid] !== undefined && depth[tid] !== undefined) {
              if (depth[sid] + 1 > depth[tid]) {
                depth[tid] = depth[sid] + 1;
                changed = true;
              }
            }
          }
          if (!changed) break;
        }
        const maxDepth = Math.max(1, ...Object.values(depth));
        const LAYER_H = 180;
        return forceY((n) => (depth[n.id] ?? 0) * LAYER_H).strength(0.5);
      })())
      .alphaDecay(0.04)
      .velocityDecay(0.6)
      .on('tick', () => {
        const posMap = new Map();
        simNodesRef.current.forEach((n, i) => {
          const nd = nodeData[i];
          const isEpic = nd?.issue?.issue_type === 'epic';
          const w = isEpic ? EPIC_W : NODE_W;
          const h = isEpic ? EPIC_H : NODE_H;
          posMap.set(n.id, { x: n.x - w / 2, y: n.y - h / 2 });
        });
        setRfNodes((prev) => prev.map((n) => {
          const pos = posMap.get(n.id);
          return pos ? { ...n, position: pos } : n;
        }));
      });

    simRef.current = sim;
    return () => sim.stop();
  }, [nodeData, edges, expand, closeNode, focus, expandRelated, expandChildren, expandParent, pruneToSelected, setRfNodes]);

  const onNodeDrag = useCallback((_e, rfNode) => {
    const sim = simRef.current;
    if (!sim) return;
    const sn = simNodesRef.current.find((n) => n.id === rfNode.id);
    if (!sn) return;
    const { width = NODE_W, height = NODE_H } = rfNode.measured || {};
    // Pin to center of node in sim coords
    sn.fx = rfNode.position.x + width / 2;
    sn.fy = rfNode.position.y + height / 2;
    // Reheat gently so neighbors adjust without flying away
    sim.alpha(Math.max(sim.alpha(), 0.15)).restart();
  }, []);

  const onNodeDragStop = useCallback((_e, rfNode) => {
    const sim = simRef.current;
    if (!sim) return;
    const sn = simNodesRef.current.find((n) => n.id === rfNode.id);
    if (!sn) return;
    // Unpin — let sim cool naturally from current position
    sn.fx = null;
    sn.fy = null;
  }, []);

  return { edges, hideClosed, pruneToSelected, showAll, focus, addVisible, expandRelated, onNodeDrag, onNodeDragStop };
}
