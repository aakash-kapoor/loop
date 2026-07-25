export const MAX_FILE_SIZE_BYTES = 500 * 1024; // 500 KB limit per file

/**
 * Reads a File object and converts it to a Base64 Data URL.
 * Smart Quality Preservation Strategy:
 * - Files under 450 KB skip lossy canvas compression entirely to preserve 100% original, pixel-perfect image/UI quality.
 * - Files over 450 KB are resized up to 1600px max dimensions with high quality (0.85) to bring them safely within free-tier limits.
 */
export async function fileToCompressedDataUrl(
  file: File,
  onProgress?: (percent: number) => void,
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.85
): Promise<{ dataUrl: string; finalSize: number }> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File "${file.name}" exceeds the 500 KB size limit for free tier.`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 60); // 0 - 60% during file reading
        onProgress(percent);
      }
    };

    reader.onerror = () => {
      reject(new Error(`Failed to read file "${file.name}".`));
    };

    reader.onload = (event) => {
      const rawDataUrl = event.target?.result as string;
      if (!rawDataUrl) {
        reject(new Error(`Could not generate Data URL for "${file.name}".`));
        return;
      }

      // If file is already under 450 KB, skip canvas re-encoding completely to preserve 100% original quality
      const SKIP_COMPRESSION_SIZE = 450 * 1024;
      const isCompressibleImage =
        file.type.startsWith('image/') &&
        !file.type.includes('svg') &&
        !file.type.includes('gif');

      if (!isCompressibleImage || file.size <= SKIP_COMPRESSION_SIZE) {
        if (onProgress) onProgress(100);
        resolve({ dataUrl: rawDataUrl, finalSize: file.size });
        return;
      }

      // Compress large images (> 450 KB) using high-resolution Canvas
      if (onProgress) onProgress(75);
      const img = new Image();
      img.src = rawDataUrl;

      img.onload = () => {
        let { width, height } = img;

        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          if (onProgress) onProgress(100);
          resolve({ dataUrl: rawDataUrl, finalSize: file.size });
          return;
        }

        // Enable high-quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Preserve PNG/WEBP format for graphics/screenshots with text
        let exportType = 'image/jpeg';
        if (file.type.includes('png')) exportType = 'image/png';
        else if (file.type.includes('webp')) exportType = 'image/webp';

        const compressedDataUrl = canvas.toDataURL(exportType, quality);

        if (onProgress) onProgress(100);

        const approxSize = Math.round((compressedDataUrl.length * 3) / 4);

        // If compressed data URL is larger or degraded, prefer original rawDataUrl if within limits
        if (approxSize > MAX_FILE_SIZE_BYTES && exportType !== 'image/jpeg') {
          // Fallback to high quality JPEG if PNG exceeded limit
          const jpegFallback = canvas.toDataURL('image/jpeg', 0.82);
          const jpegSize = Math.round((jpegFallback.length * 3) / 4);
          resolve({ dataUrl: jpegFallback, finalSize: jpegSize });
          return;
        }

        resolve({ dataUrl: compressedDataUrl, finalSize: approxSize });
      };

      img.onerror = () => {
        if (onProgress) onProgress(100);
        resolve({ dataUrl: rawDataUrl, finalSize: file.size });
      };
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Converts a Base64 Data URL string to a native Blob object.
 * Used for downloading documents (PDF, DOCX, TXT, etc.) cleanly across browsers.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mimeType });
}

/**
 * Triggers browser download for a Blob object with correct filename.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/**
 * Format bytes into human-readable size string (e.g. 1.5 MB, 450 KB)
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
