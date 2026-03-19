export interface EncodeOptions {
  fps: number;
  onProgress?: (pct: number) => void;
}

function getSupportedMimeType(): string {
  const types = [
    "video/mp4;codecs=avc1",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "video/webm";
}

export async function encodeFramesToVideo(
  frames: Blob[],
  opts: EncodeOptions,
): Promise<{ blob: Blob; mimeType: string }> {
  if (frames.length === 0) throw new Error("No frames to encode");

  const fps = Math.max(0.5, opts.fps);
  const mimeType = getSupportedMimeType();

  // Load first frame to get dimensions
  const firstUrl = URL.createObjectURL(frames[0]);
  const firstImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = firstUrl;
  });
  URL.revokeObjectURL(firstUrl);

  const canvas = document.createElement("canvas");
  canvas.width = firstImg.naturalWidth || 1280;
  canvas.height = firstImg.naturalHeight || 720;
  const ctx = canvas.getContext("2d")!;

  // Use a high fps stream but draw each frame for multiple ticks if fps < 1
  const recordFps = Math.max(1, Math.ceil(fps));
  const stream = canvas.captureStream(recordFps);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.start(100);

  const frameInterval = 1000 / fps;
  for (let i = 0; i < frames.length; i++) {
    const url = URL.createObjectURL(frames[i]);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    if (opts.onProgress) opts.onProgress(Math.round((i / frames.length) * 100));
    // Wait the frame interval so recorder captures this frame
    await new Promise((r) => setTimeout(r, Math.max(50, frameInterval)));
  }

  recorder.stop();
  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const blob = new Blob(chunks, { type: mimeType });
  return { blob, mimeType };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
