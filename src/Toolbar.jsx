export function Toolbar({ selectedId, onHideClosed, onPrune, onShowAll, onReload, showCritical, onToggleCritical }) {
  return (
    <div className="toolbar">
      <button className="toolbar-btn" onClick={onReload} title="Re-fetch beads.json">
        ↺ reload
      </button>
      <div className="toolbar-sep" />
      <button className="toolbar-btn" onClick={onHideClosed} title="Hide all closed nodes">
        hide closed
      </button>
      <div className="toolbar-sep" />
      <button
        className="toolbar-btn"
        onClick={onPrune}
        disabled={!selectedId}
        title={selectedId ? 'Prune to selected node and its 1st-level connections' : 'Select a node first'}
      >
        prune
      </button>
      <div className="toolbar-sep" />
      <button className="toolbar-btn" onClick={onShowAll} title="Show all nodes">
        show all
      </button>
      <div className="toolbar-sep" />
      <button
        className={`toolbar-btn${showCritical ? ' toolbar-btn--active' : ''}`}
        onClick={onToggleCritical}
        title="Highlight critical path"
      >
        critical path
      </button>
    </div>
  );
}
