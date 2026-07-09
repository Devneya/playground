import { Provider } from "./interfaces";

import OpenAILogoBig from "../../assets/icons/OpenAI/OpenAILogoBig.svg";
import OpenAILetteringBig from "../../assets/icons/OpenAI/OpenAILogoLetteringBig.svg";
import DeepSeekLogoBig from "../../assets/icons/DeepSeek/DeepSeekLogoBig.svg";
import BlackForestLabsLogoBig from "../../assets/icons/BlackForestLabs/BlackForestLabsLogoBig.svg";
import GoogleLogoBig from "../../assets/icons/Google/GoogleLogoBig.svg";
import AnthropicLogoBig from "../../assets/icons/Anthropic/AnthropicLogoBig.svg";

export const OpenAIProvider: Provider = {
  provider: "OpenAI",
  logoBig: OpenAILogoBig,
  logoLetteringBig: OpenAILetteringBig,
};

export const BlackForestLabs: Provider = {
  provider: "Black Forest Labs",
  logoBig: BlackForestLabsLogoBig,
};
export const DeepSeek: Provider = {
  provider: "DeepSeek",
  logoBig: DeepSeekLogoBig,
};
export const Google: Provider = {
  provider: "Google",
  logoBig: GoogleLogoBig,
};

export const AnthropicProvider: Provider = {
  provider: "Anthropic",
  logoBig: AnthropicLogoBig,
};