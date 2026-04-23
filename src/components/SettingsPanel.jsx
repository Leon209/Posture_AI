export function SettingsPanel({
  headForwardTolerance,
  setHeadForwardTolerance,
  tiltTolerance,
  setTiltTolerance,
  mouthSensitivity,
  setMouthSensitivity,
  onClose,
}) {
  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>Settings</h3>
        <button className="settings-close" onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </div>
      <h3>Posture Tolerances</h3>
      <label className="setting-row">
        <span className="setting-label">Head forward</span>
        <input
          type="range"
          min="0"
          max="100"
          value={headForwardTolerance}
          onChange={(e) => setHeadForwardTolerance(Number(e.target.value))}
        />
        <span className="setting-value">{headForwardTolerance}</span>
      </label>
      <label className="setting-row">
        <span className="setting-label">Head tilt</span>
        <input
          type="range"
          min="0"
          max="100"
          value={tiltTolerance}
          onChange={(e) => setTiltTolerance(Number(e.target.value))}
        />
        <span className="setting-value">{tiltTolerance}</span>
      </label>
      <label className="setting-row">
        <span className="setting-label">Mouth sensitivity</span>
        <input
          type="range"
          min="0"
          max="100"
          value={mouthSensitivity}
          onChange={(e) => setMouthSensitivity(Number(e.target.value))}
        />
        <span className="setting-value">{mouthSensitivity}</span>
      </label>
    </div>
  );
}

