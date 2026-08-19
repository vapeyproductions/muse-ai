type JsonObject = Record<string, unknown>;

export type YouCamTaskResult = {
  task_status: string;
  results?: JsonObject;
  error?: string | null;
  error_message?: string | null;
};

const baseUrl = () => {
  const configured = (process.env.YOUCAM_API_BASE_URL || "https://yce-api-01.makeupar.com").trim();
  try {
    return new URL(configured).origin;
  } catch {
    throw new Error("YOUCAM_API_BASE_URL is not a valid URL.");
  }
};

const authHeaders = () => {
  const configured = process.env.YOUCAM_API_KEY;
  if (!configured) throw new Error("YOUCAM_API_KEY is not configured.");
  let key = configured.trim().replace(/^Bearer\s+/i, "").trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  if (!key || key === "[sensitive]") throw new Error("YOUCAM_API_KEY is not available to the server.");
  return { Authorization: `Bearer ${key}` };
};

async function readJson(response: Response, context: string) {
  const body = await response.text();
  let payload: JsonObject = {};
  if (body) {
    try {
      payload = JSON.parse(body) as JsonObject;
    } catch {
      throw new Error(`${context}: YouCam returned an unreadable response (${response.status}).`);
    }
  }
  if (!response.ok || (typeof payload.status === "number" && payload.status >= 400)) {
    const detail = payload.error_message || payload.error || payload.message || response.statusText;
    throw new Error(`${context}: ${String(detail)}`);
  }
  return payload;
}

function apiContentType(file: File) {
  return file.type === "image/jpeg" ? "image/jpg" : file.type || "image/png";
}

