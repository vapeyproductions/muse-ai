"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { matchMuses, recommendLooks, type RecommendedLook } from "@/lib/matching";
import type { AppliedLookProvenance } from "@/lib/look-provenance";
import { representationLabel, type RepresentationTag } from "@/lib/muse-representation";
import type { LookKind, MuseAsset, MuseCatalog, MuseMatch, UserAnalysis } from "@/lib/muse-types";
import type { MuseMatchSnapshot } from "@/lib/profile-types";
import { deleteMuseSelfie, loadMuseSelfies } from "@/lib/selfie-client";
import type { SelfieVariant } from "@/lib/workspace-types";
import type { DemoBoardSnapshot } from "@/lib/demo-board-types";

const AchieveWorkspace = dynamic(() => import("@/components/AchieveWorkspace"));

type WorkspaceMode = "muses" | LookKind;
type JourneyMode = "inspiration" | "achieve" | "shopping";
type UserPhoto = { file: File; preview: string; storedSelfieId?: string };

type InspoSelection = {
  recommended: RecommendedLook;
  selectedAssetId: string;
};

function eligibleBaseVariants(variants: SelfieVariant[], kind: LookKind) {
  return variants.filter((variant) => kind === "makeup" ? !variant.makeup : !variant.hair);
}

function sourceSizingStyle(asset: MuseAsset) {
  const sourceWidth = asset.width > 0 ? asset.width : 640;
  const sourceHeight = asset.height > 0 ? asset.height : 800;
  return {
    "--source-max-width": `${Math.max(64, Math.round(sourceWidth / 2))}px`,
    "--source-max-height": `${Math.max(72, Math.round(sourceHeight / 2))}px`,
  } as CSSProperties;
}

