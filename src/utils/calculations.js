// --- Pose landmark indices ---
const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

// --- Face landmark indices ---
const UPPER_LIP = 13;
const LOWER_LIP = 14;
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;

// --- Thresholds (tunable) ---
// Base tolerances are scaled by sensitivityMultiplier(slider) at runtime.
// 50 on a slider means "use the base tolerance as-is".
export const THRESHOLDS = {
  verticalDeviation: 0.05,
  forwardDeviation: 0.05,
  shoulderTiltDeg: 10,
  mouthOpen: 0.02,
  warningDelaySec: 2.5,
  shoulderYTol: 0.03,
  headForwardZTol: 0.05,
  tiltZTol: 0.01,
};

// ---- Posture metrics --------------------------------------------------

export function computePostureMetrics(poseLandmarks, faceLandmarks = null) {
  if (!poseLandmarks || poseLandmarks.length === 0) return null;

  const nose = poseLandmarks[NOSE];
  const lShoulder = poseLandmarks[LEFT_SHOULDER];
  const rShoulder = poseLandmarks[RIGHT_SHOULDER];

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

  // Face-derived metrics (only when face landmarks are available and include
  // iris points 468/473). Z here is in face-landmark space, which is not
  // the same as pose-landmark Z, so the tilt range is interpreted only
  // relative to itself.
  let eyeMidZ = null;
  let mouthMidZ = null;
  let tiltZ = null;
  if (
    faceLandmarks &&
    faceLandmarks.length > RIGHT_IRIS &&
    faceLandmarks[LEFT_IRIS] &&
    faceLandmarks[RIGHT_IRIS]
  ) {
    eyeMidZ = (faceLandmarks[LEFT_IRIS].z + faceLandmarks[RIGHT_IRIS].z) / 2;
    mouthMidZ = (faceLandmarks[UPPER_LIP].z + faceLandmarks[LOWER_LIP].z) / 2;
    tiltZ = eyeMidZ - mouthMidZ;
  }

  return {
    shoulderMid,
    headOffset,
    shoulderTiltDeg,
    noseZ: nose.z,
    eyeMidZ,
    mouthMidZ,
    tiltZ,
  };
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

// ---- Range-based calibration (legacy, used by single-point fallback) ---

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

// ---- Quadratic least-squares --------------------------------------------

// Solve a 3x3 linear system with Cramer's rule. Returns null on singular.
function solve3x3(m) {
  const [[a11, a12, a13, b1], [a21, a22, a23, b2], [a31, a32, a33, b3]] = m;
  const det =
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31);
  if (Math.abs(det) < 1e-12) return null;
  const detA =
    b1 * (a22 * a33 - a23 * a32) -
    a12 * (b2 * a33 - a23 * b3) +
    a13 * (b2 * a32 - a22 * b3);
  const detB =
    a11 * (b2 * a33 - a23 * b3) -
    b1 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * b3 - b2 * a31);
  const detC =
    a11 * (a22 * b3 - b2 * a32) -
    a12 * (a21 * b3 - b2 * a31) +
    b1 * (a21 * a32 - a22 * a31);
  return [detA / det, detB / det, detC / det];
}

// Fits y = a*x^2 + b*x + c. Falls back to linear (a=0) then constant
// (a=b=0, c=mean(y)) when the input lacks variance.
function fitQuadratic(xs, ys) {
  const n = xs.length;
  if (n === 0) return { a: 0, b: 0, c: 0, residualStd: 0, degree: 0 };

  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  if (maxX - minX < 0.02 || n < 3) {
    const residualStd = Math.sqrt(
      ys.reduce((s, v) => s + (v - meanY) ** 2, 0) / n
    );
    return { a: 0, b: 0, c: meanY, residualStd, degree: 0 };
  }

  let S1 = 0, S2 = 0, S3 = 0, S4 = 0;
  let Sy = 0, Sxy = 0, Sxxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    const x2 = x * x;
    S1 += x;
    S2 += x2;
    S3 += x2 * x;
    S4 += x2 * x2;
    Sy += y;
    Sxy += x * y;
    Sxxy += x2 * y;
  }

  const sol = solve3x3([
    [S4, S3, S2, Sxxy],
    [S3, S2, S1, Sxy],
    [S2, S1, n, Sy],
  ]);

  if (!sol) {
    // Fallback to linear: y = b*x + c
    const meanX = S1 / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    const b = den > 1e-12 ? num / den : 0;
    const c = meanY - b * meanX;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (ys[i] - (b * xs[i] + c)) ** 2;
    return { a: 0, b, c, residualStd: Math.sqrt(ss / n), degree: 1 };
  }

  const [a, b, c] = sol;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const pred = a * xs[i] * xs[i] + b * xs[i] + c;
    ss += (ys[i] - pred) ** 2;
  }
  return { a, b, c, residualStd: Math.sqrt(ss / n), degree: 2 };
}

