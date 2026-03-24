// --- Pose landmark indices ---
const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

// --- Face landmark indices (mouth) ---
const UPPER_LIP = 13;
const LOWER_LIP = 14;

// --- Thresholds (tunable) ---
export const THRESHOLDS = {
  verticalDeviation: 0.05,
  forwardDeviation: 0.05,
  shoulderTiltDeg: 10,
  mouthOpen: 0.02,
  warningDelaySec: 2.5,
};

// ---- Posture metrics --------------------------------------------------

export function computePostureMetrics(poseLandmarks) {
  if (!poseLandmarks || poseLandmarks.length === 0) return null;

  const landmarks = poseLandmarks;
  const nose = landmarks[NOSE];
  const lShoulder = landmarks[LEFT_SHOULDER];
  const rShoulder = landmarks[RIGHT_SHOULDER];

  const shoulderMid = {
    x: (lShoulder.x + rShoulder.x) / 2,
    y: (lShoulder.y + rShoulder.y) / 2,
    z: (lShoulder.z + rShoulder.z) / 2,
  };

  const headOffset = {
    x: nose.x - shoulderMid.x,
    y: nose.y - shoulderMid.y,
    z: nose.z - shoulderMid.z,
  };

  const shoulderTiltRad = Math.atan2(
    rShoulder.y - lShoulder.y,
    rShoulder.x - lShoulder.x
  );
  const shoulderTiltDeg = (shoulderTiltRad * 180) / Math.PI;

  return { shoulderMid, headOffset, shoulderTiltDeg };
}

export function sensitivityMultiplier(sensitivity) {
  return Math.pow(2, (50 - sensitivity) / 50);
}

export function isPostureBad(current, baseline, sensitivity = 50) {
  if (!current || !baseline) return false;

  const m = sensitivityMultiplier(sensitivity);
  const vertDev = Math.abs(current.headOffset.y - baseline.headOffset.y);
  const fwdDev = Math.abs(current.headOffset.z - baseline.headOffset.z);
  const tiltDev = Math.abs(current.shoulderTiltDeg - baseline.shoulderTiltDeg);

  return (
    vertDev > THRESHOLDS.verticalDeviation * m ||
    fwdDev > THRESHOLDS.forwardDeviation * m ||
    tiltDev > THRESHOLDS.shoulderTiltDeg * m
  );
}

// ---- Range-based calibration ------------------------------------------

export function buildRangeBaseline(samples, bufferPct = 10) {
  if (!samples || samples.length === 0) return null;

  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let minTilt = Infinity, maxTilt = -Infinity;
  let sumY = 0, sumZ = 0, sumTilt = 0;

  for (const s of samples) {
    sumY += s.headOffset.y;
    sumZ += s.headOffset.z;
    sumTilt += s.shoulderTiltDeg;
    if (s.headOffset.y < minY) minY = s.headOffset.y;
    if (s.headOffset.y > maxY) maxY = s.headOffset.y;
    if (s.headOffset.z < minZ) minZ = s.headOffset.z;
    if (s.headOffset.z > maxZ) maxZ = s.headOffset.z;
    if (s.shoulderTiltDeg < minTilt) minTilt = s.shoulderTiltDeg;
    if (s.shoulderTiltDeg > maxTilt) maxTilt = s.shoulderTiltDeg;
  }

  const buf = bufferPct / 100;
  const padY = (maxY - minY) * buf || 0.005;
  const padZ = (maxZ - minZ) * buf || 0.005;
  const padTilt = (maxTilt - minTilt) * buf || 1;

  return {
    headOffsetY: { min: minY - padY, max: maxY + padY },
    headOffsetZ: { min: minZ - padZ, max: maxZ + padZ },
    shoulderTiltDeg: { min: minTilt - padTilt, max: maxTilt + padTilt },
    center: {
      headOffset: { y: sumY / samples.length, z: sumZ / samples.length },
      shoulderTiltDeg: sumTilt / samples.length,
    },
  };
}

export function isPostureBadRange(current, range, sensitivity = 50) {
  if (!current || !range) return false;

  const m = sensitivityMultiplier(sensitivity);
  const { headOffsetY, headOffsetZ, shoulderTiltDeg } = range;

  const midY = (headOffsetY.min + headOffsetY.max) / 2;
  const halfY = ((headOffsetY.max - headOffsetY.min) / 2) * m;
  const midZ = (headOffsetZ.min + headOffsetZ.max) / 2;
  const halfZ = ((headOffsetZ.max - headOffsetZ.min) / 2) * m;
  const midT = (shoulderTiltDeg.min + shoulderTiltDeg.max) / 2;
  const halfT = ((shoulderTiltDeg.max - shoulderTiltDeg.min) / 2) * m;

  return (
    current.headOffset.y < midY - halfY ||
    current.headOffset.y > midY + halfY ||
    current.headOffset.z < midZ - halfZ ||
    current.headOffset.z > midZ + halfZ ||
    current.shoulderTiltDeg < midT - halfT ||
    current.shoulderTiltDeg > midT + halfT
  );
}

// ---- Mouth-open detection ---------------------------------------------

export function isMouthOpen(faceLandmarks, sensitivity = 50) {
  if (!faceLandmarks || faceLandmarks.length === 0) return false;

  const m = sensitivityMultiplier(sensitivity);
  const upper = faceLandmarks[UPPER_LIP];
  const lower = faceLandmarks[LOWER_LIP];
  const dist = Math.abs(lower.y - upper.y);

  return dist > THRESHOLDS.mouthOpen * m;
}
