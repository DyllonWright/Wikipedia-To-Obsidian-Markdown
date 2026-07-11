import type { GeminiAnalysis, ParsedImage } from "./types";

export function generateFallbackAnalysis(
	title: string,
	leadText: string,
	images: ParsedImage[],
	vaultDate: string
): GeminiAnalysis;
