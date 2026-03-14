/**
 * Composite two images (base and overlay) into a single image
 * @param baseDataUrl - Data URL of the base image (3D viewer)
 * @param overlayDataUrl - Data URL of the overlay image (annotations)
 * @returns Promise<string> - Data URL of the composite image
 */
export async function compositeImages(
    baseDataUrl: string,
    overlayDataUrl: string | null
): Promise<string> {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
        }

        const baseImg = new Image();

        baseImg.onload = () => {
            canvas.width = baseImg.width;
            canvas.height = baseImg.height;

            // Draw base image
            ctx.drawImage(baseImg, 0, 0);

            // If there's an overlay, draw it on top
            if (overlayDataUrl) {
                const overlayImg = new Image();

                overlayImg.onload = () => {
                    ctx.drawImage(overlayImg, 0, 0);
                    resolve(canvas.toDataURL('image/png'));
                };

                overlayImg.onerror = () => {
                    // If overlay fails, just return the base image
                    resolve(canvas.toDataURL('image/png'));
                };

                overlayImg.src = overlayDataUrl;
            } else {
                // No overlay, just return the base image
                resolve(canvas.toDataURL('image/png'));
            }
        };

        baseImg.onerror = () => {
            reject(new Error('Failed to load base image'));
        };

        baseImg.src = baseDataUrl;
    });
}

/**
 * Convert a data URL to a Blob
 * @param dataUrl - Data URL to convert
 * @returns Blob
 */
export function dataUrlToBlob(dataUrl: string): Blob {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);

    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }

    return new Blob([u8arr], { type: mime });
}

/**
 * Download a data URL as a file
 * @param dataUrl - Data URL to download
 * @param filename - Name of the file to download
 */
export function downloadDataUrl(dataUrl: string, filename: string) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
