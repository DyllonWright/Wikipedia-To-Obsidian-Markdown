import type { ParsedImage, RawSection } from "./types";

export interface ParsedArticle {
	title: string;
	url: string;
	sections: RawSection[];
	images: ParsedImage[];
}

export function parseWikipediaArticle(
	html: string,
	url: string,
	options?: { linkMode?: string; omitReferences?: boolean }
): ParsedArticle;

export function convertTableToMarkdown(
	$: unknown,
	tableEl: unknown,
	baseUrl: string,
	linkMode: string,
	images?: ParsedImage[]
): string;

export function cleanNodeText(
	$: unknown,
	node: unknown,
	baseUrl: string,
	linkMode?: string,
	inTable?: boolean,
	omitReferences?: boolean,
	images?: ParsedImage[]
): string;
