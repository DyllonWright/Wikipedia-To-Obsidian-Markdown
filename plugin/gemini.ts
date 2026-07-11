import { requestUrl } from "obsidian";
import { generateFallbackAnalysis } from "../src/fallback";
import type { GeminiAnalysis, ParsedImage } from "./types";

interface GeminiRestResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{ text?: string }>;
		};
	}>;
}

const GEMINI_ENDPOINT =
	"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

function buildPrompt(
	title: string,
	leadText: string,
	infoboxText: string,
	images: ParsedImage[],
	vaultDate: string
): string {
	const dateRule = vaultDate
		? `- Every filename MUST start with the Vault Date: "${vaultDate} "
       - For standard images, use: "VaultDate Title or brief desc from caption" (e.g. "${vaultDate} Ryan Dahl at NodeConf")
       - For the primary theatrical release poster of a movie (if this is a movie and this image is the poster), use: "VaultDate Movie Title (ReleaseYear) Theatrical Release Poster" (e.g. "${vaultDate} The Gambler (2014) Theatrical Release Poster")`
		: `- For standard images, use a short title or brief description from the caption (e.g. "Ryan Dahl at NodeConf")
       - For the primary theatrical release poster of a movie (if this is a movie and this image is the poster), use: "Movie Title (ReleaseYear) Theatrical Release Poster" (e.g. "The Gambler (2014) Theatrical Release Poster")`;

	return `
    You are an expert editor preparing content for a personal Obsidian vault.
    You will be given information about a Wikipedia article:
    Title: "${title}"
    Lead Section: "${leadText.slice(0, 1500)}"
    Infobox Data: "${infoboxText.slice(0, 1000)}"
    Images: ${JSON.stringify(images.map((img) => ({ originalUrl: img.originalUrl, caption: img.caption })))}
    Vault Date: "${vaultDate}"

    Your task is to:
    1. Determine if this article is about a movie (film) as the main subject.
    2. If it is a movie, extract:
       - movieTitle: The official title of the movie (e.g. "The Gambler").
       - releaseYear: The release year of the movie as a 4-digit number (e.g. "2014").
    3. Suggest a clean, descriptive filename for each image.
       Image Naming Rules:
       ${dateRule}
       - Do not include file extensions (e.g., .jpg, .png) in the suggestions.
       - Clean up filenames: remove special characters like \\ / : * ? " < > | [ ] and replace multiple spaces with a single space.
       - Limit suggested filenames to 80 characters maximum.
       - Be descriptive but concise. If an image caption is empty or generic, use the page subject to form a description.

    Return your response strictly as a JSON object with this structure:
    {
      "isMovie": true/false,
      "movieTitle": "...",
      "releaseYear": "...",
      "briefDescription": "...",
      "imageSuggestions": [
        {
          "originalUrl": "URL from the input list",
          "suggestedName": "suggested name matching rules",
          "isPoster": true/false
        }
      ]
    }
  `;
}

/**
 * Analyzes article metadata and suggests image names.
 * With an API key: one Gemini REST call (no SDK, works everywhere
 * requestUrl works). Without a key, or on any failure: the same
 * programmatic heuristics the local server uses.
 */
export async function analyzeMetadataAndImages(
	apiKey: string,
	title: string,
	leadText: string,
	infoboxText: string,
	images: ParsedImage[],
	vaultDate: string
): Promise<GeminiAnalysis> {
	if (!apiKey) {
		return generateFallbackAnalysis(title, leadText, images, vaultDate);
	}

	try {
		const response = await requestUrl({
			url: `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contents: [{ parts: [{ text: buildPrompt(title, leadText, infoboxText, images, vaultDate) }] }],
				generationConfig: { responseMimeType: "application/json" }
			}),
			throw: true
		});

		const body = response.json as GeminiRestResponse;
		const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
		if (!text) throw new Error("Empty Gemini response");
		return JSON.parse(text) as GeminiAnalysis;
	} catch (error) {
		console.warn("Advanced Wikipedia Importer: Gemini call failed, using heuristics.", error);
		return generateFallbackAnalysis(title, leadText, images, vaultDate);
	}
}
