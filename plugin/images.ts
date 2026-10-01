import { requestUrl } from "obsidian";
import {
	IMAGE_ACCEPT,
	WIKIMEDIA_USER_AGENT,
	downloadCandidates,
	parseWikimediaUrl,
	sniffImageType
} from "../src/images";
import type { SvgMode } from "./settings";

export interface DownloadedImage {
	data: ArrayBuffer;
	/** Extension without the dot, taken from the bytes, never the URL. */
	ext: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchBytes(url: string): Promise<{ status: number; data: ArrayBuffer | null }> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await requestUrl({
				url,
				method: "GET",
				headers: { "User-Agent": WIKIMEDIA_USER_AGENT, Accept: IMAGE_ACCEPT },
				throw: false
			});
			// Wikimedia rate-limits bursts; one short pause usually clears it.
			if (res.status === 429 && attempt === 0) {
				await sleep(2000);
				continue;
			}
			return { status: res.status, data: res.status === 200 ? res.arrayBuffer : null };
		} catch {
			return { status: 0, data: null };
		}
	}
	return { status: 429, data: null };
}

/**
 * Re-encode raster bytes (PNG, WebP…) as PNG or JPEG with the platform's own
 * image decoder, so it works on desktop and mobile. JPEG gets a white
 * background (no alpha, and transparent SVG art otherwise turns black).
 * Returns null where the platform can't decode or encode.
 */
async function reencode(data: ArrayBuffer, mime: string, target: "png" | "jpg"): Promise<ArrayBuffer | null> {
	try {
		const bitmap = await createImageBitmap(new Blob([data], { type: mime }));
		const canvas = createEl("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		if (target === "jpg") {
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		}
		ctx.drawImage(bitmap, 0, 0);
		bitmap.close();
		const type = target === "jpg" ? "image/jpeg" : "image/png";
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
		return blob ? await blob.arrayBuffer() : null;
	} catch {
		return null;
	}
}

/**
 * Download one article image: try the candidate URLs best-first and keep
 * the first response whose bytes really are an image. HTML error pages
 * (which Wikimedia serves with status 200 on redirects) never reach the vault.
 * A rasterized SVG always lands in the format the SVG setting asks for.
 */
export async function downloadImage(url: string, fileWidth: number, svgMode: SvgMode): Promise<DownloadedImage> {
	const isSvgSource = parseWikimediaUrl(url)?.ext === "svg";
	const tried: string[] = [];

	for (const candidate of downloadCandidates(url, { fileWidth, svgMode })) {
		const { status, data } = await fetchBytes(candidate);
		if (!data) {
			tried.push(`HTTP ${status || "network error"}`);
			continue;
		}
		const kind = sniffImageType(data);
		if (!kind) {
			tried.push("not an image");
			continue;
		}
		if (isSvgSource && svgMode !== "svg" && kind.ext !== "svg" && kind.ext !== svgMode) {
			const converted = await reencode(data, kind.mime, svgMode);
			if (converted) return { data: converted, ext: svgMode };
		}
		return { data, ext: kind.ext };
	}
	throw new Error(`no usable image (${tried.join(", ") || "no candidates"})`);
}
