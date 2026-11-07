import { Face } from "../types";

export interface KenBurnsState {
  S: number;
  tx: number;
  ty: number;
}

/**
 * Calculates the Ken Burns pan & zoom state based on the cover image size, viewport, and face regions.
 *
 * @param baseWidth Width of the image scaled to cover the viewport
 * @param baseHeight Height of the image scaled to cover the viewport
 * @param vw Viewport width
 * @param vh Viewport height
 * @param faces Array of Face objects containing normalized area coordinates
 */
export function generateKenBurnsState(
  baseWidth: number,
  baseHeight: number,
  vw: number,
  vh: number,
  faces?: Face[]
): KenBurnsState {
  const sCover = Math.max(vw / baseWidth, vh / baseHeight);
  // Add 10% to 30% extra zoom for panning freedom
  const S = sCover * (1.1 + Math.random() * 0.2);

  const minTxImg = vw - baseWidth * S;
  const maxTxImg = 0;
  const minTyImg = vh - baseHeight * S;
  const maxTyImg = 0;

  let tx = 0;
  let ty = 0;

  // Filter out faces that lack coordinates
  const validFaces = (faces || []).filter(
    (f) =>
      typeof f.area_x === "number" &&
      typeof f.area_y === "number" &&
      typeof f.area_w === "number" &&
      typeof f.area_h === "number"
  );

  if (validFaces.length > 0) {
    // Map normalized coordinates [0, 1] to base cover dimensions
    // c (X center) = area_x * baseWidth
    // r (Y center) = area_y * baseHeight
    // s (size) = max(area_w, area_h) * baseWidth
    const mappedFaces = validFaces.map((f) => {
      const c = (f.area_x ?? 0.5) * baseWidth;
      const r = (f.area_y ?? 0.5) * baseHeight;
      const s = Math.max(f.area_w ?? 0.1, f.area_h ?? 0.1) * baseWidth;
      return { c, r, s };
    });

    let fLeft = baseWidth;
    let fRight = 0;
    let fTop = baseHeight;
    let fBottom = 0;

    for (const face of mappedFaces) {
      fLeft = Math.min(fLeft, face.c - face.s / 2);
      fRight = Math.max(fRight, face.c + face.s / 2);
      fTop = Math.min(fTop, face.r - face.s / 2);
      fBottom = Math.max(fBottom, face.r + face.s / 2);
    }

    const padding = 50;
    const minTxFace = padding - fLeft * S;
    const maxTxFace = vw - padding - fRight * S;

    const validMinTx = Math.max(minTxImg, minTxFace);
    const validMaxTx = Math.min(maxTxImg, maxTxFace);

    if (validMinTx > validMaxTx) {
      const idealTx = vw / 2 - ((fLeft + fRight) / 2) * S;
      tx = Math.max(minTxImg, Math.min(maxTxImg, idealTx));
    } else {
      tx = validMinTx + Math.random() * (validMaxTx - validMinTx);
    }

    const minTyFace = padding - fTop * S;
    const maxTyFace = vh - padding - fBottom * S;

    const validMinTy = Math.max(minTyImg, minTyFace);
    const validMaxTy = Math.min(maxTyImg, maxTyFace);

    if (validMinTy > validMaxTy) {
      const idealTy = vh / 2 - ((fTop + fBottom) / 2) * S;
      ty = Math.max(minTyImg, Math.min(maxTyImg, idealTy));
    } else {
      ty = validMinTy + Math.random() * (validMaxTy - validMinTy);
    }
  } else {
    // Fallback: Random panning across the entire cover image boundaries
    tx = minTxImg + Math.random() * (maxTxImg - minTxImg);
    ty = minTyImg + Math.random() * (maxTyImg - minTyImg);
  }

  return { S, tx, ty };
}
