import OpenAI from "openai";
import {RequestOptions} from "openai/core";
import {ImageGenerateParams} from "openai/resources";
import {ChatCompletionCreateParamsBase} from "openai/resources/chat/completions";
import {TextModel} from "./interfaces";
import {ResponseCreateParams} from "openai/resources/responses/responses";

export function chatCompletionRequestCallback(name: string) {
  return (
    client: OpenAI,
    body: Partial<ChatCompletionCreateParamsBase>,
    options?: RequestOptions
  ) => {
    return client.chat.completions.create(
      {
        ...body,
        model: name,
        messages: body.messages ?? [],
      },
      options
    );
  };
}

export function responsesRequestCallback(modelName: string) {
  return (
    client: OpenAI,
    body: Partial<ResponseCreateParams>,
    options?: RequestOptions
  ) => {
    return client.responses.create(
      {
        ...body,
        model: modelName,
        input: body.input ?? [],
      },
      options
    );
  };
}

export async function uploadFileToOpenAI(
  client: OpenAI,
  file: File,
  model: TextModel,
): Promise<string> {
  const uploaded = await client.files.create({
      file,
      purpose: "user_data",
      // @ts-expect-error LiteLLM field
      target_model_names: model.name,
    },
  );
  return uploaded.id
}

export function imageRequestCallback(
  name: string,
  addResponseFormat: boolean = true
) {
  return (
    client: OpenAI,
    body: Partial<ImageGenerateParams>,
    options?: RequestOptions
  ) => {
    if (addResponseFormat) {
      return client.images.generate(
        {
          ...body,
          model: name,
          prompt: body.prompt ?? "",
          response_format: "b64_json",
        },
        options
      );
    } else {
      return client.images.generate(
        {
          ...body,
          model: name,
          prompt: body.prompt ?? "",
        },
        options
      );
    }
  };
}

export function transcriptionRequestCallback(modelName: string) {
  return (
    client: OpenAI,
    body: {
      file: File;
      response_format?: "json" | "verbose_json";
    }
  ) => {
    return client.audio.transcriptions.create(
      {
        file: body.file,
        model: modelName,
      }
    );
  };
}

function datalabUrlToLiteLLM(datalabUrl: string) {
  const u = new URL(datalabUrl);
  return `${import.meta.env.VITE_LITELLM_URL}${u.pathname}${u.search}`;
}

const waitForOCRResult = async (
  datalabCheckUrl: string,
  virtualKey: string,
  interval = 2000,
  timeout = 60_000
) => {
  const start = Date.now();
  const checkUrl = datalabUrlToLiteLLM(datalabCheckUrl);

  while (true) {
    if (Date.now() - start > timeout) {
      throw new Error("OCR timeout");
    }

    const resp = await fetch(checkUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${virtualKey}`,
      }
    });
    if (!resp.ok) {
      throw new Error(`OCR check failed with status ${resp.status}`);
    }
    const result = await resp.json() as any;
    if (!result) {
      throw new Error("Empty OCR response");
    }
    if (result.status === "complete") {
      return result;
    }
    if (result.status === "failed") {
      throw new Error(result.error || "OCR failed");
    }
    await new Promise(r => setTimeout(r, interval));
  }
};

export async function pdfOCRRequestCallback(formData: FormData, virtualKey: string) {
  const initResp = await fetch(datalabUrlToLiteLLM("https://www.datalab.to/api/v1/marker"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${virtualKey}`,
    },
    body: formData,
  });

  if (!initResp.ok) {
    throw new Error("Failed to start OCR");
  }

  const initData = await initResp.json() as any;
  if (!initData.success) {
    throw new Error(initData.error ?? "Failed to start OCR");
  }

  const finalResult = await waitForOCRResult(
    initData.request_check_url,
    virtualKey
  );

  return finalResult;
}
