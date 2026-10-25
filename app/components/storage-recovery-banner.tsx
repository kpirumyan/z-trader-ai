"use client";

import { useEffect, useRef, useState } from "react";

import { STORAGE_RETRY_DELAY_MS } from "../constants/storage";

type StorageRecoveryBannerProps =
  | {
      status: "corrupted";
      onRetry: () => void | Promise<void>;
      onStartEmpty: () => void;
    }
  | { status: "unavailable" };

export function StorageRecoveryBanner(props: StorageRecoveryBannerProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const onRetry = props.status === "corrupted" ? props.onRetry : undefined;
  const onRetryRef = useRef(onRetry);

  useEffect(() => {
    onRetryRef.current = onRetry;
  }, [onRetry]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
      }
    };
  }, []);

  if (props.status === "unavailable") {
    return (
      <p className="storage-warning" role="status">
        Local storage is unavailable. Changes in this session will not be saved.
      </p>
    );
  }

  const handleRetry = () => {
    if (isRetrying) return;
    setIsRetrying(true);

    timeoutIdRef.current = setTimeout(async () => {
      try {
        await onRetryRef.current?.();
      } finally {
        if (isMountedRef.current) {
          setIsRetrying(false);
        }
      }
    }, STORAGE_RETRY_DELAY_MS);
  };

  const handleStartEmpty = () => {
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current);
    }

    props.onStartEmpty();
  };

  return (
    <section className="storage-recovery" aria-labelledby="storage-recovery-title">
      <div role="status">
        <h1 id="storage-recovery-title">Unable to restore your workspace</h1>
        <p>
          The saved workspace is corrupted or has an unsupported format. Retry to read it again, or
          start empty to replace it with a new workspace.
        </p>
      </div>
      <div className="storage-recovery-actions">
        <button
          type="button"
          onClick={handleRetry}
          disabled={isRetrying}
          aria-busy={isRetrying ? "true" : undefined}
        >
          Retry
        </button>
        <button type="button" onClick={handleStartEmpty}>
          Start empty
        </button>
      </div>
    </section>
  );
}
