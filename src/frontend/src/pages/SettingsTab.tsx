import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle,
  Camera,
  Contrast,
  Crosshair,
  Flashlight,
  FlipHorizontal,
  FlipVertical,
  Info,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Sun,
  Trash2,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Variant_ratio1_1_ratio4_3_ratio16_9 } from "../backend";
import FeedbackSection from "../components/FeedbackSection";
import {
  DEFAULT_SETTINGS,
  RESOLUTION_MAP,
  type UISettings,
  fromUISettings,
  toUISettings,
  useCameraSettings,
} from "../contexts/CameraSettingsContext";
import { useInternetIdentity } from "../hooks/useInternetIdentity";
import {
  useDeletePreset,
  useGetPresets,
  useGetUserSettings,
  useResetUserSettings,
  useSavePreset,
  useSaveUserSettings,
} from "../hooks/useQueries";
import { buildVideoStyle } from "../lib/cameraStyle";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeviceCapabilities {
  zoom?: { min: number; max: number; step: number };
}

interface CameraDevice {
  deviceId: string;
  label: string;
  baseZoom: number;
}

// ─── AI Subject Options ───────────────────────────────────────────────────────

const AI_SUBJECTS = [
  { value: "sky", label: "Sky" },
  { value: "sun", label: "Sun" },
  { value: "moon", label: "Moon" },
  { value: "stars", label: "Stars / Night Sky" },
  { value: "horizon", label: "Horizon" },
  { value: "person-face", label: "Person / Face" },
  { value: "clouds", label: "Clouds" },
  { value: "foreground", label: "Foreground" },
  { value: "background", label: "Background" },
  { value: "landscape", label: "Landscape" },
] as const;

