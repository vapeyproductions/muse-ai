"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type CameraQuality = {
  hasFace?: boolean;
  position?: "good" | "notgood" | "toosmall" | "outofboundary";
  frontal?: "good" | "notgood";
  lighting?: "good" | "ok" | "notgood";
};

type CapturedImage = {
  phase: number;
  image: string | Blob;
  width: number;
  height: number;
};

type CapturedResult = { mode: string; images: CapturedImage[] };

type YouCamCameraKit = {
  init: (args: Record<string, unknown>) => void;
  openCameraKit: () => void;
  close: () => void;
  addEventListener: (event: string, callback: (value: never) => void) => unknown;
  removeEventListener: (id: unknown) => void;
};

declare global {
  interface Window {
    YMK?: YouCamCameraKit;
    YMKAsyncInit?: () => void;
  }
}

const CAPTURE_TARGET_BYTES = 1.15 * 1024 * 1024;
const CAPTURE_WIDTH = 900;
const CAPTURE_HEIGHT = 1200;

function qualityMessage(quality: CameraQuality | null) {
  if (!quality) return "Position your full face inside the guide.";
  if (!quality.hasFace) return "Move into the frame so Muse can find your face.";
  if (quality.lighting === "notgood") return "Find brighter, more even light.";
  if (quality.position === "toosmall") return "Move a little closer.";
  if (quality.position === "outofboundary") return "Move back and center your full face.";
  if (quality.position !== "good") return "Center your face inside the guide.";
  if (quality.frontal !== "good") return "Follow the head direction shown on screen.";
  if (quality.lighting === "ok") return "The light is usable, but make it brighter and more even.";
  return "Perfect — hold still for automatic capture.";
}

function dataUrlBlob(value: string) {
  return fetch(value).then((response) => response.blob());
}

async function compressedCapture(image: string | Blob, name: string) {
  const source = typeof image === "string" ? await dataUrlBlob(image) : image;
  const objectUrl = URL.createObjectURL(source);
  const photo = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("This device could not read a captured photo."));
    element.src = objectUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    URL.revokeObjectURL(objectUrl);
    throw new Error("This device could not prepare the captured photos.");
  }
  const targetRatio = CAPTURE_WIDTH / CAPTURE_HEIGHT;
  const sourceRatio = photo.naturalWidth / photo.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = photo.naturalWidth;
  let sourceHeight = photo.naturalHeight;
  if (sourceRatio > targetRatio) {
    sourceWidth = photo.naturalHeight * targetRatio;
    sourceX = (photo.naturalWidth - sourceWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    sourceHeight = photo.naturalWidth / targetRatio;
    sourceY = (photo.naturalHeight - sourceHeight) / 2;
  }
  context.drawImage(
    photo,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    CAPTURE_WIDTH,
    CAPTURE_HEIGHT,
  );
  URL.revokeObjectURL(objectUrl);

  let quality = .86;
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  while (blob && blob.size > CAPTURE_TARGET_BYTES && quality > .54) {
    quality -= .08;
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }
  if (!blob || blob.size > CAPTURE_TARGET_BYTES) throw new Error("The captured photos are too large to transfer. Please try again.");
  return new File([blob], name, { type: "image/jpeg" });
}

