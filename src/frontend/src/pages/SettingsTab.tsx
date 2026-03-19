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
  Flashlight,
  FlipHorizontal,
  FlipVertical,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Sun,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
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

export default function SettingsTab() {
  const { identity } = useInternetIdentity();
  const isAuthenticated = !!identity;
  const { settings, setSettings } = useCameraSettings();

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

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [presetNameInput, setPresetNameInput] = useState("");
  const [showPresetDialog, setShowPresetDialog] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved settings from backend
  useEffect(() => {
    if (savedSettings) {
      setSettings(toUISettings(savedSettings));
    }
  }, [savedSettings, setSettings]);

  // Enumerate devices
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((devs) => {
      setDevices(devs.filter((d) => d.kind === "videoinput"));
    });
  }, []);

  // Start camera preview
  const startPreview = useCallback(
    async (deviceId?: string, resolution?: number) => {
      for (const t of streamRef.current?.getTracks() ?? []) {
        t.stop();
      }
      streamRef.current = null;
      setCameraError(null);

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
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setIsCameraActive(true);
      } catch (e) {
        setCameraError(e instanceof Error ? e.message : "Camera access denied");
        setIsCameraActive(false);
      }
    },
    [settings.deviceId, settings.resolution],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run once on mount
  useEffect(() => {
    startPreview();
    return () => {
      for (const t of streamRef.current?.getTracks() ?? []) {
        t.stop();
      }
    };
  }, []);

  // Apply constraints to active track
  const applyTrackConstraints = useCallback(async (newSettings: UISettings) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const adv: Record<string, unknown> = {};
      if (newSettings.zoom > 1) adv.zoom = newSettings.zoom;
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
    const uiS = toUISettings(preset.settings);
    handleSettingChange(uiS);
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
    startPreview(deviceId, settings.resolution);
  };

  const handleResolutionChange = (res: number) => {
    handleSettingChange({ ...settings, resolution: res });
    startPreview(settings.deviceId, res);
  };

  const previewStyle: React.CSSProperties = {
    transform:
      `${settings.flip ? "scaleY(-1)" : ""} ${settings.mirror ? "scaleX(-1)" : ""}`.trim() ||
      undefined,
  };

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

            {devices.length > 0 && (
              <SettingRow label="Camera Device">
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
                    <SelectItem value="default" className="text-xs">
                      Default Camera
                    </SelectItem>
                    {devices.map((d) => (
                      <SelectItem
                        key={d.deviceId}
                        value={d.deviceId}
                        className="text-xs"
                      >
                        {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            )}

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

            <SettingRow label={`Zoom — ${settings.zoom}x`}>
              <Slider
                min={1}
                max={10}
                step={0.1}
                value={[settings.zoom]}
                onValueChange={([v]) =>
                  handleSettingChange({ ...settings, zoom: v })
                }
                className="py-1"
                data-ocid="settings.zoom.input"
              />
            </SettingRow>

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
        <div className="rounded-xl border border-border bg-card overflow-hidden sticky top-4 self-start">
          <div
            className="relative bg-black"
            style={{ aspectRatio: "16/9", minHeight: 200 }}
          >
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              style={previewStyle}
              playsInline
              muted
              autoPlay
            />

            {/* Overlays */}
            {isCameraActive && (
              <>
                {/* Resolution chip */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-xs font-mono text-white">
                  {RESOLUTION_MAP[settings.resolution as 0 | 1 | 2 | 3]?.label}{" "}
                  ·{" "}
                  {settings.aspectRatio.replace("ratio", "").replace(/_/g, ":")}
                </div>
                {/* LIVE badge */}
                <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-[oklch(0.557_0.172_22)] text-white text-xs font-bold">
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
                  {settings.zoom}x
                </span>
              </span>
              {settings.wbMode === "manual" && (
                <span>{settings.colorTemp}K</span>
              )}
              {settings.torchOn && (
                <span className="text-yellow-400">⚡ Torch</span>
              )}
            </motion.div>
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
