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
 * Asks devneya-api to presign an upload for {verified JWT sub}/{filename}
 * and returns the URL to PUT the actual bytes to directly (Garage, not
 * devneya-api — files never pass through our own server). Shared by
 * uploadFile below and flowSaveAndLoad.ts, which has the same two-hop
 * shape for its own snapshot/index files.
 */
export async function presignUpload(
  filename: string,
  access_token: string
): Promise<{ url: string; key: string }> {
  const resp = await fetch(
    `${import.meta.env.VITE_PROXY_URL}/storage/presign-upload`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + access_token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filename }),
    }
  );
  if (!resp.ok) {
    throw new Error(`Failed to presign upload: ${resp.statusText}`);
  }
  return resp.json();
}

/**
 * Asks devneya-api to presign a download for an arbitrary key (no auth —
 * see the /storage/presign-download handler's own doc comment for why) and
 * returns the URL to GET the actual bytes from directly.
 */
export async function presignDownload(
  key: string,
  useCacheBusting: boolean = false
): Promise<string> {
  let presignUrl = `${import.meta.env.VITE_PROXY_URL}/storage/presign-download?key=${encodeURIComponent(key)}`;
  const headers: HeadersInit = {};

  if (useCacheBusting) {
    presignUrl = `${presignUrl}&t=${Date.now()}`;
    headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    headers["Pragma"] = "no-cache";
    headers["Expires"] = "0";
  }

  const resp = await fetch(presignUrl, {
    method: "GET",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
  if (!resp.ok) {
    throw new Error(`Failed to presign download: ${resp.statusText}`);
  }
  const { url } = await resp.json();
  return url;
}

/**
 * Uploads a file (image, audio, or pdf) to the server.
 * @param input - The file input, either an OpenAI Image object or a Blob.
 * @param filename - The name of the file to be uploaded.
 * @param id - Unused: the storage key's user prefix is always derived
 * server-side from the caller's verified JWT, never from this value. Kept
 * as a parameter so every existing call site (which already only ever
 * passes its own session.user.id) doesn't need to change.
 * @param access_token - The access token for authorization.
 * @returns A promise that resolves to null on success or an Error object on failure.
 */
export async function uploadFile(
  input: Image | Blob,
  filename: string,
  _id: string,
  access_token: string
) {
  try {
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

    const { url } = await presignUpload(file.name, access_token);

    const uploadResp = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!uploadResp.ok) {
      return new Error(`Failed to upload file: ${uploadResp.statusText}`);
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
    const url = await presignDownload(filename, useCacheBusting);

    const response = await fetch(url);
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
      `${import.meta.env.VITE_PROXY_URL}/storage/${path}`,
      {
        method: "DELETE",
        headers: {
          Authorization: "Bearer " + access_token,
        },
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
