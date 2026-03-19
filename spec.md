# Chrono Cam

## Current State
The settings tab has a zoom slider with hardware/digital/turbo zoom support. Tap-to-focus lets users tap the preview to set a focus point. Settings are persisted per user.

## Requested Changes (Diff)

### Add
- Zoom text input field next to the zoom slider, synced bidirectionally, accepts decimals up to 1 decimal place (tenths)
- AI Auto-focus panel below the camera preview in the settings area
  - Toggle to enable/disable AI auto-focus
  - When AI auto-focus is enabled, tap-to-focus is disabled
  - Dropdown to select focus subject: Person/Face, Sky, Horizon, Foreground, Background, Clouds, Sun, Moon, Stars, Landscape
  - Canvas-based image analysis to detect likely region for selected subject
  - Only re-applies focus constraints when detected position changes significantly (threshold-based, to preserve framerate)
  - Uses requestAnimationFrame loop to analyze frames when active

### Modify
- Zoom slider section: add a text input next to/below the slider
- Tap-to-focus: disable click handler and hide "Tap to focus" hint when AI auto-focus is active
- Preview info bar: show AI focus subject when AI focus is active

### Remove
- Nothing removed

## Implementation Plan
1. Add `zoomInputValue` local state (string) synced with `settings.zoom`
2. Render a text `<Input>` next to the zoom slider; on change parse to float, round to 1 decimal, clamp to slider range, call `handleZoomChange`
3. Add `aiAutoFocus` boolean and `aiSubject` string to local state in SettingsTab
4. Render AI Auto-focus card below the preview panel (inside the right column sticky card, below the preview info bar)
5. Implement `useEffect` that runs a `requestAnimationFrame` loop when `aiAutoFocus && isCameraActive`; on each frame:
   a. Draw video frame to offscreen canvas
   b. Analyze pixel data to determine the likely focus region for the selected subject
   c. Compare new focus point to last applied point; only call `applyFocus` if delta > threshold
6. `applyFocus(x, y)` calls `track.applyConstraints` with `pointsOfInterest` (same as tap-to-focus)
7. When `aiAutoFocus` is toggled on, disable the preview div onClick (tap-to-focus) and hide the hint text
