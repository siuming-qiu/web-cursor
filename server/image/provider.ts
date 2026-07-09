/**
 * [INPUT]: image job input + provider model + resolved input images
 * [OUTPUT]: provider-neutral submit/poll result with image bytes
 * [POS]: A 域生图 provider 适配层 —— 显式映射 YUNWU/Gemini/fal 返回契约
 * [PROTOCOL]: provider 临时 URL/data URL 只作为中间值；未知状态/结构直接失败，不猜字段
 */
import "server-only";
import OpenAI from "openai";
import {
  GeneratedImageMimeType,
  ImageJobErrorCode,
  ImageProviderModel,
  type GenerateImageItemInput,
  type GeneratedImageMimeType as GeneratedImageMimeTypeValue,
  type ImageJobError,
  type ImageProviderModel as ImageProviderModelValue,
} from "@/types/image";
import type { ProviderInputImage } from "@/server/image/storage";

const YUNWU_BASE_URL = "https://yunwu.ai/v1";
const YUNWU_FAL_BASE_URL = "https://yunwu.ai/fal-ai/nano-banana";
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const FalStatus = {
  InQueue: "IN_QUEUE",
  InProgress: "IN_PROGRESS",
  Completed: "COMPLETED",
} as const;

type GeneratedBytes = {
  bytes: Buffer;
  mimeType: GeneratedImageMimeTypeValue;
};

export type ImageProviderSubmitResult =
  | ({ status: "completed" } & GeneratedBytes)
  | { status: "submitted"; providerJobId: string };

export type ImageProviderPollResult =
  | { status: "running" }
  | ({ status: "completed" } & GeneratedBytes)
  | { status: "failed"; error: ImageJobError };

export class ImageProviderError extends Error {
  code: ImageJobErrorCode;

  constructor(code: ImageJobErrorCode, message: string) {
    super(message);
    this.name = "ImageProviderError";
    this.code = code;
  }
}

const openAiCompatibleYunwu = new OpenAI({
  baseURL: YUNWU_BASE_URL,
  apiKey: process.env.YUNWU_API_KEY ?? "missing-yunwu-api-key",
});

export function providerError(error: unknown): ImageJobError {
  if (error instanceof ImageProviderError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: ImageJobErrorCode.ProviderFailed,
    message: error instanceof Error ? error.message : String(error),
  };
}

function authHeaders() {
  if (!process.env.YUNWU_API_KEY) {
    throw new ImageProviderError(ImageJobErrorCode.ProviderUnavailable, "Missing YUNWU_API_KEY.");
  }
  return {
    Authorization: `Bearer ${process.env.YUNWU_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function promptWithAspectRatio(input: GenerateImageItemInput): string {
  return input.aspectRatio
    ? `${input.prompt}\n\nRequired aspect ratio: ${input.aspectRatio}.`
    : input.prompt;
}

function decodeDataUrl(dataUrl: string): GeneratedBytes {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, "Provider returned unsupported data URL.");
  }

  const mimeType = match[1] as GeneratedImageMimeTypeValue;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, "Provider returned empty image bytes.");
  }
  const actualMimeType = sniffGeneratedImageMimeType(bytes);
  if (!actualMimeType) {
    throw new ImageProviderError(
      ImageJobErrorCode.ProviderFailed,
      `Provider data URL bytes do not match any supported image MIME. Declared MIME: ${mimeType}.`,
    );
  }
  return { bytes, mimeType: actualMimeType };
}

function sniffGeneratedImageMimeType(bytes: Buffer): GeneratedImageMimeTypeValue | null {
  if (bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return GeneratedImageMimeType.Png;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return GeneratedImageMimeType.Jpeg;
  }
  if (bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return GeneratedImageMimeType.Webp;
  }
  return null;
}

function extractGeminiDataUrl(content: unknown): string {
  if (typeof content !== "string") {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, "Gemini image response content is not a string.");
  }

  const raw = content.trim();
  if (raw.startsWith("data:image/")) return raw;

  const markdownImage = raw.match(/!\[[^\]]*]\((data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)\)/);
  if (!markdownImage) {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, "Gemini image response did not include a data URL.");
  }
  return markdownImage[1];
}

async function submitGeminiChatImage(
  model: ImageProviderModelValue,
  input: GenerateImageItemInput,
  inputImages: ProviderInputImage[],
): Promise<ImageProviderSubmitResult> {
  if (!process.env.YUNWU_API_KEY) {
    throw new ImageProviderError(ImageJobErrorCode.ProviderUnavailable, "Missing YUNWU_API_KEY.");
  }

  const content = [
    { type: "text" as const, text: promptWithAspectRatio(input) },
    ...inputImages.map((image) => ({
      type: "image_url" as const,
      image_url: { url: image.dataUrl },
    })),
  ];

  const result = await openAiCompatibleYunwu.chat.completions.create({
    model,
    messages: [{ role: "user", content }],
  });

  const dataUrl = extractGeminiDataUrl(result.choices[0]?.message?.content);
  return { status: "completed", ...decodeDataUrl(dataUrl) };
}

function extractFalError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (typeof value.detail === "string" && value.detail) return value.detail;
  if (Array.isArray(value.detail) && value.detail.length > 0) return String(value.detail[0]);
  if (typeof value.error === "string" && value.error) return value.error;
  if (value.error && typeof value.error === "object") {
    const message = (value.error as Record<string, unknown>).message;
    if (typeof message === "string" && message) return message;
  }
  return null;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, `Provider returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

async function submitFalNanoBanana(
  input: GenerateImageItemInput,
  inputImages: ProviderInputImage[],
): Promise<ImageProviderSubmitResult> {
  const imageUrls = inputImages.map((image) => image.publicUrl);
  if (inputImages.length > 0 && imageUrls.some((url) => !url)) {
    throw new ImageProviderError(
      ImageJobErrorCode.ProviderFailed,
      "fal nano-banana requires public input image URLs; private attachments are not rehosted in this version.",
    );
  }

  const isEdit = imageUrls.length > 0;
  const response = await fetch(isEdit ? `${YUNWU_FAL_BASE_URL}/edit` : YUNWU_FAL_BASE_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      prompt: promptWithAspectRatio(input),
      num_images: 1,
      ...(isEdit ? { image_urls: imageUrls } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new ImageProviderError(
      ImageJobErrorCode.ProviderFailed,
      `fal submit HTTP ${response.status}: ${extractFalError(body) ?? response.statusText}`,
    );
  }
  if (!body || typeof body !== "object") {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, "fal submit returned non-object JSON.");
  }

  const requestId = (body as Record<string, unknown>).request_id;
  if (typeof requestId !== "string" || !requestId) {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, "fal submit response missing request_id.");
  }

  return { status: "submitted", providerJobId: requestId };
}

async function downloadGeneratedImage(url: string): Promise<GeneratedBytes> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, `Image download HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (!Object.values(GeneratedImageMimeType).includes(contentType as GeneratedImageMimeTypeValue)) {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, `Unsupported downloaded image MIME: ${contentType ?? "missing"}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, "Downloaded image is empty.");
  }
  const actualMimeType = sniffGeneratedImageMimeType(bytes);
  if (!actualMimeType) {
    throw new ImageProviderError(
      ImageJobErrorCode.ProviderFailed,
      `Downloaded image bytes do not match any supported image MIME. Declared MIME: ${contentType}.`,
    );
  }

  return { bytes, mimeType: actualMimeType };
}