export function evaluateQuadratic(model, x) {
  if (!model) return null;
  return model.a * x * x + model.b * x + model.c;
}

// ---- Posture model fitting ---------------------------------------------

// samples: array of { step, metrics } where metrics is the output of
// computePostureMetrics. Step is one of "neutral" | "forward" | "back".
export function fitPostureModels(samples) {
  if (!samples || samples.length === 0) return null;

  const xsShoulderZ = [];
  const ysShoulderY = [];
  const ysNoseZ = [];
  const tiltsNeutral = [];
  let zMin = Infinity, zMax = -Infinity;

  for (const s of samples) {
    const m = s.metrics;
    if (!m) continue;
    const z = m.shoulderMid.z;
    xsShoulderZ.push(z);
    ysShoulderY.push(m.shoulderMid.y);
    ysNoseZ.push(m.noseZ);
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
    if (s.step === "neutral" && m.tiltZ != null) {
      tiltsNeutral.push(m.tiltZ);
    }
  }

  const shoulderYModel = fitQuadratic(xsShoulderZ, ysShoulderY);
  const noseZModel = fitQuadratic(xsShoulderZ, ysNoseZ);

  let tiltRange = null;
  if (tiltsNeutral.length > 0) {
    const tMin = Math.min(...tiltsNeutral);
    const tMax = Math.max(...tiltsNeutral);
    const pad = (tMax - tMin) * 0.1 || 0.002;
    tiltRange = { min: tMin - pad, max: tMax + pad };
  }

  return {
    shoulderYModel,
    noseZModel,
    tiltRange,
    zRange: {
      min: isFinite(zMin) ? zMin : 0,
      max: isFinite(zMax) ? zMax : 0,
    },
    sampleCount: samples.length,
    tiltSampleCount: tiltsNeutral.length,
  };
}

// ---- Runtime posture evaluation ----------------------------------------

// tolerances: { shoulder, headForward, tilt } - 0-100 slider values.
// Returns { bad, reasons: string[], expected: { shoulderY, noseZ } }
export function evaluatePosture(current, models, tolerances) {
  const out = {
    bad: false,
    reasons: [],
    expected: { shoulderY: null, noseZ: null },
  };
  if (!current || !models) return out;

  const mS = sensitivityMultiplier(tolerances?.shoulder ?? 50);
  const mH = sensitivityMultiplier(tolerances?.headForward ?? 50);
  const mT = sensitivityMultiplier(tolerances?.tilt ?? 50);

  // Clamp the input Z to the calibrated range so we don't extrapolate the
  // quadratic wildly when the user moves far outside the captured span.
  const z = current.shoulderMid.z;
  const { zRange } = models;
  const clampedZ = Math.max(zRange.min, Math.min(zRange.max, z));

  // Shoulder Y model: image-space Y grows downward, so "below the modeled
  // curve" (shoulders collapsed) means a larger y value than expected.
  if (models.shoulderYModel) {
    const expectedY = evaluateQuadratic(models.shoulderYModel, clampedZ);
    out.expected.shoulderY = expectedY;
    const tol = THRESHOLDS.shoulderYTol * mS;
    if (current.shoulderMid.y - expectedY > tol) {
      out.reasons.push("shoulder");
    }
  }

  // Nose Z model: smaller Z is "closer to camera" in normalized pose space,
  // so "head further forward than expected" means noseZ < expectedNoseZ.
  if (models.noseZModel) {
    const expectedNoseZ = evaluateQuadratic(models.noseZModel, clampedZ);
    out.expected.noseZ = expectedNoseZ;
    const tol = THRESHOLDS.headForwardZTol * mH;
    if (expectedNoseZ - current.noseZ > tol) {
      out.reasons.push("headForward");
    }
  }

  // Tilt range: if current tiltZ falls outside the neutral calibration
  // range, the user is looking down or up.
  if (models.tiltRange && current.tiltZ != null) {
    const tol = THRESHOLDS.tiltZTol * mT;
    if (
      current.tiltZ < models.tiltRange.min - tol ||
      current.tiltZ > models.tiltRange.max + tol
    ) {
      out.reasons.push("tilt");
    }
  }

  out.bad = out.reasons.length > 0;
  return out;
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
