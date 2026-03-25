import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, stat } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

// Find gifsicle binary - check common locations
function findGifsicle(): string {
  const { execFileSync } = require("child_process");
  try {
    return execFileSync("which", ["gifsicle"]).toString().trim();
  } catch {
    // Fallback paths
    const paths = [
      join(process.cwd(), "node_modules", "gifsicle", "vendor", "gifsicle"),
      "/usr/bin/gifsicle",
      "/usr/local/bin/gifsicle",
    ];
    for (const p of paths) {
      try {
        require("fs").accessSync(p);
        return p;
      } catch {
        continue;
      }
    }
    throw new Error("gifsicle binary not found");
  }
}

let _gifsicle: string | null = null;
function getGifsicle(): string {
  if (!_gifsicle) _gifsicle = findGifsicle();
  return _gifsicle;
}

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

async function getFileSize(path: string): Promise<number> {
  const s = await stat(path);
  return s.size;
}

async function runGifsicle(
  inputPath: string,
  outputPath: string,
  args: string[]
): Promise<void> {
  await execFileAsync(getGifsicle(), [
    ...args,
    "-o",
    outputPath,
    inputPath,
  ]);
}

async function compressGif(
  inputPath: string,
  targetSize: number
): Promise<{ outputPath: string; steps: string[] }> {
  const id = randomUUID();
  const steps: string[] = [];
  let currentInput = inputPath;

  const makeTmp = () => join("/tmp", `gif-${id}-${Date.now()}.gif`);

  // Step 1: Lossless optimization
  {
    const out = makeTmp();
    await runGifsicle(currentInput, out, ["--optimize=3"]);
    const size = await getFileSize(out);
    steps.push(`ロスレス最適化: ${formatSize(size)}`);
    if (currentInput !== inputPath) await unlink(currentInput).catch(() => {});
    currentInput = out;
    if (size <= targetSize) return { outputPath: currentInput, steps };
  }

  // Step 2: Color reduction
  for (const colors of [128, 64, 32, 16]) {
    const out = makeTmp();
    await runGifsicle(currentInput, out, [
      "--optimize=3",
      "--colors",
      String(colors),
    ]);
    const size = await getFileSize(out);
    steps.push(`色数削減 (${colors}色): ${formatSize(size)}`);
    if (currentInput !== inputPath) await unlink(currentInput).catch(() => {});
    currentInput = out;
    if (size <= targetSize) return { outputPath: currentInput, steps };
  }

  // Step 3: Lossy compression
  for (const lossy of [30, 60, 100, 150, 200]) {
    const out = makeTmp();
    await runGifsicle(currentInput, out, [
      "--optimize=3",
      `--lossy=${lossy}`,
    ]);
    const size = await getFileSize(out);
    steps.push(`lossy圧縮 (${lossy}): ${formatSize(size)}`);
    if (currentInput !== inputPath) await unlink(currentInput).catch(() => {});
    currentInput = out;
    if (size <= targetSize) return { outputPath: currentInput, steps };
  }

  // Step 4: Resize
  for (const scale of [75, 50, 40]) {
    const out = makeTmp();
    await runGifsicle(currentInput, out, [
      "--optimize=3",
      `--lossy=200`,
      "--resize-width",
      `${scale}%`,
    ]);
    const size = await getFileSize(out);
    steps.push(`リサイズ (${scale}%): ${formatSize(size)}`);
    if (currentInput !== inputPath) await unlink(currentInput).catch(() => {});
    currentInput = out;
    if (size <= targetSize) return { outputPath: currentInput, steps };
  }

  return { outputPath: currentInput, steps };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

export async function POST(request: NextRequest) {
  let inputPath: string | null = null;
  let outputPath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const targetKB = Number(formData.get("targetSize") || 128);

    if (!file) {
      return NextResponse.json({ error: "ファイルが選択されていません" }, { status: 400 });
    }

    if (!file.type.includes("gif") && !file.name.endsWith(".gif")) {
      return NextResponse.json({ error: "GIFファイルのみ対応しています" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ error: "ファイルサイズは10MB以下にしてください" }, { status: 400 });
    }

    const targetSize = targetKB * 1024;
    const buffer = Buffer.from(await file.arrayBuffer());
    const originalSize = buffer.length;

    inputPath = join("/tmp", `gif-input-${randomUUID()}.gif`);
    await writeFile(inputPath, buffer);

    const { outputPath: compressedPath, steps } = await compressGif(inputPath, targetSize);
    outputPath = compressedPath;

    const compressedBuffer = await readFile(outputPath);
    const compressedSize = compressedBuffer.length;

    // Clean up
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});

    const base64 = compressedBuffer.toString("base64");

    return NextResponse.json({
      originalSize,
      compressedSize,
      steps,
      data: `data:image/gif;base64,${base64}`,
    });
  } catch (error) {
    // Clean up on error
    if (inputPath) await unlink(inputPath).catch(() => {});
    if (outputPath) await unlink(outputPath).catch(() => {});

    console.error("Compression error:", error);
    return NextResponse.json(
      { error: "圧縮中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
