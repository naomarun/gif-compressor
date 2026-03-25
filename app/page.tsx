"use client";

import { useState, useRef, useCallback, useEffect } from "react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface CompressResult {
  originalSize: number;
  compressedSize: number;
  steps: string[];
  blob: Blob;
  url: string;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Load gifsicle-wasm-browser via script tag (public/gifsicle.min.js)
function loadGifsicleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window.gifsicle) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "/gifsicle.min.js";
    script.onload = () => {
      // Wait a tick for the global to be set
      setTimeout(() => resolve(), 100);
    };
    script.onerror = () => reject(new Error("Failed to load gifsicle"));
    document.head.appendChild(script);
  });
}

async function runGifsicle(
  inputData: Uint8Array,
  args: string[]
): Promise<Uint8Array> {
  await loadGifsicleScript();
  const command = [args.join(" ") + " -o /out/out.gif input.gif"];
  const result = await window.gifsicle.run({
    input: [{ file: new Blob([inputData.buffer as ArrayBuffer], { type: "image/gif" }), name: "input.gif" }],
    command,
  });
  if (!result || result.length === 0) {
    throw new Error("gifsicle produced no output");
  }
  // result is an array of File objects
  const file = result[0];
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

function getGifWidth(data: Uint8Array): number {
  // GIF width is at bytes 6-7 (little-endian)
  if (data.length > 7) {
    return data[6] | (data[7] << 8);
  }
  return 0;
}

async function compressGif(
  inputData: Uint8Array,
  targetSize: number,
  onStep: (msg: string) => void,
  crop?: CropRect
): Promise<{ data: Uint8Array; steps: string[] }> {
  const steps: string[] = [];
  let current = inputData;

  // Step 0: Crop if specified
  if (crop) {
    onStep("クロップ中...");
    try {
      const cropArg = `${crop.x},${crop.y}+${crop.w}x${crop.h}`;
      const out = await runGifsicle(current, ["--crop", cropArg]);
      steps.push(`クロップ (${cropArg}): ${formatSize(out.length)}`);
      current = out;
      if (current.length <= targetSize) return { data: current, steps };
    } catch {
      steps.push("クロップ: エラー");
    }
  }

  // Check if already under target
  if (current.length <= targetSize) {
    steps.push(`すでに目標サイズ以下: ${formatSize(current.length)}`);
    return { data: current, steps };
  }

  // Step 1: Lossless optimization
  onStep("ロスレス最適化中...");
  try {
    const out = await runGifsicle(current, ["--optimize=3"]);
    steps.push(`ロスレス最適化: ${formatSize(out.length)}`);
    current = out;
    if (current.length <= targetSize) return { data: current, steps };
  } catch {
    steps.push("ロスレス最適化: スキップ");
  }

  // Step 2: Color reduction
  for (const colors of [128, 64, 32, 16]) {
    onStep(`色数削減中 (${colors}色)...`);
    try {
      const out = await runGifsicle(current, [
        "--optimize=3",
        "--colors",
        String(colors),
      ]);
      steps.push(`色数削減 (${colors}色): ${formatSize(out.length)}`);
      current = out;
      if (current.length <= targetSize) return { data: current, steps };
    } catch {
      steps.push(`色数削減 (${colors}色): スキップ`);
    }
  }

  // Step 3: Lossy compression
  for (const lossy of [30, 60, 100, 150, 200]) {
    onStep(`lossy圧縮中 (${lossy})...`);
    try {
      const out = await runGifsicle(current, [
        "--optimize=3",
        `--lossy=${lossy}`,
      ]);
      steps.push(`lossy圧縮 (${lossy}): ${formatSize(out.length)}`);
      current = out;
      if (current.length <= targetSize) return { data: current, steps };
    } catch {
      steps.push(`lossy圧縮 (${lossy}): スキップ`);
    }
  }

  // Step 4: Resize
  const origWidth = getGifWidth(inputData);
  for (const scale of [75, 50, 40]) {
    const newWidth = Math.max(1, Math.round(origWidth * scale / 100));
    onStep(`リサイズ中 (${scale}% → ${newWidth}px)...`);
    try {
      const out = await runGifsicle(inputData, [
        "--optimize=3",
        `--lossy=200`,
        "--resize-width",
        String(newWidth),
        "--colors",
        "32",
      ]);
      steps.push(`リサイズ (${scale}% → ${newWidth}px): ${formatSize(out.length)}`);
      current = out;
      if (current.length <= targetSize) return { data: current, steps };
    } catch {
      steps.push(`リサイズ (${scale}% → ${newWidth}px): スキップ`);
    }
  }

  return { data: current, steps };
}

type DragMode =
  | null
  | "move"
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "n"
  | "s"
  | "e"
  | "w";

function CropOverlay({
  imageRef,
  naturalWidth,
  naturalHeight,
  crop,
  onCropChange,
}: {
  imageRef: React.RefObject<HTMLImageElement | null>;
  naturalWidth: number;
  naturalHeight: number;
  crop: CropRect;
  onCropChange: (c: CropRect) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startCrop: CropRect;
  } | null>(null);

  const getDisplayRect = useCallback(() => {
    const img = imageRef.current;
    if (!img) return { dw: 1, dh: 1, offsetX: 0, offsetY: 0 };
    const rect = img.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    return {
      dw: rect.width,
      dh: rect.height,
      offsetX: containerRect ? rect.left - containerRect.left : 0,
      offsetY: containerRect ? rect.top - containerRect.top : 0,
    };
  }, [imageRef]);

  // Convert natural coords to display coords
  const toDisplay = useCallback(
    (c: CropRect) => {
      const { dw, dh } = getDisplayRect();
      const scaleX = dw / naturalWidth;
      const scaleY = dh / naturalHeight;
      return {
        x: c.x * scaleX,
        y: c.y * scaleY,
        w: c.w * scaleX,
        h: c.h * scaleY,
      };
    },
    [getDisplayRect, naturalWidth, naturalHeight]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        startCrop: { ...crop },
      };
    },
    [crop]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const { mode, startX, startY, startCrop } = dragRef.current;
      const { dw, dh } = getDisplayRect();
      const scaleX = naturalWidth / dw;
      const scaleY = naturalHeight / dh;

      const dx = Math.round((e.clientX - startX) * scaleX);
      const dy = Math.round((e.clientY - startY) * scaleY);

      let { x, y, w, h } = startCrop;

      const MIN_SIZE = 10;

      if (mode === "move") {
        x = startCrop.x + dx;
        y = startCrop.y + dy;
        // Clamp
        x = Math.max(0, Math.min(x, naturalWidth - w));
        y = Math.max(0, Math.min(y, naturalHeight - h));
      } else {
        // Resize handles
        if (mode === "nw" || mode === "w" || mode === "sw") {
          const newX = Math.max(0, Math.min(startCrop.x + dx, startCrop.x + startCrop.w - MIN_SIZE));
          w = startCrop.w - (newX - startCrop.x);
          x = newX;
        }
        if (mode === "ne" || mode === "e" || mode === "se") {
          w = Math.max(MIN_SIZE, Math.min(startCrop.w + dx, naturalWidth - startCrop.x));
        }
        if (mode === "nw" || mode === "n" || mode === "ne") {
          const newY = Math.max(0, Math.min(startCrop.y + dy, startCrop.y + startCrop.h - MIN_SIZE));
          h = startCrop.h - (newY - startCrop.y);
          y = newY;
        }
        if (mode === "sw" || mode === "s" || mode === "se") {
          h = Math.max(MIN_SIZE, Math.min(startCrop.h + dy, naturalHeight - startCrop.y));
        }
      }

      onCropChange({ x, y, w, h });
    },
    [getDisplayRect, naturalWidth, naturalHeight, onCropChange]
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const dc = toDisplay(crop);
  const { dw, dh, offsetX, offsetY } = getDisplayRect();

  const handleSize = 10;
  const handles: { mode: DragMode; style: React.CSSProperties; cursor: string }[] = [
    // Corners
    { mode: "nw", cursor: "nwse-resize", style: { left: -handleSize / 2, top: -handleSize / 2 } },
    { mode: "ne", cursor: "nesw-resize", style: { right: -handleSize / 2, top: -handleSize / 2 } },
    { mode: "sw", cursor: "nesw-resize", style: { left: -handleSize / 2, bottom: -handleSize / 2 } },
    { mode: "se", cursor: "nwse-resize", style: { right: -handleSize / 2, bottom: -handleSize / 2 } },
    // Edges
    { mode: "n", cursor: "ns-resize", style: { left: "50%", top: -handleSize / 2, transform: "translateX(-50%)" } },
    { mode: "s", cursor: "ns-resize", style: { left: "50%", bottom: -handleSize / 2, transform: "translateX(-50%)" } },
    { mode: "w", cursor: "ew-resize", style: { left: -handleSize / 2, top: "50%", transform: "translateY(-50%)" } },
    { mode: "e", cursor: "ew-resize", style: { right: -handleSize / 2, top: "50%", transform: "translateY(-50%)" } },
  ];

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: "absolute",
        left: offsetX,
        top: offsetY,
        width: dw,
        height: dh,
      }}
    >
      {/* Dark overlay - top */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: dc.y,
          background: "rgba(0,0,0,0.55)",
          pointerEvents: "none",
        }}
      />
      {/* Dark overlay - bottom */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: dc.y + dc.h,
          width: "100%",
          height: dh - dc.y - dc.h,
          background: "rgba(0,0,0,0.55)",
          pointerEvents: "none",
        }}
      />
      {/* Dark overlay - left */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: dc.y,
          width: dc.x,
          height: dc.h,
          background: "rgba(0,0,0,0.55)",
          pointerEvents: "none",
        }}
      />
      {/* Dark overlay - right */}
      <div
        style={{
          position: "absolute",
          left: dc.x + dc.w,
          top: dc.y,
          width: dw - dc.x - dc.w,
          height: dc.h,
          background: "rgba(0,0,0,0.55)",
          pointerEvents: "none",
        }}
      />

      {/* Crop selection area */}
      <div
        onPointerDown={(e) => handlePointerDown(e, "move")}
        style={{
          position: "absolute",
          left: dc.x,
          top: dc.y,
          width: dc.w,
          height: dc.h,
          border: "2px solid rgba(168,85,247,0.9)",
          cursor: "move",
          boxSizing: "border-box",
        }}
      >
        {/* Rule of thirds lines */}
        <div style={{ position: "absolute", left: "33.3%", top: 0, width: 1, height: "100%", background: "rgba(168,85,247,0.3)" }} />
        <div style={{ position: "absolute", left: "66.6%", top: 0, width: 1, height: "100%", background: "rgba(168,85,247,0.3)" }} />
        <div style={{ position: "absolute", left: 0, top: "33.3%", width: "100%", height: 1, background: "rgba(168,85,247,0.3)" }} />
        <div style={{ position: "absolute", left: 0, top: "66.6%", width: "100%", height: 1, background: "rgba(168,85,247,0.3)" }} />

        {/* Resize handles */}
        {handles.map((h) => (
          <div
            key={h.mode}
            onPointerDown={(e) => handlePointerDown(e, h.mode)}
            style={{
              position: "absolute",
              width: handleSize,
              height: handleSize,
              background: "rgba(168,85,247,0.9)",
              border: "1px solid white",
              borderRadius: 2,
              cursor: h.cursor,
              zIndex: 10,
              ...h.style,
            }}
          />
        ))}
      </div>

      {/* Dimension label */}
      <div
        style={{
          position: "absolute",
          left: dc.x,
          top: dc.y - 24,
          fontSize: 11,
          color: "rgba(168,85,247,1)",
          background: "rgba(0,0,0,0.7)",
          padding: "1px 6px",
          borderRadius: 4,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {Math.round(crop.w)} x {Math.round(crop.h)} px
      </div>
    </div>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [targetSize, setTargetSize] = useState(128);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [result, setResult] = useState<CompressResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Crop state
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const cropImgRef = useRef<HTMLImageElement | null>(null);

  // Cleanup object URLs
  useEffect(() => {
    return () => {
      if (result?.url) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const handleFile = useCallback((f: File) => {
    if (!f.type.includes("gif") && !f.name.endsWith(".gif")) {
      setError("GIFファイルのみ対応しています");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("ファイルサイズは10MB以下にしてください");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
    setCrop(null);
    setNaturalSize(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  const handleCompress = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStatusMsg("Wasmモジュール読み込み中...");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const inputData = new Uint8Array(arrayBuffer);
      const target = targetSize * 1024;

      // Build crop rect in natural pixel coords (rounded to integers)
      let cropForGifsicle: CropRect | undefined;
      if (crop && naturalSize) {
        cropForGifsicle = {
          x: Math.round(crop.x),
          y: Math.round(crop.y),
          w: Math.round(crop.w),
          h: Math.round(crop.h),
        };
      }

      const { data, steps } = await compressGif(inputData, target, setStatusMsg, cropForGifsicle);

      const blob = new Blob([data as unknown as BlobPart], { type: "image/gif" });
      const url = URL.createObjectURL(blob);

      setResult({
        originalSize: inputData.length,
        compressedSize: data.length,
        steps,
        blob,
        url,
      });
    } catch (err) {
      console.error(err);
      setError("圧縮中にエラーが発生しました");
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `compressed-${file?.name || "output.gif"}`;
    a.click();
  };

  const reset = () => {
    if (result?.url) URL.revokeObjectURL(result.url);
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setCrop(null);
    setNaturalSize(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const initCrop = useCallback(() => {
    if (!naturalSize) return;
    setCrop({ x: 0, y: 0, w: naturalSize.w, h: naturalSize.h });
  }, [naturalSize]);

  const resetCrop = useCallback(() => {
    setCrop(null);
  }, []);

  const isCropped = crop && naturalSize && (
    crop.x !== 0 || crop.y !== 0 ||
    Math.round(crop.w) !== naturalSize.w || Math.round(crop.h) !== naturalSize.h
  );

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl space-y-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-center bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
          GIF Compressor
        </h1>
        <p className="text-center text-white text-sm">
          GIFファイルを指定サイズ以下に圧縮します（ブラウザ内処理）
        </p>

        {/* Drop zone - only shown when no file is loaded */}
        {!file && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-12 sm:p-16 text-center cursor-pointer transition-all ${
              dragOver
                ? "border-purple-400 bg-purple-400/10"
                : "border-[#333] hover:border-[#555] bg-[#111]"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".gif,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <div className="space-y-3">
              <svg
                className="w-12 h-12 mx-auto text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-white">
                GIFファイルをドラッグ＆ドロップ
                <br />
                <span className="text-sm text-white/90">
                  またはクリックして選択（最大10MB）
                </span>
              </p>
            </div>
          </div>
        )}

        {/* Hidden file input when file is loaded */}
        {file && (
          <input
            ref={inputRef}
            type="file"
            accept=".gif,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        )}

        {/* Image preview with crop overlay */}
        {file && preview && !result && (
          <div className="bg-[#111] border border-[#333] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-white">
                {file.name} ({formatSize(file.size)})
                {naturalSize && (
                  <span className="ml-2 text-white/90">
                    {naturalSize.w} x {naturalSize.h} px
                  </span>
                )}
              </p>
            </div>

            {/* Image container with crop overlay */}
            <div className="relative flex justify-center select-none" style={{ touchAction: "none" }}>
              <div className="relative inline-block">
                <img
                  ref={cropImgRef}
                  src={preview}
                  alt="プレビュー"
                  onLoad={handleImageLoad}
                  className="max-h-80 rounded-lg block"
                  draggable={false}
                />
                {crop && naturalSize && (
                  <CropOverlay
                    imageRef={cropImgRef}
                    naturalWidth={naturalSize.w}
                    naturalHeight={naturalSize.h}
                    crop={crop}
                    onCropChange={setCrop}
                  />
                )}
              </div>
            </div>

            {/* Crop controls */}
            <div className="flex items-center justify-center gap-3">
              {!crop ? (
                <button
                  onClick={initCrop}
                  disabled={!naturalSize}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm text-white transition-colors"
                >
                  ✂️ クロップ範囲を選択
                </button>
              ) : (
                <>
                  <span className="text-xs text-white/90">
                    クロップ: {Math.round(crop.x)},{Math.round(crop.y)} +{" "}
                    {Math.round(crop.w)} x {Math.round(crop.h)}
                  </span>
                  <button
                    onClick={resetCrop}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white transition-colors"
                  >
                    クロップ解除
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Target size input */}
        {file && !result && (
          <div className="flex items-center gap-4 justify-center">
            <label className="text-sm text-white">目標サイズ:</label>
            <input
              type="number"
              value={targetSize}
              onChange={(e) => setTargetSize(Number(e.target.value))}
              min={8}
              max={10240}
              className="w-24 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-center text-sm text-white focus:outline-none focus:border-purple-400"
            />
            <span className="text-sm text-white">KB</span>
          </div>
        )}

        {/* Actions */}
        {file && (
          <div className="flex gap-3 justify-center">
            {!result && (
              <button
                onClick={handleCompress}
                disabled={loading}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="w-4 h-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    {statusMsg || "圧縮中..."}
                  </span>
                ) : (
                  isCropped ? "クロップ＆圧縮する" : "圧縮する"
                )}
              </button>
            )}
            <button
              onClick={reset}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-medium text-white transition-colors"
            >
              リセット
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-xl p-4 text-center text-sm">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="bg-[#111] border border-[#333] rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">圧縮結果</h2>

            {/* Size comparison */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#1a1a1a] rounded-xl p-4 text-center">
                <p className="text-xs text-white/90 mb-1">圧縮前</p>
                <p className="text-xl font-bold text-white/90">
                  {formatSize(result.originalSize)}
                </p>
              </div>
              <div className="bg-[#1a1a1a] rounded-xl p-4 text-center">
                <p className="text-xs text-white/90 mb-1">圧縮後</p>
                <p className="text-xl font-bold text-green-400">
                  {formatSize(result.compressedSize)}
                </p>
              </div>
            </div>

            <p className="text-center text-sm text-white">
              削減率:{" "}
              {(
                ((result.originalSize - result.compressedSize) /
                  result.originalSize) *
                100
              ).toFixed(1)}
              %
              {result.compressedSize <= targetSize * 1024 ? (
                <span className="ml-2 text-green-400">&#x2713; 目標達成</span>
              ) : (
                <span className="ml-2 text-yellow-400">
                  &#x26A0; 目標未達（これ以上の圧縮は困難です）
                </span>
              )}
            </p>

            {/* Steps */}
            <details className="text-sm">
              <summary className="text-white/90 cursor-pointer hover:text-white/90">
                圧縮ステップ詳細
              </summary>
              <ul className="mt-2 space-y-1 text-white">
                {result.steps.map((step, i) => (
                  <li key={i} className="pl-4 border-l-2 border-gray-700">
                    {step}
                  </li>
                ))}
              </ul>
            </details>

            {/* Preview */}
            <div className="text-center">
              <img
                src={result.url}
                alt="圧縮後GIF"
                className="max-h-64 mx-auto rounded-lg"
              />
            </div>

            {/* Download */}
            <button
              onClick={handleDownload}
              className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-xl font-medium transition-colors"
            >
              ダウンロード
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
