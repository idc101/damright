import React, { useState, useEffect, useRef, useCallback } from "react";
import { Photo } from "../../types";
import { generateKenBurnsState, KenBurnsState } from "../../utils/kenBurns";
import { filenameToDescription, formatExifDate } from "../../utils/slideshow";
import {
  recordPhotoSeen,
  shufflePhotosWithRecency,
  isInSleepWindow,
} from "../../utils/slideshowHistory";
import { useApi } from "../../services/ApiProvider";
import { MarkdownReader } from "../common/MarkdownReader";
import "./SlideshowView.css";

interface SlideshowViewProps {
  photos: Photo[];
  interval: number; // in seconds
  kenBurns: boolean;
  onClose: () => void;
  picturesBase?: string;
  shuffle?: boolean;
  story?: boolean;
  sleepMode?: boolean;
  sleepStart?: string;
  sleepEnd?: string;
  onRefreshPhotos?: () => Promise<void>;
}

interface ImageLayerState {
  photo: Photo | null;
  src: string;
  isActive: boolean;
  isInitial: boolean;
  isPortrait: boolean;
  isKenBurnsActive: boolean;
  baseWidth: number;
  baseHeight: number;
  state1: KenBurnsState | null;
  state2: KenBurnsState | null;
}

export const SlideshowView: React.FC<SlideshowViewProps> = ({
  photos,
  interval,
  kenBurns,
  onClose,
  picturesBase = "",
  shuffle = true,
  story = true,
  sleepMode = false,
  sleepStart = "21:00",
  sleepEnd = "06:30",
  onRefreshPhotos,
}) => {
  const api = useApi();
  const [photoQueue, setPhotoQueue] = useState<Photo[]>([]);
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const [currentSlideNum, setCurrentSlideNum] = useState<number>(-1);
  const [clockTime, setClockTime] = useState<string>("");
  const [isSleeping, setIsSleeping] = useState<boolean>(false);
  const [wakeUntil, setWakeUntil] = useState<number>(0);
  const sleepPausedTsRef = useRef<number | null>(null);
  const prevPhotoIdsRef = useRef<string>("");

  // Layers for A/B crossfading
  const [layerA, setLayerA] = useState<ImageLayerState>({
    photo: null,
    src: "",
    isActive: false,
    isInitial: false,
    isPortrait: false,
    isKenBurnsActive: false,
    baseWidth: 0,
    baseHeight: 0,
    state1: null,
    state2: null,
  });

  const [layerB, setLayerB] = useState<ImageLayerState>({
    photo: null,
    src: "",
    isActive: false,
    isInitial: false,
    isPortrait: false,
    isKenBurnsActive: false,
    baseWidth: 0,
    baseHeight: 0,
    state1: null,
    state2: null,
  });

  // Keep track of which layer is currently visually active
  const activeLayerRef = useRef<"A" | "B" | null>(null);

  // References to the image elements to trigger Web Animations API
  const imgARef = useRef<HTMLImageElement>(null);
  const imgBRef = useRef<HTMLImageElement>(null);
  
  // Track active animations so they can be cancelled
  const animationARef = useRef<Animation | null>(null);
  const animationBRef = useRef<Animation | null>(null);

  // Lock body overflow to eliminate scrollbars and page scrolling when slideshow is active
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Shuffle or order photos on mount or when photo list changes
  useEffect(() => {
    if (photos.length > 0) {
      const photoIds = photos.map((p) => p.id).join(",");
      if (photoIds !== prevPhotoIdsRef.current) {
        prevPhotoIdsRef.current = photoIds;
        setPhotoQueue(shuffle ? shufflePhotosWithRecency(photos) : [...photos]);
        setTimeOffset(0);
        setCurrentSlideNum(-1);
        activeLayerRef.current = null;
      }
    }
  }, [photos, shuffle]);

  // Periodic background refresh for 24/7 TV kiosk mode
  useEffect(() => {
    if (!onRefreshPhotos) return;
    const intervalId = setInterval(() => {
      onRefreshPhotos().catch((err) => console.error("Slideshow photo refresh error:", err));
    }, 3600 * 1000);
    return () => clearInterval(intervalId);
  }, [onRefreshPhotos]);

  // Update clock and sleep status every second
  useEffect(() => {
    const updateClockAndSleep = () => {
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, "0");
      const minutes = now.getMinutes().toString().padStart(2, "0");
      setClockTime(`${hours}:${minutes}`);

      if (sleepMode) {
        const inWindow = isInSleepWindow(sleepStart, sleepEnd, now);
        const isManuallyAwake = Date.now() < wakeUntil;
        const shouldSleep = inWindow && !isManuallyAwake;

        setIsSleeping((wasSleeping) => {
          if (shouldSleep && !wasSleeping) {
            sleepPausedTsRef.current = Math.floor(Date.now() / 1000);
          } else if (!shouldSleep && wasSleeping && sleepPausedTsRef.current !== null) {
            const sleptSec = Math.floor(Date.now() / 1000) - sleepPausedTsRef.current;
            setTimeOffset((prev) => prev - sleptSec);
            sleepPausedTsRef.current = null;
          }
          return shouldSleep;
        });
      } else {
        setIsSleeping(false);
      }
    };
    updateClockAndSleep();
    const intervalId = setInterval(updateClockAndSleep, 1000);
    return () => clearInterval(intervalId);
  }, [sleepMode, sleepStart, sleepEnd, wakeUntil]);

  const isMarkdownPhoto = (p: Photo | null | undefined) => Boolean(p && (p.mime_type === "text/markdown" || p.path.toLowerCase().endsWith(".md") || p.path.toLowerCase().endsWith(".markdown")));

  // Slide transition logic
  const transitionToPhoto = useCallback(
    async (photo: Photo) => {
      if (isMarkdownPhoto(photo)) {
        recordPhotoSeen(photo.id);
        const isInitial = activeLayerRef.current === null;
        const nextLayer = activeLayerRef.current === "A" ? "B" : "A";
        const emptyLayerState: ImageLayerState = {
          photo,
          src: "",
          isActive: true,
          isInitial,
          isPortrait: false,
          isKenBurnsActive: false,
          baseWidth: 0,
          baseHeight: 0,
          state1: null,
          state2: null,
        };

        if (nextLayer === "A") {
          setLayerA(emptyLayerState);
          setLayerB((prev) => ({ ...prev, isActive: false, isInitial: false }));
          activeLayerRef.current = "A";
        } else {
          setLayerB(emptyLayerState);
          setLayerA((prev) => ({ ...prev, isActive: false, isInitial: false }));
          activeLayerRef.current = "B";
        }
        return;
      }

      let src: string;
      try {
        src = (await api.getPreviewUrl(photo, false)) || api.getAssetUrl(photo.thumb_path || photo.path);
      } catch {
        src = api.getAssetUrl(photo.thumb_path || photo.path);
      }

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Preload image to get natural dimensions
      const img = new Image();
      img.onerror = () => {
        // Advance past failed image
        setTimeOffset((prev) => prev + interval);
      };
      img.onload = () => {
        // Record photo as seen in persistent history
        recordPhotoSeen(photo.id);

        const aspect = img.naturalWidth / img.naturalHeight;
        const screenAspect = vw / vh;

        let baseWidth: number;
        let baseHeight: number;
        if (aspect > screenAspect) {
          baseHeight = vh;
          baseWidth = vh * aspect;
        } else {
          baseWidth = vw;
          baseHeight = vw / aspect;
        }

        const isPortrait =
          img.naturalHeight > img.naturalWidth ||
          (photo.orientation !== undefined &&
            photo.orientation !== null &&
            [5, 6, 7, 8].includes(photo.orientation));
        const isKenBurnsActive = !isPortrait && kenBurns;
        const isInitial = activeLayerRef.current === null;
        const nextLayer = activeLayerRef.current === "A" ? "B" : "A";

        // Generate states for Ken Burns
        let state1: KenBurnsState | null = null;
        let state2: KenBurnsState | null = null;
        if (isKenBurnsActive) {
          state1 = generateKenBurnsState(baseWidth, baseHeight, vw, vh, photo.faces);
          state2 = generateKenBurnsState(baseWidth, baseHeight, vw, vh, photo.faces);
        }

        // Apply layer updates
        if (nextLayer === "A") {
          setLayerA({
            photo,
            src,
            isActive: true,
            isInitial,
            isPortrait,
            isKenBurnsActive,
            baseWidth,
            baseHeight,
            state1,
            state2,
          });
          setLayerB((prev) => ({ ...prev, isActive: false, isInitial: false }));
          activeLayerRef.current = "A";
        } else {
          setLayerB({
            photo,
            src,
            isActive: true,
            isInitial,
            isPortrait,
            isKenBurnsActive,
            baseWidth,
            baseHeight,
            state1,
            state2,
          });
          setLayerA((prev) => ({ ...prev, isActive: false, isInitial: false }));
          activeLayerRef.current = "B";
        }
      };
      img.src = src;
    },
    [api, kenBurns, interval]
  );

  // Trigger Ken Burns animation / clear inline sizing on Layer A DOM element when layerA state updates
  useEffect(() => {
    if (!layerA.isActive || !layerA.src || !imgARef.current) return;

    if (layerA.isKenBurnsActive && layerA.state1 && layerA.state2) {
      imgARef.current.style.width = `${layerA.baseWidth}px`;
      imgARef.current.style.height = `${layerA.baseHeight}px`;

      if (animationARef.current) animationARef.current.cancel();
      animationARef.current = imgARef.current.animate(
        [
          { transform: `translate(${layerA.state1.tx}px, ${layerA.state1.ty}px) scale(${layerA.state1.S})` },
          { transform: `translate(${layerA.state2.tx}px, ${layerA.state2.ty}px) scale(${layerA.state2.S})` },
        ],
        {
          duration: interval * 1000 + 2000,
          fill: "forwards",
          easing: "ease-in-out",
        }
      );
    } else {
      imgARef.current.style.width = "";
      imgARef.current.style.height = "";
      if (animationARef.current) {
        animationARef.current.cancel();
        animationARef.current = null;
      }
    }
  }, [layerA, interval]);

  // Trigger Ken Burns animation / clear inline sizing on Layer B DOM element when layerB state updates
  useEffect(() => {
    if (!layerB.isActive || !layerB.src || !imgBRef.current) return;

    if (layerB.isKenBurnsActive && layerB.state1 && layerB.state2) {
      imgBRef.current.style.width = `${layerB.baseWidth}px`;
      imgBRef.current.style.height = `${layerB.baseHeight}px`;

      if (animationBRef.current) animationBRef.current.cancel();
      animationBRef.current = imgBRef.current.animate(
        [
          { transform: `translate(${layerB.state1.tx}px, ${layerB.state1.ty}px) scale(${layerB.state1.S})` },
          { transform: `translate(${layerB.state2.tx}px, ${layerB.state2.ty}px) scale(${layerB.state2.S})` },
        ],
        {
          duration: interval * 1000 + 2000,
          fill: "forwards",
          easing: "ease-in-out",
        }
      );
    } else {
      imgBRef.current.style.width = "";
      imgBRef.current.style.height = "";
      if (animationBRef.current) {
        animationBRef.current.cancel();
        animationBRef.current = null;
      }
    }
  }, [layerB, interval]);

  // Time-based checker loop
  const updateImage = useCallback(() => {
    if (photoQueue.length === 0 || isSleeping) return;

    const ts = Math.floor(Date.now() / 1000) + timeOffset;
    const targetSlideNum = Math.floor(ts / interval);

    if (targetSlideNum !== currentSlideNum) {
      setCurrentSlideNum(targetSlideNum);
      
      let index = targetSlideNum % photoQueue.length;
      if (index < 0) {
        index = index + photoQueue.length;
      }
      
      const photo = photoQueue[index];
      transitionToPhoto(photo);
    }
  }, [photoQueue, timeOffset, interval, currentSlideNum, transitionToPhoto, isSleeping]);

  // Run scheduler check every 1s
  useEffect(() => {
    updateImage();
    const intervalId = setInterval(updateImage, 1000);
    return () => clearInterval(intervalId);
  }, [updateImage]);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (isSleeping) {
        // Any key wakes up from sleep for 10 minutes
        setWakeUntil(Date.now() + 10 * 60 * 1000);
        return;
      }

      if (e.key === "ArrowRight") {
        setTimeOffset((prev) => prev + interval);
      } else if (e.key === "ArrowLeft") {
        setTimeOffset((prev) => prev - interval);
      } else if (e.key === "0") {
        setTimeOffset(0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, interval, isSleeping]);

  if (photos.length === 0) {
    return (
      <div className="slideshow-container empty">
        <div className="slideshow-empty-message">
          No photos found matching criteria. Press Esc to exit.
        </div>
      </div>
    );
  }

  // Get active photo to display metadata
  const activePhoto =
    activeLayerRef.current === "B" ? layerB.photo : layerA.photo;
  
  // Format Date and Description
  const formattedDate = formatExifDate(activePhoto?.capture_time);
  const description = activePhoto
    ? filenameToDescription(activePhoto.path, picturesBase)
    : "";

  const blogDescription = activePhoto?.description;
  const blogTitle = activePhoto?.title;

  return (
    <div className="slideshow-container">
      {/* Sleep / Night Mode overlay */}
      {isSleeping && (
        <div
          className="slideshow-sleep-overlay"
          onClick={() => setWakeUntil(Date.now() + 10 * 60 * 1000)}
          data-testid="slideshow-sleep-overlay"
        >
          <div className="slideshow-sleep-clock">{clockTime}</div>
          <div className="slideshow-sleep-hint">
            Night Mode ({sleepStart} – {sleepEnd}) • Click or press any key to wake
          </div>
        </div>
      )}

      {/* Clock overlay */}
      <div className="slideshow-clock">{clockTime}</div>

      {/* Layer A */}
      <div className={`slideshow-layer ${layerA.isActive ? "active" : ""} ${layerA.isInitial ? "initial" : ""}`}>
        {layerA.src && (
          <img
            ref={imgARef}
            src={layerA.src}
            alt=""
            className={
              layerA.isKenBurnsActive
                ? "landscape"
                : layerA.isPortrait
                ? "portrait"
                : "fit-contain"
            }
          />
        )}
      </div>

      {/* Layer B */}
      <div className={`slideshow-layer ${layerB.isActive ? "active" : ""} ${layerB.isInitial ? "initial" : ""}`}>
        {layerB.src && (
          <img
            ref={imgBRef}
            src={layerB.src}
            alt=""
            className={
              layerB.isKenBurnsActive
                ? "landscape"
                : layerB.isPortrait
                ? "portrait"
                : "fit-contain"
            }
          />
        )}
      </div>

      {/* Full-Screen Markdown Story Slide */}
      {isMarkdownPhoto(activePhoto) && (
        <div className="slideshow-markdown-slide active" data-testid="slideshow-markdown-slide">
          <MarkdownReader photo={activePhoto!} variant="slideshow" />
        </div>
      )}

      {/* Book/Journal Story Panel (Left) */}
      {story && blogDescription && !isMarkdownPhoto(activePhoto) && (
        <div className="slideshow-story-card">
          {blogTitle && <span className="slideshow-story-title">{blogTitle}</span>}
          <span className="slideshow-story-text">{blogDescription}</span>
        </div>
      )}

      {/* Glassmorphism Metadata Box */}
      {(formattedDate || description) && !isMarkdownPhoto(activePhoto) && (
        <div className="slideshow-metadata">
          {formattedDate && <span className="slideshow-meta-date">{formattedDate}</span>}
          {formattedDate && description && <br />}
          {description && (
            <span className="slideshow-meta-desc">{description}</span>
          )}
        </div>
      )}
    </div>
  );
};
