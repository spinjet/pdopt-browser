export function download(
  name: string,
  text: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvCell(value: unknown) {
  let s = String(value);
  if (typeof value !== "number" && /^(\s*[=+\-@]|[\t\r])/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}

export function downloadBytes(name: string, bytes: Uint8Array, type: string) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export interface PngSize {
  width: number;
  height: number;
  dpi: number;
}

export function pngSizeSupported(width: number, height: number) {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= 16000 &&
    height <= 16000 &&
    width * height <= 20_000_000
  );
}

function withPngResolution(bytes: Uint8Array, dpi: number) {
  // PNG stores physical resolution in pixels per metre in the pHYs chunk.
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4); // pHYs
  const pixelsPerMetre = Math.round(dpi / 0.0254);
  view.setUint32(8, pixelsPerMetre);
  view.setUint32(12, pixelsPerMetre);
  chunk[16] = 1;
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 17)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(17, ~crc);

  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const firstChunkEnd = 33; // Signature and IHDR.
  const segments = [bytes.subarray(0, firstChunkEnd), chunk];
  for (let offset = firstChunkEnd; offset < bytes.length;) {
    const end = offset + source.getUint32(offset) + 12;
    if (source.getUint32(offset + 4) !== 0x70485973)
      // Replace any existing pHYs.
      segments.push(bytes.subarray(offset, end));
    offset = end;
  }
  const result = new Uint8Array(
    segments.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of segments) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export async function svgToPng(
  svg: string,
  size?: PngSize,
): Promise<Uint8Array> {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const view = root.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
  if (!view || view.length !== 4 || view.some((x) => !Number.isFinite(x)))
    throw new Error("Invalid SVG image dimensions.");
  const width = size?.width ?? Math.ceil(view[2] * 2);
  const height = size?.height ?? Math.ceil(view[3] * 2);
  if (!pngSizeSupported(width, height))
    throw new Error(
      size
        ? "PNG is too large. Reduce the width or resolution, or export SVG."
        : "PNG is too large. Export SVG or omit probabilities.",
    );
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("Could not rasterise the SVG image."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable. Export SVG.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG generation failed."))),
        "image/png",
      ),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return size ? withPngResolution(bytes, size.dpi) : bytes;
  } finally {
    URL.revokeObjectURL(url);
  }
}
