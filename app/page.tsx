"use client";

import { useState, useRef, useCallback } from "react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface CompressResult {
  originalSize: number;
  compressedSize: number;
  steps: string[];
  data: string;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [targetSize, setTargetSize] = useState(128);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompressResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleCompress = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("targetSize", String(targetSize));

      const res = await fetch("/api/compress", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "エラーが発生しました");
        return;
      }

      setResult(data);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.data;
    a.download = `compressed-${file?.name || "output.gif"}`;
    a.click();
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl space-y-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-center bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
          GIF Compressor
        </h1>
        <p className="text-center text-gray-400 text-sm">
          GIFファイルを指定サイズ以下に圧縮します
        </p>

        {/* Drop zone */}
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
              : "border-gray-700 hover:border-gray-500 bg-gray-900/50"
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
          {preview ? (
            <div className="space-y-3">
              <img
                src={preview}
                alt="Preview"
                className="max-h-48 mx-auto rounded-lg"
              />
              <p className="text-sm text-gray-400">
                {file?.name} ({formatSize(file?.size || 0)})
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <svg
                className="w-12 h-12 mx-auto text-gray-600"
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
              <p className="text-gray-400">
                GIFファイルをドラッグ＆ドロップ
                <br />
                <span className="text-sm text-gray-500">
                  またはクリックして選択（最大10MB）
                </span>
              </p>
            </div>
          )}
        </div>

        {/* Target size input */}
        {file && (
          <div className="flex items-center gap-4 justify-center">
            <label className="text-sm text-gray-400">目標サイズ:</label>
            <input
              type="number"
              value={targetSize}
              onChange={(e) => setTargetSize(Number(e.target.value))}
              min={8}
              max={10240}
              className="w-24 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-center text-sm focus:outline-none focus:border-purple-400"
            />
            <span className="text-sm text-gray-400">KB</span>
          </div>
        )}

        {/* Actions */}
        {file && (
          <div className="flex gap-3 justify-center">
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
                  圧縮中...
                </span>
              ) : (
                "圧縮する"
              )}
            </button>
            <button
              onClick={reset}
              className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-xl font-medium transition-colors"
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
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">圧縮結果</h2>

            {/* Size comparison */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-800 rounded-xl p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">圧縮前</p>
                <p className="text-xl font-bold text-gray-300">
                  {formatSize(result.originalSize)}
                </p>
              </div>
              <div className="bg-gray-800 rounded-xl p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">圧縮後</p>
                <p className="text-xl font-bold text-green-400">
                  {formatSize(result.compressedSize)}
                </p>
              </div>
            </div>

            <p className="text-center text-sm text-gray-400">
              削減率:{" "}
              {(
                ((result.originalSize - result.compressedSize) /
                  result.originalSize) *
                100
              ).toFixed(1)}
              %
              {result.compressedSize <= targetSize * 1024 ? (
                <span className="ml-2 text-green-400">目標達成</span>
              ) : (
                <span className="ml-2 text-yellow-400">
                  目標未達（これ以上の圧縮は困難です）
                </span>
              )}
            </p>

            {/* Steps */}
            <details className="text-sm">
              <summary className="text-gray-500 cursor-pointer hover:text-gray-300">
                圧縮ステップ詳細
              </summary>
              <ul className="mt-2 space-y-1 text-gray-400">
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
                src={result.data}
                alt="Compressed GIF"
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
