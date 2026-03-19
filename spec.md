# Chrono Cam

## Current State
New project, no existing code.

## Requested Changes (Diff)

### Add
- Timelapse photo capture web app with Internet Identity authentication
- Two main tabs: Capture and Settings
- Full camera settings with named presets and reset-to-default
- Client-side MP4 video generation from captured photos using FFmpeg.wasm
- Global feedback system (star rating + optional text review)
- Storage space monitoring via StorageManager API

### Modify
- N/A

### Remove
- N/A

## Implementation Plan

### Backend (Motoko)
1. **User Settings**: Store camera and capture settings per user (principal). Supports save, load, reset to defaults.
2. **Presets**: CRUD for named presets per user. Each preset stores the full settings object.
3. **Feedback**: Global list of feedback entries (principal, star rating 1-5, optional text, timestamp). Compute averaged rating. Anyone can read, authenticated users can submit (one per user, updatable).

### Frontend
1. **Auth**: Internet Identity login/logout via authorization component. Show login gate for settings/presets; feedback readable by all.
2. **Capture Tab**:
   - Rate input (float) with FPS / FPM / Interval mode toggle buttons
   - Run / Stop Capture large buttons
   - Optional Duration: value input + Seconds / Minutes / Hours toggle
   - Optional Storage Limit: value input + "Storage left after session" / "Storage consumed by session" toggle
   - Live capture status overlay (elapsed time, frame count, storage used)
   - On session end: FFmpeg.wasm encodes captured frames (stored as blobs in memory) into MP4 at computed FPS, auto-downloads, clears frames from memory after 2 minutes
3. **Settings Tab**:
   - Live camera preview with rule-of-thirds grid overlay option
   - Controls: Zoom, Focus mode, White Balance mode + Color Temperature, ISO, Shutter Speed, Brightness, Exposure mode + Compensation, Contrast, Saturation, Sharpness, Torch toggle, Image Quality (JPEG %), Aspect Ratio, Flip/Mirror, Grid Overlay toggle, Camera Selector, Resolution (HD/FHD/4K/8K)
   - Preset management: save current settings as named preset, load preset, delete preset
   - Reset to Default button
   - Settings persisted to backend per user
4. **Feedback Section** (bottom of both tabs):
   - Star rating selector (1-5)
   - Optional text review input
   - Submit button (requires login)
   - Display: averaged rating (or "N/A"), recent reviews list
5. **Permissions**: Request camera and storage estimate permissions on app load
