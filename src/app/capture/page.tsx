import type { Metadata } from "next";
import MobileCameraKit from "@/components/MobileCameraKit";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Muse — Guided phone capture",
  description: "Securely capture one guided front-facing photo for your Muse assessment.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function CapturePage() {
  return <MobileCameraKit />;
}
