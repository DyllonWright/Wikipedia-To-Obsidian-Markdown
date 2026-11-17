export function encodeLinkPath(vaultPath: string): string;

export function resolveImageStyle(imageLinkMode: string, linkMode: string): "wikilink" | "markdown";

export function formatImageEmbed(
	filename: string,
	folder: string,
	style: string,
	width?: number | string
): string;

export function normalizeImageWidth(width: unknown): number;

export function fillImagePlaceholders(
	markdown: string,
	resolve: (url: string, inTable: boolean) => string | undefined
): string;
