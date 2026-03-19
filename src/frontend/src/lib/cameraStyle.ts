import type { UISettings } from "../contexts/CameraSettingsContext";

export function buildVideoStyle(settings: UISettings): React.CSSProperties {
  const transforms: string[] = [];
  const filters: string[] = [];

  if (settings.flip) transforms.push("scaleY(-1)");
  if (settings.mirror) transforms.push("scaleX(-1)");

  if (settings.zoom > 1) transforms.push(`scale(${settings.zoom})`);

  const brightnessVal = 1 + settings.brightness / 100;
  if (Math.abs(brightnessVal - 1) > 0.01)
    filters.push(`brightness(${brightnessVal.toFixed(2)})`);

  if (settings.exposure !== 0) {
    const evBrightness = 2 ** (settings.exposure / 100);
    filters.push(`brightness(${evBrightness.toFixed(3)})`);
  }

  const contrastVal = settings.contrast / 100;
  if (Math.abs(contrastVal - 1) > 0.01)
    filters.push(`contrast(${contrastVal.toFixed(2)})`);

  const saturateVal = settings.saturation / 100;
  if (Math.abs(saturateVal - 1) > 0.01)
    filters.push(`saturate(${saturateVal.toFixed(2)})`);

  if (settings.wbMode === "manual") {
    const normalised = (settings.colorTemp - 5500) / 2750;
    if (normalised < 0) {
      const warmAmount = Math.min(Math.abs(normalised) * 0.5, 0.5);
      filters.push(`sepia(${warmAmount.toFixed(2)})`);
    } else if (normalised > 0) {
      const hueShift = normalised * -30;
      filters.push(`hue-rotate(${hueShift.toFixed(1)}deg)`);
      filters.push(`saturate(${(1 - normalised * 0.1).toFixed(2)})`);
    }
  }

  if (settings.focusValue > 0 && settings.focusValue < 100) {
    const blurPx = ((100 - settings.focusValue) / 100) * 3;
    if (blurPx > 0.2) filters.push(`blur(${blurPx.toFixed(1)}px)`);
  }

  return {
    transform: transforms.length ? transforms.join(" ") : undefined,
    filter: filters.length ? filters.join(" ") : undefined,
  };
}

export function buildCanvasFilter(settings: UISettings): string {
  const filters: string[] = [];

  const brightnessVal = 1 + settings.brightness / 100;
  if (Math.abs(brightnessVal - 1) > 0.01)
    filters.push(`brightness(${brightnessVal.toFixed(2)})`);

  if (settings.exposure !== 0) {
    const evBrightness = 2 ** (settings.exposure / 100);
    filters.push(`brightness(${evBrightness.toFixed(3)})`);
  }

  const contrastVal = settings.contrast / 100;
  if (Math.abs(contrastVal - 1) > 0.01)
    filters.push(`contrast(${contrastVal.toFixed(2)})`);

  const saturateVal = settings.saturation / 100;
  if (Math.abs(saturateVal - 1) > 0.01)
    filters.push(`saturate(${saturateVal.toFixed(2)})`);

  if (settings.wbMode === "manual") {
    const normalised = (settings.colorTemp - 5500) / 2750;
    if (normalised < 0) {
      const warmAmount = Math.min(Math.abs(normalised) * 0.5, 0.5);
      filters.push(`sepia(${warmAmount.toFixed(2)})`);
    } else if (normalised > 0) {
      const hueShift = normalised * -30;
      filters.push(`hue-rotate(${hueShift.toFixed(1)}deg)`);
    }
  }

  return filters.length ? filters.join(" ") : "none";
}
