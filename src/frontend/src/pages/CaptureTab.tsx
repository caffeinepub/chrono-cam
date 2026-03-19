import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  Camera,
  Clock,
  HardDrive,
  Layers,
  Play,
  Square,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import FeedbackSection from "../components/FeedbackSection";
import {
  RESOLUTION_MAP,
  useCameraSettings,
} from "../contexts/CameraSettingsContext";
import { buildCanvasFilter, buildVideoStyle } from "../lib/cameraStyle";
import { downloadBlob, encodeFramesToVideo } from "../lib/videoEncoder";

type RateMode = "fps" | "fpm" | "interval";
type DurationMode = "seconds" | "minutes" | "hours";
type StorageMode = "space-left" | "space-consumed";

function ModeButton({
  active,
  onClick,
  children,
  ocid,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ocid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
        active
          ? "bg-accent text-accent-foreground glow-accent"
          : "bg-input border border-border text-muted-foreground hover:text-foreground hover:border-accent/50"
      }`}
      data-ocid={ocid}
    >
      {children}
    </button>
  );
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function CaptureTab() {
  const { settings } = useCameraSettings();

  const [rateValue, setRateValue] = useState("1");
  const [rateMode, setRateMode] = useState<RateMode>("fps");
  const [durationValue, setDurationValue] = useState("");
  const [durationMode, setDurationMode] = useState<DurationMode>("minutes");
  const [storageLimitValue, setStorageLimitValue] = useState("");
  const [storageMode, setStorageMode] = useState<StorageMode>("space-consumed");

  const [isRunning, setIsRunning] = useState(false);
  const [isEncoding, setIsEncoding] = useState(false);
  const [encodeProgress, setEncodeProgress] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sessionBytes, setSessionBytes] = useState(0);
  const [storageInfo, setStorageInfo] = useState<{
    quota: number;
    usage: number;
  } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cleanupCountdown, setCleanupCountdown] = useState<number | null>(null);

  const framesRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const sessionBytesRef = useRef<number>(0);
  const isRunningRef = useRef(false);

  useEffect(() => {
    navigator.storage?.estimate().then((est) => {
      setStorageInfo({ quota: est.quota ?? 0, usage: est.usage ?? 0 });
    });
  }, []);

  const computeIntervalMs = useCallback((): number => {
    const v = Number.parseFloat(rateValue) || 1;
    if (rateMode === "fps") return 1000 / v;
    if (rateMode === "fpm") return 60000 / v;
    return v * 1000;
  }, [rateValue, rateMode]);

  const computeOutputFps = useCallback((): number => {
    const v = Number.parseFloat(rateValue) || 1;
    if (rateMode === "fps") return v;
    if (rateMode === "fpm") return v / 60;
    return 1 / v;
  }, [rateValue, rateMode]);

  const computeDurationMs = useCallback((): number | null => {
    const v = Number.parseFloat(durationValue);
    if (!durationValue.trim() || Number.isNaN(v) || v <= 0) return null;
    if (durationMode === "seconds") return v * 1000;
    if (durationMode === "minutes") return v * 60000;
    return v * 3600000;
  }, [durationValue, durationMode]);

  const captureFrame = useCallback(async (): Promise<Blob | null> => {
    if (!videoRef.current || !captureCanvasRef.current) return null;
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const filterStr = buildCanvasFilter(settings);
    ctx.filter = filterStr;

    ctx.save();

    const zoom = settings.zoom > 1 ? settings.zoom : 1;
    const srcW = video.videoWidth / zoom;
    const srcH = video.videoHeight / zoom;
    const srcX = (video.videoWidth - srcW) / 2;
    const srcY = (video.videoHeight - srcH) / 2;

    if (settings.mirror || settings.flip) {
      ctx.translate(
        settings.mirror ? canvas.width : 0,
        settings.flip ? canvas.height : 0,
      );
      ctx.scale(settings.mirror ? -1 : 1, settings.flip ? -1 : 1);
      ctx.drawImage(
        video,
        srcX,
        srcY,
        srcW,
        srcH,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    } else {
      ctx.drawImage(
        video,
        srcX,
        srcY,
        srcW,
        srcH,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    }

    ctx.restore();
    ctx.filter = "none";

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => resolve(b),
        "image/jpeg",
        settings.imageQuality / 100,
      );
    });
  }, [settings]);

  const stopCapture = useCallback(
    async (reason = "manual") => {
      if (!isRunningRef.current) return;
      isRunningRef.current = false;

      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      intervalRef.current = null;
      timerRef.current = null;

      setIsRunning(false);

      if (reason !== "manual") toast.info(`Capture stopped: ${reason}`);

      const frames = [...framesRef.current];
      if (frames.length === 0) {
        toast.warning("No frames captured");
        for (const t of streamRef.current?.getTracks() ?? []) {
          t.stop();
        }
        return;
      }

      setIsEncoding(true);
      setEncodeProgress(0);
      try {
        const fps = computeOutputFps();
        const { blob, mimeType } = await encodeFramesToVideo(frames, {
          fps,
          onProgress: setEncodeProgress,
        });
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const filename = `timelapse_${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
        downloadBlob(blob, filename);
        toast.success(`Video downloaded: ${filename}`);

        // Clear frames immediately
        framesRef.current = [];
        sessionBytesRef.current = 0;
        setFrameCount(0);
        setSessionBytes(0);

        // Start 2-min cleanup countdown display
        let remaining = 120;
        setCleanupCountdown(remaining);
        const cleanupTimer = setInterval(() => {
          remaining--;
          setCleanupCountdown(remaining);
          if (remaining <= 0) {
            clearInterval(cleanupTimer);
            setCleanupCountdown(null);
          }
        }, 1000);
      } catch (e) {
        toast.error(
          `Video encoding failed: ${e instanceof Error ? e.message : "Unknown error"}`,
        );
      } finally {
        setIsEncoding(false);
        setEncodeProgress(0);
        for (const t of streamRef.current?.getTracks() ?? []) {
          t.stop();
        }
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
      }
    },
    [computeOutputFps],
  );

  const startCapture = useCallback(async () => {
    if (isRunning || isEncoding) return;
    setCameraError(null);
    framesRef.current = [];
    sessionBytesRef.current = 0;
    setFrameCount(0);
    setElapsedMs(0);
    setSessionBytes(0);

    // Start camera stream
    try {
      const res = RESOLUTION_MAP[settings.resolution as 0 | 1 | 2 | 3];
      const constraints: MediaStreamConstraints = {
        video: {
          ...(settings.deviceId
            ? { deviceId: { exact: settings.deviceId } }
            : { facingMode: "environment" }),
          width: { ideal: res.width },
          height: { ideal: res.height },
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>((resolve) => {
          if (!videoRef.current) {
            resolve();
            return;
          }
          videoRef.current.onloadedmetadata = () => resolve();
        });
        await videoRef.current.play().catch(() => {});
      }
    } catch (e) {
      setCameraError(e instanceof Error ? e.message : "Camera access denied");
      return;
    }

    isRunningRef.current = true;
    setIsRunning(true);
    startTimeRef.current = Date.now();

    const intervalMs = computeIntervalMs();
    const durationMs = computeDurationMs();
    const storageLimitMB = Number.parseFloat(storageLimitValue);
    const hasStorageLimit =
      storageLimitValue.trim() !== "" &&
      !Number.isNaN(storageLimitMB) &&
      storageLimitMB > 0;

    // Elapsed timer
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 500);

    // Capture interval
    intervalRef.current = setInterval(async () => {
      if (!isRunningRef.current) return;

      const blob = await captureFrame();
      if (!blob) return;

      framesRef.current.push(blob);
      sessionBytesRef.current += blob.size;
      setFrameCount((c) => c + 1);
      setSessionBytes(sessionBytesRef.current);

      // Check duration
      if (
        durationMs !== null &&
        Date.now() - startTimeRef.current >= durationMs
      ) {
        stopCapture("Duration limit reached");
        return;
      }

      // Check storage
      if (hasStorageLimit) {
        const limitBytes = storageLimitMB * 1024 * 1024;
        if (storageMode === "space-consumed") {
          if (sessionBytesRef.current >= limitBytes) {
            stopCapture("Storage limit reached");
            return;
          }
        } else {
          // space-left-after
          const est = await navigator.storage?.estimate();
          const avail = (est?.quota ?? 0) - (est?.usage ?? 0);
          if (avail < limitBytes) {
            stopCapture("Storage space insufficient");
            return;
          }
        }
      }
    }, intervalMs);
  }, [
    isRunning,
    isEncoding,
    settings,
    computeIntervalMs,
    computeDurationMs,
    storageLimitValue,
    storageMode,
    captureFrame,
    stopCapture,
  ]);

  const intervalMs = computeIntervalMs();
  const outputFps = computeOutputFps();

  return (
    <div className="space-y-6">
      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* Left: Controls panel */}
        <div className="space-y-4">
          {/* Rate input */}
          <div
            className="rounded-xl border border-border bg-card p-4"
            data-ocid="capture.card"
          >
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-3.5 w-3.5 text-accent" />
              <Label className="text-xs font-semibold text-foreground">
                Capture Rate
              </Label>
            </div>
            <div className="flex gap-2 mb-3">
              <ModeButton
                active={rateMode === "fps"}
                onClick={() => setRateMode("fps")}
                ocid="capture.fps.toggle"
              >
                FPS
              </ModeButton>
              <ModeButton
                active={rateMode === "fpm"}
                onClick={() => setRateMode("fpm")}
                ocid="capture.fpm.toggle"
              >
                FPM
              </ModeButton>
              <ModeButton
                active={rateMode === "interval"}
                onClick={() => setRateMode("interval")}
                ocid="capture.interval.toggle"
              >
                Interval
              </ModeButton>
            </div>
            <Input
              type="number"
              min="0.01"
              step="any"
              value={rateValue}
              onChange={(e) => setRateValue(e.target.value)}
              className="bg-input border-border text-foreground text-sm h-9"
              placeholder={rateMode === "interval" ? "seconds" : rateMode}
              data-ocid="capture.rate.input"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Interval:{" "}
              <span className="text-accent font-mono">
                {(intervalMs / 1000).toFixed(2)}s
              </span>
              &nbsp;·&nbsp; Output FPS:{" "}
              <span className="text-accent font-mono">
                {outputFps.toFixed(2)}
              </span>
            </p>
          </div>

          {/* Duration */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-3.5 w-3.5 text-accent" />
              <Label className="text-xs font-semibold text-foreground">
                Duration
              </Label>
              <span className="text-xs text-muted-foreground ml-auto">
                optional
              </span>
            </div>
            <div className="flex gap-2 mb-3">
              <ModeButton
                active={durationMode === "seconds"}
                onClick={() => setDurationMode("seconds")}
                ocid="capture.duration_seconds.toggle"
              >
                Sec
              </ModeButton>
              <ModeButton
                active={durationMode === "minutes"}
                onClick={() => setDurationMode("minutes")}
                ocid="capture.duration_minutes.toggle"
              >
                Min
              </ModeButton>
              <ModeButton
                active={durationMode === "hours"}
                onClick={() => setDurationMode("hours")}
                ocid="capture.duration_hours.toggle"
              >
                Hrs
              </ModeButton>
            </div>
            <Input
              type="number"
              min="0"
              step="any"
              value={durationValue}
              onChange={(e) => setDurationValue(e.target.value)}
              className="bg-input border-border text-foreground text-sm h-9"
              placeholder="Leave empty for unlimited"
              data-ocid="capture.duration.input"
            />
          </div>

          {/* Storage limit */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="h-3.5 w-3.5 text-accent" />
              <Label className="text-xs font-semibold text-foreground">
                Storage Limit (MB)
              </Label>
              <span className="text-xs text-muted-foreground ml-auto">
                optional
              </span>
            </div>
            {storageInfo && (
              <p className="text-xs text-muted-foreground mb-2">
                Available:{" "}
                <span className="text-foreground font-mono">
                  {formatBytes(storageInfo.quota - storageInfo.usage)}
                </span>
              </p>
            )}
            <Input
              type="number"
              min="0"
              step="any"
              value={storageLimitValue}
              onChange={(e) => setStorageLimitValue(e.target.value)}
              className="bg-input border-border text-foreground text-sm h-9 mb-3"
              placeholder="MB limit"
              data-ocid="capture.storage_limit.input"
            />
            <div className="flex gap-2">
              <ModeButton
                active={storageMode === "space-consumed"}
                onClick={() => setStorageMode("space-consumed")}
                ocid="capture.storage_consumed.toggle"
              >
                Consumed
              </ModeButton>
              <ModeButton
                active={storageMode === "space-left"}
                onClick={() => setStorageMode("space-left")}
                ocid="capture.storage_left.toggle"
              >
                Space Left
              </ModeButton>
            </div>
          </div>

          {/* Run / Stop */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              onClick={startCapture}
              disabled={isRunning || isEncoding}
              className="h-12 font-bold text-sm bg-primary text-primary-foreground hover:bg-primary/90 glow-primary disabled:opacity-40"
              data-ocid="capture.run.primary_button"
            >
              <Play className="h-4 w-4 mr-2 fill-current" />
              RUN
            </Button>
            <Button
              size="lg"
              onClick={() => stopCapture("manual")}
              disabled={!isRunning}
              className="h-12 font-bold text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 glow-destructive disabled:opacity-40"
              data-ocid="capture.stop.delete_button"
            >
              <Square className="h-4 w-4 mr-2 fill-current" />
              STOP
            </Button>
          </div>
        </div>

        {/* Right: Camera preview + status */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Preview area */}
          <div className="relative bg-black" style={{ minHeight: 280 }}>
            {/* Video element */}
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              style={{
                ...buildVideoStyle(settings),
                minHeight: 280,
                maxHeight: 420,
                display: "block",
              }}
              playsInline
              muted
              autoPlay
            />
            <canvas ref={captureCanvasRef} className="hidden" />

            {/* Overlays */}
            {isRunning && (
              <>
                {/* Resolution chip */}
                <div className="absolute top-3 left-3 px-2 py-1 rounded bg-black/60 text-xs font-mono text-foreground">
                  {RESOLUTION_MAP[settings.resolution as 0 | 1 | 2 | 3]
                    ?.label ?? "HD"}
                </div>
                {/* LIVE badge */}
                <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[oklch(0.557_0.172_22)] text-white text-xs font-bold">
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse-slow" />
                  LIVE
                </div>
                {/* Grid overlay */}
                {settings.gridOverlay && (
                  <div className="absolute inset-0 grid-overlay pointer-events-none" />
                )}
              </>
            )}

            {/* Camera error */}
            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                <div className="text-center p-6">
                  <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
                  <p className="text-sm text-destructive font-semibold">
                    {cameraError}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Check camera permissions in browser settings
                  </p>
                </div>
              </div>
            )}

            {/* Idle state */}
            {!isRunning && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <Camera className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    Press RUN to start capture
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="p-4 border-t border-border">
            <AnimatePresence mode="wait">
              {isEncoding ? (
                <motion.div
                  key="encoding"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2"
                  data-ocid="capture.encoding.loading_state"
                >
                  <div className="flex justify-between text-xs">
                    <span className="text-accent font-semibold">
                      Encoding video…
                    </span>
                    <span className="text-muted-foreground font-mono">
                      {encodeProgress}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-accent rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${encodeProgress}%` }}
                    />
                  </div>
                </motion.div>
              ) : isRunning ? (
                <motion.div
                  key="running"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="grid grid-cols-3 gap-4"
                  data-ocid="capture.status.panel"
                >
                  <div>
                    <p className="text-xs text-muted-foreground">Elapsed</p>
                    <p className="text-sm font-mono font-semibold text-accent">
                      {formatTime(elapsedMs)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Frames</p>
                    <p className="text-sm font-mono font-semibold text-foreground">
                      {frameCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Session Size
                    </p>
                    <p className="text-sm font-mono font-semibold text-foreground">
                      {formatBytes(sessionBytes)}
                    </p>
                  </div>
                </motion.div>
              ) : cleanupCountdown !== null ? (
                <motion.div
                  key="cleanup"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-muted-foreground flex items-center gap-2"
                >
                  <Layers className="h-3.5 w-3.5 text-accent" />
                  Cleaning up in {cleanupCountdown}s…
                </motion.div>
              ) : (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-muted-foreground"
                >
                  Ready · Configure rate and press RUN
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <FeedbackSection />
    </div>
  );
}
