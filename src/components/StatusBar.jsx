export function StatusBar({ statusClass, statusLabel, mouthStatus }) {
  return (
    <div className="status-bar">
      <div className={`status-badge ${statusClass}`}>
        <span className="dot" />
        {statusLabel}
      </div>

      {mouthStatus === "open" && (
        <div className="status-badge status-warn">
          <span className="dot" />
          Close your mouth
        </div>
      )}
    </div>
  );
}

