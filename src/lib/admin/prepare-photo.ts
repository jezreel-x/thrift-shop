/**
 * Getting a phone photo ready to upload, in the browser.
 *
 * A phone photo is often 4000px and 3–6MB; nothing on the shop shows one
 * wider than about 1200px. Shrinking it here, before it leaves the phone,
 * makes uploading over mobile data take seconds instead of a minute, and
 * means storage never holds an original nobody sees. The seed script uses the
 * same 2000px limit.
 */

export const MAX_EDGE = 2000;
const QUALITY = 0.85;

/** The size that fits within `max` on its longest edge, never enlarged. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));

  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Lowercase hex, as the storage name uses. */
export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type PreparedPhoto = {
  blob: Blob;
  /** products/<sha-256>.webp — the same photo always gets the same name. */
  pathname: string;
  width: number;
  height: number;
};

/**
 * Decodes, shrinks and encodes one photo, and names it by its content.
 *
 * Rotation from the camera's EXIF is applied while decoding, so a portrait
 * photo does not arrive on its side. WebP where the browser can write it,
 * JPEG where it cannot (older Safari).
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      `${file.name} couldn't be opened. If it's an iPhone HEIC photo, share it as JPEG.`,
    );
  }

  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't prepare photos.");
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  let blob = await encode(canvas, "image/webp");
  // A browser that cannot write WebP quietly hands back PNG instead.
  if (blob.type !== "image/webp") blob = await encode(canvas, "image/jpeg");
  const extension = blob.type === "image/webp" ? "webp" : "jpg";

  const hash = toHex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));

  return { blob, pathname: `products/${hash}.${extension}`, ...size };
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The photo couldn't be encoded."))),
      type,
      QUALITY,
    ),
  );
}
