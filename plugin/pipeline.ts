import { requestUrl } from "obsidian";
import { parseWikipediaArticle } from "../src/parser";
import { analyzeMetadataAndImages } from "../src/gemini";
import { WIKIMEDIA_USER_AGENT } from "../src/images";
import type { KeyRing } from "../src/keyring";
import { obsidianTransport } from "./gemini";
import type { AnalyzedArticle } from "./types";

/**
 * Today in the computer's local timezone, formatted for image-name
 * prefixes: "YYYY MM DD". Uses local calendar components rather than
 * toISOString() (UTC), so a late-evening import west of UTC keeps the
 * local date instead of rolling forward to tomorrow.
 */
export function vaultDateToday(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year} ${month} ${day}`;
}

/**
 * Accept only Wikipedia article URLs, and send mobile links (en.m.…) to the
 * desktop page, whose HTML the parser expects.
 */
export function normalizeArticleUrl(input: string): string {
	let u: URL;
	try {
		const trimmed = input.trim();
		// Accept "en.wikipedia.org/wiki/…" pasted without a scheme.
		u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
	} catch {
		throw new Error("That doesn't look like a URL.");
	}
	if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only web links work here.");
	if (!/(^|\.)wikipedia\.org$/i.test(u.hostname)) throw new Error("Only wikipedia.org articles can be imported.");
	u.protocol = "https:";
	u.hostname = u.hostname.replace(/\.m\.wikipedia\.org$/i, ".wikipedia.org");
	u.hash = "";
	return u.toString();
}

/**
 * The former /api/analyze endpoint, in-process: fetch the article HTML,
 * parse structure and images, then run metadata analysis (Gemini or
 * heuristics) for film detection and image-name suggestions.
 */
export async function analyzeArticle(
	rawUrl: string,
	options: { ring: KeyRing; imageNameDatePrefix: boolean; offerGalleryImages: boolean }
): Promise<AnalyzedArticle> {
	const url = normalizeArticleUrl(rawUrl);
	const response = await requestUrl({
		url,
		method: "GET",
		headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
		throw: true
	});

	const parsedData = parseWikipediaArticle(response.text, url, {
		linkMode: "standard",
		omitReferences: false,
		includeGalleries: options.offerGalleryImages
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

	const { analysis, source, note } = await analyzeMetadataAndImages({
		title: parsedData.title,
		leadText,
		infoboxText,
		images: parsedData.images,
		vaultDate: activeDate,
		ring: options.ring,
		transport: obsidianTransport
	});

	return {
		title: parsedData.title,
		url: parsedData.url,
		isMovie: analysis.isMovie,
		movieTitle: analysis.movieTitle || parsedData.title,
		releaseYear: analysis.releaseYear || "",
		briefDescription: analysis.briefDescription || "",
		namingSource: source,
		namingNote: note,
		sections: parsedData.sections.map((s) => ({
			id: s.id,
			title: s.title,
			level: s.level,
			elementCount: s.elements.length
		})),
		images: parsedData.images.map((img) => {
			const suggestion = analysis.imageSuggestions.find((s) => s.originalUrl === img.originalUrl);
			return {
				originalUrl: img.originalUrl,
				caption: img.caption,
				fileWidth: img.fileWidth ?? 0,
				source: img.source ?? "figure",
				suggestedName: suggestion ? suggestion.suggestedName : `${activeDate} ${parsedData.title}`.trim(),
				isPoster: suggestion ? suggestion.isPoster : false
			};
		}),
		rawSections: parsedData.sections
	};
}