type AISubject = (typeof AI_SUBJECTS)[number]["value"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function estimateBaseZoom(label: string): number {
  const lower = label.toLowerCase();
  const mmMatch = lower.match(/(\d+\.?\d*)\s*mm/);
  if (mmMatch) {
    const mm = Number.parseFloat(mmMatch[1]);
    return Math.max(0.5, mm / 26);
  }
  const xMatch = lower.match(/(\d+\.?\d*)\s*x/);
  if (xMatch) return Math.max(0.5, Number.parseFloat(xMatch[1]));

  if (lower.includes("ultrawide") || lower.includes("ultra wide")) return 0.6;
  if (lower.includes("ultra")) return 0.6;
  if (lower.includes("telephoto") || lower.includes("tele")) return 3.0;
  if (lower.includes("periscope")) return 5.0;
  if (lower.includes("wide")) return 1.0;
  if (lower.includes("front") || lower.includes("selfie")) return 1.0;
  return 1.0;
}

function findBestCamera(
  zoom: number,
  cameras: CameraDevice[],
): CameraDevice | null {
  if (cameras.length === 0) return null;
  const sorted = [...cameras].sort((a, b) => a.baseZoom - b.baseZoom);
  let best = sorted[0];
  for (const cam of sorted) {
    if (cam.baseZoom <= zoom) best = cam;
    else break;
  }
  return best;
}

/** Compute luminance of a pixel (r, g, b values 0-255) */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Analyze pixel data and return a normalized focus point {x, y} based on subject */
function analyzeFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  subject: AISubject,
): { x: number; y: number } {
  // Helper: get pixel index
  const idx = (px: number, py: number) => (py * width + px) * 4;

  switch (subject) {
    case "sky":
    case "background": {
      // Top third, find brightest region
      const topRows = Math.floor(height / 3);
      let maxLum = -1;
      let bx = 0.5;
      let by = 0.15;
      for (let py = 0; py < topRows; py++) {
        for (let px = 0; px < width; px++) {
          const i = idx(px, py);
          const lum = luminance(data[i], data[i + 1], data[i + 2]);
          if (lum > maxLum) {
            maxLum = lum;
            bx = px / width;
            by = py / height;
          }
        }
      }
      return { x: bx, y: by };
    }

    case "sun": {
      // Top half, find single brightest point
      const halfH = Math.floor(height / 2);
      let maxLum = -1;
      let bx = 0.5;
      let by = 0.25;
      for (let py = 0; py < halfH; py++) {
        for (let px = 0; px < width; px++) {
          const i = idx(px, py);
          const lum = luminance(data[i], data[i + 1], data[i + 2]);
          if (lum > maxLum) {
            maxLum = lum;
            bx = px / width;
            by = py / height;
          }
        }
      }
      return { x: bx, y: by };
    }

    case "moon": {
      // Full image, find brightest isolated spot
      let maxLum = -1;
      let bx = 0.5;
      let by = 0.3;
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const i = idx(px, py);
          const lum = luminance(data[i], data[i + 1], data[i + 2]);
          if (lum > maxLum) {
            maxLum = lum;
            bx = px / width;
            by = py / height;
          }
        }
      }
      return { x: bx, y: by };
    }

    case "stars": {
      // Top portion, distributed bright spots — use centroid of bright pixels
      const topRows = Math.floor(height * 0.6);
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      const threshold = 180;
      for (let py = 0; py < topRows; py++) {
        for (let px = 0; px < width; px++) {
          const i = idx(px, py);
          const lum = luminance(data[i], data[i + 1], data[i + 2]);
          if (lum > threshold) {
            sumX += px / width;
            sumY += py / height;
            count++;
          }
        }
      }
      if (count > 0) return { x: sumX / count, y: sumY / count };
      return { x: 0.5, y: 0.3 };
    }

    case "horizon":
    case "landscape": {
      // Middle third, find row with maximum contrast (edge detection)
      const startY = Math.floor(height / 3);
      const endY = Math.floor((height * 2) / 3);
      let maxContrast = -1;
      let bestY = 0.5;
      for (let py = startY; py < endY - 1; py++) {
        let rowContrast = 0;
        for (let px = 0; px < width; px++) {
          const i1 = idx(px, py);
          const i2 = idx(px, py + 1);
          const lum1 = luminance(data[i1], data[i1 + 1], data[i1 + 2]);
          const lum2 = luminance(data[i2], data[i2 + 1], data[i2 + 2]);
          rowContrast += Math.abs(lum1 - lum2);
        }
        if (rowContrast > maxContrast) {
          maxContrast = rowContrast;
          bestY = py / height;
        }
      }
      return { x: 0.5, y: bestY };
    }

    case "person-face": {
      // Center-weighted region (0.5, 0.4) with contrast detection
      // Check a center band for highest contrast area
      const cx = Math.floor(width / 2);
      const cy = Math.floor(height * 0.4);
      const radius = Math.floor(Math.min(width, height) / 4);
      let maxContrast = -1;
      let bx = 0.5;
      let by = 0.4;
      for (
        let py = Math.max(0, cy - radius);
        py < Math.min(height - 1, cy + radius);
        py++
      ) {
        for (
          let px = Math.max(0, cx - radius);
          px < Math.min(width - 1, cx + radius);
          px++
        ) {
          const i1 = idx(px, py);
          const i2 = idx(px + 1, py + 1);
          const lum1 = luminance(data[i1], data[i1 + 1], data[i1 + 2]);
          const lum2 = luminance(data[i2], data[i2 + 1], data[i2 + 2]);
          const contrast = Math.abs(lum1 - lum2);
          if (contrast > maxContrast) {
            maxContrast = contrast;
            bx = px / width;
            by = py / height;
          }
        }
      }
      return { x: bx, y: by };
    }

    case "clouds": {
      // Upper half, diffuse high-luminance area
      const halfH = Math.floor(height / 2);
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      const threshold = 150;
      for (let py = 0; py < halfH; py++) {
        for (let px = 0; px < width; px++) {
          const i = idx(px, py);
          const lum = luminance(data[i], data[i + 1], data[i + 2]);
          if (lum > threshold) {
            sumX += px / width;
            sumY += py / height;
            count++;
          }
        }
      }
      if (count > 0) return { x: sumX / count, y: sumY / count };
      return { x: 0.5, y: 0.25 };
    }

    case "foreground": {
      // Bottom third, highest contrast
      const startY = Math.floor((height * 2) / 3);
      let maxContrast = -1;
      let bx = 0.5;
      let by = 0.75;
      for (let py = startY; py < height - 1; py++) {
        for (let px = 0; px < width - 1; px++) {
          const i1 = idx(px, py);
          const i2 = idx(px + 1, py + 1);
          const lum1 = luminance(data[i1], data[i1 + 1], data[i1 + 2]);
          const lum2 = luminance(data[i2], data[i2 + 1], data[i2 + 2]);
          const contrast = Math.abs(lum1 - lum2);
          if (contrast > maxContrast) {
            maxContrast = contrast;
            bx = px / width;
            by = py / height;
          }
        }
      }
      return { x: bx, y: by };
    }

    default:
      return { x: 0.5, y: 0.5 };
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SettingRow({
  label,
  children,
}: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </Label>
      {children}
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-xs font-semibold rounded transition-all ${
        active
          ? "bg-accent text-accent-foreground"
          : "bg-input border border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SettingsTab() {
  const { identity } = useInternetIdentity();
  const isAuthenticated = !!identity;
  const { settings, setSettings, hardwareMaxZoom, setHardwareMaxZoom } =
    useCameraSettings();

  const { data: savedSettings } = useGetUserSettings();
  const { mutateAsync: saveSettings, isPending: isSaving } =
    useSaveUserSettings();
  const { mutateAsync: resetSettings, isPending: isResetting } =
    useResetUserSettings();
  const { data: presets = [] } = useGetPresets();
  const { mutateAsync: savePreset, isPending: isSavingPreset } =
    useSavePreset();
  const { mutateAsync: deletePreset, isPending: isDeletingPreset } =
    useDeletePreset();

  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [deviceCapabilities, setDeviceCapabilities] =
    useState<DeviceCapabilities | null>(null);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [presetNameInput, setPresetNameInput] = useState("");
  const [showPresetDialog, setShowPresetDialog] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [autoSwitchBadge, setAutoSwitchBadge] = useState<string | null>(null);
  const [hwZoomActive, setHwZoomActive] = useState(false);
  const [tapFocusPoint, setTapFocusPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Zoom text input state
  const [zoomInputValue, setZoomInputValue] = useState("");
  const [zoomInputFocused, setZoomInputFocused] = useState(false);

  // AI Auto-focus state
  const [aiAutoFocus, setAiAutoFocus] = useState(false);
  const [aiSubject, setAiSubject] = useState<AISubject>("sky");

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSwitchBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastAutoSwitchedDeviceRef = useRef<string>("");
  const tapFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AI auto-focus refs
  const aiFrameRef = useRef<number | null>(null);
  const aiFrameCountRef = useRef(0);
  const lastFocusPointRef = useRef<{ x: number; y: number } | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Initialize offscreen canvas once
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 45;
    offscreenCanvasRef.current = canvas;
  }, []);

  // Load saved settings from backend
  useEffect(() => {
    if (savedSettings) {
      setSettings(toUISettings(savedSettings));
    }
  }, [savedSettings, setSettings]);

  // Sync zoom input when not focused
  useEffect(() => {
    if (!zoomInputFocused) {
      setZoomInputValue(settings.zoom.toFixed(1));
    }
  }, [settings.zoom, zoomInputFocused]);

  // Start camera preview
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally uses only initial values
  const startPreview = useCallback(
    async (deviceId?: string, resolution?: number, skipEnumerate = false) => {
      for (const t of streamRef.current?.getTracks() ?? []) t.stop();
      streamRef.current = null;
      setCameraError(null);
      setHwZoomActive(false);

      const res =
        RESOLUTION_MAP[(resolution ?? settings.resolution) as 0 | 1 | 2 | 3];
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(deviceId || settings.deviceId
              ? { deviceId: { exact: deviceId ?? settings.deviceId } }
              : { facingMode: "environment" }),
            width: { ideal: res.width },
            height: { ideal: res.height },
          },
        });
        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        if (track) {
          const caps = (track as any).getCapabilities?.() ?? {};
          if (caps.zoom) {
            const zoomCap = {
              min: Number(caps.zoom.min ?? 1),
              max: Number(caps.zoom.max ?? 1),
              step: Number(caps.zoom.step ?? 0.1),
            };
            setDeviceCapabilities({ zoom: zoomCap });
            setHardwareMaxZoom(zoomCap.max);
            setHwZoomActive(true);
          } else {
            setDeviceCapabilities(null);
            setHardwareMaxZoom(1);
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setIsCameraActive(true);

        if (!skipEnumerate) {
          const devs = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devs.filter((d) => d.kind === "videoinput");
          const mapped: CameraDevice[] = videoInputs.map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${i + 1}`,
            baseZoom: estimateBaseZoom(d.label || ""),
          }));
          setCameras(mapped);
        }
      } catch (e) {
        setCameraError(e instanceof Error ? e.message : "Camera access denied");
        setIsCameraActive(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.deviceId, settings.resolution],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run once on mount
  useEffect(() => {
    startPreview();
    return () => {
      for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    };
  }, []);

  // Apply hardware zoom constraints to active track
  const applyHardwareZoom = useCallback(
    async (zoom: number) => {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || !hwZoomActive) return;
      try {
        await track.applyConstraints({
          advanced: [{ zoom } as MediaTrackConstraintSet],
        });
      } catch {
        // silently ignore
      }
    },
    [hwZoomActive],
  );

  // Apply focus at normalized coordinates
  const applyFocus = useCallback(async (x: number, y: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [
          {
            pointsOfInterest: [{ x, y }],
            focusMode: "single-shot",
          } as any,
        ],
      });
    } catch {
      // silently ignore
    }
    lastFocusPointRef.current = { x, y };
  }, []);

  // Apply all non-zoom constraints to active track
  const applyTrackConstraints = useCallback(async (newSettings: UISettings) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const adv: Record<string, unknown> = {};
      if (newSettings.brightness !== 0)
        adv.brightness = newSettings.brightness / 100;
      adv.contrast = newSettings.contrast / 100;
      adv.saturation = newSettings.saturation / 100;
      adv.sharpness = newSettings.sharpness / 100;
      if (newSettings.wbMode === "manual") {
        adv.colorTemperature = newSettings.colorTemp;
        adv.whiteBalanceMode = "manual";
      } else {
        adv.whiteBalanceMode = "continuous";
      }
      adv.torch = newSettings.torchOn;
      await track.applyConstraints({
        advanced: [adv as MediaTrackConstraintSet],
      });
    } catch {
      // silently ignore unsupported constraints
    }
  }, []);

  // Auto camera switch based on zoom level
  const tryAutoSwitch = useCallback(
    async (zoom: number, currentDeviceId: string, newSettings: UISettings) => {
      if (!newSettings.autoSwitchCamera || cameras.length < 2) return;
      const best = findBestCamera(zoom, cameras);
      if (!best) return;
      const targetId = best.deviceId;
      if (
        targetId === currentDeviceId ||
        targetId === lastAutoSwitchedDeviceRef.current
      )
        return;

      lastAutoSwitchedDeviceRef.current = targetId;
      const updated = { ...newSettings, deviceId: targetId };
      setSettings(updated);
      await startPreview(targetId, updated.resolution, true);

      if (autoSwitchBadgeTimerRef.current)
        clearTimeout(autoSwitchBadgeTimerRef.current);
      setAutoSwitchBadge(`Switched to ${best.label}`);
      autoSwitchBadgeTimerRef.current = setTimeout(
        () => setAutoSwitchBadge(null),
        3000,
      );
    },
    [cameras, setSettings, startPreview],
  );

  // Debounced save + apply
  const handleSettingChange = useCallback(
    (newSettings: UISettings) => {
      setSettings(newSettings);
      applyTrackConstraints(newSettings);
      if (!isAuthenticated) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          await saveSettings(fromUISettings(newSettings));
        } catch {
          // silent
        }
      }, 1200);
    },
    [setSettings, applyTrackConstraints, isAuthenticated, saveSettings],
  );

  // Handle zoom change with hardware zoom + auto switch
  const handleZoomChange = useCallback(
    async (zoom: number) => {
      const hwMax = deviceCapabilities?.zoom?.max ?? hardwareMaxZoom;
      const hwMin = deviceCapabilities?.zoom?.min ?? 1;

      let effectiveZoom = zoom;
      if (!settings.turboZoom && zoom > hwMax) {
        effectiveZoom = hwMax;
      }

      const newSettings = { ...settings, zoom: effectiveZoom };
      handleSettingChange(newSettings);

      if (hwZoomActive) {
        const hwZoom = Math.min(effectiveZoom, hwMax);
        const clampedHwZoom = Math.max(hwMin, hwZoom);
        await applyHardwareZoom(clampedHwZoom);
      }

      await tryAutoSwitch(effectiveZoom, settings.deviceId, newSettings);
    },
    [
      settings,
      deviceCapabilities,
      hardwareMaxZoom,
      hwZoomActive,
      handleSettingChange,
      applyHardwareZoom,
      tryAutoSwitch,
    ],
  );

  // Handle zoom text input commit
  const handleZoomInputCommit = useCallback(() => {
    const parsed = Number.parseFloat(zoomInputValue);
    if (Number.isNaN(parsed)) {
      setZoomInputValue(settings.zoom.toFixed(1));
      return;
    }
    const hwMax = deviceCapabilities?.zoom?.max ?? hardwareMaxZoom;
    const hwMin = deviceCapabilities?.zoom?.min ?? 1;
    const resWidth = RESOLUTION_MAP[settings.resolution as 0 | 1 | 2 | 3].width;
    const turboMax = resWidth / 2;
    const maxAllowed = settings.turboZoom ? turboMax : hwMax;
    const clamped = Math.max(hwMin, Math.min(maxAllowed, parsed));
    const rounded = Math.round(clamped * 10) / 10;
    handleZoomChange(rounded);
    setZoomInputValue(rounded.toFixed(1));
  }, [
    zoomInputValue,
    settings,
    deviceCapabilities,
    hardwareMaxZoom,
    handleZoomChange,
  ]);

  // Tap to focus handler (disabled when AI auto-focus is on)
  const handleTapFocus = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isCameraActive || aiAutoFocus) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const normX = (event.clientX - rect.left) / rect.width;
      const normY = (event.clientY - rect.top) / rect.height;

      const px = normX * 100;
      const py = normY * 100;
      setTapFocusPoint({ x: px, y: py });

      if (tapFocusTimerRef.current) clearTimeout(tapFocusTimerRef.current);
      tapFocusTimerRef.current = setTimeout(() => setTapFocusPoint(null), 1500);

      await applyFocus(normX, normY);
    },
    [isCameraActive, aiAutoFocus, applyFocus],
  );

  // AI Auto-focus animation loop
  useEffect(() => {
    if (!aiAutoFocus || !isCameraActive) {
      if (aiFrameRef.current !== null) {
        cancelAnimationFrame(aiFrameRef.current);
        aiFrameRef.current = null;
      }
      return;
    }

    const canvas = offscreenCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    aiFrameCountRef.current = 0;

    const loop = () => {
      aiFrameCountRef.current++;

      // Only run analysis every ~30 frames (~1 second at 30fps)
      if (aiFrameCountRef.current % 30 === 0) {
        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const point = analyzeFrame(
            imageData.data,
            canvas.width,
            canvas.height,
            aiSubject,
          );

          const last = lastFocusPointRef.current;
          const shouldUpdate =
            !last ||
            Math.abs(point.x - last.x) > 0.05 ||
            Math.abs(point.y - last.y) > 0.05;

          if (shouldUpdate) {
            applyFocus(point.x, point.y);
          }
        }
      }

      aiFrameRef.current = requestAnimationFrame(loop);
    };

    aiFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (aiFrameRef.current !== null) {
        cancelAnimationFrame(aiFrameRef.current);
        aiFrameRef.current = null;
      }
    };
  }, [aiAutoFocus, isCameraActive, aiSubject, applyFocus]);

  const handleReset = async () => {
    if (!isAuthenticated) {
      toast.error("Login required");
      return;
    }
    try {
      await resetSettings();
      setSettings(DEFAULT_SETTINGS);
      toast.success("Settings reset to defaults");
    } catch {
      toast.error("Reset failed");
    }
  };

  const handleSavePreset = async () => {
    if (!isAuthenticated) {
      toast.error("Login required");
      return;
    }
    if (!presetNameInput.trim()) {
      toast.error("Enter a preset name");
      return;
    }
    try {
      await savePreset({
        name: presetNameInput.trim(),
        settings: fromUISettings(settings),
      });
      toast.success(`Preset "${presetNameInput.trim()}" saved`);
      setShowPresetDialog(false);
      setPresetNameInput("");
    } catch {
      toast.error("Failed to save preset");
    }
  };

  const handleLoadPreset = (name: string) => {
    const preset = presets.find((p) => p.name === name);
    if (!preset) return;
    handleSettingChange(toUISettings(preset.settings));
    toast.success(`Preset "${name}" loaded`);
  };

  const handleDeletePreset = async () => {
    if (!selectedPreset) return;
    try {
      await deletePreset(selectedPreset);
      toast.success(`Preset "${selectedPreset}" deleted`);
      setSelectedPreset("");
    } catch {
      toast.error("Delete failed");
    }
  };

  const handleDeviceChange = (deviceId: string) => {
    handleSettingChange({ ...settings, deviceId });
    lastAutoSwitchedDeviceRef.current = deviceId;
    startPreview(deviceId, settings.resolution, true);
  };

  const handleResolutionChange = (res: number) => {
    handleSettingChange({ ...settings, resolution: res });
    startPreview(settings.deviceId, res, true);
  };

  // Compute derived zoom values
  const hwMin = deviceCapabilities?.zoom?.min ?? 1;
  const hwMax = deviceCapabilities?.zoom?.max ?? hardwareMaxZoom;
  const hwStep = deviceCapabilities?.zoom?.step ?? 0.1;
  const resWidth = RESOLUTION_MAP[settings.resolution as 0 | 1 | 2 | 3].width;
  const turboMax = resWidth / 2;
  const zoomSliderMax = settings.turboZoom ? turboMax : hwMax;
  const isTurboActive = settings.turboZoom && settings.zoom > hwMax;
  const turboScale = isTurboActive ? settings.zoom / hwMax : 1;

  const previewStyle = buildVideoStyle(settings, hwZoomActive, turboScale);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* Left: settings panel */}
        <div className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto pr-1">
          {/* Preset management */}
          {isAuthenticated && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Save className="h-3.5 w-3.5 text-accent" />
                <Label className="text-xs font-semibold text-foreground">
                  Presets
                </Label>
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.length > 0 && (
                  <Select
                    value={selectedPreset}
                    onValueChange={setSelectedPreset}
                  >
                    <SelectTrigger
                      className="h-8 text-xs bg-input border-border flex-1 min-w-[120px]"
                      data-ocid="settings.preset.select"
                    >
                      <SelectValue placeholder="Select preset…" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {presets.map((p) => (
                        <SelectItem
                          key={p.name}
                          value={p.name}
                          className="text-xs"
                        >
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {selectedPreset && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-border"
                    onClick={() => handleLoadPreset(selectedPreset)}
                    data-ocid="settings.load_preset.button"
                  >
                    Load
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-accent/50 text-accent hover:bg-accent/10"
                  onClick={() => setShowPresetDialog(true)}
                  data-ocid="settings.save_preset.open_modal_button"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Save
                </Button>
                {selectedPreset && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
                    onClick={handleDeletePreset}
                    disabled={isDeletingPreset}
                    data-ocid="settings.delete_preset.delete_button"
                  >
                    {isDeletingPreset ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-border"
                  onClick={handleReset}
                  disabled={isResetting}
                  data-ocid="settings.reset.button"
                >
                  {isResetting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  <span className="ml-1">Reset</span>
                </Button>
              </div>
            </div>
          )}

          {/* Camera & Resolution */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Camera className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-foreground">
                Camera & Resolution
              </span>
              {isSaving && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
              )}
            </div>

            {cameras.length > 0 && (
              <SettingRow label="Camera Lens">
                <Select
                  value={settings.deviceId || "default"}
                  onValueChange={handleDeviceChange}
                >
                  <SelectTrigger
                    className="h-8 text-xs bg-input border-border"
                    data-ocid="settings.device.select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {cameras.map((cam, i) => (
                      <SelectItem
                        key={cam.deviceId || `cam-${i}`}
                        value={cam.deviceId || "default"}
                        className="text-xs"
                      >
                        {cam.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            )}

            {/* Auto-switch camera toggle */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <Label className="text-xs text-foreground">
                  Auto Switch Camera
                </Label>
                <span className="text-xs text-muted-foreground">
                  Automatically switch lens based on zoom level
                </span>
              </div>
              <Switch
                checked={settings.autoSwitchCamera}
                onCheckedChange={(v) =>
                  handleSettingChange({ ...settings, autoSwitchCamera: v })
                }
                className="data-[state=checked]:bg-accent"
                data-ocid="settings.auto_switch_camera.switch"
              />
            </div>

            <SettingRow label="Resolution">
              <div
                className="flex gap-2"
                data-ocid="settings.resolution.toggle"
              >
                {([0, 1, 2, 3] as const).map((r) => (
                  <ModeBtn
                    key={r}
                    active={settings.resolution === r}
                    onClick={() => handleResolutionChange(r)}
                  >
                    {RESOLUTION_MAP[r].label}
                  </ModeBtn>
                ))}
              </div>
            </SettingRow>

            <SettingRow label="Aspect Ratio">
              <div
                className="flex gap-2"
                data-ocid="settings.aspect_ratio.toggle"
              >
                {(
                  [
                    [Variant_ratio1_1_ratio4_3_ratio16_9.ratio1_1, "1:1"],
                    [Variant_ratio1_1_ratio4_3_ratio16_9.ratio4_3, "4:3"],
                    [Variant_ratio1_1_ratio4_3_ratio16_9.ratio16_9, "16:9"],
                  ] as const
                ).map(([val, label]) => (
                  <ModeBtn
                    key={val}
                    active={settings.aspectRatio === val}
                    onClick={() =>
                      handleSettingChange({ ...settings, aspectRatio: val })
                    }
                  >
                    {label}
                  </ModeBtn>
                ))}
              </div>
            </SettingRow>
          </div>

          {/* Zoom & Focus */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Sliders className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-foreground">
                Zoom & Focus
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Zoom
                </Label>
                {/* Zoom text input */}
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={zoomInputValue}
                    onChange={(e) => setZoomInputValue(e.target.value)}
                    onFocus={() => setZoomInputFocused(true)}
                    onBlur={() => {
                      setZoomInputFocused(false);
                      handleZoomInputCommit();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-16 h-7 text-xs text-center bg-input border-border px-1"
                    step="0.1"
                    data-ocid="settings.zoom_value.input"
                  />
                  <span className="text-xs text-muted-foreground">x</span>
                </div>
              </div>
              <Slider
                min={hwMin}
                max={zoomSliderMax}
                step={hwStep}
                value={[settings.zoom]}
                onValueChange={([v]) => handleZoomChange(v)}
                className="py-1"
                data-ocid="settings.zoom.input"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{hwMin.toFixed(1)}x</span>
                {hwZoomActive && (
                  <span className="text-accent">
                    Hardware zoom up to {hwMax.toFixed(1)}x
                  </span>
                )}
                <span>{zoomSliderMax.toFixed(0)}x</span>
              </div>
              {/* No hardware zoom hint */}
              {!hwZoomActive && isCameraActive && (
                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground/70">
                  <Info className="h-3 w-3 shrink-0" />
                  <span>
                    Hardware zoom not supported on this device — enable{" "}
                    <span className="text-yellow-400/80">Turbo Zoom</span> below
                    for digital zoom.
                  </span>
                </div>
              )}
            </div>

            {/* Turbo Zoom section */}
            <AnimatePresence>
              {(!hwZoomActive && isCameraActive) ||
              settings.zoom >= hwMax * 0.95 ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-yellow-400" />
                    <span className="text-xs font-semibold text-yellow-400">
                      Turbo Zoom
                    </span>
                    <Switch
                      checked={settings.turboZoom}
                      onCheckedChange={(v) => {
                        const newZoom =
                          !v && settings.zoom > hwMax ? hwMax : settings.zoom;
                        handleSettingChange({
                          ...settings,
                          turboZoom: v,
                          zoom: newZoom,
                        });
                      }}
                      className="data-[state=checked]:bg-yellow-500 ml-auto"
                      data-ocid="settings.turbo_zoom.switch"
                    />
                  </div>
                  <p className="text-xs text-yellow-400/80">
                    {hwZoomActive
                      ? `⚠ Turbo Zoom digitally crops and upscales the image beyond the hardware limit (${hwMax.toFixed(1)}x). Resolution will decrease when active.`
                      : "⚠ Your device does not support hardware zoom. Turbo Zoom digitally crops and upscales the image — resolution will decrease as you zoom in."}
                  </p>
                  {isTurboActive && (
                    <div className="text-xs text-yellow-300/70">
                      Digital scale: {turboScale.toFixed(2)}x
                      {hwZoomActive &&
                        ` (hardware at max ${hwMax.toFixed(1)}x)`}
                    </div>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <SettingRow label="Focus">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <ModeBtn
                    active={settings.focusValue === 0}
                    onClick={() =>
                      handleSettingChange({ ...settings, focusValue: 0 })
                    }
                  >
                    Auto
                  </ModeBtn>
                  <ModeBtn
                    active={settings.focusValue > 0}
                    onClick={() =>
                      handleSettingChange({
                        ...settings,
                        focusValue: settings.focusValue || 50,
                      })
                    }
                  >
                    Manual
                  </ModeBtn>
                </div>
                {settings.focusValue > 0 && (
                  <Slider
                    min={1}
                    max={100}
                    step={1}
                    value={[settings.focusValue]}
                    onValueChange={([v]) =>
                      handleSettingChange({ ...settings, focusValue: v })
                    }
                    className="py-1"
                    data-ocid="settings.focus.input"
                  />
                )}
              </div>
            </SettingRow>
          </div>

          {/* White Balance */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Sun className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-foreground">
                White Balance & Color
              </span>
            </div>
            <SettingRow label="White Balance">
              <div className="flex gap-2">
                <ModeBtn
                  active={settings.wbMode === "auto"}
                  onClick={() =>
                    handleSettingChange({ ...settings, wbMode: "auto" })
                  }
                >
                  Auto
                </ModeBtn>
                <ModeBtn
                  active={settings.wbMode === "manual"}
                  onClick={() =>
                    handleSettingChange({ ...settings, wbMode: "manual" })
                  }
                >
                  Manual
                </ModeBtn>
              </div>
            </SettingRow>
            {settings.wbMode === "manual" && (
              <SettingRow label={`Color Temperature — ${settings.colorTemp}K`}>
                <Slider
                  min={2500}
                  max={8000}
                  step={100}
                  value={[settings.colorTemp]}
                  onValueChange={([v]) =>
                    handleSettingChange({ ...settings, colorTemp: v })
                  }
                  className="py-1"
                  data-ocid="settings.color_temp.input"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Warm 2500K</span>
                  <span>Cool 8000K</span>
                </div>
              </SettingRow>
            )}
          </div>

          {/* Exposure & ISO */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Sun className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-foreground">
                Exposure & ISO
              </span>
            </div>
            <SettingRow label="Exposure Mode">
              <div className="flex gap-2">
                <ModeBtn
                  active={settings.exposure === 0}
                  onClick={() =>
                    handleSettingChange({ ...settings, exposure: 0 })
                  }
                >
                  Auto
                </ModeBtn>
                <ModeBtn
                  active={settings.exposure !== 0}
                  onClick={() =>
                    handleSettingChange({
                      ...settings,
                      exposure: settings.exposure || 100,
                    })
                  }
                >
                  Manual
                </ModeBtn>
              </div>
            </SettingRow>
            {settings.exposure !== 0 && (
              <SettingRow
                label={`Exposure Comp — ${(settings.exposure / 100).toFixed(1)} EV`}
              >
                <Slider
                  min={-300}
                  max={300}
                  step={10}
                  value={[settings.exposure]}
                  onValueChange={([v]) =>
                    handleSettingChange({ ...settings, exposure: v })
                  }
                  className="py-1"
                  data-ocid="settings.exposure.input"
                />
              </SettingRow>
            )}
            <SettingRow label={`ISO — ${settings.iso}`}>
              <Slider
                min={50}
                max={6400}
                step={50}
                value={[settings.iso]}
                onValueChange={([v]) =>
                  handleSettingChange({ ...settings, iso: v })
                }
                className="py-1"
                data-ocid="settings.iso.input"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>50</span>
                <span>6400</span>
              </div>
            </SettingRow>
            <SettingRow label={`Shutter Speed — 1/${settings.shutterSpeed}s`}>
              <Slider
                min={1}
                max={8000}
                step={1}
                value={[settings.shutterSpeed]}
                onValueChange={([v]) =>
                  handleSettingChange({ ...settings, shutterSpeed: v })
                }
                className="py-1"
                data-ocid="settings.shutter_speed.input"
              />
            </SettingRow>
          </div>

          {/* Image adjustments */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Contrast className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-foreground">
                Image Adjustments
              </span>
            </div>
            <SettingRow
              label={`Brightness — ${settings.brightness > 0 ? "+" : ""}${settings.brightness}`}
            >
              <Slider
                min={-100}
                max={100}
                step={1}
                value={[settings.brightness]}
                onValueChange={([v]) =>
                  handleSettingChange({ ...settings, brightness: v })
                }
                className="py-1"
                data-ocid="settings.brightness.input"
              />
            </SettingRow>
            <SettingRow
              label={`Contrast — ${(settings.contrast / 100).toFixed(1)}`}
            >
              <Slider
                min={0}
                max={200}
                step={1}
                value={[settings.contrast]}
                onValueChange={([v]) =>
                  handleSettingChange({ ...settings, contrast: v })
                }
                className="py-1"
                data-ocid="settings.contrast.input"
              />
            </SettingRow>
            <SettingRow
              label={`Saturation — ${(settings.saturation / 100).toFixed(1)}`}
            >
              <Slider
                min={0}
                max={200}
                step={1}
                value={[settings.saturation]}
                onValueChange={([v]) =>
                  handleSettingChange({ ...settings, saturation: v })
                }
                className="py-1"
                data-ocid="settings.saturation.input"
              />
            </SettingRow>
            <SettingRow
              label={`Sharpness — ${(settings.sharpness / 100).toFixed(1)}`}
            >
              <Slider
                min={0}
                max={200}
                step={1}
                value={[settings.sharpness]}
                onValueChange={([v]) =>
                  handleSettingChange({ ...settings, sharpness: v })
                }
                className="py-1"
                data-ocid="settings.sharpness.input"
              />
            </SettingRow>
            <SettingRow label={`Image Quality — ${settings.imageQuality}%`}>
              <Slider
                min={10}
                max={100}
                step={1}
                value={[settings.imageQuality]}
                onValueChange={([v]) =>
                  handleSettingChange({ ...settings, imageQuality: v })
                }
                className="py-1"
                data-ocid="settings.image_quality.input"
              />
            </SettingRow>
          </div>

          {/* Toggles */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-foreground">
                Camera Options
              </span>
            </div>
            {(
              [
                ["torchOn", "Torch / Flashlight", Flashlight],
                ["flip", "Flip (Vertical)", FlipVertical],
                ["mirror", "Mirror (Horizontal)", FlipHorizontal],
                ["gridOverlay", "Grid Overlay", Layers],
              ] as const
            ).map(([key, label, Icon]) => (
              <div key={key} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <Label className="text-xs text-foreground">{label}</Label>
                </div>
                <Switch
                  checked={settings[key] as boolean}
                  onCheckedChange={(v) =>
                    handleSettingChange({ ...settings, [key]: v })
                  }
                  className="data-[state=checked]:bg-accent"
                  data-ocid={`settings.${key}.switch`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Right: Live camera preview */}
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card overflow-hidden sticky top-4 self-start">
            <div
              className={`relative bg-black${isCameraActive && !aiAutoFocus ? " cursor-crosshair" : ""}`}
              style={{ aspectRatio: "16/9", minHeight: 200 }}
              onClick={handleTapFocus}
              onKeyDown={() => {}}
              // biome-ignore lint/a11y/useSemanticElements: camera preview div needs layout control
              role="presentation"
              tabIndex={-1}
            >
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                style={previewStyle}
                playsInline
                muted
                autoPlay
              />

              {/* Tap-to-focus indicator */}
              <AnimatePresence>
                {isCameraActive && tapFocusPoint !== null && !aiAutoFocus && (
                  <motion.div
                    key={`${tapFocusPoint.x}-${tapFocusPoint.y}`}
                    initial={{ opacity: 1, scale: 1.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="absolute pointer-events-none"
                    style={{
                      left: `${tapFocusPoint.x}%`,
                      top: `${tapFocusPoint.y}%`,
                      transform: "translate(-50%, -50%)",
                      width: 48,
                      height: 48,
                      border: "2px solid white",
                      borderRadius: 4,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
                    }}
                  />
                )}
              </AnimatePresence>

              {/* AI Focus active indicator overlay */}
              <AnimatePresence>
                {aiAutoFocus && isCameraActive && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 border border-accent/40 text-accent text-xs font-semibold"
                  >
                    <Crosshair className="h-3 w-3" />
                    AI Focus Active
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Overlays */}
              {isCameraActive && (
                <>
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-xs font-mono text-white">
                    {
                      RESOLUTION_MAP[settings.resolution as 0 | 1 | 2 | 3]
                        ?.label
                    }{" "}
                    ·{" "}
                    {settings.aspectRatio
                      .replace("ratio", "")
                      .replace(/_/g, ":")}
                  </div>
                  <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-[oklch(0.557_0.172_22)] text-white text-xs font-bold">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse-slow" />
                    LIVE
                  </div>
                  {settings.gridOverlay && (
                    <div className="absolute inset-0 grid-overlay pointer-events-none" />
                  )}
                  {/* Auto-switch badge */}
                  <AnimatePresence>
                    {autoSwitchBadge && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/70 text-white text-xs flex items-center gap-1"
                      >
                        <Camera className="h-3 w-3" />
                        {autoSwitchBadge}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* Turbo zoom badge */}
                  {isTurboActive && (
                    <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-yellow-500/80 text-black text-xs font-bold flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      TURBO {settings.zoom.toFixed(1)}x
                    </div>
                  )}
                </>
              )}

              {cameraError && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                  <div className="text-center p-4">
                    <AlertTriangle className="h-7 w-7 text-destructive mx-auto mb-2" />
                    <p className="text-xs text-destructive font-semibold">
                      {cameraError}
                    </p>
                  </div>
                </div>
              )}
              {!isCameraActive && !cameraError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Camera className="h-8 w-8 text-muted-foreground/30" />
                </div>
              )}
            </div>

            {/* Preview info bar */}
            <div className="p-3 border-t border-border">
              <motion.div
                className="flex flex-wrap gap-3 text-xs text-muted-foreground"
                animate={{ opacity: 1 }}
              >
                <span>
                  ISO{" "}
                  <span className="text-foreground font-mono">
                    {settings.iso}
                  </span>
                </span>
                <span>1/{settings.shutterSpeed}s</span>
                <span>
                  Zoom{" "}
                  <span className="text-foreground font-mono">
                    {settings.zoom.toFixed(1)}x
                  </span>
                  {isTurboActive && (
                    <span className="text-yellow-400 ml-1">⚡</span>
                  )}
                </span>
                {hwZoomActive && <span className="text-accent">HW</span>}
                {!hwZoomActive && isCameraActive && (
                  <span className="text-muted-foreground/50">No HW zoom</span>
                )}
                {settings.wbMode === "manual" && (
                  <span>{settings.colorTemp}K</span>
                )}
                {settings.torchOn && (
                  <span className="text-yellow-400">⚡ Torch</span>
                )}
              </motion.div>
              {isCameraActive && !aiAutoFocus && (
                <p className="text-xs text-muted-foreground/50 mt-1.5">
                  Tap to focus
                </p>
              )}
              {isCameraActive && aiAutoFocus && (
                <p className="text-xs text-accent/60 mt-1.5 flex items-center gap-1">
                  <Crosshair className="h-3 w-3" />
                  AI auto-focus active — tap-to-focus disabled
                </p>
              )}
            </div>
          </div>

          {/* AI Auto-focus panel */}
          <div
            className="rounded-xl border border-border bg-card p-3 space-y-3"
            data-ocid="settings.ai_focus.panel"
          >
            <div className="flex items-center gap-2">
              <Crosshair className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-foreground">
                AI Auto-focus
              </span>
              <Switch
                checked={aiAutoFocus}
                onCheckedChange={(v) => {
                  setAiAutoFocus(v);
                  if (!v) lastFocusPointRef.current = null;
                }}
                className="data-[state=checked]:bg-accent ml-auto"
                data-ocid="settings.ai_autofocus.switch"
              />
            </div>

            <AnimatePresence>
              {aiAutoFocus && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2 overflow-hidden"
                >
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Focus Subject
                    </Label>
                    <Select
                      value={aiSubject}
                      onValueChange={(v) => {
                        setAiSubject(v as AISubject);
                        lastFocusPointRef.current = null;
                      }}
                    >
                      <SelectTrigger
                        className="h-8 text-xs bg-input border-border"
                        data-ocid="settings.ai_focus_subject.select"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {AI_SUBJECTS.map((s) => (
                          <SelectItem
                            key={s.value}
                            value={s.value}
                            className="text-xs"
                          >
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground/60">
                    AI analyzes each frame and automatically adjusts focus when
                    the subject moves significantly. Tap-to-focus is disabled
                    while AI auto-focus is active.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {!aiAutoFocus && (
              <p className="text-xs text-muted-foreground/50">
                Enable to automatically focus on a selected subject before each
                capture. Analyzes the frame and re-focuses only on significant
                movement to preserve framerate.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Preset dialog */}
      <Dialog open={showPresetDialog} onOpenChange={setShowPresetDialog}>
        <DialogContent
          className="bg-popover border-border"
          data-ocid="settings.preset_dialog.dialog"
        >
          <DialogHeader>
            <DialogTitle className="text-foreground text-sm">
              Save Preset
            </DialogTitle>
          </DialogHeader>
          <Input
            value={presetNameInput}
            onChange={(e) => setPresetNameInput(e.target.value)}
            placeholder="Preset name…"
            className="bg-input border-border"
            onKeyDown={(e) => e.key === "Enter" && handleSavePreset()}
            data-ocid="settings.preset_name.input"
          />
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPresetDialog(false)}
              className="border-border"
              data-ocid="settings.preset_dialog.cancel_button"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSavePreset}
              disabled={isSavingPreset}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
              data-ocid="settings.preset_dialog.confirm_button"
            >
              {isSavingPreset ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span className="ml-1">Save</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FeedbackSection />
    </div>
  );
}
