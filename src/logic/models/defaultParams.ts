import {AudioModel, ImageModel, Model, TextModel} from "./interfaces";
import {ModelConfiguration, ModelLibrary, ModelType} from "./modelLibrary";

const textModel = ModelLibrary.getModelsByType("text")[0] as TextModel;
const imageModel = ModelLibrary.getModelsByType("image")[0] as ImageModel;
const audioModel = ModelLibrary.getModelsByType("audio")[0] as AudioModel;
const pdfModel = ModelLibrary.getModelsByType("pdf")[0] as AudioModel;
export const emptyModificationParams = "{\n\n\n\n\n\n\n\n\n}";

export const defaultModelConfigurations: Record<ModelType, ModelConfiguration> =
  {
    text: {
      type: textModel.type,
      name: textModel.name,
      params: emptyModificationParams,
    },
    image: {
      type: imageModel.type,
      name: imageModel.name,
      params: emptyModificationParams,
    },
    audio: {
      type: audioModel.type,
      name: audioModel.name,
      params: emptyModificationParams,
    },
    pdf: {
      type: pdfModel.type,
      name: pdfModel.name,
      params: emptyModificationParams,
    }
  };

function makeSizeConfig(
  modelNames: string[] = [],
  types: ModelType[] = ["text", "image", "audio"]
): Record<ModelType, ModelConfiguration[]> {

  const result: Record<ModelType, ModelConfiguration[]> = {
    text: [],
    image: [],
    audio: [],
    pdf: [],
  };

  for (const type of types) {
    const models: Model[] = modelNames
      .map(name => ModelLibrary.getModelByName(name))
      .filter(Boolean) as Model[];

    result[type] = models
      .filter(m => m.type === type)
      .map(m => ({
        type: m.type,
        name: m.name,
        params: emptyModificationParams,
      }));
  }
  return result;
}

export const SIZES = ["XS", "S", "M", "L"] as const;
export type Size = (typeof SIZES)[number];

export const XSSizeModelConfiguration = makeSizeConfig([
  "gemma-3n-E4B-it",
  "DeepSeek-R1-Distill-Qwen-14B",
  "gpt-4o",
  "claude-3-haiku-20240307",
  "dall-e-3",
  "FLUX.1-schnell"
]);

export const EmptySizeModelConfiguration = makeSizeConfig([]);

export const modelConfigurationsBySize: Record<Size, Record<ModelType, ModelConfiguration[]>> = {
  XS: XSSizeModelConfiguration,
  S: EmptySizeModelConfiguration,
  M: EmptySizeModelConfiguration,
  L: EmptySizeModelConfiguration
};