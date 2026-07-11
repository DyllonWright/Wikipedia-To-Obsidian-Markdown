/* Type surface for the shared CommonJS modules in src/, which the plugin
 * bundles directly so the server, GUI, and plugin share one implementation. */

declare module "*src/parser" {
	import type { ParsedImage, RawSection } from "./types";
	export function parseWikipediaArticle(
		html: string,
		url: string,
		options?: { linkMode?: string; omitReferences?: boolean }
	): {
		title: string;
		url: string;
		sections: RawSection[];
		images: ParsedImage[];
	};
}

declare module "*src/markdown" {
	import type { RawSection } from "./types";
	export function assembleMarkdown(
		title: string,
		url: string,
		rawSections: RawSection[],
		selectedSectionIds: string[],
		linkMode: string,
		omitReferences: boolean
	): string;
	export function applyLinkMode(markdown: string, linkMode: string, isInsideTable?: boolean): string;
	export function compressMarkdownSpacing(md: string): string;
}

declare module "*src/fallback" {
	import type { GeminiAnalysis, ParsedImage } from "./types";
	export function generateFallbackAnalysis(
		title: string,
		leadText: string,
		images: ParsedImage[],
		vaultDate: string
	): GeminiAnalysis;
}
