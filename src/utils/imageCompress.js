// Shrinks a photo before it's uploaded (chat images): longest side ≤ maxSize,
// re-encoded as JPEG. GIFs and non-images are returned as they are, and so is
// a file that wouldn't get any smaller.

export const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

export const canvasToJpeg = (canvas, name, quality = 0.82) => new Promise((resolve) => {
  canvas.toBlob(
    (blob) => resolve(blob ? new File([blob], `${name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' }) : null),
    'image/jpeg',
    quality,
  );
});

export async function compressImage(file, { maxSize = 1600, quality = 0.82 } = {}) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs get a white background, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await canvasToJpeg(canvas, file.name, quality);
    return out && (out.size < file.size || scale < 1) ? out : file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
