import { requestUrl } from "obsidian";
import type { Transport } from "../src/gemini";

/**
 * The shared Gemini caller's transport, over Obsidian's requestUrl (no
 * CORS, works on mobile). Never throws: HTTP errors come back with their
 * status, and network failures or timeouts as status 0.
 */
export const obsidianTransport: Transport = ({ url, method, headers, body, timeoutMs }) => {
	const request = requestUrl({ url, method, headers, body, throw: false }).then(
		(res) => ({ status: res.status, text: res.text }),
		(error: unknown) => ({ status: 0, text: error instanceof Error ? error.message : String(error) })
	);
	const timeout = new Promise<{ status: number; text: string }>((resolve) =>
		window.setTimeout(() => resolve({ status: 0, text: `timeout after ${timeoutMs}ms` }), timeoutMs)
	);
	return Promise.race([request, timeout]);
};
