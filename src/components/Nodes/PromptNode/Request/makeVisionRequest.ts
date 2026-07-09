import {ContentAction} from "../../../Buttons/ContentNodeActionButton";
import {downloadFile} from "../../../../storage";
import {pdfToBase64PageChunks} from "../../ContentNode/ResponseField/PdfResponseField";
import OpenAI from "openai";
import {makeMessagesChainForCompletions, makeMessagesChainForPDF,} from "../../../../logic/models/modelLibrary";
import {blobToB64} from "../../../../logic/utils";

type VisionRequestProps = {
  filePath: string;
  action: ContentAction;
  virtualKey: string;
};

export const makeVisionRequest = async (props: VisionRequestProps) => {
  switch (props.action.contentType) {
    case "pdf":
      return await visionPdfRequest(props);
    case "image":
      return await visionImageRequest(props);
    default:
      throw new Error(`Unsupported content type for vision: ${props.action.contentType}`);
  }
};

const visionPdfRequest = async (props: VisionRequestProps) => {
  try {
    if (!props.action.model || props.action.model.type !== "pdf") {
      throw new Error("Invalid model for PDF Vision");
    }

    const blob = await downloadFile(props.filePath);
    if (blob instanceof Error) {
      throw blob;
    }
    const pageChunks = await pdfToBase64PageChunks(blob, 1.5, 4);

    const client = new OpenAI({
      baseURL: `${import.meta.env.VITE_LITELLM_URL || ""}`,
      apiKey: props.virtualKey,
      maxRetries: 0,
      dangerouslyAllowBrowser: true,
    });
    const makeChain = props.action.model.makeMessagesChain ?? makeMessagesChainForPDF;
    const results: string[] = [];

    for (let i = 0; i < pageChunks.length; i++) {
      try {
        const messages = makeChain(pageChunks[i]);
        const requestBody = {
          model: props.action.model.name ?? "nscale/meta-llama/Llama-4-Scout-17B-16E-Instruct",
          messages
        };
        const response = await props.action.model.requestCallback(client, requestBody);

        const text = response.choices[0]?.message?.content ?? "";
        if (text) {
          results.push(text);
        }
      } catch (error) {
        throw new Error(`PDF page chunk ${i + 1} request failed: ${error}`);
      }
    }
    return {
      text: results.join("\n\n"),
    };
  } catch (err) {
    console.error("PDF Vision failed:", err);
    throw new Error(`PDF Vision failed: ${err}`);
  }
};

const visionImageRequest = async (props: VisionRequestProps) => {
  try {
    const blob = await downloadFile(props.filePath);
    if (blob instanceof Error) {
      throw blob;
    }

    const client = new OpenAI({
      baseURL: `${import.meta.env.VITE_LITELLM_URL || ""}`,
      apiKey: props.virtualKey,
      maxRetries: 0,
      dangerouslyAllowBrowser: true,
    });

    const b64String = await blobToB64(blob);
    const messages = makeMessagesChainForCompletions(
      "Extract all text from the attached image",
      [],
      "You are an assistant specialized in understanding images.",
      {type: "image", ref: b64String}
    );

    const requestBody = {
      model: props.action.model.name ?? "nscale/meta-llama/Llama-4-Scout-17B-16E-Instruct",
      messages
    };
    return props.action.model.requestCallback(client, requestBody);
  } catch (err) {
    console.error("Image Vision failed:", err);
    throw new Error(`Image Vision failed: ${err}`);
  }
};
