import http from "node:http";
import { env } from "../config/env.js";

/**
 * REST client gọi tới container `roomi-fields/notebooklm-mcp` (cổng 3000 nội bộ).
 * Dùng `node:http` để hỗ trợ request chờ lâu (sinh Audio mất 5-8 phút) mà không bị
 * HeadersTimeoutError của undici, đồng thời nhận `fetchFn` cho unit test.
 */

export type NotebookLmClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

export type NblmCitation = {
  marker: string;
  number: number;
  sourceText: string;
  sourceName?: string;
};

export type NblmContentOverview = {
  sources: { id?: string; name: string; type: string; status: string }[];
  generatedContent: { id?: string; type: string; title: string; status: string }[];
  sourceCount: number;
  hasAudioOverview: boolean;
};

export type NblmDownloadData = {
  filePath?: string;
  googleSlidesUrl?: string;
  googleSheetsUrl?: string;
  mimeType?: string;
  size?: number;
};

const DEFAULT_TIMEOUT_MS = 900_000;

export function isNotebookLmConfigured(): boolean {
  return Boolean(env.NOTEBOOKLM_API_URL);
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const key = (apiKey ?? env.NOTEBOOKLM_API_KEY).trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function nodeHttpRequest(
  urlStr: string,
  method: string,
  headers: Record<string, string>,
  bodyStr: string | undefined,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      u,
      { method, headers, timeout: timeoutMs },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          let payload: unknown = null;
          try { payload = JSON.parse(raw); } catch { payload = null; }
          resolve({ ok: (res.statusCode ?? 500) < 400, status: res.statusCode ?? 500, payload });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`Quá thời gian chờ NotebookLM (${Math.round(timeoutMs / 1000)}s)`));
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function requestNblm<T>(
  method: "GET" | "POST",
  pathWithQuery: string,
  body?: Record<string, unknown>,
  opts: NotebookLmClientOptions = {},
): Promise<T> {
  const rawBase = (opts.baseUrl ?? env.NOTEBOOKLM_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!rawBase) throw new Error("Chưa cấu hình NOTEBOOKLM_API_URL trong .env");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fullUrl = `${rawBase}${pathWithQuery}`;
  const headers = buildHeaders(opts.apiKey);
  const bodyStr = body ? JSON.stringify(body) : undefined;

  let ok = false;
  let status = 500;
  let payload: { success?: boolean; data?: T; error?: string } | null = null;

  if (opts.fetchFn) {
    const res = await opts.fetchFn(fullUrl, {
      method,
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(timeoutMs),
    });
    ok = res.ok;
    status = res.status;
    payload = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  } else {
    const res = await nodeHttpRequest(fullUrl, method, headers, bodyStr, timeoutMs);
    ok = res.ok;
    status = res.status;
    payload = res.payload as { success?: boolean; data?: T; error?: string } | null;
  }

  const safePayload = payload as { success?: boolean; data?: T; error?: string } | null;
  if (!ok || !safePayload || safePayload.success === false) {
    const errText = safePayload?.error || `HTTP ${status}`;
    if (/not authenticated|authentication|login|setup-auth/i.test(errText)) {
      throw new Error(
        `NotebookLM chưa đăng nhập tài khoản Google (${errText}). Chủ bot cần mở cửa sổ noVNC (cổng 6080) để đăng nhập Google trước.`,
      );
    }
    throw new Error(`NotebookLM API lỗi: ${errText}`);
  }
  return safePayload.data as T;
}

export async function createNotebookInNblm(
  name: string,
  opts?: NotebookLmClientOptions,
): Promise<{ notebookId: string; notebookUrl: string; title: string }> {
  const data = await requestNblm<{
    notebook_url: string;
    notebook_id: string;
    actual_name?: string;
  }>("POST", "/notebooks/create", { name }, opts);
  return { notebookId: data.notebook_id, notebookUrl: data.notebook_url, title: data.actual_name || name };
}

export async function addSourceToNblm(
  params: { notebookUrl: string; sourceType: "url" | "youtube" | "text"; url?: string; text?: string; title?: string },
  opts?: NotebookLmClientOptions,
): Promise<{ title?: string; sourceType: string }> {
  const data = await requestNblm<{ title?: string; sourceType?: string }>(
    "POST",
    "/content/sources",
    {
      notebook_url: params.notebookUrl,
      source_type: params.sourceType,
      url: params.url,
      text: params.text,
      title: params.title,
    },
    opts,
  );
  return { title: data?.title || params.title || params.url, sourceType: params.sourceType };
}

export async function listContentInNblm(notebookUrl: string, opts?: NotebookLmClientOptions): Promise<NblmContentOverview> {
  return requestNblm<NblmContentOverview>("GET", `/content?notebook_url=${encodeURIComponent(notebookUrl)}`, undefined, opts);
}

export async function askQuestionInNblm(
  notebookUrl: string,
  question: string,
  opts?: NotebookLmClientOptions,
): Promise<{ answer: string; citations: NblmCitation[] }> {
  const data = await requestNblm<{
    status: string;
    answer?: string;
    error?: string;
    sources?: { citations?: NblmCitation[] };
  }>("POST", "/ask", { notebook_url: notebookUrl, question, source_format: "footnotes" }, opts);
  if (data.status === "error" || !data.answer) throw new Error(data.error || "NotebookLM không trả về câu trả lời");
  return { answer: data.answer, citations: data.sources?.citations ?? [] };
}

export async function generateContentInNblm(
  params: {
    notebookUrl: string;
    contentType: "audio_overview" | "video" | "infographic" | "presentation" | "report";
    customInstructions?: string;
    language?: string;
    videoStyle?: string;
    videoFormat?: string;
    infographicFormat?: string;
    reportFormat?: string;
    presentationStyle?: string;
    presentationLength?: string;
  },
  opts?: NotebookLmClientOptions,
): Promise<{ status: string; textContent?: string }> {
  const body: Record<string, unknown> = {
    notebook_url: params.notebookUrl,
    content_type: params.contentType,
    language: params.language || "vi",
  };
  if (params.customInstructions && params.contentType !== "report") body.custom_instructions = params.customInstructions;
  if (params.videoStyle) body.video_style = params.videoStyle;
  if (params.videoFormat) body.video_format = params.videoFormat;
  if (params.infographicFormat) body.infographic_format = params.infographicFormat;
  if (params.reportFormat) body.report_format = params.reportFormat;
  if (params.presentationStyle) body.presentation_style = params.presentationStyle;
  if (params.presentationLength) body.presentation_length = params.presentationLength;

  return requestNblm<{ status: string; textContent?: string }>("POST", "/content/generate", body, {
    ...opts,
    timeoutMs: opts?.timeoutMs ?? 900_000,
  });
}

export async function downloadContentFromNblm(
  notebookUrl: string,
  contentType: "audio_overview" | "video" | "infographic" | "presentation",
  opts?: NotebookLmClientOptions,
): Promise<NblmDownloadData> {
  const q = `?content_type=${encodeURIComponent(contentType)}&notebook_url=${encodeURIComponent(notebookUrl)}`;
  return requestNblm<NblmDownloadData>("GET", `/content/download${q}`, undefined, {
    ...opts,
    timeoutMs: opts?.timeoutMs ?? 300_000,
  });
}
