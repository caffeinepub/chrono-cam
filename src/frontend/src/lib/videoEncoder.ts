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

  // Guard: captureStream not supported (e.g. Safari iOS)
  if (typeof (canvas as any).captureStream === "undefined") {
    throw new Error("Video capture not supported in this browser");
  }

  const recordFps = Math.max(1, Math.ceil(fps));
  const stream = (canvas as any).captureStream(recordFps) as MediaStream;
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // Promise that resolves only in onstop -- by then all ondataavailable have fired
  const recordingDone = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (e) =>
      reject(
        new Error(
          `MediaRecorder error: ${(e as any).error?.message ?? String(e)}`,
        ),
      );
  });

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

  // Flush any buffered data before stopping
  recorder.requestData();
  recorder.stop();

  // Wait for onstop -- guarantees all ondataavailable events have already fired
  await recordingDone;

  if (opts.onProgress) opts.onProgress(100);

  const blob = new Blob(chunks, { type: mimeType });

  if (blob.size === 0) {
    throw new Error("Encoded video is empty -- try capturing more frames");
  }

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
