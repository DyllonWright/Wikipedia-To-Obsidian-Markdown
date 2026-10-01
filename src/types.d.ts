/* Shared type surface for the CommonJS modules in src/, consumed by the
 * plugin's TypeScript and by typed linting. */

export interface ParsedImage {
	originalUrl: string;
	caption: string;
	/** Original pixel width (data-file-width), 0 when unknown. */
	fileWidth?: number;
	/** Where the image sat: the infobox, a captioned figure, or a gallery. */
	source?: "infobox" | "figure" | "gallery";
}

export interface RawSection {
	id: string;
	title: string;
	level: number;
	elements: SectionElement[];
}

export interface SectionElement {
	type: "p" | "table" | "list" | "image" | "references";
	content: unknown;
	isInfobox?: boolean;
	url?: string;
	caption?: string;
}

export interface ImageSuggestion {
	originalUrl: string;
	suggestedName: string;
	isPoster: boolean;
}

export interface GeminiAnalysis {
	isMovie: boolean;
	movieTitle: string;
	releaseYear: string;
	briefDescription: string;
	imageSuggestions: ImageSuggestion[];
}
