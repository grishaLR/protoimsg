/** Max file size in bytes (~2 MB) before base64 encoding */
export const MAX_FILE_SIZE = 2 * 1024 * 1024;

const DATA_IMAGE_PREFIX = /^data:image\//;

export function isDataImageUrl(url: string): boolean {
  return DATA_IMAGE_PREFIX.test(url);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsDataURL(file);
  });
}
