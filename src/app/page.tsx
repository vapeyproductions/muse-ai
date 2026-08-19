import MuseExperience from "@/components/MuseExperience";
import catalogJson from "@/data/muse-catalog.json";
import type { MuseCatalog } from "@/lib/muse-types";

export default function Home() {
  return <MuseExperience catalog={catalogJson as MuseCatalog} />;
}
