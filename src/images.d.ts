export const STANDARD_WIDTHS: number[];
export const WIKIMEDIA_USER_AGENT: string;
export const IMAGE_ACCEPT: string;
export function normalizeImageUrl(url: string): string;
export function parseWikimediaUrl(url: string): null | {
	origin: string;
	project: string;
	hashPath: string;
	fileName: string;
	ext: string;
	isThumb: boolean;
	thumbName: string;
};
export function originalFileUrl(url: string): string;
export function downloadCandidates(
	url: string,
	opts?: { fileWidth?: number; svgMode?: "png" | "jpg" | "svg" }
): string[];
export function sniffImageType(data: ArrayBuffer | Uint8Array): null | { ext: string; mime: string };