export async function uploadYouCamFiles(feature: string, files: File[], version = "v2.0") {
  const apiBaseUrl = baseUrl();
  const response = await fetch(`${apiBaseUrl}/s2s/${version}/file/${feature}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      files: files.map((file) => ({
        content_type: apiContentType(file),
        file_name: file.name || `muse-${crypto.randomUUID()}.jpg`,
        file_size: file.size,
      })),
    }),
  });
  const payload = await readJson(response, `Preparing ${feature} upload`);
  const responseData = (payload.data || payload.result || {}) as JsonObject;
  const uploaded = (responseData.files || []) as Array<{
    file_id: string;
    requests: Array<{ method: string; url: string; headers?: Record<string, string> }>;
  }>;
  if (uploaded.length !== files.length) throw new Error(`Preparing ${feature} upload returned an incomplete file list.`);

  await Promise.all(uploaded.map(async (item, index) => {
    const uploadRequest = item.requests?.[0];
    if (!uploadRequest?.url || !item.file_id) throw new Error(`Preparing ${feature} upload returned invalid instructions.`);
    let uploadUrl: string;
    try {
      uploadUrl = new URL(String(uploadRequest.url)).toString();
    } catch {
      throw new Error(`Preparing ${feature} upload returned an invalid upload URL.`);
    }
    const uploadHeaders = new Headers();
    Object.entries(uploadRequest.headers || {}).forEach(([name, value]) => {
      if (typeof value !== "string" || !value) return;
      try {
        uploadHeaders.set(name, value);
      } catch {
        throw new Error(`Preparing ${feature} upload returned invalid upload headers.`);
      }
    });
    if (!uploadHeaders.has("content-type")) uploadHeaders.set("content-type", apiContentType(files[index]));
    const putResponse = await fetch(uploadUrl, {
      method: uploadRequest.method || "PUT",
      headers: uploadHeaders,
      body: await files[index].arrayBuffer(),
    });
    if (!putResponse.ok) throw new Error(`Uploading ${feature} image failed (${putResponse.status}).`);
  }));

  return uploaded.map((item) => item.file_id);
}

function legacyResult(payload: JsonObject) {
  return (payload.result || payload.data || {}) as JsonObject;
}

function legacyMakeupResultUrl(result: JsonObject) {
  const actions = Array.isArray(result.results) ? result.results : [];
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const data = Array.isArray((action as JsonObject).data) ? (action as JsonObject).data as unknown[] : [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const url = (item as JsonObject).url;
      if (typeof url === "string" && url) return url;
    }
  }
  return null;
}

/**
 * Makeup Transfer still uses Perfect Corp's legacy v1 task contract. Unlike the
 * newer APIs, it expects two uploaded file IDs inside payload.file_sets and
 * polls with task_id as a query parameter.
 */
export async function runYouCamMakeupTransfer(
  sourceFileId: string,
  referenceFileId: string,
  timeoutMs = 75_000,
) {
  const feature = "mu-trans-rec";
  const version = "v1.0";
  const apiBaseUrl = baseUrl();
  const startedAt = Date.now();
  const response = await fetch(`${apiBaseUrl}/s2s/${version}/task/${feature}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: 0,
      payload: {
        file_sets: {
          src_ids: [sourceFileId],
          ref_ids: [referenceFileId],
        },
        actions: [{ id: 0 }],
        output_ext: "jpg",
      },
    }),
  });
  const payload = await readJson(response, "Starting makeup transfer");
  const taskId = legacyResult(payload).task_id;
  if (typeof taskId !== "string" || !taskId) {
    throw new Error("Starting makeup transfer did not return a task ID.");
  }

  let pollingInterval = 900;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollingInterval));
    const pollUrl = new URL(`${apiBaseUrl}/s2s/${version}/task/${feature}`);
    pollUrl.searchParams.set("task_id", taskId);
    const pollResponse = await fetch(pollUrl, {
      headers: authHeaders(),
      cache: "no-store",
    });
    const pollPayload = await readJson(pollResponse, "Checking makeup transfer");
    const result = legacyResult(pollPayload);
    const status = result.status || result.task_status;
    if (status === "success") {
      const resultUrl = legacyMakeupResultUrl(result);
      if (!resultUrl) throw new Error("YouCam did not return a makeup image.");
      console.info("[youcam] makeup transfer completed", { elapsedMs: Date.now() - startedAt });
      return resultUrl;
    }
    if (status === "error") {
      console.error("[youcam] makeup transfer engine error", {
        elapsedMs: Date.now() - startedAt,
        apiOrigin: apiBaseUrl,
        error: String(result.error_message || result.error || "processing failed"),
      });
      throw new Error(`makeup transfer: ${String(result.error_message || result.error || "processing failed")}`);
    }
    const requestedInterval = Number(result.polling_interval);
    if (Number.isFinite(requestedInterval)) {
      pollingInterval = Math.min(9_000, Math.max(450, requestedInterval));
    }
  }
  throw new Error("Makeup transfer timed out before returning a result.");
}

export async function runYouCamTask(
  feature: string,
  body: JsonObject,
  version = "v2.0",
  timeoutMs = 52_000,
): Promise<YouCamTaskResult> {
  const response = await fetch(`${baseUrl()}/s2s/${version}/task/${feature}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response, `Starting ${feature}`);
  const taskId = (payload.data as JsonObject | undefined)?.task_id;
  if (typeof taskId !== "string") throw new Error(`Starting ${feature} did not return a task ID.`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const pollResponse = await fetch(`${baseUrl()}/s2s/${version}/task/${feature}/${encodeURIComponent(taskId)}`, {
      headers: authHeaders(),
      cache: "no-store",
    });
    const pollPayload = await readJson(pollResponse, `Checking ${feature}`);
    const data = (pollPayload.data || {}) as YouCamTaskResult;
    if (data.task_status === "success") return data;
    if (data.task_status === "error") {
      throw new Error(`${feature}: ${data.error_message || data.error || "processing failed"}`);
    }
  }
  throw new Error(`${feature} timed out before returning a result.`);
}

export async function analyzeSingleFile(
  feature: string,
  file: File,
  taskBody: (fileId: string) => JsonObject = (fileId) => ({ src_file_id: fileId }),
) {
  const [fileId] = await uploadYouCamFiles(feature, [file]);
  return runYouCamTask(feature, taskBody(fileId));
}

export async function analyzeMultipleFiles(feature: string, files: File[]) {
  const fileIds = await uploadYouCamFiles(feature, files);
  return runYouCamTask(feature, { src_file_ids: fileIds });
}
