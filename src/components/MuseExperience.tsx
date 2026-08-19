"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { demoAnalysis } from "@/lib/demo-analysis";
import { authClient } from "@/lib/auth-client";
import { matchMuses, recommendLooks, type RecommendedLook } from "@/lib/matching";
import type { MuseAsset, MuseCatalog, UserAnalysis } from "@/lib/muse-types";
import {
  loadLatestAssessmentFacePhoto,
  saveSelfieToMuse,
  type AssessmentPhotoRole,
  type PersistedSelfie,
} from "@/lib/selfie-client";
import ResultsWorkspace from "@/components/ResultsWorkspace";
import PhoneCaptureConnect, { type PhoneCapturePhotoSet } from "@/components/PhoneCaptureConnect";
import { REPRESENTATION_OPTIONS, type RepresentationTag } from "@/lib/muse-representation";
import { deleteMuseProfile, loadMuseProfile, saveMuseProfile } from "@/lib/profile-client";
import type { MuseMatchSnapshot } from "@/lib/profile-types";
import type { DemoBoardAccount, DemoBoardSnapshot } from "@/lib/demo-board-types";

type Screen = "home" | "account" | "restoring" | "assessment" | "results";
type SessionDestination = "assessment";
type ResultTab = "muses" | "makeup" | "hair";
type PhotoKey = "face";
type PhotoOrigin = "upload" | "guided" | "stored";
type PhotoValue = { file: File; preview: string; storedSelfieId?: string; origin?: PhotoOrigin };
type AnalysisQuality = {
  status: "passed" | "warning";
  kind?: "photo" | "service";
  summary: string;
  checks: string[];
};
type DetectorReport = {
  id: string;
  label: string;
  status: "completed" | "failed";
  issue?: string;
};
type AnalysisResponse = {
  analysis: UserAnalysis;
  warnings?: string[];
  quality?: AnalysisQuality;
  matchReady?: boolean;
  completedDetectors?: string[];
  detectors?: DetectorReport[];
};

class AnalysisRequestError extends Error {
  quality?: AnalysisQuality;
  detectors?: DetectorReport[];

  constructor(message: string, quality?: AnalysisQuality, detectors?: DetectorReport[]) {
    super(message);
    this.name = "AnalysisRequestError";
    this.quality = quality;
    this.detectors = detectors;
  }
}

async function fallbackPortraitAssessmentFile(file: File) {
  const bitmap = await createImageBitmap(file);
  if (Math.min(bitmap.width, bitmap.height) < 320) {
    bitmap.close();
    throw new Error("This photo is too small. Choose an image at least 320 × 320 pixels.");
  }
  const targetRatio = 3 / 4;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = bitmap.width;
  let sourceHeight = bitmap.height;

  if (bitmap.width > bitmap.height) {
    // Keep most of a landscape frame so a fallback crop does not trim the
    // hairline or chin. The server path below uses attention-based centering.
    sourceHeight = bitmap.height * .9;
    sourceWidth = sourceHeight * targetRatio;
    sourceX = (bitmap.width - sourceWidth) / 2;
    sourceY = (bitmap.height - sourceHeight) / 2;
  } else if (bitmap.width / bitmap.height > targetRatio) {
    sourceWidth = bitmap.height * targetRatio;
    sourceX = (bitmap.width - sourceWidth) / 2;
  } else {
    sourceHeight = bitmap.width / targetRatio;
    sourceY = (bitmap.height - sourceHeight) / 2;
  }

  // A consistent portrait crop gives all three front-facing detectors the
  // same high-resolution source without changing the saved original.
  const outputWidth = 900;
  const outputHeight = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Muse could not prepare this photo. Please try a JPG or PNG instead.");
  }
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Muse could not prepare this photo.")), "image/jpeg", .94);
  });
  const baseName = file.name.replace(/\.[^.]+$/, "") || "muse-photo";
  return new File([blob], `${baseName}-portrait.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}

async function portraitAssessmentFile(file: File) {
  const form = new FormData();
  form.append("file", file, file.name);
  try {
    const response = await fetch("/api/portrait-crop", {
      method: "POST",
      body: form,
      cache: "no-store",
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (response.status >= 400 && response.status < 500) {
        throw new Error(payload.error || "Muse could not prepare this photo.");
      }
      throw new TypeError(payload.error || "Portrait preparation is temporarily unavailable.");
    }
    const blob = await response.blob();
    const baseName = file.name.replace(/\.[^.]+$/, "") || "muse-photo";
    return new File([blob], `${baseName}-portrait.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch (error) {
    if (error instanceof Error && !(error instanceof TypeError)) throw error;
    return fallbackPortraitAssessmentFile(file);
  }
}

const ANALYSIS_TASKS = [
  { id: "fitzpatrick", label: "AI Fitzpatrick Skin Type Analysis" },
  { id: "colors", label: "AI Facial Color Tones Analyzer" },
  { id: "face", label: "AI Face Attributes & Ratio Analyzer" },
];

const FEATURE_LABELS: Array<[keyof UserAnalysis, string]> = [
  ["faceShape", "Face shape"],
  ["eyeShape", "Eyes"],
  ["eyelidType", "Lids"],
  ["eyebrowShape", "Brows"],
  ["lipShape", "Lips"],
  ["cheekbones", "Cheekbones"],
];

const HAIR_COLOR_OPTIONS = ["Black", "Brown", "Auburn", "Blonde", "Red", "Grey/White", "Other"];

const titleCase = (value: string) => value.replace(/\b\w/g, (letter) => letter.toUpperCase());
const displayValue = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.toLowerCase() !== "unknown" ? normalized : "Unavailable";
};
const swatchColor = (value: string) => /^#[\da-f]{6}$/i.test(value) ? value : "#e5dce1";

function Logo() {
  return (
    <span className="logo" aria-label="Muse home">
      muse<span className="logoDot">.</span>
    </span>
  );
}

function Header({
  compact = false,
  onHome,
  accountName,
  onSignOut,
  onSignIn,
}: {
  compact?: boolean;
  onHome: () => void;
  accountName?: string;
  onSignOut?: () => void;
  onSignIn?: () => void;
}) {
  return (
    <header className={`siteHeader ${compact ? "siteHeaderCompact" : ""}`}>
      <button className="logoButton" onClick={onHome} aria-label="Go to the Muse home page">
        <Logo />
      </button>
      <div className="headerRight">
        <span className="headerWhisper">your features, your references</span>
        {accountName && onSignOut && (
          <button className="accountPill" onClick={onSignOut} title="Sign out">
            <strong>@{accountName}</strong>
            <span>sign out</span>
          </button>
        )}
        {!accountName && onSignIn && (
          <button className="homeSignInButton" onClick={onSignIn}>Sign in</button>
        )}
        <span className="headerMonogram" aria-hidden="true">M</span>
      </div>
    </header>
  );
}

