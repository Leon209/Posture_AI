import { useCallback, useRef, useState } from "react";

export function usePostureStatus({ warningDelayMs }) {
  const badSinceRef = useRef(null);
  const [postureStatus, setPostureStatus] = useState("waiting");
  const [postureReasons, setPostureReasons] = useState([]);

  const reset = useCallback(() => {
    badSinceRef.current = null;
    setPostureStatus("waiting");
    setPostureReasons([]);
  }, []);

  const markGood = useCallback(() => {
    badSinceRef.current = null;
    setPostureStatus("good");
    setPostureReasons([]);
  }, []);

  const ingest = useCallback(
    ({ bad, reasons }) => {
      const now = Date.now();
      if (bad) {
        if (badSinceRef.current === null) {
          badSinceRef.current = now;
          return;
        }
        if (now - badSinceRef.current > warningDelayMs) {
          setPostureStatus("bad");
          setPostureReasons(reasons ?? []);
        }
        return;
      }

      badSinceRef.current = null;
      setPostureStatus("good");
      setPostureReasons([]);
    },
    [warningDelayMs]
  );

  return {
    postureStatus,
    postureReasons,
    reset,
    markGood,
    ingest,
  };
}

