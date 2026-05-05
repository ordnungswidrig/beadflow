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

function buildIndex(issues) {
  const byId = {};
  for (const issue of issues) byId[issue.id] = issue;
  const outgoing = {}; // id -> [ids this depends on]
  const incoming = {}; // id -> [ids that depend on this]
  for (const issue of issues) {
    outgoing[issue.id] = outgoing[issue.id] || [];
    incoming[issue.id] = incoming[issue.id] || [];
    if (!Array.isArray(issue.dependencies)) continue;
    for (const dep of issue.dependencies) {
      const src = dep.depends_on_id;
      const tgt = dep.issue_id;
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
      const byId = Object.fromEntries(allIssues.map((i) => [i.id, i]));

      // Roots: no dependencies of their own
      const roots = allIssues.filter(
        (i) => !Array.isArray(i.dependencies) || i.dependencies.length === 0
      );
      const seed = roots.length > 0 ? roots : [allIssues[0]];
      const visible = new Set(seed.map((i) => i.id));

      // Expand each root into its open dependents (incoming[id] = dependents)
      for (const root of seed) {
        for (const dependentId of (incoming[root.id] || [])) {
          const dep = byId[dependentId];
          if (dep && dep.status !== 'closed') visible.add(dependentId);
        }
      }

      setVisibleIds(visible);
      setInitialized(true);
    }
  }, [allIssues, initialized, incoming]);

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

  // Focus: center on node, expand all 1st-level connections both directions
  const focus = useCallback((id) => {
    const next = new Set([id]);
    for (const n of (incoming[id] || [])) next.add(n);
    for (const n of (outgoing[id] || [])) next.add(n);
    setVisibleIds(next);
  }, [incoming, outgoing]);

  const hideClosed = useCallback(() => {
    setVisibleIds((prev) => {
      const next = new Set([...prev].filter((id) => byId[id]?.status !== 'closed'));
      return next.size > 0 ? next : prev;
    });
  }, [byId]);

  const pruneToSelected = useCallback((selectedId) => {
    if (!selectedId) return;
    const next = new Set([selectedId]);
    for (const n of (incoming[selectedId] || [])) next.add(n);
    for (const n of (outgoing[selectedId] || [])) next.add(n);
    setVisibleIds(next);
  }, [incoming, outgoing]);

  const showAll = useCallback(() => {
    setVisibleIds(new Set(allIssues.map((i) => i.id)));
  }, [allIssues]);

  // Recompute edges whenever visibleIds changes
  const { edges, nodeData } = useMemo(() => {
    const ids = [...visibleIds];
    const visibleSet = new Set(ids);

    const seenEdges = new Set();
    const edges = [];
    for (const issue of allIssues) {
      if (!Array.isArray(issue.dependencies)) continue;
      for (const dep of issue.dependencies) {
        const src = dep.depends_on_id;
        const tgt = dep.issue_id;
        const key = `${src}->${tgt}`;
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        if (visibleSet.has(src) && visibleSet.has(tgt)) {
          const srcIssue = byId[src];
          const tgtIssue = byId[tgt];
          const edgeClosed = srcIssue?.status === 'closed' && tgtIssue?.status === 'closed';
          edges.push({
            id: key, source: src, target: tgt, type: 'floating',
            data: {
              issueType: srcIssue?.issue_type || 'task',
              priority: srcIssue?.priority ?? 2,
              closed: edgeClosed,
              depType: dep.type || 'blocks',
              critical: false, // set after criticalEdges is computed below
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
      // Build adjacency for visible nodes
      const adj = {}; // id -> [tgt]
      for (const id of ids) adj[id] = [];
      for (const e of edges) adj[e.source]?.push(e.target);

      // Build reverse adjacency (tgt -> sources) for tracing back to root
      const radj = {}; // id -> [src that point to it]
      for (const id of ids) radj[id] = [];
      for (const e of edges) radj[e.target]?.push(e.source);

      if (selectedId && visibleSet.has(selectedId)) {
        // Trace from selectedId back to cluster root via BFS on reverse edges
        // picking the path with most hops (longest upstream chain)
        const dist = {}; const prev = {};
        for (const id of ids) { dist[id] = -Infinity; prev[id] = null; }
        dist[selectedId] = 0;
        // BFS upstream
        const q = [selectedId];
        const seen = new Set([selectedId]);
        while (q.length) {
          const u = q.shift();
          for (const src of (radj[u] || [])) {
            if (dist[src] < dist[u] - 1) {
              dist[src] = dist[u] - 1;
              prev[src] = u; // src -> u edge
            }
            if (!seen.has(src)) { seen.add(src); q.push(src); }
          }
        }
        // Root is the node with the most negative dist (furthest upstream)
        const root = [...seen].reduce((a, b) => dist[a] <= dist[b] ? a : b);
        // Trace from root to selectedId
        let cur = root;
        while (cur) {
          criticalNodes.add(cur);
          if (prev[cur]) criticalEdges.add(`${cur}->${prev[cur]}`);
          cur = prev[cur];
        }
      } else {
        // No selection: highlight global longest path
        const dist = {}; const prev = {};
        for (const id of ids) { dist[id] = 1; prev[id] = null; }
        const inDeg = {};
        for (const id of ids) inDeg[id] = 0;
        for (const e of edges) inDeg[e.target] = (inDeg[e.target] || 0) + 1;
        const queue = ids.filter((id) => !inDeg[id]);
        const topo = [];
        const vis = new Set(queue);
        while (queue.length) {
          const u = queue.shift(); topo.push(u);
          for (const v of (adj[u] || [])) {
            inDeg[v]--;
            if (inDeg[v] === 0 && !vis.has(v)) { vis.add(v); queue.push(v); }
          }
        }
        for (const u of topo) {
          for (const v of (adj[u] || [])) {
            if (dist[u] + 1 > dist[v]) { dist[v] = dist[u] + 1; prev[v] = u; }
          }
        }
        let endNode = ids.reduce((a, b) => dist[a] >= dist[b] ? a : b);
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

    const nodeData = ids.map((id) => ({
      id,
      issue: byId[id],
      onCriticalPath: showCritical && criticalNodes.has(id),
      inCount: (incoming[id] || []).filter((n) => !visibleSet.has(n)).length,
      outCount: (outgoing[id] || []).filter((n) => !visibleSet.has(n)).length,
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
            isLast: nd?.isLast ?? false,
            expand, closeNode, focus,
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

    const simNodeById = Object.fromEntries(simNodes.map((n) => [n.id, n]));
    const links = edges
      .map((e) => ({ source: simNodeById[e.source], target: simNodeById[e.target] }))
      .filter((l) => l.source && l.target);

    if (simRef.current) simRef.current.stop();

    const sim = forceSimulation(simNodes)
      .force('link', forceLink(links).distance(220).strength(0.7))
      .force('charge', forceManyBody().strength(-500))
      .force('collide', forceCollide((n) => {
        const nd = nodeData.find((d) => d.id === n.id);
        const isEpic = nd?.issue?.issue_type === 'epic';
        return Math.max(isEpic ? EPIC_W : NODE_W, isEpic ? EPIC_H : NODE_H) * 0.75;
      }))
      .force('center', forceCenter(0, 0))
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
      .force('y', forceY((n) => {
        const hasOut = links.some((l) => l.source === n);
        const hasIn = links.some((l) => l.target === n);
        if (hasOut && !hasIn) return n.cy - 80;
        if (hasIn && !hasOut) return n.cy + 80;
        return n.cy;
      }).strength(0.2))
      .alphaDecay(0.04)
      .velocityDecay(0.5)
      .on('tick', () => {
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
              isLast: nd?.isLast ?? false,
              expand,
              closeNode,
              focus,
            },
            type: 'bead',
          };
        }));
      });

    simRef.current = sim;
    return () => sim.stop();
  }, [nodeData, edges, expand, closeNode, focus, setRfNodes]);

  return { edges, hideClosed, pruneToSelected, showAll, focus };
}
