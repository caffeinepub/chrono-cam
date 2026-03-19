# Chrono Cam

## Current State
Settings tab has many controls (zoom, focus, brightness, contrast, saturation, sharpness, white balance, color temp, ISO, shutter speed, exposure, torch, flip, mirror, grid overlay). Flip, mirror, and grid overlay work via CSS and DOM. All other settings attempt to use MediaStream `applyConstraints()` which is unsupported in most desktop browsers, so they have no visual effect.

## Requested Changes (Diff)

### Add
- CSS filter computation from settings (brightness, contrast, saturation, sharpness, focus blur, color temperature tint)
- Zoom via CSS `scale()` transform in preview
- Canvas filter application during frame capture (brightness, contrast, saturation)
- Zoom-aware canvas cropping during capture
- Vertical flip handling in canvas capture (was missing)

### Modify
- `previewStyle` in SettingsTab to include CSS `filter` and `scale()` for zoom
- CaptureTab video preview style to match same CSS effects
- `captureFrame` in CaptureTab to apply canvas filters and zoom/flip transforms

### Remove
- Nothing removed; `applyConstraints` fallback kept for browsers that do support it (torch, hardware zoom)

## Implementation Plan
1. Create shared `buildVideoStyle` helper that computes CSS transform + filter from UISettings
2. Update SettingsTab `previewStyle` to use helper
3. Update CaptureTab video style to use same helper
4. Update `captureFrame` to apply canvas filter string and handle zoom crop + flip
