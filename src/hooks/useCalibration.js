import { useCallback, useRef, useState } from "react";
import { fitPostureModels } from "../utils/calculations";

export function useCalibration({ stepDurationSec, steps }) {
  const modelsRef = useRef(null);
  const samplesRef = useRef([]);
  const stepStartRef = useRef(null);
  const stepIdxRef = useRef(0);

  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [models, setModels] = useState(null);

  const start = useCallback(() => {
    samplesRef.current = [];
    stepIdxRef.current = 0;
    stepStartRef.current = Date.now();
    modelsRef.current = null;
    setModels(null);
    setIsCalibrating(true);
    setCalibrated(false);
    setStepIdx(0);
    setProgressPct(0);
  }, []);

  const ingest = useCallback(
    (metrics) => {
      if (!metrics || !isCalibrating) return null;

      const idx = stepIdxRef.current;
      const stepId = steps[idx]?.id;
      if (!stepId) return null;

      samplesRef.current.push({ step: stepId, metrics });

      const elapsed = Date.now() - stepStartRef.current;
      const durMs = stepDurationSec * 1000;
      const pct = Math.min(100, (elapsed / durMs) * 100);
      setProgressPct(pct);

      if (elapsed < durMs) return null;

      if (idx < steps.length - 1) {
        const nextIdx = idx + 1;
        stepIdxRef.current = nextIdx;
        stepStartRef.current = Date.now();
        setStepIdx(nextIdx);
        setProgressPct(0);
        return { type: "step" };
      }

      const fitted = fitPostureModels(samplesRef.current);
      modelsRef.current = fitted;
      setModels(fitted);
      samplesRef.current = [];
      setIsCalibrating(false);
      setProgressPct(100);
      setCalibrated(true);
      return { type: "done", models: fitted };
    },
    [isCalibrating, stepDurationSec, steps]
  );

  return {
    isCalibrating,
    calibrated,
    stepIdx,
    progressPct,
    models,
    modelsRef,
    start,
    ingest,
  };
}

