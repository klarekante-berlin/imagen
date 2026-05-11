import type { TransparencyMode } from "../../../shared/types/enums";

const ATLAS_BASE = "https://api.atlascloud.ai/api/v1";
const MODEL_TEXT = "openai/gpt-image-2/text-to-image";
const MODEL_EDIT = "openai/gpt-image-2/edit";
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 120; // 10 minutes

function getKey(): string {
  const k = process.env.ATLASCLOUD_API_KEY;
  if (!k) throw new Error("ATLASCLOUD_API_KEY not configured");
  return k;
}

/**
 * Maps a creative aspect ratio (any "W:H" string) to one of the two sizes the
 * gpt-image-2 endpoint accepts (1024×1024 or 1024×1536, plus the rotated
 * 1536×1024 for wide formats). For ratios outside these, picks the closer one.
 */
export function pickAtlasSize(aspect: string): string {
  const [wStr, hStr] = aspect.split(":");
  const w = Number(wStr ?? "1");
  const h = Number(hStr ?? "1");
  if (!w || !h) return "1024x1024";
  const r = w / h;
  if (r > 1.1) return "1536x1024";
  if (r < 0.9) return "1024x1536";
  return "1024x1024";
}

export async function atlasUploadMedia(
  buffer: Buffer,
  mime: string,
  fileName: string,
): Promise<string> {
  const key = getKey();
  const blob = new Blob([buffer as unknown as BlobPart], { type: mime });
  const form = new FormData();
  form.set("file", blob, fileName);
  const res = await fetch(`${ATLAS_BASE}/model/uploadMedia`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Atlas uploadMedia failed (${res.status}): ${err}`);
  }
  const json = (await res.json()) as { data?: { download_url?: string } };
  const url = json.data?.download_url;
  if (!url) throw new Error("Atlas uploadMedia: no download_url");
  return url;
}

export type AtlasGenerateInput = {
  prompt: string;
  aspect: string;
  /** Reference image URLs. http(s) only — call atlasUploadMedia for data: URIs. */
  referenceImageUrls?: string[];
  transparency?: TransparencyMode;
  quality?: "low" | "medium" | "high";
  onStatus?: (status: string, elapsedSec: number) => void;
};

export type AtlasGenerateResult = {
  outputUrl: string;
  predictionId: string;
  elapsedSec: number;
  model: string;
};

export async function atlasGenerate(input: AtlasGenerateInput): Promise<AtlasGenerateResult> {
  const key = getKey();
  const useEdit = !!(input.referenceImageUrls && input.referenceImageUrls.length > 0);
  const refs = useEdit ? input.referenceImageUrls!.slice(0, 10) : [];

  // gpt-image-2 doesn't have a native alpha mode. We pass the request through
  // anyway and rely on the prompt to ask for a clean cut-out when transparency
  // is requested — frame post-processing (phase 3 later) will alpha-cut it.
  const transparencyHint =
    input.transparency === "alpha"
      ? " Render the subject on a solid neutral background, ready for cut-out."
      : input.transparency === "full_bleed"
        ? " Compose edge-to-edge, no margins or framing."
        : "";

  const body: Record<string, unknown> = {
    model: useEdit ? MODEL_EDIT : MODEL_TEXT,
    prompt: input.prompt + transparencyHint,
    size: pickAtlasSize(input.aspect),
    quality: input.quality ?? "high",
    output_format: "jpeg",
    enable_base64_output: false,
    enable_sync_mode: false,
  };
  if (useEdit) {
    body.images = refs;
    body.input_fidelity = "high";
  }

  const submitRes = await fetch(`${ATLAS_BASE}/model/generateImage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!submitRes.ok) {
    const err = await submitRes.text().catch(() => submitRes.statusText);
    throw new Error(`Atlas submit failed (${submitRes.status}): ${err}`);
  }
  const submitJson = (await submitRes.json()) as {
    code?: number;
    msg?: string;
    data?: { id?: string };
  };
  const predictionId = submitJson.data?.id;
  if (!predictionId) {
    throw new Error(`Atlas submit returned no prediction id: ${submitJson.msg ?? "unknown"}`);
  }

  const startedAt = Date.now();
  const pollUrl = `${ATLAS_BASE}/model/prediction/${predictionId}`;
  let lastStatus = "";
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(pollUrl, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) continue;
    const data = (await res.json()) as {
      data?: { status?: string; outputs?: string[]; error?: string };
    };
    const status = data.data?.status ?? "";
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    if (status !== lastStatus) {
      input.onStatus?.(status, elapsedSec);
      lastStatus = status;
    }
    if (status === "completed") {
      const outputUrl = data.data?.outputs?.[0];
      if (!outputUrl) throw new Error("Atlas completed without output URL");
      return {
        outputUrl,
        predictionId,
        elapsedSec,
        model: useEdit ? MODEL_EDIT : MODEL_TEXT,
      };
    }
    if (status === "failed") {
      throw new Error(`Atlas generation failed: ${data.data?.error ?? "unknown"}`);
    }
  }
  throw new Error(`Atlas generation timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 60000} min`);
}
