import { useCallback, useEffect, useRef, useState } from "react";
import { DrawingUtils, PoseLandmarker, FaceLandmarker } from "@mediapipe/tasks-vision";
import { useCamera } from "./hooks/useCamera";
import { useMediaPipe } from "./hooks/useMediaPipe";
import {
  computePostureMetrics,
  isPostureBad,
  isPostureBadRange,
  buildRangeBaseline,
  isMouthOpen,
  THRESHOLDS,
} from "./utils/calculations";

const WARNING_DELAY_MS = THRESHOLDS.warningDelaySec * 1000;

export default function App() {
  const { videoRef, cameraReady, cameraError } = useCamera();
  const { poseRef, faceRef, modelsReady, modelError } = useMediaPipe();

  const canvasRef = useRef(null);
  const baselineRef = useRef(null);
  const rangeBaselineRef = useRef(null);
  const calibrationSamplesRef = useRef([]);
  const calibrationStartRef = useRef(null);
  const badPostureSinceRef = useRef(null);
  const mouthOpenSinceRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const rafIdRef = useRef(null);

  const [calibrated, setCalibrated] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [postureStatus, setPostureStatus] = useState("waiting");
  const [mouthStatus, setMouthStatus] = useState("ok");
  const [currentMetrics, setCurrentMetrics] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [postureSensitivity, setPostureSensitivity] = useState(50);
  const [mouthSensitivity, setMouthSensitivity] = useState(50);
  const [calibrationDuration, setCalibrationDuration] = useState(5);
  const [bufferTolerance, setBufferTolerance] = useState(10);

  const postureSensRef = useRef(postureSensitivity);
  postureSensRef.current = postureSensitivity;
  const mouthSensRef = useRef(mouthSensitivity);
  mouthSensRef.current = mouthSensitivity;
  const calibrationDurationRef = useRef(calibrationDuration);
  calibrationDurationRef.current = calibrationDuration;
  const bufferToleranceRef = useRef(bufferTolerance);
  bufferToleranceRef.current = bufferTolerance;

  const ready = cameraReady && modelsReady;

  // --- Calibrate --------------------------------------------------------

  const handleCalibrate = useCallback(() => {
    if (!ready) return;

    const video = videoRef.current;
    const ts = performance.now();
    const poseResult = poseRef.current.detectForVideo(video, ts);

    if (poseResult.landmarks.length > 0) {
      const metrics = computePostureMetrics(poseResult.landmarks[0]);
      baselineRef.current = metrics;
      badPostureSinceRef.current = null;
      mouthOpenSinceRef.current = null;
      setCalibrated(true);
      setPostureStatus("good");
      setMouthStatus("ok");
    }
  }, [ready, videoRef, poseRef]);

  // --- Calibration phase ------------------------------------------------

  const handleCalibratePhase = useCallback(() => {
    if (!ready || isCalibrating) return;
    calibrationSamplesRef.current = [];
    calibrationStartRef.current = Date.now();
    rangeBaselineRef.current = null;
    badPostureSinceRef.current = null;
    mouthOpenSinceRef.current = null;
    setIsCalibrating(true);
    setCalibrationProgress(0);
    setPostureStatus("waiting");
    setMouthStatus("ok");
  }, [ready, isCalibrating]);

  // --- Detection loop ---------------------------------------------------

  useEffect(() => {
    if (!ready) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const drawingUtils = new DrawingUtils(ctx);

    function detect() {
      if (video.currentTime === lastVideoTimeRef.current) {
        rafIdRef.current = requestAnimationFrame(detect);
        return;
      }
      lastVideoTimeRef.current = video.currentTime;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const ts = performance.now();

      // Pose detection
      const poseResult = poseRef.current.detectForVideo(video, ts);
      if (poseResult.landmarks.length > 0) {
        const landmarks = poseResult.landmarks[0];

        drawingUtils.drawLandmarks(landmarks, {
          radius: 2,
          color: "#00FF88",
          fillColor: "#00FF8844",
        });
        drawingUtils.drawConnectors(
          landmarks,
          PoseLandmarker.POSE_CONNECTIONS,
          { color: "#00FF8844", lineWidth: 1 }
        );

        const metrics = computePostureMetrics(landmarks);
        setCurrentMetrics(metrics);

        if (isCalibrating && metrics) {
          calibrationSamplesRef.current.push(metrics);
          const elapsed = Date.now() - calibrationStartRef.current;
          const durMs = calibrationDurationRef.current * 1000;
          const pct = Math.min(100, (elapsed / durMs) * 100);
          setCalibrationProgress(pct);

          if (elapsed >= durMs) {
            const range = buildRangeBaseline(
              calibrationSamplesRef.current,
              bufferToleranceRef.current
            );
            rangeBaselineRef.current = range;
            baselineRef.current = range?.center
              ? { headOffset: range.center.headOffset, shoulderTiltDeg: range.center.shoulderTiltDeg }
              : metrics;
            calibrationSamplesRef.current = [];
            setIsCalibrating(false);
            setCalibrationProgress(100);
            setCalibrated(true);
            setPostureStatus("good");
          }
        } else if (calibrated && metrics) {
          const bad = rangeBaselineRef.current
            ? isPostureBadRange(metrics, rangeBaselineRef.current, postureSensRef.current)
            : isPostureBad(metrics, baselineRef.current, postureSensRef.current);
          const now = Date.now();

          if (bad) {
            if (badPostureSinceRef.current === null) {
              badPostureSinceRef.current = now;
            } else if (now - badPostureSinceRef.current > WARNING_DELAY_MS) {
              setPostureStatus("bad");
            }
          } else {
            badPostureSinceRef.current = null;
            setPostureStatus("good");
          }
        }
      }

      // Face detection (use ts + 1 to avoid timestamp collision with pose)
      const faceResult = faceRef.current.detectForVideo(video, ts + 1);
      if (faceResult.faceLandmarks.length > 0) {
        const faceLandmarks = faceResult.faceLandmarks[0];

        drawingUtils.drawConnectors(
          faceLandmarks,
          FaceLandmarker.FACE_LANDMARKS_TESSELATION,
          { color: "#ffffff10", lineWidth: 0.5 }
        );
        drawingUtils.drawConnectors(
          faceLandmarks,
          FaceLandmarker.FACE_LANDMARKS_LIPS,
          { color: "#FF666644", lineWidth: 1 }
        );

        if (calibrated) {
          const mouthOpen = isMouthOpen(faceLandmarks, mouthSensRef.current);
          const now = Date.now();

          if (mouthOpen) {
            if (mouthOpenSinceRef.current === null) {
              mouthOpenSinceRef.current = now;
            } else if (now - mouthOpenSinceRef.current > WARNING_DELAY_MS) {
              setMouthStatus("open");
            }
          } else {
            mouthOpenSinceRef.current = null;
            setMouthStatus("ok");
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(detect);
    }

    rafIdRef.current = requestAnimationFrame(detect);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [ready, calibrated, isCalibrating, videoRef, poseRef, faceRef]);

  // --- Render -----------------------------------------------------------

  const error = cameraError || modelError;

  if (error) {
    return (
      <div className="app">
        <div className="error-card">
          <h2>Something went wrong</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const statusLabel =
    postureStatus === "bad"
      ? "Sit straight!"
      : postureStatus === "good"
        ? "Good posture"
        : "Waiting for calibration";

  const statusClass =
    postureStatus === "bad"
      ? "status-bad"
      : postureStatus === "good"
        ? "status-good"
        : "status-neutral";

  return (
    <div className="app">
      <div className="header">
        <h1 className="title">Sitting Straight</h1>
        <button
          className="settings-toggle"
          onClick={() => setSettingsOpen((o) => !o)}
          aria-label="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="3" />
            <path d="M10 1.5v2M10 16.5v2M3.4 3.4l1.4 1.4M15.2 15.2l1.4 1.4M1.5 10h2M16.5 10h2M3.4 16.6l1.4-1.4M15.2 4.8l1.4-1.4" />
          </svg>
        </button>
      </div>

      {settingsOpen && (
        <div className="settings-panel">
          <h3>Settings</h3>
          <label className="setting-row">
            <span className="setting-label">Posture sensitivity</span>
            <input
              type="range"
              min="0"
              max="100"
              value={postureSensitivity}
              onChange={(e) => setPostureSensitivity(Number(e.target.value))}
            />
            <span className="setting-value">{postureSensitivity}</span>
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

          <div className="settings-divider" />
          <h3>Calibration Phase</h3>

          <label className="setting-row">
            <span className="setting-label">Duration (sec)</span>
            <input
              type="range"
              min="2"
              max="15"
              step="1"
              value={calibrationDuration}
              onChange={(e) => setCalibrationDuration(Number(e.target.value))}
            />
            <span className="setting-value">{calibrationDuration}s</span>
          </label>
          <label className="setting-row">
            <span className="setting-label">Buffer tolerance</span>
            <input
              type="range"
              min="0"
              max="50"
              step="1"
              value={bufferTolerance}
              onChange={(e) => setBufferTolerance(Number(e.target.value))}
            />
            <span className="setting-value">{bufferTolerance}%</span>
          </label>
        </div>
      )}

      <div className="video-container">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />

        {!ready && (
          <div className="loading-overlay">
            <div className="spinner" />
            <p>Loading models&hellip;</p>
          </div>
        )}

        {isCalibrating && (
          <div className="calibrating-overlay">
            <div className="calibrating-content">
              <p>Move naturally within your comfortable range</p>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${calibrationProgress}%` }}
                />
              </div>
              <span className="progress-label">
                {Math.ceil(calibrationDuration - (calibrationDuration * calibrationProgress) / 100)}s
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="controls">
        <button
          className={`calibrate-btn ${ready && !calibrated && !isCalibrating ? "pulse" : ""}`}
          onClick={handleCalibrate}
          disabled={!ready || isCalibrating}
        >
          {calibrated ? "Re-calibrate" : "Calibrate"}
        </button>
        <button
          className="calibrate-btn calibrate-phase-btn"
          onClick={handleCalibratePhase}
          disabled={!ready || isCalibrating}
        >
          {isCalibrating ? "Calibrating\u2026" : "Calibrate Phase"}
        </button>
      </div>

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

      {currentMetrics && calibrated && (
        <div className="metrics">
          <span>
            Tilt: {currentMetrics.shoulderTiltDeg.toFixed(1)}°
          </span>
          <span>
            Head Y offset: {currentMetrics.headOffset.y.toFixed(3)}
          </span>
          <span>
            Head Z offset: {currentMetrics.headOffset.z.toFixed(3)}
          </span>
        </div>
      )}
    </div>
  );
}
