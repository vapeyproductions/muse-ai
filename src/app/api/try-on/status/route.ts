import { NextResponse, after } from "next/server";
import { getRun } from "workflow/api";
import { auth } from "@/lib/auth";
import { storeGeneratedSelfie } from "@/lib/selfie-store";
import { verifyTryOnJob } from "@/lib/try-on-job";
import type { TryOnWorkflowResult } from "@/workflows/try-on";

export const runtime = "nodejs";
export const maxDuration = 30;

function phaseFor(elapsedMs: number) {
  if (elapsedMs < 3_000) return "Preparing your selfie…";
  if (elapsedMs < 10_000) return "Uploading securely to YouCam…";
  if (elapsedMs < 35_000) return "YouCam is rendering your look…";
  return "Finishing your new look…";
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to view this render." }, { status: 401 });

  const token = new URL(request.url).searchParams.get("token") || "";
  const job = verifyTryOnJob(token, session.user.id);
  if (!job) return NextResponse.json({ error: "That render link is invalid or expired." }, { status: 403 });

  try {
    const run = getRun<TryOnWorkflowResult>(job.runId);
    if (!(await run.exists)) return NextResponse.json({ error: "That render could not be found." }, { status: 404 });

    const status = await run.status;
    if (status === "completed") {
      const result = await run.returnValue;
      if (result.userId !== session.user.id) {
        return NextResponse.json({ error: "That render does not belong to this account." }, { status: 403 });
      }

      after(async () => {
        try {
          await storeGeneratedSelfie({
            sourceUrl: result.resultUrl,
            userId: result.userId,
            label: result.outputLabel,
            parentId: result.parentId,
            id: result.resultId,
            makeup: result.makeup,
            hair: result.hair,
          });
        } catch (error) {
          console.error("Background try-on persistence failed", error);
        }
      });

      return NextResponse.json({
        status: "complete",
        resultUrl: result.resultUrl,
        resultId: result.resultId,
        outputLabel: result.outputLabel,
      });
    }

    if (status === "failed" || status === "cancelled") {
      let message = status === "cancelled"
        ? "This render was cancelled."
        : "YouCam could not complete this look.";
      try {
        await run.returnValue;
      } catch (error) {
        if (error instanceof Error && error.message) message = error.message;
      }
      return NextResponse.json({
        status: "failed",
        error: message,
      });
    }

    const elapsedMs = Math.max(0, Date.now() - job.issuedAt);
    return NextResponse.json({ status: "running", phase: phaseFor(elapsedMs), elapsedMs });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Render status is unavailable." }, { status: 500 });
  }
}
