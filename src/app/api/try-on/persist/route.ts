import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { auth } from "@/lib/auth";
import { storeGeneratedSelfie } from "@/lib/selfie-store";
import { verifyTryOnJob } from "@/lib/try-on-job";
import type { TryOnWorkflowResult } from "@/workflows/try-on";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to save this render." }, { status: 401 });

  try {
    const body = await request.json() as { token?: string };
    const job = verifyTryOnJob(body.token || "", session.user.id);
    if (!job) return NextResponse.json({ error: "That render link is invalid or expired." }, { status: 403 });

    const run = getRun<TryOnWorkflowResult>(job.runId);
    if (!(await run.exists) || await run.status !== "completed") {
      return NextResponse.json({ error: "That render is not ready to save yet." }, { status: 409 });
    }
    const result = await run.returnValue;
    if (result.userId !== session.user.id) {
      return NextResponse.json({ error: "That render does not belong to this account." }, { status: 403 });
    }

    const saved = await storeGeneratedSelfie({
      sourceUrl: result.resultUrl,
      userId: result.userId,
      label: result.outputLabel,
      parentId: result.parentId,
      id: result.resultId,
      makeup: result.makeup,
      hair: result.hair,
    });
    return NextResponse.json({ storedSelfieId: saved.id, resultUrl: saved.imageUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The generated selfie could not be saved." }, { status: 500 });
  }
}
