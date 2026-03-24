import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  PoseLandmarker,
  FaceLandmarker,
} from "@mediapipe/tasks-vision";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export function useMediaPipe() {
  const poseRef = useRef(null);
  const faceRef = useRef(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelError, setModelError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);

        const [pose, face] = await Promise.all([
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" },
            runningMode: "VIDEO",
            numPoses: 1,
          }),
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
            runningMode: "VIDEO",
            numFaces: 1,
          }),
        ]);

        if (cancelled) {
          pose.close();
          face.close();
          return;
        }

        poseRef.current = pose;
        faceRef.current = face;
        setModelsReady(true);
      } catch (err) {
        if (!cancelled) setModelError(err.message);
      }
    }

    init();

    return () => {
      cancelled = true;
      poseRef.current?.close();
      faceRef.current?.close();
    };
  }, []);

  return { poseRef, faceRef, modelsReady, modelError };
}