function extractFalImageUrl(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, "fal result returned non-object JSON.");
  }
  const images = (body as Record<string, unknown>).images;
  if (!Array.isArray(images) || images.length === 0 || !images[0] || typeof images[0] !== "object") {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, "fal result missing images[0].url.");
  }
  const url = (images[0] as Record<string, unknown>).url;
  if (typeof url !== "string" || !url) {
    throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, "fal result images[0].url is invalid.");
  }
  return url;
}

async function pollFalNanoBanana(providerJobId: string): Promise<ImageProviderPollResult> {
  try {
    const statusResponse = await fetch(`${YUNWU_FAL_BASE_URL}/requests/${providerJobId}/status`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const statusBody = await readJsonResponse(statusResponse);

    if (!statusResponse.ok) {
      return {
        status: "failed",
        error: {
          code: ImageJobErrorCode.ProviderFailed,
          message: `fal status HTTP ${statusResponse.status}: ${extractFalError(statusBody) ?? statusResponse.statusText}`,
        },
      };
    }
    if (!statusBody || typeof statusBody !== "object") {
      return { status: "failed", error: { code: ImageJobErrorCode.ProviderFailed, message: "fal status returned non-object JSON." } };
    }

    const status = (statusBody as Record<string, unknown>).status;
    if (status === FalStatus.InQueue || status === FalStatus.InProgress) return { status: "running" };
    if (status !== FalStatus.Completed) {
      return {
        status: "failed",
        error: {
          code: ImageJobErrorCode.ProviderFailed,
          message: extractFalError(statusBody) ?? `Unexpected fal status: ${String(status || "empty")}`,
        },
      };
    }

    const resultResponse = await fetch(`${YUNWU_FAL_BASE_URL}/requests/${providerJobId}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const resultBody = await readJsonResponse(resultResponse);
    if (!resultResponse.ok) {
      return {
        status: "failed",
        error: {
          code: ImageJobErrorCode.ProviderFailed,
          message: `fal result HTTP ${resultResponse.status}: ${extractFalError(resultBody) ?? resultResponse.statusText}`,
        },
      };
    }

    return { status: "completed", ...(await downloadGeneratedImage(extractFalImageUrl(resultBody))) };
  } catch (error) {
    return { status: "failed", error: providerError(error) };
  }
}

export async function submitImageProviderJob(ctx: {
  model: ImageProviderModelValue;
  input: GenerateImageItemInput;
  inputImages: ProviderInputImage[];
}): Promise<ImageProviderSubmitResult> {
  if (ctx.model === ImageProviderModel.YunwuGemini31FlashImagePreview) {
    return submitGeminiChatImage(ctx.model, ctx.input, ctx.inputImages);
  }
  if (ctx.model === ImageProviderModel.YunwuFalNanoBanana) {
    return submitFalNanoBanana(ctx.input, ctx.inputImages);
  }
  const unreachable: never = ctx.model;
  throw new ImageProviderError(ImageJobErrorCode.ProviderFailed, `Unsupported image provider model: ${unreachable}`);
}

export async function pollImageProviderJob(ctx: {
  model: ImageProviderModelValue;
  providerJobId: string;
}): Promise<ImageProviderPollResult> {
  if (ctx.model === ImageProviderModel.YunwuGemini31FlashImagePreview) {
    return {
      status: "failed",
      error: {
        code: ImageJobErrorCode.ProviderFailed,
        message: "Gemini chat image provider does not support polling.",
      },
    };
  }
  if (ctx.model === ImageProviderModel.YunwuFalNanoBanana) {
    return pollFalNanoBanana(ctx.providerJobId);
  }
  const unreachable: never = ctx.model;
  return {
    status: "failed",
    error: {
      code: ImageJobErrorCode.ProviderFailed,
      message: `Unsupported image provider model: ${unreachable}`,
    },
  };
}