function AssetImage({
  asset,
  alt,
  sizes,
  className = "",
}: {
  asset: MuseAsset;
  alt: string;
  sizes: string;
  className?: string;
}) {
  return (
    <Image
      className={className}
      src={asset.imageUrl}
      alt={alt}
      fill
      sizes={sizes}
      unoptimized
    />
  );
}

function Landing({
  catalog,
  onStart,
  onDemo,
  accountName,
  onSignOut,
  onSignIn,
}: {
  catalog: MuseCatalog;
  onStart: () => void;
  onDemo: (account: DemoBoardAccount) => void;
  accountName?: string;
  onSignOut: () => void;
  onSignIn: () => void;
}) {
  const featuredNames = [
    "Rihanna",
    "Angelina Jolie",
    "Aaliyah",
    "Lucy Liu",
    "Naomi Campbell",
    "Adriana Lima",
    "Zendaya",
    "Taylor Russell",
    "Zoë Saldaña",
    "Halle Berry",
    "Beyoncé",
    "Lupita Nyong'o",
  ];
  const heroTiles = featuredNames
    .map((name, index) => {
      const muse = catalog.muses.find((item) => item.name === name);
      const asset = muse ? catalog.assets[muse.introAssetIds[index % muse.introAssetIds.length]] : undefined;
      return muse && asset ? { muse, asset } : null;
    })
    .filter((tile): tile is NonNullable<typeof tile> => Boolean(tile));

  return (
    <main className="landing">
      <Header
        onHome={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        accountName={accountName}
        onSignOut={onSignOut}
        onSignIn={onSignIn}
      />
      <section className="heroSection">
        <div className="heroCopy">
          <p className="eyebrow">AI beauty direction, made personal</p>
          <h1>Use celebrity styling to inspire your look</h1>
          <figure className="heroFeatureImage">
            <Image
              src="/generated/muse-tablet-hero.png"
              alt="A woman browsing hair and makeup inspiration on a translucent futuristic tablet"
              fill
              sizes="(max-width: 700px) 92vw, 42vw"
              priority
            />
          </figure>
          <p className="heroBody">
            Muse studies your features, coloring, and hair to recommend your celebrity look-alikes’ most fabulous looks. Experiment with their hair and makeup ideas to discover what makes your own features shine.
          </p>
          <div className="heroActions">
            <button className="primaryButton" onClick={onStart}>
              Begin your analysis <span aria-hidden="true">↗</span>
            </button>
            <div className="sampleBoardPicker" aria-label="Explore a sample board">
              <span>Explore sample boards:</span>
              <button className="textButton sampleBoardButton" onClick={() => onDemo("testing123")}>User 1</button>
              <button className="textButton sampleBoardButton" onClick={() => onDemo("testing12345")}>User 2</button>
            </div>
          </div>
          <div className="heroMeta">
            <span>10–15 minutes</span>
            <span>{catalog.stats.muses} curated muses</span>
            <span>{catalog.stats.looks} try-on looks</span>
          </div>
        </div>

        <div className="heroCollage" aria-label="A collage of Muse inspiration portraits">
          {heroTiles.map(({ muse, asset }, index) => (
            <figure className={`heroTile heroTile${index + 1}`} key={`${muse.id}-${asset.id}`}>
              <AssetImage asset={asset} alt={`${muse.name} beauty inspiration`} sizes="(max-width: 800px) 45vw, 22vw" />
              <figcaption>{muse.name}</figcaption>
            </figure>
          ))}
          <div className="collageStamp">
            <span>made of</span>
            <strong>you</strong>
          </div>
        </div>
      </section>

      <section className="manifestoSection">
        <p className="sectionNumber">01</p>
        <div>
          <p className="eyebrow">The idea</p>
          <h2>Inspiration works better when it begins with recognition.</h2>
        </div>
        <p className="manifestoBody">
          Not a beauty score. Not a prescription. Muse finds useful overlap—shared structure, coloring, texture, and sensibility—so references feel illuminating instead of impossible.
        </p>
      </section>

      <section className="processSection">
        <article>
          <span>01</span>
          <h3>Read your features</h3>
          <p>Three YouCam detectors build a structured profile from one clear, front-facing selfie.</p>
        </article>
        <article>
          <span>02</span>
          <h3>Meet your muses</h3>
          <p>A transparent matching model finds your closest feature and color references.</p>
        </article>
        <article>
          <span>03</span>
          <h3>Try the ideas</h3>
          <p>Move from your muse board to makeup and hair try-ons in one gesture.</p>
        </article>
      </section>

      <section className="landingCta">
        <p className="eyebrow">Your glow-up, with a point of reference</p>
        <h2>Ready to meet your muses?</h2>
        <button className="primaryButton lightButton" onClick={onStart}>Start the assessment</button>
      </section>
    </main>
  );
}

function AccountGate({
  onHome,
  onAuthenticated,
  initialMode = "create",
}: {
  onHome: () => void;
  onAuthenticated: (username: string) => void;
  initialMode?: "create" | "sign-in";
}) {
  const [mode, setMode] = useState<"create" | "sign-in">(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const normalizedUsername = username.trim().toLowerCase();

  const submitAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!/^[a-z0-9_.]{3,24}$/.test(normalizedUsername)) {
      setError("Use 3–24 letters, numbers, underscores, or periods.");
      return;
    }
    if (password.length < 8) {
      setError("Your password needs at least 8 characters.");
      return;
    }
    if (mode === "create" && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const result = mode === "create"
        ? await authClient.signUp.email({
            name: username.trim(),
            username: normalizedUsername,
            email: `${normalizedUsername}@muse.invalid`,
            password,
          })
        : await authClient.signIn.username({
            username: normalizedUsername,
            password,
            rememberMe: true,
          });

      if (result.error) {
        throw new Error(result.error.message || "We couldn’t complete that request.");
      }
      onAuthenticated(normalizedUsername);
    } catch (accountError) {
      setError(accountError instanceof Error ? accountError.message : "We couldn’t complete that request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="accountShell">
      <Header compact onHome={onHome} />
      <section className="accountStage">
        <div className="accountSignal" aria-hidden="true">
          <span>M</span>
          <i />
          <i />
          <i />
        </div>
        <div className="accountCard">
          <p className="eyebrow">Private access · synced across devices</p>
          <h1>{mode === "create" ? "Create your Muse identity." : "Welcome back to Muse."}</h1>
          <p className="accountIntro">
            Your account keeps your sessions available wherever you sign in. No email address or social account is required.
          </p>
          <div className="accountTabs" role="tablist" aria-label="Account action">
            <button
              className={mode === "create" ? "accountTab accountTabActive" : "accountTab"}
              onClick={() => { setMode("create"); setError(""); }}
              type="button"
            >
              Create account
            </button>
            <button
              className={mode === "sign-in" ? "accountTab accountTabActive" : "accountTab"}
              onClick={() => { setMode("sign-in"); setError(""); }}
              type="button"
            >
              Sign in
            </button>
          </div>
          <form className="accountForm" onSubmit={submitAccount}>
            <label>
              <span>Username</span>
              <div className="accountInputWrap"><b>@</b><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="yourname" /></div>
            </label>
            <label>
              <span>Password</span>
              <input type="password" autoComplete={mode === "create" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8 characters minimum" />
            </label>
            {mode === "create" && (
              <label>
                <span>Confirm password</span>
                <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Type it once more" />
              </label>
            )}
            {error && <p className="accountError" role="alert">{error}</p>}
            <button className="primaryButton accountSubmit" disabled={submitting}>
              {submitting ? "Connecting…" : mode === "create" ? "Create account & continue" : "Sign in & continue"}
            </button>
          </form>
          <p className="accountFootnote">Because Muse does not ask for an email, keep your password somewhere safe. Email-based password recovery is intentionally unavailable.</p>
        </div>
      </section>
    </main>
  );
}

function Assessment({
  onHome,
  onFinish,
  accountName,
  onSignOut,
  defaultPhoto,
  onPersistSelfie,
}: {
  onHome: () => void;
  onFinish: (analysis: UserAnalysis, facePhoto: PhotoValue | undefined, representationPreferences: RepresentationTag[]) => Promise<void>;
  accountName: string;
  onSignOut: () => void;
  defaultPhoto?: PhotoValue;
  onPersistSelfie: (
    file: File,
    label: string,
    options?: { assessmentRole?: AssessmentPhotoRole; parentId?: string },
  ) => Promise<PersistedSelfie>;
}) {
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<Partial<Record<PhotoKey, PhotoValue>>>(() => (
    defaultPhoto ? { face: defaultPhoto } : {}
  ));
  const [demoMode, setDemoMode] = useState(false);
  const [analysis, setAnalysis] = useState<UserAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [selfieStorageStatus, setSelfieStorageStatus] = useState(defaultPhoto ? "Saved selfie loaded from your Muse account." : "");
  const [running, setRunning] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState<PhotoKey | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploadQuality, setUploadQuality] = useState<AnalysisQuality | null>(null);
  const [preparedAnalysis, setPreparedAnalysis] = useState<UserAnalysis | null>(null);
  const [preparedMatchReady, setPreparedMatchReady] = useState(false);
  const [detectorReports, setDetectorReports] = useState<DetectorReport[]>([]);
  const [checkingUploads, setCheckingUploads] = useState(false);
  const [representationPreferences, setRepresentationPreferences] = useState<RepresentationTag[]>([]);
  const userChangedPhotos = useRef(false);

  const toggleRepresentation = (tag: RepresentationTag) => {
    setRepresentationPreferences((current) => current.includes(tag)
      ? current.filter((item) => item !== tag)
      : [...current, tag]);
  };

  useEffect(() => {
    if (!defaultPhoto) return;
    setPhotos((current) => current.face ? current : { ...current, face: defaultPhoto });
    setSelfieStorageStatus("Saved selfie loaded from your Muse account.");
  }, [defaultPhoto]);

  useEffect(() => {
    let cancelled = false;
    void loadLatestAssessmentFacePhoto()
      .then((savedFace) => {
        if (cancelled || !savedFace) return;
        const restored: Partial<Record<PhotoKey, PhotoValue>> = {
          face: { ...savedFace, storedSelfieId: savedFace.selfie.id, origin: "stored" },
        };
        if (userChangedPhotos.current) {
          Object.values(restored).forEach((photo) => {
            if (photo?.preview.startsWith("blob:")) URL.revokeObjectURL(photo.preview);
          });
          return;
        }
        setPhotos((current) => {
          Object.values(current).forEach((photo) => {
            if (photo?.preview.startsWith("blob:") && photo.preview !== restored.face?.preview) {
              URL.revokeObjectURL(photo.preview);
            }
          });
          return restored;
        });
        setSelfieStorageStatus("Saved front assessment photo loaded from your Muse account.");
      })
      .catch((error) => {
        if (!cancelled) setSelfieStorageStatus(error instanceof Error ? error.message : "Saved assessment photos unavailable.");
      });
    return () => { cancelled = true; };
  }, []);

  const resetPreparedAnalysis = () => {
    setPreparedAnalysis(null);
    setPreparedMatchReady(false);
    setDetectorReports([]);
    setUploadQuality(null);
    setAnalysisError("");
  };

  const setUploadedPhoto = async (sourceFile: File) => {
    userChangedPhotos.current = true;
    setPreparingPhoto("face");
    setUploadError("");
    resetPreparedAnalysis();
    try {
      const file = await portraitAssessmentFile(sourceFile);
      const preview = URL.createObjectURL(file);
      setPhotos((current) => {
        Object.values(current).forEach((photo) => {
          if (photo?.preview.startsWith("blob:")) URL.revokeObjectURL(photo.preview);
        });
        return { face: { file, preview, origin: "upload" } };
      });
      setDemoMode(false);
      setSelfieStorageStatus("Saving the portrait crop privately to your Muse account…");
      const saved = await onPersistSelfie(file, "Assessment selfie", { assessmentRole: "face" });
      setPhotos((current) => current.face?.file === file
        ? { ...current, face: { ...current.face, storedSelfieId: saved.id } }
        : current);
      setSelfieStorageStatus("Portrait photo saved privately to your Muse account.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Muse could not prepare this photo.";
      setUploadError(message);
      setSelfieStorageStatus(message);
    } finally {
      setPreparingPhoto(null);
    }
  };

  const acceptPhonePhotos = useCallback((captured: PhoneCapturePhotoSet) => {
    userChangedPhotos.current = true;
    setPhotos({
      face: { ...captured.face, origin: "guided" },
    });
    setDemoMode(false);
    setPreparedAnalysis(null);
    setPreparedMatchReady(false);
    setDetectorReports([]);
    setUploadQuality(null);
    setAnalysisError("");
    setSelfieStorageStatus("Guided selfie received and saved privately.");
  }, []);

  const friendlyAnalysisError = (message: string) => {
    if (/string did not match the expected pattern/i.test(message)) {
      return "YouCam could not read the photo upload. Muse has repaired the portrait format; please retry or replace the photo.";
    }
    return message || "Analysis could not be completed.";
  };

  const requestAnalysis = async (): Promise<AnalysisResponse> => {
    const form = new FormData();
    if (photos.face) form.append("face", photos.face.file, photos.face.file.name);
    const response = await fetch("/api/analyze", { method: "POST", body: form });
    const body = await response.text();
    let payload: Partial<AnalysisResponse> & { error?: string } = {};
    if (body) {
      try {
        payload = JSON.parse(body) as Partial<AnalysisResponse> & { error?: string };
      } catch {
        throw new AnalysisRequestError("Muse received an unreadable response from YouCam. Please try again.", {
          status: "warning",
          kind: "service",
          summary: "Muse could not read YouCam’s response.",
          checks: ["This is a service problem, not a problem with your photos."],
        });
      }
    }
    if (!response.ok || !payload.analysis) {
      throw new AnalysisRequestError(
        friendlyAnalysisError(payload.error || "Analysis could not be completed."),
        payload.quality,
        payload.detectors,
      );
    }
    return payload as AnalysisResponse;
  };

  const reviewAnalysisPlan = async () => {
    if (demoMode) {
      setStep(1);
      return;
    }
    if (preparedAnalysis && uploadQuality) {
      setStep(1);
      return;
    }
    setCheckingUploads(true);
    setStep(1);
    setAnalysisError("");
    try {
      const payload = await requestAnalysis();
      setDetectorReports(payload.detectors || []);
      const quality = payload.quality || {
        status: payload.warnings?.length ? "warning" : "passed",
        summary: payload.warnings?.length
          ? "YouCam completed the check with a few cautions."
          : "Your uploaded photo passed YouCam’s framing and lighting checks.",
        checks: payload.warnings?.length ? ["Retaking the front photo may improve precision."] : ["Face visible", "Portrait framing accepted", "Lighting accepted"],
      } satisfies AnalysisQuality;
      setUploadQuality(quality);
      // Quality feedback is advisory. YouCam can return useful partial analysis
      // when one detector rejects an otherwise usable photo, so keep that
      // result available and let the user decide whether to retake or continue.
      setPreparedAnalysis(payload.analysis);
      setPreparedMatchReady(payload.matchReady !== false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouCam could not approve these photos yet.";
      const returnedQuality = error instanceof AnalysisRequestError ? error.quality : undefined;
      setDetectorReports(error instanceof AnalysisRequestError ? error.detectors || [] : []);
      setUploadQuality(returnedQuality || {
        status: "warning",
        kind: "service",
        summary: "Muse could not complete the YouCam connection.",
        checks: [friendlyAnalysisError(message)],
      });
      setPreparedAnalysis(null);
      setPreparedMatchReady(false);
    } finally {
      setCheckingUploads(false);
    }
  };

  const runAnalysis = async () => {
    setRunning(true);
    setAnalysisError("");
    try {
      if (demoMode || !photos.face) {
        await new Promise((resolve) => window.setTimeout(resolve, 1300));
        setAnalysis(demoAnalysis);
      } else if (preparedAnalysis) {
        setAnalysis(preparedAnalysis);
      } else {
        const payload = await requestAnalysis();
        setDetectorReports(payload.detectors || []);
        setPreparedMatchReady(payload.matchReady !== false);
        if (payload.matchReady === false) {
          setUploadQuality(payload.quality || {
            status: "warning",
            kind: "photo",
            summary: "The Face Attributes detector could not complete this photo.",
            checks: ["Replace the front-facing photo before calculating matches."],
          });
        }
        setAnalysis(payload.analysis);
      }
      setStep(2);
    } catch (error) {
      const message = friendlyAnalysisError(error instanceof Error ? error.message : "Analysis could not be completed.");
      if (error instanceof AnalysisRequestError) {
        setDetectorReports(error.detectors || []);
        if (error.quality) setUploadQuality(error.quality);
      }
      setAnalysisError(message);
    } finally {
      setRunning(false);
    }
  };

  const analysisInProgress = checkingUploads || running;

  return (
    <main className="assessmentShell">
      <Header compact onHome={onHome} accountName={accountName} onSignOut={onSignOut} />
      <div className="assessmentProgress" aria-label={`Assessment step ${step + 1} of 3`}>
        {["Selfie", "Analyze", "Profile"].map((label, index) => (
          <div className={index <= step ? "progressItem progressItemActive" : "progressItem"} key={label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <small>{label}</small>
          </div>
        ))}
      </div>

      <section className="assessmentCard">
        {step === 0 && (
          <div className="assessmentGrid">
            <div className="assessmentIntro">
              <p className="eyebrow">Step one · your selfie</p>
              <h1>A clear canvas gives us a precise map.</h1>
              <p className="selfieGuidance">Face forward in soft, even light. Keep your whole face and hair visible, leave your hair down, remove tinted glasses, and wear little or no makeup if possible.</p>
              <ul className="captureChecklist">
                <li>Natural daylight or soft front lighting</li>
                <li>Neutral expression, eyes open</li>
                <li>At least 320 × 320 px, JPG or PNG</li>
              </ul>
            </div>
            <div className="selfieSourcePanel">
              <div className="selfieSourceActions" aria-label="Choose how to add your photo">
                <label className="selfieSourceButton">
                  <span aria-hidden="true">＋</span>
                  <span>
                    <strong>{preparingPhoto === "face" ? "Preparing portrait…" : photos.face ? "Replace uploaded photo" : "Upload a photo"}</strong>
                    <small>JPG or PNG · portrait crop</small>
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void setUploadedPhoto(file);
                    }}
                  />
                </label>
                <PhoneCaptureConnect onCaptured={acceptPhonePhotos} />
              </div>
              <div className={`selfiePhotoDisplay ${photos.face ? "selfiePhotoDisplayFilled" : ""}`}>
                {photos.face ? (
                  <span className="photoPreview" style={{ backgroundImage: `url(${photos.face.preview})` }} />
                ) : (
                  <div className="selfiePhotoPlaceholder">
                    <span aria-hidden="true">M</span>
                    <strong>Your front-facing photo will appear here</strong>
                  </div>
                )}
              </div>
            </div>
            {uploadError && <p className="uploadPreparationError" role="alert">{uploadError}</p>}
            {selfieStorageStatus && <p className="selfieStorageStatus" role="status">{selfieStorageStatus}</p>}
          </div>
        )}

        {step === 1 && (
          <div className="analysisStage">
            <div className={analysisInProgress ? "analysisOrb analysisOrbRunning" : "analysisOrb"} aria-hidden="true"><span /></div>
            <p className="eyebrow">Step two · analysis</p>
            <h1>{analysisInProgress ? "Reading the relationships between your features…" : "Three signals. One coherent profile."}</h1>
            <div className="taskList">
              {ANALYSIS_TASKS.map((task, index) => {
                const detector = detectorReports.find((report) => report.id === task.id);
                return (
                <div key={task.id} className={analysisInProgress ? "taskRow taskRowRunning" : "taskRow"} style={{ animationDelay: `${index * 120}ms` }} title={detector?.issue}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{task.label}</strong>
                  <em>{analysisInProgress ? "reading" : detector?.status === "completed" ? "complete" : detector?.status === "failed" ? "review" : "ready"}</em>
                </div>
                );
              })}
            </div>
            {uploadQuality && (
              <div className={`uploadQualityPanel ${uploadQuality.status === "passed" ? "uploadQualityPanelPassed" : "uploadQualityPanelWarning"}`} role="status">
                <div>
                  <strong>{uploadQuality.status === "passed" ? "YouCam analysis complete" : uploadQuality.kind === "service" ? "YouCam connection problem" : photos.face?.origin === "guided" ? "Camera capture passed · detector review" : "Photo quality note"}</strong>
                  <p>{uploadQuality.summary}</p>
                </div>
                <ul>
                  {uploadQuality.checks.slice(0, 3).map((check) => <li key={check}>{check}</li>)}
                </ul>
              </div>
            )}
            {analysisError && <p className="errorMessage">{analysisError}</p>}
          </div>
        )}

        {step === 2 && analysis && (
          <div>
            <div className="assessmentIntro assessmentIntroWide">
              <p className="eyebrow">Step three · your profile</p>
              <h1>The visual vocabulary we’ll match against.</h1>
              <p className="profileSource">
                {analysis.source === "demo"
                  ? "Sample analysis shown"
                  : preparedMatchReady
                    ? "Analyzed with YouCam AI"
                    : "Analyzed with the available YouCam signals · reduced confidence"}
              </p>
            </div>
            <div className="profileReviewGrid">
              <article className="profilePanel colorPanel">
                <span className="profilePanelLabel">Color & skin</span>
                <div className="skinSwatch" style={{ backgroundColor: swatchColor(analysis.skinColor) }} />
                <h3>{analysis.fitzpatrick ? `Fitzpatrick Type ${analysis.fitzpatrick}` : "Fitzpatrick unavailable"}</h3>
                <p>{displayValue(analysis.eyeColor)} eyes</p>
                <label className="profileCorrection">
                  <span>Hair color</span>
                  <select
                    value={HAIR_COLOR_OPTIONS.includes(analysis.hairColor) ? analysis.hairColor : "Other"}
                    onChange={(event) => setAnalysis((current) => current ? { ...current, hairColor: event.target.value } : current)}
                  >
                    {HAIR_COLOR_OPTIONS.map((color) => <option key={color} value={color}>{color}</option>)}
                  </select>
                  <small>YouCam estimate · correct it if needed</small>
                </label>
                <div className="microSwatches">
                  <span><i style={{ background: swatchColor(analysis.skinColor) }} /><small>Skin color</small></span>
                  <span><i style={{ background: swatchColor(analysis.lipColor) }} /><small>Lip color</small></span>
                </div>
              </article>
              <article className="profilePanel">
                <span className="profilePanelLabel">Face structure</span>
                <div className="featureList">
                  {FEATURE_LABELS.map(([key, label]) => (
                    <div key={key}><small>{label}</small><strong>{displayValue(analysis[key])}</strong></div>
                  ))}
                </div>
              </article>
              <article className="profilePanel representationPanel">
                <div className="representationQuestion">
                  <span className="profilePanelLabel">Race or ethnic background <i>optional</i></span>
                  <p>Which backgrounds should Muse consider when choosing between close feature matches?</p>
                  <div className="representationChoices">
                    <button
                      type="button"
                      className={!representationPreferences.length ? "representationChip representationChipActive" : "representationChip"}
                      onClick={() => setRepresentationPreferences([])}
                    >
                      No preference
                    </button>
                    {REPRESENTATION_OPTIONS.map((option) => (
                      <button
                        type="button"
                        className={representationPreferences.includes(option.id) ? "representationChip representationChipActive" : "representationChip"}
                        aria-pressed={representationPreferences.includes(option.id)}
                        onClick={() => toggleRepresentation(option.id)}
                        key={option.id}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <small className="representationPrivacy">Self-identified only · never inferred from your photo · saved until you recalibrate</small>
                </div>
              </article>
            </div>
            <p className="assessmentNote">These labels guide visual recommendations; they are not medical judgments or measures of beauty.</p>
          </div>
        )}

        <footer className="assessmentFooter">
          <button className="backButton" disabled={analysisInProgress} onClick={() => (step === 0 ? onHome() : setStep((current) => current - 1))}>
            ← {step === 0 ? "Exit" : "Back"}
          </button>
          {step === 0 && (
            <div className="footerActions">
              <button className="demoButton" onClick={() => { setDemoMode(true); setPreparedAnalysis(null); setPreparedMatchReady(false); setUploadQuality(null); setStep(1); }}>Use sample photo</button>
              <button className="primaryButton" disabled={checkingUploads || !photos.face?.storedSelfieId || preparingPhoto !== null} onClick={() => void reviewAnalysisPlan()}>{checkingUploads ? "Analyzing photo with YouCam…" : "Analyze photo with YouCam"}</button>
            </div>
          )}
          {step === 1 && (
            <button
              className="primaryButton"
              onClick={runAnalysis}
              disabled={analysisInProgress}
            >
              {checkingUploads
                ? "Analyzing photo with YouCam…"
                : running
                ? "Analyzing…"
                : preparedAnalysis && uploadQuality?.status === "warning"
                    ? "Continue with this photo"
                  : preparedAnalysis
                    ? "View my profile"
                  : uploadQuality?.status === "warning"
                    ? "Retry YouCam"
                    : "Analyze my profile"}
            </button>
          )}
          {step === 2 && analysis && (
            <button
              className="primaryButton"
              disabled={running}
              onClick={() => {
                setRunning(true);
                setAnalysisError("");
                void onFinish(analysis, photos.face, representationPreferences)
                  .catch((error) => setAnalysisError(error instanceof Error ? error.message : "Your Muse profile could not be saved."))
                  .finally(() => setRunning(false));
              }}
            >
              {running ? "Saving your profile…" : "Reveal my muses"} {!running && <span aria-hidden="true">↗</span>}
            </button>
          )}
        </footer>
      </section>
    </main>
  );
}

function MuseBoard({
  catalog,
  matches,
}: {
  catalog: MuseCatalog;
  matches: ReturnType<typeof matchMuses>;
}) {
  const tiles = matches.flatMap((match) =>
    match.muse.introAssetIds.map((assetId, photoIndex) => ({
      asset: catalog.assets[assetId],
      match,
      photoIndex,
    })),
  ).slice(0, 24);

  return (
    <div>
      <div className="matchRibbon">
        {matches.slice(0, 5).map((match, index) => {
          const asset = catalog.assets[match.muse.introAssetIds[0]];
          return (
            <article className="matchCard" key={match.muse.id}>
              <div className="matchPortrait"><AssetImage asset={asset} alt={match.muse.name} sizes="180px" /></div>
              <span className="matchRank">0{index + 1}</span>
              <h3>{match.muse.name}</h3>
              <p>{match.score}% alignment</p>
              <small>{match.reasons.join(" · ")}</small>
            </article>
          );
        })}
      </div>

      <div className="boardIntro">
        <p className="eyebrow">The visual edit</p>
        <h2>Beauty languages worth borrowing.</h2>
        <p>Saved from your closest muses and arranged to feel like a world—not a search result.</p>
      </div>

      <div className="masonryBoard">
        {tiles.map(({ asset, match, photoIndex }) => (
          <a className="masonryTile" href={asset.sourceUrl} target="_blank" rel="noreferrer" key={`${match.muse.id}-${asset.id}`}>
            <div style={{ aspectRatio: `${asset.width || 3} / ${asset.height || 4}` }}>
              <AssetImage asset={asset} alt={`${match.muse.name} inspiration`} sizes="(max-width: 700px) 48vw, 22vw" />
            </div>
            {(photoIndex === 0 || photoIndex % 3 === 0) && <span>{match.muse.name}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}

function LookBoard({
  catalog,
  looks,
  kind,
  saved,
  onSave,
  onTry,
}: {
  catalog: MuseCatalog;
  looks: RecommendedLook[];
  kind: "makeup" | "hair";
  saved: Set<string>;
  onSave: (id: string) => void;
  onTry: (look: RecommendedLook) => void;
}) {
  const descriptorCounts = new Map<string, number>();
  looks.forEach(({ look }) => look.descriptors.forEach((tag) => descriptorCounts.set(tag, (descriptorCounts.get(tag) ?? 0) + 1)));
  const filters = [...descriptorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([tag]) => tag);
  const [activeFilter, setActiveFilter] = useState("All");
  const visible = activeFilter === "All" ? looks : looks.filter(({ look }) => look.descriptors.includes(activeFilter));

  return (
    <div>
      <div className="lookBoardHeader">
        <div>
          <p className="eyebrow">{kind === "makeup" ? "Makeup direction" : "Hair direction"}</p>
          <h2>{kind === "makeup" ? "Looks that echo your coloring and structure." : "Styles with the right shape, movement, and mood."}</h2>
        </div>
        <p>{kind === "makeup" ? "Each card uses the approved transfer template from its full reference set." : "Your muses supply the visual language; adapt each reference to your natural texture."}</p>
      </div>
      <div className="filterBar">
        {["All", ...filters].map((filter) => (
          <button className={filter === activeFilter ? "filterButton filterButtonActive" : "filterButton"} onClick={() => setActiveFilter(filter)} key={filter}>
            {filter}
          </button>
        ))}
      </div>
      <div className="lookGrid">
        {visible.map((recommended, index) => {
          const { look, muse } = recommended;
          const asset = catalog.assets[look.templateAssetId];
          return (
            <article className={`lookCard ${index % 5 === 1 ? "lookCardTall" : ""}`} key={look.id}>
              <div className="lookImage">
                <AssetImage asset={asset} alt={`${look.label} on ${muse.name}`} sizes="(max-width: 700px) 90vw, 30vw" />
                <button className={saved.has(look.id) ? "saveButton saveButtonActive" : "saveButton"} onClick={() => onSave(look.id)} aria-label={`${saved.has(look.id) ? "Remove" : "Save"} ${look.label}`}>
                  {saved.has(look.id) ? "♥" : "♡"}
                </button>
                <span className="templateBadge">Try-on template</span>
              </div>
              <div className="lookCopy">
                <p>{muse.name}</p>
                <h3>{titleCase(look.label)}</h3>
                <div className="tagRow">{look.descriptors.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
                <button className="tryButton" onClick={() => onTry(recommended)}>Try this look <span>↗</span></button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function TryOnModal({
  catalog,
  selection,
  defaultPhoto,
  onClose,
}: {
  catalog: MuseCatalog;
  selection: RecommendedLook;
  defaultPhoto?: PhotoValue;
  onClose: () => void;
}) {
  const [photo, setPhoto] = useState<PhotoValue | undefined>(defaultPhoto);
  const [status, setStatus] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const asset = catalog.assets[selection.look.templateAssetId];

  const generate = async () => {
    if (!photo) {
      setStatus("Add a selfie first.");
      return;
    }
    setStatus("Creating your preview…");
    setResultUrl("");
    try {
      const form = new FormData();
      form.append("photo", photo.file);
      form.append("kind", selection.look.kind);
      form.append("referenceUrl", asset.imageUrl);
      const response = await fetch("/api/try-on", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Preview unavailable.");
      if (payload.resultUrl) {
        setResultUrl(payload.resultUrl);
        setStatus("Your preview is ready.");
      } else {
        setStatus(payload.message ?? "Add your YouCam API key to generate this preview.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Preview unavailable.");
    }
  };

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="try-on-title">
      <div className="tryOnModal">
        <button className="modalClose" onClick={onClose} aria-label="Close try-on">×</button>
        <div className="modalHeading">
          <p className="eyebrow">Virtual try-on · {selection.look.kind}</p>
          <h2 id="try-on-title">{titleCase(selection.look.label)}</h2>
          <p>Inspired by {selection.muse.name}</p>
        </div>
        <div className="tryOnCompare">
          <div className="tryOnPane">
            <span>You</span>
            {photo ? (
              <div className="localPhoto" style={{ backgroundImage: `url(${photo.preview})` }} />
            ) : (
              <label className="modalUpload">
                <b>＋</b><strong>Add your selfie</strong><small>JPG or PNG</small>
                <input type="file" accept="image/jpeg,image/png" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) setPhoto({ file, preview: URL.createObjectURL(file) });
                }} />
              </label>
            )}
          </div>
          <div className="tryOnPlus">＋</div>
          <div className="tryOnPane">
            <span>Reference</span>
            <div className="referencePhoto"><AssetImage asset={asset} alt={`${selection.look.label} reference`} sizes="320px" /></div>
          </div>
          {resultUrl && (
            <>
              <div className="tryOnPlus">→</div>
              <div className="tryOnPane">
                <span>Preview</span>
                <div className="referencePhoto"><Image src={resultUrl} alt="Generated virtual try-on" fill sizes="320px" unoptimized /></div>
              </div>
            </>
          )}
        </div>
        {status && <p className="tryOnStatus">{status}</p>}
        <button className="primaryButton modalGenerate" onClick={generate}>Generate with YouCam</button>
      </div>
    </div>
  );
}

export function LegacyResults({
  catalog,
  analysis,
  aesthetics,
  defaultPhoto,
  onHome,
  onRestart,
}: {
  catalog: MuseCatalog;
  analysis: UserAnalysis;
  aesthetics: string[];
  defaultPhoto?: PhotoValue;
  onHome: () => void;
  onRestart: () => void;
}) {
  const [tab, setTab] = useState<ResultTab>("muses");
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [tryOn, setTryOn] = useState<RecommendedLook | null>(null);
  const matches = useMemo(() => matchMuses(catalog, analysis, []), [catalog, analysis]);
  const makeup = useMemo(() => recommendLooks(matches, "makeup", aesthetics), [matches, aesthetics]);
  const hair = useMemo(() => recommendLooks(matches, "hair", aesthetics), [matches, aesthetics]);

  const toggleSave = (id: string) => {
    setSaved((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <main className="resultsShell">
      <Header compact onHome={onHome} />
      <section className="resultsHero">
        <div>
          <p className="eyebrow">Your first edit</p>
          <h1>Your muses aren’t copies.<br />They’re clues.</h1>
        </div>
        <div className="resultsProfile">
          <span className="resultColor" style={{ background: analysis.skinColor }} />
          <div><small>Your profile</small><strong>{analysis.faceShape} · {analysis.eyeShape} eyes</strong><p>{aesthetics.join(" · ")}</p></div>
          <button onClick={onRestart}>Retake</button>
        </div>
      </section>

      <nav className="resultTabs" aria-label="Muse recommendations">
        {(["muses", "makeup", "hair"] as ResultTab[]).map((item) => (
          <button className={tab === item ? "resultTab resultTabActive" : "resultTab"} onClick={() => setTab(item)} key={item}>
            {item === "muses" ? "Muse board" : item} <span>{item === "muses" ? matches.length : item === "makeup" ? makeup.length : hair.length}</span>
          </button>
        ))}
      </nav>

      <section className="resultsContent">
        {tab === "muses" && <MuseBoard catalog={catalog} matches={matches} />}
        {tab === "makeup" && <LookBoard catalog={catalog} looks={makeup} kind="makeup" saved={saved} onSave={toggleSave} onTry={setTryOn} />}
        {tab === "hair" && <LookBoard catalog={catalog} looks={hair} kind="hair" saved={saved} onSave={toggleSave} onTry={setTryOn} />}
      </section>
      <footer className="resultsFooter"><Logo /><span>{saved.size} saved ideas · catalog v{catalog.version}</span></footer>
      {tryOn && <TryOnModal catalog={catalog} selection={tryOn} defaultPhoto={defaultPhoto} onClose={() => setTryOn(null)} />}
    </main>
  );
}

function Results(props: Parameters<typeof ResultsWorkspace>[0]) {
  return <ResultsWorkspace {...props} />;
}

export default function MuseExperience({ catalog }: { catalog: MuseCatalog }) {
  const { data: session } = authClient.useSession();
  const [screen, setScreen] = useState<Screen>("home");
  const [analysis, setAnalysis] = useState<UserAnalysis | null>(null);
  const [representationPreferences, setRepresentationPreferences] = useState<RepresentationTag[]>([]);
  const [savedMatches, setSavedMatches] = useState<MuseMatchSnapshot[]>([]);
  const [facePhoto, setFacePhoto] = useState<PhotoValue | undefined>();
  const [localAccountName, setLocalAccountName] = useState("");
  const [accountGateMode, setAccountGateMode] = useState<"create" | "sign-in">("create");
  const [demoBoard, setDemoBoard] = useState<DemoBoardSnapshot | null>(null);
  const [restoreMessage, setRestoreMessage] = useState("Your saved selfie, feature analysis, celebrity matches, and look library are loading.");
  const loadedAccountStateFor = useRef("");
  const awaitingPostAuthRestore = useRef(false);
  const pendingDestination = useRef<SessionDestination>("assessment");

  const accountName = session?.user.username || session?.user.name || localAccountName;

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || loadedAccountStateFor.current === userId) return;
    loadedAccountStateFor.current = userId;
    setScreen("restoring");
    setDemoBoard(null);
    setAnalysis(null);
    setRepresentationPreferences([]);
    setSavedMatches([]);
    setFacePhoto((current) => {
      if (current?.preview.startsWith("blob:")) URL.revokeObjectURL(current.preview);
      return undefined;
    });
    let cancelled = false;
    void Promise.all([loadMuseProfile(), loadLatestAssessmentFacePhoto()])
      .then(([savedProfile, latest]) => {
        if (cancelled) {
          if (latest?.preview.startsWith("blob:")) URL.revokeObjectURL(latest.preview);
          return;
        }
        if (latest) {
          setFacePhoto({
            file: latest.file,
            preview: latest.preview,
            storedSelfieId: latest.selfie.id,
            origin: latest.selfie.sourceKind === "upload" ? "upload" : "stored",
          });
        }
        if (savedProfile) {
          setAnalysis(savedProfile.analysis);
          setRepresentationPreferences(savedProfile.representationPreferences);
          setSavedMatches(savedProfile.matches);
          awaitingPostAuthRestore.current = false;
          setScreen("results");
          window.scrollTo({ top: 0 });
        } else {
          awaitingPostAuthRestore.current = false;
          setScreen("assessment");
        }
      })
      .catch(() => {
        if (!cancelled) {
          loadedAccountStateFor.current = "";
          awaitingPostAuthRestore.current = false;
          setScreen("home");
        }
      });
    return () => { cancelled = true; };
  }, [session?.user.id]);

  const goHome = () => {
    setScreen("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const enterSession = (destination: SessionDestination) => {
    setDemoBoard(null);
    if (analysis) {
      setScreen("results");
    } else {
      setScreen("assessment");
    }
    window.scrollTo({ top: 0 });
  };

  const openDemoBoard = async (account: DemoBoardAccount) => {
    setRestoreMessage(`Loading ${account === "testing123" ? "User 1" : "User 2"}’s live sample board…`);
    setScreen("restoring");
    try {
      const response = await fetch(`/api/demo-board?account=${encodeURIComponent(account)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.board) throw new Error(payload.error || "The sample board could not be loaded.");
      const board = payload.board as DemoBoardSnapshot;
      setDemoBoard(board);
      setAnalysis(board.profile.analysis);
      setRepresentationPreferences(board.profile.representationPreferences);
      setSavedMatches(board.profile.matches);
      setFacePhoto(undefined);
      setScreen("results");
      window.scrollTo({ top: 0 });
    } catch (error) {
      setScreen("home");
      window.alert(error instanceof Error ? error.message : "The sample board could not be loaded.");
    }
  };

  const requestSession = (destination: SessionDestination, gateMode: "create" | "sign-in" = "create") => {
    pendingDestination.current = destination;
    setRestoreMessage("Your saved selfie, feature analysis, celebrity matches, and look library are loading.");
    if (session?.user) enterSession(destination);
    else {
      setAccountGateMode(gateMode);
      setScreen("account");
    }
  };

  const signOut = async () => {
    await authClient.signOut();
    setLocalAccountName("");
    setAnalysis(null);
    setDemoBoard(null);
    setRepresentationPreferences([]);
    setSavedMatches([]);
    setFacePhoto((current) => {
      if (current?.preview.startsWith("blob:")) URL.revokeObjectURL(current.preview);
      return undefined;
    });
    loadedAccountStateFor.current = "";
    awaitingPostAuthRestore.current = false;
    setScreen("home");
  };

  const restartAssessment = async () => {
    try {
      await deleteMuseProfile();
      if (facePhoto?.preview.startsWith("blob:")) URL.revokeObjectURL(facePhoto.preview);
      setAnalysis(null);
      setDemoBoard(null);
      setRepresentationPreferences([]);
      setSavedMatches([]);
      setFacePhoto(undefined);
      setScreen("assessment");
      window.scrollTo({ top: 0 });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Muse could not start recalibration.");
    }
  };

  if (screen === "account") {
    return (
      <AccountGate
        onHome={goHome}
        initialMode={accountGateMode}
        onAuthenticated={(username) => {
          awaitingPostAuthRestore.current = true;
          setLocalAccountName(username);
          setScreen("restoring");
        }}
      />
    );
  }

  if (screen === "restoring") {
    return (
      <main className="accountShell">
        <Header compact onHome={goHome} />
        <section className="accountStage">
          <div className="accountCard restoreAccountCard">
            <div className="analysisOrb" aria-hidden="true"><span /></div>
            <p className="eyebrow">RESTORING YOUR MUSE PROFILE</p>
            <h1>Welcome back.</h1>
            <p>{restoreMessage}</p>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "assessment") {
    return (
      <Assessment
        onHome={goHome}
        accountName={accountName || "muse"}
        onSignOut={signOut}
        defaultPhoto={facePhoto}
        onPersistSelfie={saveSelfieToMuse}
        onFinish={async (nextAnalysis, nextFacePhoto, nextRepresentationPreferences) => {
          const nextMatches = matchMuses(catalog, nextAnalysis, nextRepresentationPreferences, 5);
          const snapshot: MuseMatchSnapshot[] = nextMatches.map((match) => ({
            museId: match.muse.id,
            score: match.score,
            featureScore: match.featureScore,
            representationScore: match.representationScore,
            reasons: match.reasons,
          }));
          await saveMuseProfile({
            analysis: nextAnalysis,
            representationPreferences: nextRepresentationPreferences,
            matches: snapshot,
            catalogVersion: catalog.version,
          });
          setAnalysis(nextAnalysis);
          setFacePhoto(nextFacePhoto);
          setRepresentationPreferences(nextRepresentationPreferences);
          setSavedMatches(snapshot);
          setScreen("results");
          window.scrollTo({ top: 0 });
        }}
      />
    );
  }

  if (screen === "results" && analysis) {
    return (
      <Results
        key={demoBoard ? `demo:${demoBoard.account}` : `user:${session?.user.id || accountName}`}
        catalog={catalog}
        analysis={analysis}
        aesthetics={[]}
        representationPreferences={representationPreferences}
        savedMatches={savedMatches}
        defaultPhoto={facePhoto}
        onHome={goHome}
        onRestart={restartAssessment}
        accountName={demoBoard ? undefined : accountName || undefined}
        workspaceStorageKey={demoBoard ? undefined : session?.user.id || undefined}
        onSignOut={!demoBoard && accountName ? signOut : undefined}
        demoBoard={demoBoard || undefined}
        onRequireAccount={() => {
          window.alert("Demo only. Please log in or create an account to experiment with looks and create a product catalog.");
        }}
      />
    );
  }

  return (
    <Landing
      catalog={catalog}
      accountName={accountName || undefined}
      onSignOut={signOut}
      onSignIn={() => requestSession("assessment", "sign-in")}
      onStart={() => requestSession("assessment")}
      onDemo={(account) => void openDemoBoard(account)}
    />
  );
}
