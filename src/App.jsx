import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';
import { BeadNode } from './BeadNode';
import { FloatingEdge, ArrowMarkerDef } from './FloatingEdge';
import { Sidebar } from './Sidebar';
import { Toolbar } from './Toolbar';
import { useBeadGraph } from './useBeadGraph';

const nodeTypes = { bead: BeadNode };
const edgeTypes = { floating: FloatingEdge };

function useAllIssues() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch(`/beads.json?v=${reloadKey}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => { setIssues(Array.isArray(data) ? data : []); setLoading(false); })
      .catch((e) => { setError(e); setLoading(false); });
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { issues, loading, error, reload };
}

function Graph({ issues, reload, initialId }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showCritical, setShowCritical] = useState(false);
  const { fitView, getNode, setCenter } = useReactFlow();

  const selectedId = selectedNode?.id ?? null;
  const { edges: computedEdges, hideClosed, pruneToSelected, showAll, focus } = useBeadGraph(issues, setNodes, showCritical, selectedId);

  useEffect(() => {
    setEdges(computedEdges);
  }, [computedEdges, setEdges]);

  // fitView after nodes settle
  useEffect(() => {
    const t = setTimeout(() => {
      programmaticMoveRef.current = true;
      fitView({ duration: 400, padding: 0.15 });
      setTimeout(() => { programmaticMoveRef.current = false; }, 600);
    }, 600);
    return () => clearTimeout(t);
  }, [nodes.length, fitView]);

  const fitToNeighborhood = useCallback((id, delay = 0) => {
    const go = () => {
      const node = getNode(id);
      if (!node) return;
      const { width = 240, height = 90 } = node.measured || {};
      const x = (node.internals?.positionAbsolute?.x ?? node.position.x) + width / 2;
      const y = (node.internals?.positionAbsolute?.y ?? node.position.y) + height / 2;
      programmaticMoveRef.current = true;
      setCenter(x, y, { zoom: 0.9, duration: 400 });
      setTimeout(() => { programmaticMoveRef.current = false; }, 600);
    };
    delay ? setTimeout(go, delay) : go();
  }, [getNode, setCenter]);

  const pushHistory = useCallback((id) => {
    const url = new URL(window.location.href);
    url.searchParams.set('id', id);
    const cur = window.history.state;
    if (cur?.id === id) {
      // Same node: just normalize (e.g. after panning)
      window.history.replaceState({ id }, '', url);
    } else {
      // If current entry is a panned entry, replace it first so back skips it
      if (cur?.panned) window.history.replaceState(cur, '', window.location.href);
      window.history.pushState({ id }, '', url);
    }
  }, []);

  const onNodeClick = useCallback((_e, node) => setSelectedNode(node), []);
  const onNodeDoubleClick = useCallback((_e, node) => {
    fitToNeighborhood(node.id);
    pushHistory(node.id);
  }, [fitToNeighborhood, pushHistory]);
  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  // Push a synthetic history entry when the user manually pans/zooms,
  // so browser "back" restores the last focused node's view.
  const programmaticMoveRef = useRef(false);
  const onMoveEnd = useCallback(() => {
    if (programmaticMoveRef.current) return;
    const currentId = new URLSearchParams(window.location.search).get('id');
    if (!currentId) return;
    if (window.history.state?.panned) {
      window.history.replaceState({ id: currentId, panned: true }, '', window.location.href);
    } else if (window.history.state?.id === currentId) {
      window.history.pushState({ id: currentId, panned: true }, '', window.location.href);
    }
  }, []);

  // Keep React Flow's selected state in sync with selectedId when sim is idle
  useEffect(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === selectedId })));
  }, [selectedId, setNodes]);

  const onFocusId = useCallback((id) => {
    focus(id);
    const issue = issues.find((i) => i.id === id);
    if (issue) setSelectedNode({ id, data: { issue } });
    fitToNeighborhood(id, 300);
    pushHistory(id);
  }, [focus, issues, fitToNeighborhood, pushHistory]);

  // Handle browser back/forward
  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get('id');
      if (!id) { setSelectedNode(null); return; }
      const issue = issues.find((i) => i.id === id);
      if (!issue) return;
      setSelectedNode({ id, data: { issue } });
      fitToNeighborhood(id, 50);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [issues, focus, fitToNeighborhood]);

  // On initial load with ?id= param, focus that node once issues are ready
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !initialId || issues.length === 0) return;
    initializedRef.current = true;
    const issue = issues.find((i) => i.id === initialId);
    if (issue) {
      setSelectedNode({ id: initialId, data: { issue } });
      focus(initialId);
      fitToNeighborhood(initialId, 800);
    }
  }, [initialId, issues, focus, fitToNeighborhood]);

  return (
    <div className="app">
      <div className="canvas-area">
        <ArrowMarkerDef />
        <Toolbar
          selectedId={selectedNode?.id}
          onHideClosed={hideClosed}
          onPrune={() => pruneToSelected(selectedNode?.id)}
          onShowAll={showAll}
          onReload={reload}
          showCritical={showCritical}
          onToggleCritical={() => setShowCritical((v) => !v)}
        />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          onMoveEnd={onMoveEnd}
          fitView
          colorMode="system"
          proOptions={{ hideAttribution: false }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="rgba(255,255,255,0.06)"
          />
          <Controls
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
            }}
          />
        </ReactFlow>
      </div>
      <Sidebar selectedNode={selectedNode} allIssues={issues} onFocusId={onFocusId} />
    </div>
  );
}

export default function App() {
  const { issues, loading, error, reload } = useAllIssues();

  if (loading) {
    return (
      <div className="app">
        <div className="canvas-area">
          <div className="canvas-empty-state">
            <div className="ring"><div className="ring-dot" /></div>
            <div className="empty-title">loading graph…</div>
          </div>
        </div>
        <Sidebar selectedNode={null} allIssues={[]} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <div className="canvas-area">
          <div className="canvas-empty-state">
            <div className="ring"><div className="ring-dot" style={{ background: '#ee5b5b' }} /></div>
            <div className="empty-title">failed to load</div>
            <div className="empty-hint">{error.message}</div>
          </div>
        </div>
        <Sidebar selectedNode={null} allIssues={[]} />
      </div>
    );
  }

  const initialId = new URLSearchParams(window.location.search).get('id');

  return (
    <ReactFlowProvider>
      <Graph issues={issues} reload={reload} initialId={initialId} />
    </ReactFlowProvider>
  );
}
