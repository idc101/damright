import { Photo } from "../../types";
import { useApi } from "../../services/ApiProvider";
import { memo } from "react";

interface PhotoPreviewProps {
  photo: Photo;
  className?: string;
  isThumbnail?: boolean;
  src?: string;
}

export const PhotoPreview = memo(function PhotoPreview({ photo, className, isThumbnail = true, src: srcOverride }: PhotoPreviewProps) {
  const api = useApi();
  const { exposure } = photo;

  const version = [
    photo.exposure,
    photo.crop_top,
    photo.crop_left,
    photo.crop_bottom,
    photo.crop_right,
    photo.crop_angle,
    photo.portrait_blur,
    photo.orientation,
  ]
    .filter((v) => v !== undefined && v !== null && v !== 0)
    .join("_");

  const src = srcOverride || api.getAssetUrl(isThumbnail ? photo.thumb_path : photo.path, isThumbnail, version || undefined);
  const altText = isThumbnail ? "thumbnail" : "photo preview";

  const style: React.CSSProperties = {
    filter: exposure ? `brightness(${1 + exposure})` : undefined,
    width: isThumbnail ? "100%" : "auto",
    height: isThumbnail ? "100%" : "auto",
    maxWidth: isThumbnail ? undefined : "100%",
    maxHeight: isThumbnail ? undefined : "100%",
    objectFit: "contain" as const,
  };

  return (
    <img
      src={src}
      className={className}
      style={style}
      alt={altText}
      loading={isThumbnail ? "lazy" : "eager"}
      decoding="async"
    />
  );
});
