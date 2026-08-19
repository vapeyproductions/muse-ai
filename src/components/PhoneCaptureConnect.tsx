"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { loadMuseSelfieFile, type PersistedSelfie } from "@/lib/selfie-client";

type LoadedCapturePhoto = {
  file: File;
  preview: string;
  storedSelfieId: string;
};

export type PhoneCapturePhotoSet = {
  face: LoadedCapturePhoto;
};

type CaptureSession = {
  id: string;
  captureUrl: string;
  expiresAt: string;
  status: "pending" | "capturing" | "complete" | "expired";
};

type SessionUpdate = Omit<CaptureSession, "captureUrl"> & {
  photos: {
    face: PersistedSelfie;
  } | null;
};

export default function PhoneCaptureConnect({ onCaptured }: { onCaptured: (photos: PhoneCapturePhotoSet) => void }) {
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [synced, setSynced] = useState(false);
  const [message, setMessage] = useState("");

  const start = async () => {
    setCreating(true);
    setMessage("");
    setSynced(false);
    try {
      const response = await fetch("/api/mobile-capture", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Guided capture could not be started.");
      setSession(payload.capture as CaptureSession);
      setOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Guided capture could not be started.");
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!open || !session?.id || synced) return;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/api/mobile-capture/session/${encodeURIComponent(session.id)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Camera connection was interrupted.");
        const update = payload.capture as SessionUpdate;
        if (cancelled) return;
        setSession((current) => current ? { ...current, status: update.status, expiresAt: update.expiresAt } : current);
        if (update.status === "complete" && update.photos) {
          const face = await loadMuseSelfieFile(update.photos.face);
          if (cancelled) return;
          onCaptured({
            face: { file: face.file, preview: face.preview, storedSelfieId: face.selfie.id },
          });
          setSynced(true);
          setMessage("Guided selfie received and saved privately.");
          return;
        }
        if (update.status === "expired") {
          setMessage("This connection expired. Close this window and create a new one.");
          return;
        }
        timer = window.setTimeout(poll, 1500);
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Camera connection was interrupted.");
          timer = window.setTimeout(poll, 3000);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onCaptured, open, session?.id, synced]);

  return (
    <>
      <button className="phoneCaptureButton" type="button" onClick={start} disabled={creating}>
        <span aria-hidden="true">▣</span>
        <span>
          <strong>{creating ? "Creating camera link…" : "Take a photo on phone or computer"}</strong>
          <small>Guided YouCam camera</small>
        </span>
      </button>
      {!open && message && <p className="phoneCaptureInlineStatus" role="status">{message}</p>}

      {open && session && (
        <div className="phoneCaptureBackdrop" role="dialog" aria-modal="true" aria-labelledby="phone-capture-title">
          <section className="phoneCaptureDialog">
            <button className="phoneCaptureClose" onClick={() => setOpen(false)} aria-label="Close guided camera options">×</button>
            <span className="systemLabel">GUIDED CAMERA LINK / SECURE</span>
            <h2 id="phone-capture-title">Please scan the QR code below to take your photo on your phone, or use this computer’s camera.</h2>

            <div className="phoneCapturePairing">
              <div className="phoneCaptureQr" aria-label="QR code containing the private phone camera link">
                <QRCodeSVG value={session.captureUrl} size={196} bgColor="#fff8fc" fgColor="#6c3c58" level="M" />
              </div>
              <div className="phoneCaptureSteps">
                <span className={session.status === "pending" ? "active" : "done"}><b>01</b> Scan for phone or use this computer</span>
                <span className={session.status === "capturing" ? "active" : session.status === "complete" ? "done" : ""}><b>02</b> Follow YouCam’s guides</span>
                <span className={synced ? "active done" : ""}><b>03</b> Photo returns here</span>
              </div>
            </div>

            <div className="phoneCaptureActions">
              <a href={session.captureUrl} target="_blank" rel="noreferrer">Use this computer’s camera</a>
              <button type="button" onClick={() => void navigator.clipboard.writeText(session.captureUrl).then(() => setMessage("Private link copied."))}>Copy private link</button>
            </div>
            <p className={`phoneCaptureStatus ${synced ? "phoneCaptureStatusDone" : ""}`} role="status">
              {message || (session.status === "capturing" ? "Camera connected — guided capture is in progress…" : "Waiting for a phone or computer camera to connect…")}
            </p>
            <small>The private link expires after 20 minutes and stops accepting photos after one completed capture.</small>
            {synced && <button className="primaryButton phoneCaptureDone" onClick={() => setOpen(false)}>Continue with this photo</button>}
          </section>
        </div>
      )}
    </>
  );
}
