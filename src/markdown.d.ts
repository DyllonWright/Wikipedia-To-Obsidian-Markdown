import type { RawSection } from "./types";

export function applyLinkMode(
	markdown: string,
	linkMode: string,
	isInsideTable?: boolean
): string;

export function assembleMarkdown(
	title: string,
	url: string,
	rawSections: RawSection[],
	selectedSectionIds: string[],
	linkMode: string,
	omitReferences: boolean
): string;

export function compressMarkdownSpacing(md: string): string;
