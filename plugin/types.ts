/* Shapes flowing between the pipeline, the modal, and the shared
 * CommonJS modules in src/. The shared shapes live in src/types.d.ts. */

export type {
	GeminiAnalysis,
	ImageSuggestion,
	ParsedImage,
	RawSection,
	SectionElement
} from "../src/types";

import type { ParsedImage, RawSection } from "../src/types";

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
