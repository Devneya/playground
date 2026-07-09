import {imageDataURLtoFile} from "./logic/utils";
import {Image} from "openai/resources";

export function mimeToExtension(mime: string): string | null {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "png",
    "image/jpg": "png",
    "image/webp": "png",

    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "webm",

    "application/pdf": "pdf",
    "application/json": "json",
  };

  return map[mime] ?? null;
}

export function mimeFromType(
  type: "image" | "pdf" | "audio" | "text"
): string {
  switch (type) {
    case "image":
      return "image/png";

    case "pdf":
      return "application/pdf";

    case "audio":
      return "audio/mpeg";

    default:
      return "application/octet-stream";
  }
}

/**
 * Uploads a file (image, audio, or pdf) to the server.
 * @param input - The file input, either an OpenAI Image object or a Blob.
 * @param filename - The name of the file to be uploaded.
 * @param id - A unique identifier for the file.
 * @param access_token - The access token for authorization.
 * @returns A promise that resolves to null on success or an Error object on failure.
 */
export async function uploadFile(
  input: Image | Blob,
  filename: string,
  id: string,
  access_token: string
) {
  try {
    const form = new FormData();
    form.append("id", id);

    let file: File;
    if (
      typeof input === "object" &&
      input !== null &&
      "b64_json" in input &&
      input.b64_json
    ) {
      file = imageDataURLtoFile(
        "data:image/png;base64," + input.b64_json,
        `${filename}.png`
      );
    } else if (input instanceof Blob) {
      const extension = mimeToExtension(input.type);
      if (!extension) {
        throw new Error(`Unsupported mime type: ${input.type}`);
      }
      file = new File([input], `${filename}.${extension}`, {
        type: input.type,
      });
    } else {
      throw new Error("Unsupported input type");
    }
    form.append("file", file);

    const response = await fetch(`${import.meta.env.VITE_PROXY_URL}/upload_file`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + access_token,
      },
      body: form,
    });
    if (!response.ok) {
      return new Error(`Failed to upload file: ${response.statusText}`);
    }
    return null;
  } catch (error) {
    console.log(error);
    return error as Error;
  }
}

/**
 * Downloads a file from the server.
 * @param filename - The name of the file to be downloaded with user id.
 * @param useCacheBusting - Optional flag to add cache-busting parameters (timestamp and no-cache headers). Default: false.
 * @returns A promise that resolves to a Blob object on success or an Error object on failure.
 */
export async function downloadFile(filename: string, useCacheBusting: boolean = false): Promise<Blob | Error> {
  try {
    let url = `${import.meta.env.VITE_STORAGE_URL}/${filename}`;
    const headers: HeadersInit = {};

    if (useCacheBusting) {
      const timestamp = Date.now();
      url = `${url}?t=${timestamp}`;
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      headers["Pragma"] = "no-cache";
      headers["Expires"] = "0";
    }
    const response = await fetch(
      url,
      {
        method: "GET",
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const blob = await response.blob();
    return blob;
  } catch (error) {
    return error as Error;
  }
}

/**
 * Deletes a file from the server.
 * @param access_token - The access token for authorization.
 * @param path - The path of the file to be deleted.
 * @returns A promise that resolves to the server's response on success or an Error object on failure.
 */
export async function deleteFile(
  access_token: string,
  path: string
): Promise<Response | Error> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_PROXY_URL}/delete_file`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + access_token,
        },
        body: JSON.stringify({path: path}),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete file: ${response.statusText}`);
    }

    return response;
  } catch (error) {
    return error as Error;
  }
}
