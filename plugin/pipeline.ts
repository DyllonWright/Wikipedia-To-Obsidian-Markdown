import { requestUrl } from "obsidian";
import { parseWikipediaArticle } from "../src/parser";
import { analyzeMetadataAndImages } from "./gemini";
import type { AnalyzedArticle } from "./types";

/** Today, formatted for image-name prefixes: "YYYY MM DD". */
export function vaultDateToday(): string {
	return new Date().toISOString().split("T")[0].replace(/-/g, " ");
}

/**
 * The former /api/analyze endpoint, in-process: fetch the article HTML,
 * parse structure and images, then run metadata analysis (Gemini or
 * heuristics) for film detection and image-name suggestions.
 */
export async function analyzeArticle(
	url: string,
	options: { geminiApiKey: string; imageNameDatePrefix: boolean }
): Promise<AnalyzedArticle> {
	const response = await requestUrl({ url, method: "GET", throw: true });
	const html: string = response.text;

	const parsedData = parseWikipediaArticle(html, url, {
		linkMode: "standard",
		omitReferences: false
	});

	// Lead-section text and infobox summary feed the metadata analysis.
	let leadText = "";
	let infoboxText = "";
	const introSection = parsedData.sections.find((s) => s.id === "section-intro");
	if (introSection) {
		leadText = introSection.elements
			.filter((el) => el.type === "p")
			.map((el) => String(el.content))
			.join(" ");
		const infoboxEl = introSection.elements.find((el) => el.type === "table" && el.isInfobox);
		if (infoboxEl) infoboxText = String(infoboxEl.content);
	}

	const activeDate = options.imageNameDatePrefix ? vaultDateToday() : "";

	const analysis = await analyzeMetadataAndImages(
		options.geminiApiKey,
		parsedData.title,
		leadText,
		infoboxText,
		parsedData.images,
		activeDate
	);

	return {
		title: parsedData.title,
		url: parsedData.url,
		isMovie: analysis.isMovie,
		movieTitle: analysis.movieTitle || parsedData.title,
		releaseYear: analysis.releaseYear || "",
		briefDescription: analysis.briefDescription || "",
		sections: parsedData.sections.map((s) => ({
			id: s.id,
			title: s.title,
			level: s.level,
			elementCount: s.elements.length
		})),
		images: parsedData.images.map((img) => {
			const suggestion = analysis.imageSuggestions.find(
				(s) => s.originalUrl === img.originalUrl
			);
			return {
				originalUrl: img.originalUrl,
				caption: img.caption,
				suggestedName: suggestion
					? suggestion.suggestedName
					: `${activeDate} ${parsedData.title}`.trim(),
				isPoster: suggestion ? suggestion.isPoster : false
			};
		}),
		rawSections: parsedData.sections
	};
}

/** Rewrite a Wikipedia thumbnail URL to the original full-resolution file. */
export function getHighResUrl(url: string): string {
	if (!url) return "";
	if (url.includes("/thumb/")) {
		const parts = url.split("/");
		const thumbIndex = parts.indexOf("thumb");
		if (thumbIndex !== -1) {
			parts.splice(thumbIndex, 1);
			const lastPart = parts[parts.length - 1];
			if (
				lastPart.match(/^\d+px-/) ||
				(lastPart.toLowerCase().endsWith(".png") &&
					parts[parts.length - 2].toLowerCase().endsWith(".svg"))
			) {
				parts.pop();
			}
			return parts.join("/");
		}
	}
	return url;
}
