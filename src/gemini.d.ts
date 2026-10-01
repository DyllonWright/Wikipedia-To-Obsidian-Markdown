import type { GeminiAnalysis, ParsedImage } from "./types";
import type { KeyRing } from "./keyring";

export type Transport = (req: {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
	timeoutMs: number;
}) => Promise<{ status: number; text: string }>;

export const PRIMARY_MODEL: string;

export function analyzeMetadataAndImages(opts: {
	title: string;
	leadText: string;
	infoboxText: string;
	images: ParsedImage[];
	vaultDate: string;
	ring: KeyRing | null;
	transport: Transport;
}): Promise<{ analysis: GeminiAnalysis; source: "gemini" | "heuristics"; note: string }>;
