import type { TransparencyMode } from "../../../shared/types/enums";

const ATLAS_BASE = "https://api.atlascloud.ai/api/v1";
const MODEL_TEXT = "openai/gpt-image-2/text-to-image";
const MODEL_EDIT = "openai/gpt-image-2/edit";

function getKey(): string {
  const k = process.env.ATLASCLOUD_API_KEY;
  if (!k) throw new Error("ATLASCLOUD_API_KEY not configured");
  return k;
}

/** Maps an arbitrary aspect to the closest size gpt-image-2 supports. */
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

export type AtlasSubmitInput = {
  prompt: string;
  aspect: string;
  /** http(s) URLs only — pre-upload local files via atlasUploadMedia. */
  referenceImageUrls?: string[];
  transparency?: TransparencyMode;
  quality?: "low" | "medium" | "high";
};

export type AtlasSubmitResult = {
  predictionId: string;
  model: string;
};

/** Submits a generation request. Returns immediately with the prediction id. */
export async function atlasSubmit(input: AtlasSubmitInput): Promise<AtlasSubmitResult> {
  const key = getKey();
  const useEdit = !!(input.referenceImageUrls && input.referenceImageUrls.length > 0);
  const refs = useEdit ? input.referenceImageUrls!.slice(0, 10) : [];

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

  const res = await fetch(`${ATLAS_BASE}/model/generateImage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Atlas submit failed (${res.status}): ${err}`);
  }
  const json = (await res.json()) as { msg?: string; data?: { id?: string } };
  const predictionId = json.data?.id;
  if (!predictionId) {
    throw new Error(`Atlas submit returned no id: ${json.msg ?? "unknown"}`);
  }
  return { predictionId, model: useEdit ? MODEL_EDIT : MODEL_TEXT };
}

export type AtlasPollResult =
  | { status: "queued" | "running" }
  | { status: "completed"; outputUrl: string }
  | { status: "failed"; error: string };

/** Single poll. Caller decides how often to retry. */
export async function atlasPoll(predictionId: string): Promise<AtlasPollResult> {
  const key = getKey();
  const res = await fetch(`${ATLAS_BASE}/model/prediction/${predictionId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    return { status: "running" }; // transient network issue — treat as still running
  }
  const data = (await res.json()) as {
    data?: { status?: string; outputs?: string[]; error?: string };
  };
  const raw = data.data?.status ?? "";
  if (raw === "completed") {
    const outputUrl = data.data?.outputs?.[0];
    if (!outputUrl) return { status: "failed", error: "completed without output url" };
    return { status: "completed", outputUrl };
  }
  if (raw === "failed") {
    return { status: "failed", error: data.data?.error ?? "unknown" };
  }
  return { status: raw === "queued" ? "queued" : "running" };
}
