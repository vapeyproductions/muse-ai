"use client";

import type { SavedMuseProfile } from "@/lib/profile-types";

export async function loadMuseProfile(): Promise<SavedMuseProfile | null> {
  const response = await fetch("/api/profile", { cache: "no-store" });
  if (response.status === 404) return null;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Your saved Muse profile is unavailable.");
  return payload.profile as SavedMuseProfile;
}

export async function saveMuseProfile(profile: Omit<SavedMuseProfile, "updatedAt">) {
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(profile),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Your Muse profile could not be saved.");
  return payload.profile as SavedMuseProfile;
}

export async function deleteMuseProfile() {
  const response = await fetch("/api/profile", { method: "DELETE" });
  if (response.status === 404) return;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Your Muse profile could not be recalibrated.");
}
