import { useCallback, useEffect, useRef, useState } from "react";
import { DrawingUtils, PoseLandmarker, FaceLandmarker } from "@mediapipe/tasks-vision";
import { useCamera } from "./hooks/useCamera";
import { useMediaPipe } from "./hooks/useMediaPipe";
import {
  computePostureMetrics,
  fitPostureModels,
  evaluatePosture,
  evaluateQuadratic,
  isMouthOpen,
  THRESHOLDS,
} from "./utils/calculations";

const WARNING_DELAY_MS = THRESHOLDS.warningDelaySec * 1000;
const CALIBRATION_STEP_DURATION_SEC = 5;

const CALIB_STEPS = [
  { id: "neutral", label: "Sit in your ideal posture" },
  { id: "forward", label: "Slowly lean forward" },
  { id: "back", label: "Slowly lean back" },
];

const REASON_LABELS = {
  shoulder: "Straighten your back",
  headForward: "Head forward",
  tilt: "Looking down",
};

export default function App() {
  const { videoRef, cameraReady, cameraError } = useCamera();
  const { poseRef, faceRef, modelsReady, modelError } = useMediaPipe();

  const canvasRef = useRef(null);
  const modelsRef = useRef(null);
  const calibrationSamplesRef = useRef([]);
  const calibrationStepStartRef = useRef(null);
  const calibrationStepIdxRef = useRef(0);
  const badPostureSinceRef = useRef(null);
  const mouthOpenSinceRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const rafIdRef = useRef(null);

  const [calibrated, setCalibrated] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationStepIdx, setCalibrationStepIdx] = useState(0);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [postureStatus, setPostureStatus] = useState("waiting");
  const [postureReasons, setPostureReasons] = useState([]);
  const [mouthStatus, setMouthStatus] = useState("ok");
  const [currentMetrics, setCurrentMetrics] = useState(null);
  const [currentExpected, setCurrentExpected] = useState({ shoulderY: null, noseZ: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [headForwardTolerance, setHeadForwardTolerance] = useState(50);
  const [tiltTolerance, setTiltTolerance] = useState(50);
  const [mouthSensitivity, setMouthSensitivity] = useState(50);
  const [postureModels, setPostureModels] = useState(null);

  const headForwardTolRef = useRef(headForwardTolerance);
  headForwardTolRef.current = headForwardTolerance;
  const tiltTolRef = useRef(tiltTolerance);
  tiltTolRef.current = tiltTolerance;
  const mouthSensRef = useRef(mouthSensitivity);
  mouthSensRef.current = mouthSensitivity;

  const ready = cameraReady && modelsReady;

  // --- Multi-step guided calibration -----------------------------------

  const handleCalibratePhase = useCallback(() => {
    if (!ready || isCalibrating) return;
    calibrationSamplesRef.current = [];
    calibrationStepIdxRef.current = 0;
    calibrationStepStartRef.current = Date.now();
    modelsRef.current = null;
    badPostureSinceRef.current = null;
    mouthOpenSinceRef.current = null;
    setPostureModels(null);
    setIsCalibrating(true);
    setCalibrationStepIdx(0);
    setCalibrationProgress(0);
    setPostureStatus("waiting");
    setPostureReasons([]);
    setMouthStatus("ok");
  }, [ready, isCalibrating]);

  // --- Detection loop --------------------------------------------------

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

      const poseResult = poseRef.current.detectForVideo(video, ts);
      const faceResult = faceRef.current.detectForVideo(video, ts + 1);

      const poseLandmarks = poseResult.landmarks[0] ?? null;
      const faceLandmarks = faceResult.faceLandmarks[0] ?? null;

      if (poseLandmarks) {
        drawingUtils.drawLandmarks(poseLandmarks, {
          radius: 2,
          color: "#00FF88",
          fillColor: "#00FF8844",
        });
        drawingUtils.drawConnectors(
          poseLandmarks,
          PoseLandmarker.POSE_CONNECTIONS,
          { color: "#00FF8844", lineWidth: 1 }
        );
      }

      if (faceLandmarks) {
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
      }

      const metrics = poseLandmarks
        ? computePostureMetrics(poseLandmarks, faceLandmarks)
        : null;
      setCurrentMetrics(metrics);

      if (metrics && isCalibrating) {
        const stepIdx = calibrationStepIdxRef.current;
        const stepId = CALIB_STEPS[stepIdx].id;
        calibrationSamplesRef.current.push({ step: stepId, metrics });

        const elapsed = Date.now() - calibrationStepStartRef.current;
        const durMs = CALIBRATION_STEP_DURATION_SEC * 1000;
        const pct = Math.min(100, (elapsed / durMs) * 100);
        setCalibrationProgress(pct);

        if (elapsed >= durMs) {
          if (stepIdx < CALIB_STEPS.length - 1) {
            const nextIdx = stepIdx + 1;
            calibrationStepIdxRef.current = nextIdx;
            calibrationStepStartRef.current = Date.now();
            setCalibrationStepIdx(nextIdx);
            setCalibrationProgress(0);
          } else {
            const models = fitPostureModels(calibrationSamplesRef.current);
            modelsRef.current = models;
            setPostureModels(models);
            calibrationSamplesRef.current = [];
            setIsCalibrating(false);
            setCalibrationProgress(100);
            setCalibrated(true);
            setPostureStatus("good");
            setPostureReasons([]);
          }
        }
      } else if (metrics && calibrated) {
        const result = evaluatePosture(metrics, modelsRef.current, {
          shoulder: 50,
          headForward: headForwardTolRef.current,
          tilt: tiltTolRef.current,
        });
        setCurrentExpected(result.expected);

        const now = Date.now();
        if (result.bad) {
          if (badPostureSinceRef.current === null) {
            badPostureSinceRef.current = now;
          } else if (now - badPostureSinceRef.current > WARNING_DELAY_MS) {
            setPostureStatus("bad");
            setPostureReasons(result.reasons);
          }
        } else {
          badPostureSinceRef.current = null;
          setPostureStatus("good");
          setPostureReasons([]);
        }
      }

      if (calibrated && faceLandmarks) {
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

      rafIdRef.current = requestAnimationFrame(detect);
    }

    rafIdRef.current = requestAnimationFrame(detect);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [ready, calibrated, isCalibrating, videoRef, poseRef, faceRef]);

  // --- Render ----------------------------------------------------------

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

  const reasonLabels = postureReasons.map((r) => REASON_LABELS[r] ?? r);
  const statusLabel =
    postureStatus === "bad"
      ? reasonLabels.length > 0
        ? reasonLabels.join(" + ")
        : "Sit straight!"
      : postureStatus === "good"
        ? "Good posture"
        : "Waiting for calibration";

  const statusClass =
    postureStatus === "bad"
      ? "status-bad"
      : postureStatus === "good"
        ? "status-good"
        : "status-neutral";

  const currentStep = CALIB_STEPS[calibrationStepIdx];

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
              <span className="step-indicator">
                Step {calibrationStepIdx + 1} of {CALIB_STEPS.length}
              </span>
              <p>{currentStep.label}</p>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${calibrationProgress}%` }}
                />
              </div>
              <span className="progress-label">
                {Math.ceil(
                  CALIBRATION_STEP_DURATION_SEC -
                    (CALIBRATION_STEP_DURATION_SEC * calibrationProgress) / 100
                )}s
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="controls">
        <button
          className="calibrate-btn calibrate-phase-btn"
          onClick={handleCalibratePhase}
          disabled={!ready || isCalibrating}
        >
          {isCalibrating ? "Calibrating\u2026" : (calibrated ? "Re-calibrate" : "Calibrate")}
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
            Shoulder Z: {currentMetrics.shoulderMid.z.toFixed(3)}
          </span>
          <span>
            Shoulder Y: {currentMetrics.shoulderMid.y.toFixed(3)}
          </span>
          <span>
            Nose Z: {currentMetrics.noseZ.toFixed(3)}
          </span>
          {currentMetrics.tiltZ != null && (
            <span>
              Tilt Z: {currentMetrics.tiltZ.toFixed(4)}
            </span>
          )}
        </div>
      )}

      {postureModels && (
        <div className="metrics metrics-bounds">
          <h4 className="bounds-title">Posture models (debug)</h4>
          <span>
            Samples: {postureModels.sampleCount}
            {" · "}
            Z span: [{postureModels.zRange.min.toFixed(3)} … {postureModels.zRange.max.toFixed(3)}]
          </span>
          <span>
            Shoulder Y = {postureModels.shoulderYModel.a.toFixed(3)}·z² +{" "}
            {postureModels.shoulderYModel.b.toFixed(3)}·z +{" "}
            {postureModels.shoulderYModel.c.toFixed(3)}
            {" (deg "}{postureModels.shoulderYModel.degree}{")"}
          </span>
          <span>
            Nose Z = {postureModels.noseZModel.a.toFixed(3)}·z² +{" "}
            {postureModels.noseZModel.b.toFixed(3)}·z +{" "}
            {postureModels.noseZModel.c.toFixed(3)}
            {" (deg "}{postureModels.noseZModel.degree}{")"}
          </span>
          {postureModels.tiltRange && (
            <span>
              Tilt range: [{postureModels.tiltRange.min.toFixed(4)} …{" "}
              {postureModels.tiltRange.max.toFixed(4)}]{" "}
              ({postureModels.tiltSampleCount} neutral samples)
            </span>
          )}
          {currentMetrics && (
            <span>
              Expected at live Z: Y=
              {currentExpected.shoulderY != null
                ? currentExpected.shoulderY.toFixed(3)
                : evaluateQuadratic(postureModels.shoulderYModel, currentMetrics.shoulderMid.z)?.toFixed(3)}
              {" · noseZ="}
              {currentExpected.noseZ != null
                ? currentExpected.noseZ.toFixed(3)
                : evaluateQuadratic(postureModels.noseZModel, currentMetrics.shoulderMid.z)?.toFixed(3)}
            </span>
          )}
          {postureReasons.length > 0 && (
            <span className="bounds-reasons">
              Failing: {postureReasons.map((r) => REASON_LABELS[r] ?? r).join(", ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
