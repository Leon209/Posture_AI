export function CalibrationOverlay({
  stepIdx,
  stepCount,
  stepLabel,
  progressPct,
  remainingSec,
}) {
  return (
    <div className="calibrating-overlay">
      <div className="calibrating-content">
        <span className="step-indicator">
          Step {stepIdx + 1} of {stepCount}
        </span>
        <p>{stepLabel}</p>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="progress-label">{remainingSec}s</span>
      </div>
    </div>
  );
}

