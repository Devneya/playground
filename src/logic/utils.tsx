import { useEffect, useRef, useState } from "react";
import { downloadFile } from "../storage";
import { Canvas } from "./flowStore/interfaces";

/**
 * Returns the current date and time in a formatted string.
 * @returns {string} A formatted date string.
 */
export const getDate = (): string =>
  new Date().toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });







/**
 * Generates a unique filename using a UUID and the current timestamp.
 * @returns {string} A unique filename string.
 */
export function createFilename(): string {
  return `${crypto.randomUUID()}-${Date.now().toString()}`;
}



/**
 * Converts an image data URL to a File object.
 * @param dataurl - The data URL of the image.
 * @param filename - The desired filename for the File object.
 * @returns {File} A File object representing the image.
 */
export function imageDataURLtoFile(dataurl: string, filename: string): File {
  const arr = dataurl.split(",");
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[arr.length - 1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }

  return new File([u8arr], filename, { type: mime });
}

/**
 * Converts a Blob object to a Base64 string.
 * @param blob - The Blob object.
 * @returns {Promise<string>} A promise that resolves to a Base64 string.
 */
export function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function decodeFileIDFromLiteLLM(encodedId: string): string {
  try {
    const decoded = atob(encodedId);
    const match = decoded.match(/llm_output_file_id,(file-[a-zA-Z0-9]+)/);
    if (match?.[1]) {
      return match[1];
    }
    return encodedId;
  } catch {
    return encodedId;
  }
}

export function useAvatar(path?: string) {
  const [url, setUrl] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
    }

    if (!path) {
      setUrl(null);
      prevUrlRef.current = null;
      return;
    }

    downloadFile(path).then((blob) => {
      if (blob instanceof Error) {
        return;
      }
      const newUrl = URL.createObjectURL(blob);
      prevUrlRef.current = newUrl;
      setUrl(newUrl);
    }).catch(console.log);

    return () => {
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = null;
      }
    };
  }, [path]);
  return url;
}

/**
 * Generates the next available canvas name by finding the lowest unused number.
 * For duplicate canvases, uses "OriginalName (Copy N)" format.
 * For new canvases, uses "BaseName N" format.
 * @param canvases - Array of existing canvases to check names against.
 * @param baseName - Base name for new canvases (default: "New Canvas").
 * @param originalName - Original name for duplicate canvases (optional).
 * @returns The next available canvas name.
 */
export const getNextCanvasName = (
  canvases: Canvas[],
  baseName: string = "New Canvas",
  originalName?: string
) => {
  const nameToUse = originalName || baseName;
  const escapedName = nameToUse.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = originalName
    ? new RegExp(`^${escapedName} \\(Copy (\\d+)\\)$`)
    : new RegExp(`^${escapedName} (\\d+)$`);

  const usedNumbers = new Set<number>();
  canvases.forEach(canvas => {
    const match = canvas.name.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num)) {
        usedNumbers.add(num);
      }
    }
  });

  let nextIndex = 1;
  while (usedNumbers.has(nextIndex)) {
    nextIndex++;
  }

  return originalName
    ? `${originalName} (Copy ${nextIndex})`
    : `${baseName} ${nextIndex}`;
};

/**
 * Formats a date string into a human-readable format.
 * @param dateString - The date string to format (ISO string or already formatted).
 * @returns Formatted date string like "Mon, 1 Jan 2026, 12:00".
 */
export const formatCanvasDate = (dateString: string): string => {
  try {
    let date: Date;
    date = new Date(dateString);

    if (isNaN(date.getTime())) {
      return dateString;
    }

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekday = weekdays[date.getDay()];

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];

    const day = date.getDate();
    const year = date.getFullYear();

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${weekday}, ${day} ${month} ${year}, ${hours}:${minutes}`;
  } catch (error) {
    return dateString;
  }
};