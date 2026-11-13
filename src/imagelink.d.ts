export function encodeLinkPath(vaultPath: string): string;

export function resolveImageStyle(imageLinkMode: string, linkMode: string): "wikilink" | "markdown";

export function formatImageEmbed(filename: string, folder: string, style: string): string;
