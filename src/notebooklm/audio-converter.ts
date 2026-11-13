import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config/env.js";

/**
 * Đọc file sản phẩm tải về từ `notebooklm-mcp` và chuyển đổi Audio (M4A/WAV)
 * sang MP3 bằng `ffmpeg` theo đúng yêu cầu mục 14.4:
 * "Audio về dạng M4A/WAV, bot đổi sang MP3 bằng ffmpeg."
 *
 * Bảo mật:
 * - Chỉ truyền danh sách biến môi trường tối thiểu (`envToiThieuChoFfmpeg`) cho `ffmpeg`,
 *   tuyệt đối không lộ `CREDENTIALS_ENCRYPTION_KEY` hay khóa API vào tiến trình con.
 * - Chỉ đọc file nằm trong thư mục chia sẻ `/data` hoặc `dataDir`, chống path traversal.
 */

const BIEN_MOI_TRUONG_CHO_PHEP = ["PATH", "SYSTEMROOT", "HOME", "TMPDIR", "TEMP", "TMP"] as const;

export function envToiThieuChoFfmpeg(
  nguon: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const kq: NodeJS.ProcessEnv = {};
  for (const k of BIEN_MOI_TRUONG_CHO_PHEP) {
    if (nguon[k] !== undefined) kq[k] = nguon[k];
  }
  return kq;
}

/**
 * Phân giải đường dẫn file do container `notebooklm-mcp` trả về (thường là
 * `/data/notebooklm/...` hoặc `/data/...`) sang đường dẫn thực tế mà `zalo-agent`
 * đọc được (trong Docker mount ở `/data/notebooklm`, hoặc trên máy dev nằm ở `dataDir`).
 */
export function resolveDownloadedFilePath(rawFilePath: string): string {
  const baseName = path.basename(rawFilePath);
  if (!baseName || baseName === "." || baseName === "..") {
    throw new Error("Đường dẫn file tải về từ NotebookLM không hợp lệ");
  }

  const candidates = [
    path.join(dataDir, "notebooklm", baseName),
    path.join(dataDir, baseName),
    path.resolve(rawFilePath),
  ];

  const allowedRoots = [path.resolve(dataDir), path.resolve("/data")];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const insideAllowed = allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep),
    );
    if (insideAllowed && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }

  throw new Error(
    `Không tìm thấy file tải về từ NotebookLM (${baseName}). Hãy kiểm tra volume chia sẻ /data/notebooklm giữa 2 container.`,
  );
}

export function chayFfmpegSangMp3(
  inputPath: string,
  outputPath: string,
  timeoutMs = 120_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-nostdin", "-i", inputPath, "-vn", "-codec:a", "libmp3lame", "-qscale:a", "2", outputPath],
      { env: envToiThieuChoFfmpeg(), timeout: timeoutMs, windowsHide: true },
      (err, _stdout, stderr) => {
        if (!err) {
          resolve();
          return;
        }
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(
            new Error(
              "Máy chủ chưa cài ffmpeg nên không đổi được file âm thanh M4A/WAV sang MP3.",
            ),
          );
          return;
        }
        reject(new Error(`Lỗi chuyển đổi âm thanh sang MP3 bằng ffmpeg: ${stderr || err.message}`));
      },
    );
  });
}

/**
 * Đọc file tải về thành Buffer; nếu là audio (`.m4a`/`.wav`/`.aac`) thì đổi sang `.mp3`
 * bằng `ffmpeg` (ghi file đích vào `dataDir/tmp` của `zalo-agent`), sau đó dọn file tạm.
 */
export async function docVaChuanHoaFileNotebookLm(
  rawFilePath: string,
  loai: "audio" | "video" | "infographic",
  runner: typeof chayFfmpegSangMp3 = chayFfmpegSangMp3,
): Promise<{ buffer: Buffer; ext: string }> {
  const resolvedInput = resolveDownloadedFilePath(rawFilePath);
  const extGoc = path.extname(resolvedInput).toLowerCase();

  if (loai === "audio" && extGoc !== ".mp3") {
    const tmpDir = path.join(dataDir, "tmp");
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const mp3Path = path.join(
      tmpDir,
      `${path.basename(resolvedInput, extGoc)}-${Date.now()}.mp3`,
    );
    try {
      await runner(resolvedInput, mp3Path);
      const buffer = await fs.promises.readFile(mp3Path);
      return { buffer, ext: "mp3" };
    } finally {
      await fs.promises.unlink(mp3Path).catch(() => {});
      await fs.promises.unlink(resolvedInput).catch(() => {});
    }
  }

  try {
    const buffer = await fs.promises.readFile(resolvedInput);
    const defaultExt = loai === "audio" ? "mp3" : loai === "video" ? "mp4" : "png";
    const ext = extGoc.replace(/^\./, "") || defaultExt;
    return { buffer, ext };
  } finally {
    await fs.promises.unlink(resolvedInput).catch(() => {});
  }
}