export default function MobileCameraKit() {
  const router = useRouter();
  const [sdkReady, setSdkReady] = useState(false);
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "capturing" | "uploading" | "complete" | "error">("checking");
  const [quality, setQuality] = useState<CameraQuality | null>(null);
  const [message, setMessage] = useState("Checking your private Muse link…");
  const listenerIds = useRef<unknown[]>([]);
  const tokenRef = useRef("");

  useEffect(() => {
    window.YMKAsyncInit = () => setSdkReady(Boolean(window.YMK));
    const nextToken = window.location.hash.replace(/^#/, "");
    tokenRef.current = nextToken;
    const abortController = new AbortController();

    const validateLink = async () => {
      if (!nextToken) throw new Error("This private camera link is incomplete. Scan the code again from your assessment.");
      const response = await fetch("/api/mobile-capture/token", {
        headers: { "X-Muse-Capture-Token": nextToken },
        cache: "no-store",
        signal: abortController.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "This private camera link is unavailable.");
      if (payload.capture.status === "complete") {
        setSessionState("complete");
        setMessage("This photo has already been sent to your assessment.");
      } else if (payload.capture.status === "expired") {
        throw new Error("This private camera link has expired. Create a new link on your assessment.");
      } else {
        setSessionState("ready");
        setMessage("YouCam is ready to guide your assessment selfie.");
      }
    };

    void validateLink().catch((error) => {
      if (abortController.signal.aborted) return;
      setSessionState("error");
      setMessage(error instanceof Error ? error.message : "This private camera link is unavailable.");
    });

    return () => {
      abortController.abort();
      listenerIds.current.forEach((id) => window.YMK?.removeEventListener(id));
      listenerIds.current = [];
      window.YMK?.close();
      window.YMKAsyncInit = undefined;
    };
  }, []);

  const uploadCapture = async (result: CapturedResult) => {
    if (result.images.length < 1) {
      setSessionState("error");
      setMessage("YouCam did not return the assessment photo. Please try the guided capture again.");
      return;
    }
    setSessionState("uploading");
    setMessage("Securing your front-facing photo…");
    try {
      const ordered = [...result.images].sort((a, b) => a.phase - b.phase);
      const face = await compressedCapture(ordered[0].image, "muse-front.jpg");
      const form = new FormData();
      form.append("face", face);
      const response = await fetch("/api/mobile-capture/token", {
        method: "POST",
        headers: { "X-Muse-Capture-Token": tokenRef.current },
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Your photos could not be transferred.");
      window.YMK?.close();
      window.history.replaceState(null, "", "/capture");
      setSessionState("complete");
      setMessage("Photo sent. Return to your original Muse assessment—it will appear automatically.");
    } catch (error) {
      setSessionState("error");
      setMessage(error instanceof Error ? error.message : "Your photos could not be transferred.");
    }
  };

  const startCamera = () => {
    if (!window.YMK || !sdkReady) {
      setMessage("The guided camera is still loading. Try again in a moment.");
      return;
    }
    setQuality(null);
    setSessionState("capturing");
    setMessage("Allow camera access, then follow the on-screen head guides.");
    listenerIds.current.forEach((id) => window.YMK?.removeEventListener(id));
    listenerIds.current = [
      window.YMK.addEventListener("faceQualityChanged", (value) => setQuality(value as CameraQuality)),
      window.YMK.addEventListener("faceDetectionCaptured", (value) => void uploadCapture(value as CapturedResult)),
    ];
    // Camera Kit otherwise falls back to a fixed 360px module on many iPhones.
    // Leave room for its controls, which intentionally extend beyond the preview.
    const availableWidth = Math.min(340, window.innerWidth - 64, (window.innerHeight - 150) * .75);
    const cameraWidth = Math.max(300, Math.floor(availableWidth));
    window.YMK.init({
      faceDetectionMode: "skincare",
      imageFormat: "blob",
      language: "enu",
      // This front capture feeds the three profile analyzers. The strict preset
      // keeps it inside their documented angle, face-size, and lighting rules.
      qualityLevel: "strict",
      countingDuration: 1800,
      hideFlipCameraButton: false,
      width: cameraWidth,
      height: Math.round(cameraWidth * 4 / 3),
    });
    window.YMK.openCameraKit();
  };

  const exitCamera = () => {
    window.YMK?.close();
    window.close();
    window.setTimeout(() => {
      if (!window.closed) router.replace("/");
    }, 150);
  };

  return (
    <main className="mobileCapturePage">
      <Script
        src="https://plugins-media.makeupar.com/v2.5-camera-kit/sdk.js"
        strategy="afterInteractive"
        onLoad={() => setSdkReady(Boolean(window.YMK))}
        onReady={() => setSdkReady(Boolean(window.YMK))}
        onError={() => {
          setSessionState("error");
          setMessage("The YouCam guided camera could not load. Return to Muse and upload your photos instead.");
        }}
      />
      <header className="mobileCaptureHeader">
        <span className="logo">muse<span className="logoDot">.</span></span>
        <div className="mobileCaptureHeaderActions">
          <span>SECURE GUIDED CAPTURE</span>
          <button type="button" onClick={exitCamera}>Back to Muse</button>
        </div>
      </header>

      <section className="mobileCaptureStage">
        <div className="mobileCaptureCopy">
          <span className="systemLabel">YOUCAM CAMERA KIT / FRONT SELFIE</span>
          <div className="mobileQualityReadout" aria-live="polite">
            <i className={quality?.hasFace ? "qualityPulse qualityPulseGood" : "qualityPulse"} />
            <strong>{sessionState === "capturing" ? qualityMessage(quality) : message}</strong>
            {quality && sessionState === "capturing" && (
              <small>Face {quality.hasFace ? "found" : "missing"} · position {quality.position || "checking"} · light {quality.lighting || "checking"}</small>
            )}
          </div>
          {sessionState === "ready" && (
            <button className="primaryButton mobileCaptureStart" onClick={startCamera} disabled={!sdkReady}>
              {sdkReady ? "Start guided photo" : "Loading YouCam…"}<span>↗</span>
            </button>
          )}
          {sessionState === "error" && (
            <button className="primaryButton mobileCaptureStart" onClick={() => window.location.reload()}>Try again</button>
          )}
        </div>
        <div className="mobileCameraShell">
          <div id="YMK-module" />
          {sessionState !== "capturing" && sessionState !== "uploading" && (
            <div className="mobileCameraPlaceholder" aria-hidden="true">
              <span />
              <b>{sessionState === "complete" ? "✓" : "M"}</b>
            </div>
          )}
          {sessionState === "uploading" && <div className="mobileCameraUploading"><b>UPLOADING</b><span>Encrypting your photo…</span></div>}
        </div>
      </section>
      <footer className="mobileCaptureFootnote">Your private link expires after one capture or 20 minutes. Photos are stored only in your Muse account.</footer>
    </main>
  );
}
