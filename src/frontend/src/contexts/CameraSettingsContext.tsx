import type React from "react";
import { createContext, useCallback, useContext, useState } from "react";
import {
  type CameraSettings,
  Variant_ratio1_1_ratio4_3_ratio16_9,
} from "../backend";

export interface UISettings {
  deviceId: string;
  resolution: number; // 0=HD 1=FHD 2=4K 3=8K
  aspectRatio: Variant_ratio1_1_ratio4_3_ratio16_9;
  zoom: number; // 1-10
  focusValue: number; // 0-100
  wbMode: "auto" | "manual";
  colorTemp: number; // 2500-8000
  iso: number; // 50-6400
  shutterSpeed: number; // 1-8000
  brightness: number; // -100 to 100
  exposure: number; // -300 to 300
  contrast: number; // 0-200
  saturation: number; // 0-200
  sharpness: number; // 0-200
  imageQuality: number; // 10-100
  torchOn: boolean;
  flip: boolean;
  mirror: boolean;
  gridOverlay: boolean;
}

export const DEFAULT_SETTINGS: UISettings = {
  deviceId: "",
  resolution: 0,
  aspectRatio: Variant_ratio1_1_ratio4_3_ratio16_9.ratio16_9,
  zoom: 1,
  focusValue: 0,
  wbMode: "auto",
  colorTemp: 5500,
  iso: 400,
  shutterSpeed: 60,
  brightness: 0,
  exposure: 0,
  contrast: 100,
  saturation: 100,
  sharpness: 100,
  imageQuality: 90,
  torchOn: false,
  flip: false,
  mirror: false,
  gridOverlay: false,
};

export function toUISettings(s: CameraSettings): UISettings {
  return {
    deviceId: s.cameraDeviceId,
    resolution: Number(s.resolution),
    aspectRatio: s.aspectRatio,
    zoom: Number(s.zoom),
    focusValue: Number(s.focus),
    wbMode: s.whiteBalance.__kind__ === "auto" ? "auto" : "manual",
    colorTemp: Number(s.colorTemperature),
    iso: Number(s.iso),
    shutterSpeed: Number(s.shutterSpeed),
    brightness: Number(s.brightness),
    exposure: Number(s.exposure),
    contrast: Number(s.contrast),
    saturation: Number(s.saturation),
    sharpness: Number(s.sharpness),
    imageQuality: Number(s.imageQuality),
    torchOn: s.torchOn,
    flip: s.flip,
    mirror: s.mirror,
    gridOverlay: s.gridOverlay,
  };
}

export function fromUISettings(s: UISettings): CameraSettings {
  return {
    cameraDeviceId: s.deviceId,
    resolution: BigInt(s.resolution),
    aspectRatio: s.aspectRatio,
    zoom: BigInt(Math.round(s.zoom)),
    focus: BigInt(Math.round(s.focusValue)),
    whiteBalance:
      s.wbMode === "auto"
        ? { __kind__: "auto" as const, auto: null }
        : {
            __kind__: "custom" as const,
            custom: BigInt(Math.round(s.colorTemp)),
          },
    colorTemperature: BigInt(Math.round(s.colorTemp)),
    iso: BigInt(Math.round(s.iso)),
    shutterSpeed: BigInt(Math.round(s.shutterSpeed)),
    brightness: BigInt(Math.round(s.brightness)),
    exposure: BigInt(Math.round(s.exposure)),
    contrast: BigInt(Math.round(s.contrast)),
    saturation: BigInt(Math.round(s.saturation)),
    sharpness: BigInt(Math.round(s.sharpness)),
    imageQuality: BigInt(Math.round(s.imageQuality)),
    torchOn: s.torchOn,
    flip: s.flip,
    mirror: s.mirror,
    gridOverlay: s.gridOverlay,
  };
}

export const RESOLUTION_MAP: Record<
  number,
  { width: number; height: number; label: string }
> = {
  0: { width: 1280, height: 720, label: "HD" },
  1: { width: 1920, height: 1080, label: "FHD" },
  2: { width: 3840, height: 2160, label: "4K" },
  3: { width: 7680, height: 4320, label: "8K" },
};

interface CameraSettingsContextValue {
  settings: UISettings;
  setSettings: React.Dispatch<React.SetStateAction<UISettings>>;
  updateSetting: <K extends keyof UISettings>(
    key: K,
    value: UISettings[K],
  ) => void;
}

const CameraSettingsContext = createContext<CameraSettingsContextValue | null>(
  null,
);

export function CameraSettingsProvider({
  children,
}: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<UISettings>(DEFAULT_SETTINGS);

  const updateSetting = useCallback(
    <K extends keyof UISettings>(key: K, value: UISettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  return (
    <CameraSettingsContext.Provider
      value={{ settings, setSettings, updateSetting }}
    >
      {children}
    </CameraSettingsContext.Provider>
  );
}

export function useCameraSettings() {
  const ctx = useContext(CameraSettingsContext);
  if (!ctx)
    throw new Error("useCameraSettings must be inside CameraSettingsProvider");
  return ctx;
}
