import { evaluateQuadratic } from "../utils/calculations";

export function DebugPanel({
  postureModels,
  currentMetrics,
  currentExpected,
  postureReasons,
  reasonLabels,
}) {
  if (!postureModels) return null;

  return (
    <div className="metrics metrics-bounds">
      <h4 className="bounds-title">Posture models (debug)</h4>
      <span>
        Samples: {postureModels.sampleCount}
        {" · "}
        Z span: [{postureModels.zRange.min.toFixed(3)} …{" "}
        {postureModels.zRange.max.toFixed(3)}]
      </span>
      <span>
        Shoulder Y = {postureModels.shoulderYModel.a.toFixed(3)}·z² +{" "}
        {postureModels.shoulderYModel.b.toFixed(3)}·z +{" "}
        {postureModels.shoulderYModel.c.toFixed(3)}
        {" (deg "}
        {postureModels.shoulderYModel.degree}
        {")"}
      </span>
      <span>
        Nose Z = {postureModels.noseZModel.a.toFixed(3)}·z² +{" "}
        {postureModels.noseZModel.b.toFixed(3)}·z +{" "}
        {postureModels.noseZModel.c.toFixed(3)}
        {" (deg "}
        {postureModels.noseZModel.degree}
        {")"}
      </span>
      {postureModels.tiltRange && (
        <span>
          Tilt range: [{postureModels.tiltRange.min.toFixed(4)} …{" "}
          {postureModels.tiltRange.max.toFixed(4)}] ({" "}
          {postureModels.tiltSampleCount} neutral samples)
        </span>
      )}
      {currentMetrics && (
        <span>
          Expected at live Z: Y=
          {currentExpected.shoulderY != null
            ? currentExpected.shoulderY.toFixed(3)
            : evaluateQuadratic(
                postureModels.shoulderYModel,
                currentMetrics.shoulderMid.z
              )?.toFixed(3)}
          {" · noseZ="}
          {currentExpected.noseZ != null
            ? currentExpected.noseZ.toFixed(3)
            : evaluateQuadratic(
                postureModels.noseZModel,
                currentMetrics.shoulderMid.z
              )?.toFixed(3)}
        </span>
      )}
      {postureReasons.length > 0 && (
        <span className="bounds-reasons">Failing: {reasonLabels}</span>
      )}
    </div>
  );
}

