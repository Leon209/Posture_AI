import { useCallback, useEffect, useRef, useState } from "react";
import { DrawingUtils, PoseLandmarker, FaceLandmarker } from "@mediapipe/tasks-vision";
import { useCamera } from "./hooks/useCamera";
import { useMediaPipe } from "./hooks/useMediaPipe";
import { useCalibration } from "./hooks/useCalibration";
import { usePostureStatus } from "./hooks/usePostureStatus";
import { SettingsPanel } from "./components/SettingsPanel";
import { CalibrationOverlay } from "./components/CalibrationOverlay";
import { StatusBar } from "./components/StatusBar";
import { DebugPanel } from "./components/DebugPanel";
import {
  computePostureMetrics,
  evaluatePosture,
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
  const mouthOpenSinceRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const rafIdRef = useRef(null);

  const postureStatusApi = usePostureStatus({ warningDelayMs: WARNING_DELAY_MS });
  const [mouthStatus, setMouthStatus] = useState("ok");
  const [currentMetrics, setCurrentMetrics] = useState(null);
  const [currentExpected, setCurrentExpected] = useState({ shoulderY: null, noseZ: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [headForwardTolerance, setHeadForwardTolerance] = useState(50);
  const [tiltTolerance, setTiltTolerance] = useState(50);
  const [mouthSensitivity, setMouthSensitivity] = useState(50);

  const headForwardTolRef = useRef(headForwardTolerance);
  headForwardTolRef.current = headForwardTolerance;
  const tiltTolRef = useRef(tiltTolerance);
  tiltTolRef.current = tiltTolerance;
  const mouthSensRef = useRef(mouthSensitivity);
  mouthSensRef.current = mouthSensitivity;

  const ready = cameraReady && modelsReady;

  const calibration = useCalibration({
    stepDurationSec: CALIBRATION_STEP_DURATION_SEC,
    steps: CALIB_STEPS,
  });

  // --- Multi-step guided calibration -----------------------------------

  const handleCalibratePhase = useCallback(() => {
    if (!ready || calibration.isCalibrating) return;
    calibration.start();
    mouthOpenSinceRef.current = null;
    postureStatusApi.reset();
    setMouthStatus("ok");
  }, [ready, calibration, postureStatusApi]);

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

      if (metrics && calibration.isCalibrating) {
        const evt = calibration.ingest(metrics);
        if (evt?.type === "done") {
          postureStatusApi.markGood();
        }
      } else if (metrics && calibration.calibrated) {
        const result = evaluatePosture(metrics, calibration.modelsRef.current, {
          shoulder: 50,
          headForward: headForwardTolRef.current,
          tilt: tiltTolRef.current,
        });
        setCurrentExpected(result.expected);
        postureStatusApi.ingest({ bad: result.bad, reasons: result.reasons });
      }

      if (calibration.calibrated && faceLandmarks) {
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
  }, [
    ready,
    calibration,
    postureStatusApi,
    videoRef,
    poseRef,
    faceRef,
  ]);

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

  const reasonLabelsArr = postureStatusApi.postureReasons.map((r) => REASON_LABELS[r] ?? r);
  const statusLabel =
    postureStatusApi.postureStatus === "bad"
      ? reasonLabelsArr.length > 0
        ? reasonLabelsArr.join(" + ")
        : "Sit straight!"
      : postureStatusApi.postureStatus === "good"
        ? "Good posture"
        : "Waiting for calibration";

  const statusClass =
    postureStatusApi.postureStatus === "bad"
      ? "status-bad"
      : postureStatusApi.postureStatus === "good"
        ? "status-good"
        : "status-neutral";

  const currentStep = CALIB_STEPS[calibration.stepIdx];

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-title">Posture.AI</div>
        <div className="topbar-actions">
          <button
            className="menu-button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            <span className="hamburger-line" />
            <span className="hamburger-line" />
            <span className="hamburger-line" />
          </button>

          {menuOpen && (
            <div className="topbar-menu" role="menu">
              <button
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  setSettingsOpen((o) => !o);
                  setMenuOpen(false);
                }}
              >
                Settings
              </button>
            </div>
          )}
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel
          headForwardTolerance={headForwardTolerance}
          setHeadForwardTolerance={setHeadForwardTolerance}
          tiltTolerance={tiltTolerance}
          setTiltTolerance={setTiltTolerance}
          mouthSensitivity={mouthSensitivity}
          setMouthSensitivity={setMouthSensitivity}
          onClose={() => setSettingsOpen(false)}
        />
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

        {calibration.isCalibrating && (
          <CalibrationOverlay
            stepIdx={calibration.stepIdx}
            stepCount={CALIB_STEPS.length}
            stepLabel={currentStep.label}
            progressPct={calibration.progressPct}
            remainingSec={Math.ceil(
              CALIBRATION_STEP_DURATION_SEC -
                (CALIBRATION_STEP_DURATION_SEC * calibration.progressPct) / 100
            )}
          />
        )}
      </div>

      <div className="controls">
        <button
          className="calibrate-btn calibrate-phase-btn"
          onClick={handleCalibratePhase}
          disabled={!ready || calibration.isCalibrating}
        >
          {calibration.isCalibrating
            ? "Calibrating\u2026"
            : (calibration.calibrated ? "Re-calibrate" : "Calibrate")}
        </button>
      </div>

      <StatusBar
        statusClass={statusClass}
        statusLabel={statusLabel}
        mouthStatus={mouthStatus}
      />

      {currentMetrics && calibration.calibrated && (
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

      <DebugPanel
        postureModels={calibration.models}
        currentMetrics={currentMetrics}
        currentExpected={currentExpected}
        postureReasons={postureStatusApi.postureReasons}
        reasonLabels={reasonLabelsArr.join(", ")}
      />
    </div>
  );
}
