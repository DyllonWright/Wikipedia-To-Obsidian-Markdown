/* Shared shapes flowing between the pipeline, the modal, and the shared
 * CommonJS modules in src/. */

export interface ParsedImage {
	originalUrl: string;
	caption: string;
}

export interface AnalyzedImage extends ParsedImage {
	suggestedName: string;
	isPoster: boolean;
}

export interface SectionSummary {
	id: string;
	title: string;
	level: number;
	elementCount: number;
}

/** Opaque section payload produced by src/parser.js and consumed verbatim
 *  by src/markdown.js — the plugin passes it through without touching it. */
export interface RawSection {
	id: string;
	title: string;
	level: number;
	elements: unknown[];
}

export interface GeminiAnalysis {
	isMovie: boolean;
	movieTitle: string;
	releaseYear: string;
	briefDescription: string;
	imageSuggestions: Array<{
		originalUrl: string;
		suggestedName: string;
		isPoster: boolean;
	}>;
}

export interface AnalyzedArticle {
	title: string;
	url: string;
	isMovie: boolean;
	movieTitle: string;
	releaseYear: string;
	briefDescription: string;
	sections: SectionSummary[];
	images: AnalyzedImage[];
	rawSections: RawSection[];
}
