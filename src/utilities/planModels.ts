// The models a ChatGPT plan offers, as Codex lists them. No dependencies, so the UI can use it too.
export interface PlanModel {
  id: string;
  label: string;
  efforts: string[];
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** The plan's models as Codex lists them; the model setting also accepts any other id. */
export const PLAN_MODELS: PlanModel[] = [
  { id: "gpt-6-sol", label: "GPT-6 Sol", efforts: [...EFFORTS, "ultra"] },
  { id: "gpt-6-astra", label: "GPT-6 Astra", efforts: [...EFFORTS, "ultra"] },
  { id: "gpt-6-luna", label: "GPT-6 Luna", efforts: EFFORTS },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", efforts: [...EFFORTS, "ultra"] },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", efforts: [...EFFORTS, "ultra"] },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", efforts: EFFORTS },
  { id: "gpt-5.5", label: "GPT-5.5", efforts: ["low", "medium", "high", "xhigh"] },
];
