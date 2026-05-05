import { useCallback, useEffect, useState } from 'react';
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

function Graph({ issues, reload }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showCritical, setShowCritical] = useState(false);
  const { fitView, fitBounds } = useReactFlow();

  const { edges: computedEdges, hideClosed, pruneToSelected, showAll } = useBeadGraph(issues, setNodes, showCritical, selectedNode?.id);

  useEffect(() => {
    setEdges(computedEdges);
  }, [computedEdges, setEdges]);

  // fitView after nodes settle
  useEffect(() => {
    const t = setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 600);
    return () => clearTimeout(t);
  }, [nodes.length, fitView]);

  const onNodeClick = useCallback((_e, node) => setSelectedNode(node), []);
  const onPaneClick = useCallback(() => setSelectedNode(null), []);

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
          onPaneClick={onPaneClick}
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
      <Sidebar selectedNode={selectedNode} allIssues={issues} />
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

  return (
    <ReactFlowProvider>
      <Graph issues={issues} reload={reload} />
    </ReactFlowProvider>
  );
}