function collageLayoutStyles(assets: MuseAsset[]) {
  const count = Math.max(assets.length, 1);
  const columns = Math.max(4, Math.ceil(Math.sqrt(count * 2.05)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const verticalOverlap = .18;
  const nominalHeight = 96 / (rows - Math.max(0, rows - 1) * verticalOverlap);
  const boardAspect = 1.45;
  const styles: CSSProperties[] = [];

  for (let row = 0; row < rows; row += 1) {
    const start = row * columns;
    const rowAssets = assets.slice(start, start + columns);
    const naturalWidths = rowAssets.map((asset) => {
      const aspect = Math.max(.55, Math.min(1.6, (asset.width || 640) / (asset.height || 800)));
      return nominalHeight * aspect / boardAspect;
    });
    const averageWidth = naturalWidths.reduce((sum, width) => sum + width, 0) / Math.max(rowAssets.length, 1);
    const overlap = averageWidth * .14;
    const naturalTotal = naturalWidths.reduce((sum, width) => sum + width, 0) - overlap * Math.max(0, rowAssets.length - 1);
    const scale = Math.min(1, 96 / Math.max(naturalTotal, 1));
    const rowHeight = nominalHeight * scale;
    const widths = naturalWidths.map((width) => width * scale);
    const scaledOverlap = overlap * scale;
    const rowTotal = widths.reduce((sum, width) => sum + width, 0) - scaledOverlap * Math.max(0, widths.length - 1);
    let left = (100 - rowTotal) / 2;
    const top = 1 + row * nominalHeight * (1 - verticalOverlap);

    rowAssets.forEach((asset, rowIndex) => {
      const globalIndex = start + rowIndex;
      const rotation = ((globalIndex * 31) % 9) - 4;
      styles.push({
        ...sourceSizingStyle(asset),
        left: `${left}%`,
        top: `${top}%`,
        width: `${widths[rowIndex]}%`,
        height: `${rowHeight}%`,
        zIndex: 2 + (globalIndex % 11),
        "--tile-rotation": `${rotation * .45}deg`,
      } as CSSProperties);
      left += widths[rowIndex] - scaledOverlap;
    });
  }

  return styles;
}

function CollageViewport({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children: ReactNode;
}) {
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const setZoom = (zoom: number) => setView((current) => ({
    ...current,
    zoom: Math.max(.6, Math.min(3, zoom)),
  }));
  const nudge = (x: number, y: number) => setView((current) => ({
    ...current,
    x: current.x + x,
    y: current.y + y,
  }));
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".collageControls")) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewX: view.x,
      viewY: view.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.current.startX;
    const deltaY = event.clientY - drag.current.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 5) drag.current.moved = true;
    setView((current) => ({
      ...current,
      x: drag.current ? drag.current.viewX + deltaX : current.x,
      y: drag.current ? drag.current.viewY + deltaY : current.y,
    }));
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    if (drag.current.moved) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className={`${className} collageViewport${dragging ? " collageViewportDragging" : ""}`}
      aria-label={label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        className="collageScene"
        style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})` }}
      >
        <div className="canvasGrid" aria-hidden="true" />
        {children}
      </div>
      <div className="collageControls" aria-label="Collage navigation controls">
        <button onClick={() => nudge(56, 0)} aria-label="Move collage left">←</button>
        <button onClick={() => nudge(0, 48)} aria-label="Move collage up">↑</button>
        <button onClick={() => nudge(0, -48)} aria-label="Move collage down">↓</button>
        <button onClick={() => nudge(-56, 0)} aria-label="Move collage right">→</button>
        <i aria-hidden="true" />
        <button onClick={() => setZoom(view.zoom - .2)} aria-label="Zoom out">−</button>
        <output>{Math.round(view.zoom * 100)}%</output>
        <button onClick={() => setZoom(view.zoom + .2)} aria-label="Zoom in">+</button>
        <button className="collageFit" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>Fit</button>
      </div>
      <span className="collageMoveHint">Drag to move · controls to zoom</span>
    </div>
  );
}

function sourceQualityClass(asset: MuseAsset) {
  const shortestSide = Math.min(asset.width || 640, asset.height || 800);
  return shortestSide < 480 ? " sourceCompact" : "";
}

function NeonAsset({ asset, alt, sizes }: { asset: MuseAsset; alt: string; sizes: string }) {
  return (
    <Image
      src={asset.imageUrl}
      alt={alt}
      fill
      sizes={sizes}
      style={{ objectFit: "contain" }}
      unoptimized
    />
  );
}

function CyberMark() {
  return (
    <span className="cyberMark">
      <i aria-hidden="true" /> MUSE<span>{"//AI"}</span>
    </span>
  );
}

const PRIMARY_ANALYSIS_FIELDS: Array<[keyof UserAnalysis, string]> = [
  ["faceShape", "Face shape"],
  ["cheekbones", "Cheekbones"],
  ["eyeShape", "Eye shape"],
  ["eyeSize", "Eye size"],
  ["noseWidth", "Nose width"],
  ["noseLength", "Nose length"],
  ["fitzpatrick", "Skin type"],
  ["eyeColor", "Eye color"],
  ["hairColor", "Hair color"],
];

const SECONDARY_ANALYSIS_FIELDS: Array<[keyof UserAnalysis, string]> = [
  ["eyeAngle", "Eye angle"],
  ["eyeSpacing", "Eye spacing"],
  ["eyelidType", "Eyelid"],
  ["eyebrowShape", "Brow shape"],
  ["eyebrowThickness", "Brow density"],
  ["eyebrowSpacing", "Brow spacing"],
  ["eyebrowLength", "Brow length"],
  ["eyebrowColor", "Brow color"],
  ["lipShape", "Lip shape"],
];

function analysisValue(key: keyof UserAnalysis, value: UserAnalysis[keyof UserAnalysis]) {
  if (key === "fitzpatrick") return `Type ${value}`;
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "unknown") return "Not confidently detected";
  return text.replace(/-/g, " ");
}

function MuseCollage({
  catalog,
  matches,
  activeMuseId,
}: {
  catalog: MuseCatalog;
  matches: MuseMatch[];
  activeMuseId: string | null;
}) {
  const photoPool = useMemo(() => {
    const visibleMatches = activeMuseId ? matches.filter((match) => match.muse.id === activeMuseId) : matches;
    const assetsByMuse = visibleMatches.map((match) => ({
      match,
      assetIds: [...new Set([
        ...match.muse.introAssetIds,
        ...match.muse.looks.flatMap((look) => look.galleryAssetIds),
      ])],
    }));
    const rows: Array<{ asset: MuseAsset; match: MuseMatch }> = [];
    const longest = Math.max(...assetsByMuse.map(({ assetIds }) => assetIds.length), 0);
    for (let photoIndex = 0; photoIndex < longest; photoIndex += 1) {
      assetsByMuse.forEach(({ match, assetIds }) => {
        const assetId = assetIds[photoIndex];
        if (assetId) rows.push({ asset: catalog.assets[assetId], match });
      });
    }
    return rows;
  }, [activeMuseId, catalog, matches]);
  const collageStyles = useMemo(() => collageLayoutStyles(photoPool.map(({ asset }) => asset)), [photoPool]);
  const activeMatch = matches.find((match) => match.muse.id === activeMuseId);

  return (
    <section className="signalPanel museSignalPanel">
      <div className={`signalHeading${activeMatch ? "" : " signalHeadingSolo"}`}>
        <div>
          <span className="systemLabel">MUSE MATRIX / 01</span>
          <h1>{activeMatch ? activeMatch.muse.name : "Your five closest matches"}</h1>
        </div>
        {activeMatch && <p>{activeMatch.score}% aligned through {activeMatch.reasons.join(", ")}.</p>}
      </div>

      <CollageViewport
        key={`${activeMuseId || "all"}-${photoPool.length}`}
        className={`overlapCanvas ${activeMatch ? "overlapCanvasSolo" : ""}`}
        label={activeMatch ? `${activeMatch.muse.name} inspiration collage` : "Combined muse inspiration collage"}
      >
        {photoPool.map(({ asset, match }, index) => (
          <a
            className={`overlapTile${sourceQualityClass(asset)}`}
            style={collageStyles[index]}
            href={asset.sourceUrl}
            target="_blank"
            rel="noreferrer"
            key={`${match.muse.id}-${asset.id}-${index}`}
            title={`Open ${match.muse.name} source`}
            aria-label={`Examine ${match.muse.name} inspiration photo`}
          >
            <NeonAsset asset={asset} alt={`${match.muse.name} inspiration`} sizes="(max-width: 850px) 42vw, 18vw" />
            <span>{match.muse.name}</span>
          </a>
        ))}
        <div className="matrixReadout">
          <small>ACTIVE CLUSTER</small>
          <strong>{activeMatch ? "01" : "05"}</strong>
          <span>{photoPool.length} visual references</span>
        </div>
      </CollageViewport>
    </section>
  );
}

function StyleCollage({
  catalog,
  kind,
  looks,
  museFilter,
  keywordFilter,
  onSelect,
}: {
  catalog: MuseCatalog;
  kind: LookKind;
  looks: RecommendedLook[];
  museFilter: string;
  keywordFilter: string;
  onSelect: (selection: InspoSelection) => void;
}) {
  const cards = useMemo(() => looks
    .filter(({ muse }) => museFilter === "all" || muse.id === museFilter)
    .filter(({ look }) => keywordFilter === "all" || look.descriptors.includes(keywordFilter))
    .flatMap((recommended) => recommended.look.galleryAssetIds.map((assetId) => ({
      recommended,
      assetId,
      asset: catalog.assets[assetId],
    })))
    .filter((card) => Boolean(card.asset)), [catalog, keywordFilter, looks, museFilter]);
  const collageStyles = useMemo(() => collageLayoutStyles(cards.map(({ asset }) => asset)), [cards]);

  return (
    <section className="signalPanel styleSignalPanel">
      <div className="signalHeading styleSignalHeading signalHeadingSolo">
        <div>
          <span className="systemLabel">{kind.toUpperCase()} LIBRARY / {kind === "makeup" ? "02" : "03"}</span>
          <h1>{kind === "makeup" ? "Looks suited for your features and coloring" : "Styles that fit your face"}</h1>
        </div>
      </div>

      <CollageViewport
        key={`${kind}-${museFilter}-${keywordFilter}-${cards.length}`}
        className="styleMatrix"
        label={`${kind} inspiration collage`}
      >
        {cards.map(({ recommended, assetId, asset }, index) => (
          <button
            className={`styleSignal${sourceQualityClass(asset)}`}
            style={collageStyles[index]}
            onClick={() => onSelect({ recommended, selectedAssetId: assetId })}
            key={`${recommended.look.id}-${assetId}-${index}`}
            aria-label={`${kind === "makeup" ? "Makeup" : "Hair"} inspiration from ${recommended.muse.name}`}
          >
            <span className="styleSignalImage">
              <NeonAsset asset={asset} alt={`${kind === "makeup" ? "Makeup" : "Hair"} inspiration from ${recommended.muse.name}`} sizes="(max-width: 850px) 20vw, 10vw" />
            </span>
          </button>
        ))}
        {cards.length === 0 && (
          <div className="emptySignal">
            <strong>NO SIGNALS FOUND</strong>
            <span>Clear one of the filters below to reopen the library.</span>
          </div>
        )}
      </CollageViewport>
    </section>
  );
}

function VariantInspector({
  catalog,
  variant,
  onRename,
  onDelete,
  deleting,
}: {
  catalog: MuseCatalog;
  variant: SelfieVariant;
  onRename: (label: string) => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const applied = [variant.makeup, variant.hair].filter((item): item is AppliedLookProvenance => Boolean(item));
  return (
    <div className="variantInspector" id="variant-inspector">
      <div className="renameLine">
        <span>FILE LABEL</span>
        <input value={variant.label} onChange={(event) => onRename(event.target.value)} aria-label="Rename this selfie" />
      </div>
      {applied.length ? applied.map((look) => {
        const selected = catalog.assets[look.selectedAssetId];
        return (
          <div className="provenanceRow" key={look.kind}>
            <div className="provenanceThumb">
              {selected
                ? <NeonAsset asset={selected} alt="Selected inspiration" sizes="70px" />
                : <span className="missingProvenanceThumb">{look.kind === "makeup" ? "M" : "H"}</span>}
            </div>
            <div>
              <span>{look.kind.toUpperCase()} SOURCE</span>
              <strong>{look.kind === "makeup" ? "Makeup inspiration" : "Hair inspiration"}</strong>
              <small>Inspired by {look.museName}</small>
            </div>
            {selected && <a href={selected.sourceUrl} target="_blank" rel="noreferrer" title="Open the selected inspiration source">↗</a>}
          </div>
        );
      }) : (
        <p className="cleanVariant">{variant.sourceKind === "generated"
          ? "This is an older generated look. Its original recipe was not recorded, so Muse will keep it in your library but will not use it as a new layering base."
          : "Unmodified source image. Add a makeup or hair signal to create a new branch."}</p>
      )}
      {variant.parentId && <small className="branchId">BRANCH / {variant.parentId.slice(0, 8).toUpperCase()}</small>}
      {onDelete && (
        <button className="deleteLookButton" disabled={deleting} onClick={onDelete}>
          {deleting ? "DELETING…" : "DELETE THIS LOOK"}
        </button>
      )}
    </div>
  );
}

function SelfieConsole({
  catalog,
  variants,
  currentIndex,
  inspect,
  mode,
  generating,
  notice,
  onNavigate,
  onMode,
  onInspect,
  onRename,
  onDeleteVariant,
  deletingVariantId,
  journey,
  hasGeneratedLooks,
  onAchieve,
  onShopping,
}: {
  catalog: MuseCatalog;
  variants: SelfieVariant[];
  currentIndex: number;
  inspect: boolean;
  mode: WorkspaceMode;
  generating: boolean;
  notice: string;
  onNavigate: (index: number) => void;
  onMode: (mode: WorkspaceMode) => void;
  onInspect: (index: number) => void;
  onRename: (label: string) => void;
  onDeleteVariant: (variant: SelfieVariant) => void;
  deletingVariantId: string | null;
  journey: JourneyMode;
  hasGeneratedLooks: boolean;
  onAchieve: () => void;
  onShopping: () => void;
}) {
  const current = variants[currentIndex];
  const [fullImageOpen, setFullImageOpen] = useState(false);

  useEffect(() => {
    if (!fullImageOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullImageOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [fullImageOpen]);

  return (
    <aside className="selfieConsole">
      <div className="consoleTopline">
        <span>LIVE COMPOSITE</span>
        <i>{String(currentIndex + 1).padStart(2, "0")} / {String(variants.length).padStart(2, "0")}</i>
      </div>
      <div className="lookLibrary">
        <div className="lookLibraryHeading">
          <span>PHOTO LIBRARY</span>
          <small>{variants.length} SAVED</small>
        </div>
        <div className="lookLibraryRail">
          {variants.map((variant, index) => {
            const canDelete = Boolean(variant.deletable && variant.storedSelfieId);
            const isDeleting = deletingVariantId === variant.id;
            const hasRecordedInspo = Boolean(variant.makeup || variant.hair);
            const recordedLayers = [variant.makeup && "makeup", variant.hair && "hair"].filter(Boolean).join(" and ");
            return (
              <div className="lookLibraryItem" key={variant.id}>
                <button
                  className={index === currentIndex ? "lookLibraryCard lookLibraryCardActive" : "lookLibraryCard"}
                  onClick={() => onNavigate(index)}
                  title={`${variant.label}${variant.makeup ? " · makeup" : ""}${variant.hair ? " · hair" : ""}`}
                  type="button"
                >
                  <span className="lookLibraryThumb">
                    <Image src={variant.imageUrl} alt="" fill sizes="64px" unoptimized />
                    <i className="lookLibraryBadges">
                      {variant.makeup && <b title="Includes makeup">M</b>}
                      {variant.hair && <b title="Includes hair">H</b>}
                    </i>
                  </span>
                  <small>{variant.label}</small>
                </button>
                {hasRecordedInspo && (
                  <button
                    className={index === currentIndex && inspect ? "lookLibraryCardInfo lookLibraryCardInfoActive" : "lookLibraryCardInfo"}
                    onClick={() => onInspect(index)}
                    aria-label={`View the ${recordedLayers} inspiration used to create ${variant.label}`}
                    aria-expanded={index === currentIndex && inspect}
                    aria-controls="variant-inspector"
                    title={`View ${recordedLayers} inspiration`}
                    type="button"
                  >
                    i
                  </button>
                )}
                {canDelete && (
                  <button
                    className="lookLibraryCardDelete"
                    disabled={isDeleting}
                    onClick={() => onDeleteVariant(variant)}
                    aria-label={`Delete ${variant.label}`}
                    title={`Delete ${variant.label}`}
                    type="button"
                  >
                    {isDeleting ? "…" : "×"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className={`selfieViewport ${generating ? "selfieViewportGenerating" : ""}`}>
        <Image src={current.imageUrl} alt={current.label} fill sizes="(max-width: 900px) 92vw, 30vw" unoptimized />
        <button
          className="fullImageLaunch"
          onClick={() => setFullImageOpen(true)}
          type="button"
          aria-label={`View ${current.label} full size`}
        >
          <span>FULL IMAGE</span><b>↗</b>
        </button>
        <div className="scanBeam" aria-hidden="true" />
        <span className="viewportCorner viewportCornerA" aria-hidden="true" />
        <span className="viewportCorner viewportCornerB" aria-hidden="true" />
        {generating && <div className="renderOverlay"><strong>RENDERING</strong><span>MUSE AI / YOUCAM</span></div>}
        <div className="variantArrows">
          <button disabled={currentIndex === 0} onClick={() => onNavigate(currentIndex - 1)} aria-label="Previous selfie">←</button>
          <strong>{current.label}</strong>
          <button disabled={currentIndex === variants.length - 1} onClick={() => onNavigate(currentIndex + 1)} aria-label="Next selfie">→</button>
        </div>
      </div>

      {fullImageOpen && createPortal((
        <div className="fullImageBackdrop" role="dialog" aria-modal="true" aria-label={`Full-size ${current.label}`} onClick={() => setFullImageOpen(false)}>
          <button className="fullImageClose" onClick={() => setFullImageOpen(false)} type="button" aria-label="Close full-size image">×</button>
          <figure className="fullImageFrame" onClick={(event) => event.stopPropagation()}>
            <Image src={current.imageUrl} alt={current.label} fill sizes="100vw" unoptimized priority />
            <figcaption>{current.label}</figcaption>
          </figure>
        </div>
      ), document.body)}

      {notice && <div className="consoleNotice">{notice}</div>}
      {journey === "inspiration" ? (
        <>
          {hasGeneratedLooks && (
            <button className="shoppingListLaunch" onClick={onShopping}>
              <span>PRODUCT CATALOG</span><small>Owned products, routines + saved recommendations</small><b>↗</b>
            </button>
          )}
          <div className="consoleModes">
            <button className={mode === "muses" ? "consoleMode consoleModeActive" : "consoleMode"} onClick={() => onMode("muses")}>
              <span>00</span> Muse board
            </button>
            <button className={mode === "makeup" ? "consoleMode consoleModeActive consoleModeMakeup" : "consoleMode consoleModeMakeup"} onClick={() => onMode("makeup")}>
              <span>01</span> Makeup
            </button>
            <button className={mode === "hair" ? "consoleMode consoleModeActive consoleModeHair" : "consoleMode consoleModeHair"} onClick={() => onMode("hair")}>
              <span>02</span> Hair
            </button>
          </div>
          <div className="consoleUtilities consoleUtilitiesSingle">
            <button onClick={onAchieve}>Achieve this look</button>
          </div>
        </>
      ) : (
        <div className="achieveConsoleActions">
          {journey === "shopping" ? (
            <button className="achieveConsoleAction achieveConsoleActionPrimary" onClick={onAchieve}>Achieve this look<span>01</span></button>
          ) : (
            <button className="achieveConsoleAction achieveConsoleActionPrimary" onClick={onShopping}>Go to Product Catalog<span>01</span></button>
          )}
        </div>
      )}
      {inspect && (
        <VariantInspector
          catalog={catalog}
          variant={current}
          onRename={onRename}
          onDelete={current.deletable && current.storedSelfieId
            ? () => onDeleteVariant(current)
            : undefined}
          deleting={deletingVariantId === current.id}
        />
      )}
    </aside>
  );
}

function AnalysisModal({
  analysis,
  representationPreferences,
  onClose,
}: {
  analysis: UserAnalysis;
  representationPreferences: RepresentationTag[];
  onClose: () => void;
}) {
  return (
    <div className="cyberModalBackdrop" role="dialog" aria-modal="true" aria-labelledby="analysis-title">
      <div className="cyberModal analysisModal">
        <button className="cyberModalClose" onClick={onClose} aria-label="Close">×</button>
        <span className="systemLabel">FACIAL ANALYSIS / DETECTED PROFILE</span>
        <h2 id="analysis-title">Your feature map</h2>
        <p className="analysisModalIntro">
          The highlighted signals create 92% of your feature-match score. Skin type also limits candidates to the nearest three-tone window.
        </p>

        <section className="analysisSignalSection analysisPrimarySection">
          <div className="analysisSectionHeading">
            <strong>PRIMARY MATCH SIGNALS</strong>
            <span>92% of feature score</span>
          </div>
          <div className="analysisSignalGrid">
            {PRIMARY_ANALYSIS_FIELDS.map(([key, label]) => (
              <div className="analysisSignal" key={key}>
                <small>{label}</small>
                <strong>{analysisValue(key, analysis[key])}</strong>
              </div>
            ))}
          </div>
        </section>

        <div className="analysisColorReadout">
          <span><i style={{ backgroundColor: analysis.skinColor }} />Detected skin color <b>{analysis.skinColor || "Unavailable"}</b></span>
          <span><i style={{ backgroundColor: analysis.lipColor }} />Detected lip color <b>{analysis.lipColor || "Unavailable"}</b></span>
          <span className="analysisSource">SOURCE / {analysis.source === "youcam" ? "YOUCAM API" : "SAMPLE PROFILE"}</span>
        </div>

        <div className="analysisPreferenceReadout">
          <strong>REPRESENTATION PREFERENCE</strong>
          <span>{representationPreferences.length
            ? representationPreferences.map(representationLabel).join(" · ")
            : "No preference selected"}</span>
          <small>Self-identification · 22% of ranking · at least 3 of 5 when available</small>
        </div>

        <section className="analysisSignalSection">
          <div className="analysisSectionHeading">
            <strong>SECONDARY DETAIL</strong>
            <span>tie-break signals</span>
          </div>
          <div className="analysisSignalGrid analysisSecondaryGrid">
            {SECONDARY_ANALYSIS_FIELDS.map(([key, label]) => (
              <div className="analysisSignal" key={key}>
                <small>{label}</small>
                <strong>{analysisValue(key, analysis[key])}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function TryOnConfirmation({
  catalog,
  selection,
  variants,
  defaultBaseId,
  duplicate,
  generating,
  progressLabel,
  onClose,
  onBaseChange,
  onConfirm,
}: {
  catalog: MuseCatalog;
  selection: InspoSelection;
  variants: SelfieVariant[];
  defaultBaseId: string;
  duplicate?: SelfieVariant;
  generating: boolean;
  progressLabel: string;
  onClose: () => void;
  onBaseChange: (baseId: string) => void;
  onConfirm: (baseId: string, forceFresh: boolean) => void;
}) {
  const kind = selection.recommended.look.kind;
  const eligibleVariants = eligibleBaseVariants(variants, kind);
  const initialBaseId = eligibleVariants.some((variant) => variant.id === defaultBaseId)
    ? defaultBaseId
    : eligibleVariants[0]?.id || "";
  const [baseId, setBaseId] = useState(initialBaseId);
  const [forceFresh, setForceFresh] = useState(false);
  const selected = catalog.assets[selection.selectedAssetId];

  return (
    <div className="cyberModalBackdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="cyberModal">
        <button className="cyberModalClose" onClick={onClose} aria-label="Close">×</button>
        <span className="systemLabel">CONFIRM SIGNAL TRANSFER</span>
        <h2 id="confirm-title">Try this {selection.recommended.look.kind} reference?</h2>
        <p className="modalSubline">Inspired by {selection.recommended.muse.name} · {selection.recommended.look.kind} protocol</p>

        <div className="selectionPreview">
          <figure><NeonAsset asset={selected} alt="Selected inspiration" sizes="360px" /></figure>
          <div>
            <span>YOUR SELECTED INSPO</span>
            <strong>Muse will render the look associated with this reference.</strong>
          </div>
        </div>
        {duplicate && (
          <div className="duplicateAlert">
            <strong>YOU’VE RENDERED THIS LOOK BEFORE</strong>
            <p>This inspiration uses the same {selection.recommended.look.kind} template as <b>{duplicate.label}</b>. Muse will instantly reuse an exact saved result when the base photo also matches.</p>
            <label className="freshRenderToggle">
              <input
                type="checkbox"
                checked={forceFresh}
                onChange={(event) => setForceFresh(event.target.checked)}
              />
              <span>Render a fresh copy anyway</span>
              <small>Uses YouCam credits and takes longer.</small>
            </label>
          </div>
        )}

        <div className="baseThumbnailSelector">
          <div className="baseThumbnailHeading">
            <span>APPLY ON TOP OF</span>
            <small>{eligibleVariants.length} POSSIBLE {eligibleVariants.length === 1 ? "BASE" : "BASES"}</small>
          </div>
          <div className="baseThumbnailRail">
            {eligibleVariants.map((variant) => (
              <button
                className={variant.id === baseId ? "baseThumbnailCard baseThumbnailCardActive" : "baseThumbnailCard"}
                onClick={() => {
                  setBaseId(variant.id);
                  onBaseChange(variant.id);
                }}
                key={variant.id}
                type="button"
              >
                <span className="baseThumbnailImage">
                  <Image src={variant.imageUrl} alt="" fill sizes="92px" unoptimized />
                </span>
                <strong>{variant.label}</strong>
                <small>{variant.makeup ? "MAKEUP" : "NO MAKEUP"}{variant.hair ? " · HAIR" : " · NO HAIR"}</small>
              </button>
            ))}
          </div>
        </div>
        <p className="layeringNote">Muse only shows photos that can accept this layer. Existing makeup can receive hair, and existing hair can receive makeup.</p>
        <button className="confirmTransfer" disabled={generating || !baseId} onClick={() => onConfirm(baseId, forceFresh)}>
          {generating ? progressLabel || "Rendering new branch…" : "Confirm & render with Muse AI"}<span>↗</span>
        </button>
      </div>
    </div>
  );
}

export default function ResultsWorkspace({
  catalog,
  analysis,
  aesthetics,
  representationPreferences,
  savedMatches,
  defaultPhoto,
  onHome,
  onRestart,
  accountName,
  workspaceStorageKey,
  onSignOut,
  onRequireAccount,
  demoBoard,
}: {
  catalog: MuseCatalog;
  analysis: UserAnalysis;
  aesthetics: string[];
  representationPreferences: RepresentationTag[];
  savedMatches?: MuseMatchSnapshot[];
  defaultPhoto?: UserPhoto;
  onHome: () => void;
  onRestart: () => void;
  accountName?: string;
  workspaceStorageKey?: string;
  onSignOut?: () => void;
  onRequireAccount: () => void;
  demoBoard?: DemoBoardSnapshot;
}) {
  const matches = useMemo(() => {
    if (savedMatches?.length) {
      const museById = new Map(catalog.muses.map((muse) => [muse.id, muse]));
      const restored = savedMatches.flatMap((snapshot) => {
        const muse = museById.get(snapshot.museId);
        return muse ? [{
          muse,
          score: snapshot.score,
          featureScore: snapshot.featureScore,
          representationScore: snapshot.representationScore,
          reasons: snapshot.reasons,
        }] : [];
      });
      if (restored.length) return restored;
    }
    return matchMuses(catalog, analysis, representationPreferences, 5);
  }, [analysis, catalog, representationPreferences, savedMatches]);
  const makeupLooks = useMemo(() => recommendLooks(matches, "makeup", aesthetics, 10_000), [aesthetics, matches]);
  const hairLooks = useMemo(() => recommendLooks(matches, "hair", aesthetics, 10_000), [aesthetics, matches]);
  const sampleAsset = catalog.assets[matches[0].muse.introAssetIds[0]];
  const readOnlyDemo = Boolean(demoBoard);
  const demoVariants: SelfieVariant[] = (demoBoard?.selfies || []).map((selfie) => ({
    id: selfie.id,
    label: selfie.label,
    imageUrl: selfie.imageUrl,
    storedSelfieId: selfie.id,
    parentId: selfie.parentId || undefined,
    makeup: selfie.makeup || undefined,
    hair: selfie.hair || undefined,
    sourceKind: selfie.sourceKind,
    provenanceKnown: selfie.sourceKind === "upload" || Boolean(selfie.makeup || selfie.hair),
    deletable: false,
    demo: true,
  }));
  const demoInitialVariant = demoVariants.find((variant) => variant.id === demoBoard?.assessmentSelfieId) || demoVariants[0];
  const [mode, setMode] = useState<WorkspaceMode>("muses");
  const [journey, setJourney] = useState<JourneyMode>("inspiration");
  const [restoredWorkspaceScope, setRestoredWorkspaceScope] = useState<string | null>(null);
  const [activeMuseId, setActiveMuseId] = useState<string | null>(null);
  const [museFilter, setMuseFilter] = useState("all");
  const [keywordFilter, setKeywordFilter] = useState("all");
  const [pending, setPending] = useState<InspoSelection | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deletingVariantId, setDeletingVariantId] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState("");
  const [inspect, setInspect] = useState(false);
  const [notice, setNotice] = useState(readOnlyDemo ? `${demoBoard?.label} sample board · demo only` : defaultPhoto ? "" : "Sample subject loaded.");
  const initialVariantId = demoInitialVariant?.id || defaultPhoto?.storedSelfieId || "original";
  const [variants, setVariants] = useState<SelfieVariant[]>(() => demoInitialVariant
    ? [demoInitialVariant, ...demoVariants.filter((variant) => variant.id !== demoInitialVariant.id)]
    : [{
        id: initialVariantId,
        label: defaultPhoto ? "Current assessment" : "Sample source",
        imageUrl: defaultPhoto?.preview || sampleAsset.imageUrl,
        sourceUrl: defaultPhoto ? undefined : sampleAsset.imageUrl,
        file: defaultPhoto?.file,
        storedSelfieId: defaultPhoto?.storedSelfieId,
        sourceKind: defaultPhoto ? "upload" : undefined,
        provenanceKnown: true,
        deletable: false,
        demo: !defaultPhoto,
      }]);
  const [currentVariantId, setCurrentVariantId] = useState(initialVariantId);
  const currentIndex = Math.max(0, variants.findIndex((variant) => variant.id === currentVariantId));
  const currentVariant = variants[currentIndex];
  const activeLooks = mode === "makeup" ? makeupLooks : hairLooks;
  const keywords = useMemo(() => {
    const counts = new Map<string, number>();
    activeLooks.forEach(({ look }) => look.descriptors.forEach((descriptor) => counts.set(descriptor, (counts.get(descriptor) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([descriptor]) => descriptor);
  }, [activeLooks]);

  useEffect(() => {
    if (!defaultPhoto) return;
    const id = defaultPhoto.storedSelfieId || "original";
    const currentAssessment: SelfieVariant = {
      id,
      label: "Current assessment",
      imageUrl: defaultPhoto.preview,
      file: defaultPhoto.file,
      storedSelfieId: defaultPhoto.storedSelfieId,
      sourceKind: "upload",
      provenanceKnown: true,
      deletable: false,
    };
    setVariants((current) => [currentAssessment, ...current.filter((variant) => variant.id !== id)]);
    setCurrentVariantId(id);
    setNotice("Your most recent front-facing assessment photo is active.");
  }, [defaultPhoto]);

  useEffect(() => {
    if (!workspaceStorageKey) {
      setRestoredWorkspaceScope(null);
      return;
    }
    try {
      const savedWorkspace = window.sessionStorage.getItem(`muse-workspace:${workspaceStorageKey}`);
      if (savedWorkspace) {
        const parsed = JSON.parse(savedWorkspace) as { journey?: unknown; currentVariantId?: unknown };
        if (parsed.journey === "inspiration" || parsed.journey === "achieve" || parsed.journey === "shopping") {
          setJourney(parsed.journey);
        }
        if (typeof parsed.currentVariantId === "string" && parsed.currentVariantId) {
          setCurrentVariantId(parsed.currentVariantId);
        }
      }
    } catch {
      window.sessionStorage.removeItem(`muse-workspace:${workspaceStorageKey}`);
    }
    setRestoredWorkspaceScope(workspaceStorageKey);
  }, [workspaceStorageKey]);

  useEffect(() => {
    if (!workspaceStorageKey || restoredWorkspaceScope !== workspaceStorageKey) return;
    window.sessionStorage.setItem(`muse-workspace:${workspaceStorageKey}`, JSON.stringify({
      journey,
      currentVariantId,
    }));
  }, [currentVariantId, journey, restoredWorkspaceScope, workspaceStorageKey]);

  useEffect(() => {
    if (!accountName || readOnlyDemo) return;
    let cancelled = false;
    void loadMuseSelfies()
      .then((selfies) => {
        if (cancelled) return;
        const library: SelfieVariant[] = selfies.map((selfie) => ({
          id: selfie.id,
          label: selfie.label,
          imageUrl: selfie.imageUrl,
          storedSelfieId: selfie.id,
          parentId: selfie.parentId || undefined,
          makeup: selfie.makeup || undefined,
          hair: selfie.hair || undefined,
          sourceKind: selfie.sourceKind,
          provenanceKnown: selfie.sourceKind === "upload" || Boolean(selfie.makeup || selfie.hair),
          deletable: selfie.deletable,
        }));
        if (!library.length) return;
        setVariants(library);
        setCurrentVariantId((current) => library.some((variant) => variant.id === current)
          ? current
          : defaultPhoto?.storedSelfieId && library.some((variant) => variant.id === defaultPhoto.storedSelfieId)
            ? defaultPhoto.storedSelfieId
            : library[0].id);
      })
      .catch((error) => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Your photo library could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [accountName, defaultPhoto?.storedSelfieId, readOnlyDemo, workspaceStorageKey]);

  const changeMode = (nextMode: WorkspaceMode) => {
    setJourney("inspiration");
    setMode(nextMode);
    setMuseFilter("all");
    setKeywordFilter("all");
    setNotice("");
  };

  const restartExperience = () => {
    if (workspaceStorageKey) window.sessionStorage.removeItem(`muse-workspace:${workspaceStorageKey}`);
    onRestart();
  };

  const duplicate = pending ? variants.find((variant) => {
    const applied = pending.recommended.look.kind === "makeup" ? variant.makeup : variant.hair;
    return applied?.templateAssetId === pending.recommended.look.templateAssetId;
  }) : undefined;

  const deleteVariant = async (variant: SelfieVariant) => {
    if (readOnlyDemo) return onRequireAccount();
    if (!variant.storedSelfieId || !variant.deletable) return;
    if (!window.confirm(`Delete ${variant.label}? This removes the saved image from your Muse library.`)) return;
    setDeletingVariantId(variant.id);
    try {
      await deleteMuseSelfie(variant.storedSelfieId);
      const remaining = variants.filter((candidate) => candidate.id !== variant.id);
      const fallback = remaining.find((candidate) => candidate.id === variant.parentId) || remaining[0];
      setVariants(remaining);
      if (currentVariantId === variant.id && fallback) setCurrentVariantId(fallback.id);
      setInspect(false);
      setNotice(`${variant.label} was deleted from your Muse library.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${variant.label} could not be deleted.`);
    } finally {
      setDeletingVariantId(null);
    }
  };

  const generateVariant = async (selection: InspoSelection, baseId: string, forceFresh: boolean) => {
    if (readOnlyDemo) return onRequireAccount();
    const base = variants.find((variant) => variant.id === baseId);
    if (!base) return;
    const kind = selection.recommended.look.kind;
    if ((kind === "makeup" && base.makeup) || (kind === "hair" && base.hair)) {
      setNotice(`That photo already has a ${kind} layer. Choose one of the available bases instead.`);
      return;
    }
    setCurrentVariantId(base.id);
    setPending(null);
    setGenerating(true);
    setRenderProgress("Starting your render…");
    setNotice("Starting your render…");
    try {
      const highestLookNumber = variants.reduce((highest, variant) => {
        const match = variant.label.match(/^Look #(\d+)$/i);
        return Math.max(highest, match ? Number(match[1]) : 0);
      }, 0);
      const outputLabel = `Look #${highestLookNumber + 1}`;
      const applied: AppliedLookProvenance = {
        kind,
        lookId: selection.recommended.look.id,
        lookLabel: selection.recommended.look.label,
        museName: selection.recommended.muse.name,
        selectedAssetId: selection.selectedAssetId,
        templateAssetId: selection.recommended.look.templateAssetId,
      };
      const nextMakeup = kind === "makeup" ? applied : base.makeup;
      const nextHair = kind === "hair" ? applied : base.hair;
      const form = new FormData();
      form.append("kind", kind);
      const templateAsset = catalog.assets[selection.recommended.look.templateAssetId];
      const templateUrl = new URL(
        templateAsset.transferImageUrl || templateAsset.imageUrl,
        window.location.origin,
      ).toString();
      form.append("referenceUrl", templateUrl);
      form.append("outputLabel", outputLabel);
      form.append("forceFresh", String(forceFresh));
      form.append("makeup", JSON.stringify(nextMakeup || null));
      form.append("hair", JSON.stringify(nextHair || null));
      if (base.storedSelfieId) form.append("storedSelfieId", base.storedSelfieId);
      else if (base.file) form.append("photo", base.file);
      else if (base.sourceUrl) form.append("sourceUrl", base.sourceUrl);
      else throw new Error("This branch no longer has a renderable source. Start from the original selfie.");

      const response = await fetch("/api/try-on", { method: "POST", body: form });
      let payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The transfer could not be completed.");

      let jobToken = "";
      if (payload.status === "queued") {
        jobToken = String(payload.jobToken || "");
        if (!jobToken) throw new Error("Muse could not track this render.");
        setRenderProgress("Render queued…");
        setNotice("Render queued. Keep exploring—your new look will appear here when it is ready.");

        for (let attempt = 0; attempt < 120; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, attempt < 12 ? 500 : 1_000));
          const statusResponse = await fetch(`/api/try-on/status?token=${encodeURIComponent(jobToken)}`, {
            cache: "no-store",
          });
          const statusPayload = await statusResponse.json();
          if (!statusResponse.ok) throw new Error(statusPayload.error || "Muse lost contact with this render.");
          if (statusPayload.status === "failed") throw new Error(statusPayload.error || "The transfer could not be completed.");
          if (statusPayload.status === "complete") {
            payload = statusPayload;
            break;
          }
          const phase = String(statusPayload.phase || "YouCam is rendering your look…");
          setRenderProgress(phase);
          setNotice(phase);
        }
        if (payload.status !== "complete") throw new Error("This render is taking longer than expected. Please try again.");
      }
      const id = crypto.randomUUID();
      const next: SelfieVariant = {
        id,
        label: outputLabel,
        imageUrl: payload.resultUrl || base.imageUrl,
        sourceUrl: payload.storedSelfieId ? undefined : payload.resultUrl || base.sourceUrl,
        file: payload.resultUrl ? undefined : base.file,
        storedSelfieId: payload.storedSelfieId,
        parentId: base.id,
        makeup: nextMakeup,
        hair: nextHair,
        sourceKind: "generated",
        provenanceKnown: true,
        deletable: true,
        demo: !payload.resultUrl,
      };
      setVariants((current) => [...current, next]);
      setCurrentVariantId(id);
      setPending(null);
      setInspect(true);
      setNotice(payload.resultUrl
        ? payload.cached
          ? `${next.label} loaded instantly from your saved Muse renders.`
          : `${next.label} is ready. Saving it privately in the background…`
        : `${next.label} composition saved. Add the YouCam key to render the visual transformation.`);

      if (payload.resultUrl && !payload.storedSelfieId && jobToken) {
        void fetch("/api/try-on/persist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: jobToken }),
        })
          .then(async (persistResponse) => {
            const persisted = await persistResponse.json();
            if (!persistResponse.ok) throw new Error(persisted.error || "This look could not be saved.");
            setVariants((current) => current.map((variant) => variant.id === id
              ? {
                ...variant,
                imageUrl: persisted.resultUrl,
                sourceUrl: undefined,
                storedSelfieId: persisted.storedSelfieId,
              }
              : variant));
            setNotice(`${next.label} rendered from ${base.label} and saved privately.`);
          })
          .catch((error) => {
            setNotice(error instanceof Error
              ? `${next.label} is visible, but Muse could not save it yet: ${error.message}`
              : `${next.label} is visible, but Muse could not save it yet.`);
          });
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The transfer could not be completed.");
    } finally {
      setGenerating(false);
      setRenderProgress("");
    }
  };

  return (
    <main className="cyberResults">
      <header className="cyberHeader">
        <button onClick={onHome} className="cyberHome"><CyberMark /></button>
        <div className="headerTelemetry">
          <span>PROFILE / {analysis.faceShape.toUpperCase()}</span>
          <span>SKIN / F{analysis.fitzpatrick}</span>
          <span className="onlinePulse">SYSTEM ONLINE</span>
        </div>
        <div className="cyberAccountActions">
          <button className="recalibrate facialAnalysisHeaderButton" onClick={() => setAnalysisOpen(true)}><span>View </span>Facial analysis</button>
          <button className="recalibrate" onClick={readOnlyDemo ? onRequireAccount : restartExperience}>{readOnlyDemo ? "Create your Muse" : "Recalibrate"}</button>
          {accountName && onSignOut && (
            <button className="cyberAccount" onClick={onSignOut} title="Sign out of Muse">
              <span>@{accountName}</span><strong>Sign out</strong>
            </button>
          )}
        </div>
      </header>

      <div className="workspaceGrid">
        <div className="workspaceMain">
          {journey !== "inspiration" ? (
            <AchieveWorkspace
              journey={journey}
              catalog={catalog}
              analysis={analysis}
              variants={variants}
              currentVariant={currentVariant}
              onSelectVariant={setCurrentVariantId}
              onReturn={() => {
                setInspect(false);
                setJourney("inspiration");
              }}
              demoBoard={demoBoard}
              readOnly={readOnlyDemo}
              onDemoBlocked={onRequireAccount}
            />
          ) : (
            <>
              {mode === "muses" ? (
                <MuseCollage catalog={catalog} matches={matches} activeMuseId={activeMuseId} />
              ) : (
                <StyleCollage
                  catalog={catalog}
                  kind={mode}
                  looks={activeLooks}
                  museFilter={museFilter}
                  keywordFilter={keywordFilter}
                  onSelect={(selection) => {
                    if (readOnlyDemo || !accountName) {
                      onRequireAccount();
                      return;
                    }
                    const availableBases = eligibleBaseVariants(variants, selection.recommended.look.kind);
                    const selectedBase = availableBases.find((variant) => variant.id === currentVariant.id) || availableBases[0];
                    if (!selectedBase) {
                      setNotice(`No saved photo can accept another ${selection.recommended.look.kind} layer.`);
                      return;
                    }
                    setCurrentVariantId(selectedBase.id);
                    setPending(selection);
                  }}
                />
              )}

              {mode === "muses" ? (
                <nav className="museCommandDock" aria-label="Filter by muse">
                  <button className={!activeMuseId ? "museCommand museCommandActive" : "museCommand"} onClick={() => setActiveMuseId(null)}>
                    <span>ALL</span><strong>Combined matrix</strong><small>5 signals</small>
                  </button>
                  {matches.map((match, index) => (
                    <button
                      className={activeMuseId === match.muse.id ? "museCommand museCommandActive" : "museCommand"}
                      onClick={() => setActiveMuseId(activeMuseId === match.muse.id ? null : match.muse.id)}
                      key={match.muse.id}
                    >
                      <span>0{index + 1}</span><strong>{match.muse.name}</strong><small>{match.score}% match</small>
                    </button>
                  ))}
                </nav>
              ) : (
                <div className="styleCommandDock">
                  <div className="filterProtocol">
                    <span>MUSE</span>
                    <button className={museFilter === "all" ? "active" : ""} onClick={() => setMuseFilter("all")}>All five</button>
                    {matches.map((match) => (
                      <button className={museFilter === match.muse.id ? "active" : ""} onClick={() => setMuseFilter(match.muse.id)} key={match.muse.id}>{match.muse.name}</button>
                    ))}
                  </div>
                  <div className="filterProtocol">
                    <span>KEYWORD</span>
                    <button className={keywordFilter === "all" ? "active" : ""} onClick={() => setKeywordFilter("all")}>All signals</button>
                    {keywords.map((keyword) => (
                      <button className={keywordFilter === keyword ? "active" : ""} onClick={() => setKeywordFilter(keyword)} key={keyword}>{keyword}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <SelfieConsole
          catalog={catalog}
          variants={variants}
          currentIndex={currentIndex}
          inspect={inspect}
          mode={mode}
          generating={generating}
          notice={notice}
          onNavigate={(index) => {
            setCurrentVariantId(variants[index].id);
            setInspect(false);
          }}
          onMode={changeMode}
          onInspect={(index) => {
            const nextVariantId = variants[index].id;
            if (nextVariantId === currentVariantId) {
              setInspect((current) => !current);
              return;
            }
            setCurrentVariantId(nextVariantId);
            setInspect(true);
          }}
          onRename={(label) => setVariants((current) => current.map((variant) => variant.id === currentVariant.id ? { ...variant, label } : variant))}
          onDeleteVariant={(variant) => void deleteVariant(variant)}
          deletingVariantId={deletingVariantId}
          journey={journey}
          hasGeneratedLooks={variants.some((variant) => variant.sourceKind === "generated")}
          onAchieve={() => {
            setInspect(false);
            setJourney("achieve");
          }}
          onShopping={() => {
            setInspect(false);
            setJourney("shopping");
          }}
        />
      </div>

      <footer className="cyberFooter">
        <span>FEATURES ARE COORDINATES, NOT LIMITS.</span>
        <span>{catalog.stats.assets} REFERENCES / {catalog.stats.looks} STYLE SIGNALS / CATALOG {catalog.version}</span>
      </footer>

      {pending && (
        <TryOnConfirmation
          key={`${pending.recommended.look.kind}-${pending.recommended.look.id}-${pending.selectedAssetId}`}
          catalog={catalog}
          selection={pending}
          variants={variants}
          defaultBaseId={currentVariant.id}
          duplicate={duplicate}
          generating={generating}
          progressLabel={renderProgress}
          onClose={() => !generating && setPending(null)}
          onBaseChange={setCurrentVariantId}
          onConfirm={(baseId, forceFresh) => generateVariant(pending, baseId, forceFresh)}
        />
      )}
      {analysisOpen && (
        <AnalysisModal
          analysis={analysis}
          representationPreferences={representationPreferences}
          onClose={() => setAnalysisOpen(false)}
        />
      )}
    </main>
  );
}
