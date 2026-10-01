import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import { KeyRing, parseKeyList } from "../src/keyring";
import type WikipediaImporterPlugin from "./main";

/** What happens to SVG images: rasterize (phone galleries can't show SVG) or keep. */
export type SvgMode = "png" | "jpg" | "svg";

export interface KeyRingState {
	active?: string;
	dry?: Record<string, string>;
	dead?: Record<string, boolean>;
}

export interface WikipediaImporterSettings {
	/** Vault folder for downloaded images. */
	attachmentsFolder: string;
	/** Vault folder for the created note; empty = vault root. */
	noteFolder: string;
	/** How article-internal links render: standard | wikilink | comment | plain. */
	linkMode: string;
	/** Skip reference footnotes and bibliography sections. */
	omitReferences: boolean;
	/** Prefix suggested image names with today's date (YYYY MM DD). */
	imageNameDatePrefix: boolean;
	/** SVG handling: save as PNG (default), as JPG, or keep the vector SVG. */
	svgMode: SvgMode;
	/** List gallery thumbnails in the checklist (unticked). Off: galleries never come in. */
	offerGalleryImages: boolean;
	/**
	 * Names of Obsidian secrets (Settings → Keychain) holding Gemini keys.
	 * Key VALUES never land in data.json, so they never ride along with a
	 * synced or shared vault folder.
	 */
	geminiKeySecrets: string[];
	/** Rotation memory: fingerprints only, never key values. */
	keyRingState: KeyRingState;
}

export const DEFAULT_SETTINGS: WikipediaImporterSettings = {
	attachmentsFolder: "Attachments",
	noteFolder: "",
	linkMode: "wikilink",
	omitReferences: false,
	imageNameDatePrefix: true,
	svgMode: "png",
	offerGalleryImages: false,
	geminiKeySecrets: [],
	keyRingState: {}
};

const SECRET_PREFIX = "wikipedia-importer-gemini";

/**
 * Accept older data.json shapes:
 *   - pre-2.0 local-server plumbing (serverUrl, autoManageServer, repoPath) gets dropped;
 *   - the 2.x plaintext `geminiApiKey` moves into Obsidian's secret storage
 *     and leaves data.json.
 */
export function migrateSettings(
	raw: Record<string, unknown>,
	app?: App
): { settings: WikipediaImporterSettings; migrated: boolean } {
	const data: Record<string, unknown> = { ...raw };
	let migrated = false;
	for (const key of ["serverUrl", "autoManageServer", "repoPath"]) {
		if (key in data) {
			delete data[key];
			migrated = true;
		}
	}

	const legacyKey = typeof data.geminiApiKey === "string" ? data.geminiApiKey.trim() : "";
	if ("geminiApiKey" in data) {
		if (legacyKey && app?.secretStorage) {
			app.secretStorage.setSecret(SECRET_PREFIX, legacyKey);
			const ids = Array.isArray(data.geminiKeySecrets) ? (data.geminiKeySecrets as string[]) : [];
			if (!ids.includes(SECRET_PREFIX)) data.geminiKeySecrets = [...ids, SECRET_PREFIX];
			delete data.geminiApiKey;
			migrated = true;
		} else if (!legacyKey) {
			delete data.geminiApiKey;
			migrated = true;
		}
	}

	const settings: WikipediaImporterSettings = { ...DEFAULT_SETTINGS, ...data };
	if (!["png", "jpg", "svg"].includes(settings.svgMode)) settings.svgMode = "png";
	if (!Array.isArray(settings.geminiKeySecrets)) settings.geminiKeySecrets = [];
	return { settings, migrated };
}

/** Build the key ring from the secrets the settings name. Values stay in memory only. */
export function buildKeyRing(app: App, settings: WikipediaImporterSettings): KeyRing {
	const keys: ReturnType<typeof parseKeyList> = [];
	for (const id of settings.geminiKeySecrets) {
		if (!id) continue;
		const value = app.secretStorage?.getSecret(id) ?? "";
		for (const k of parseKeyList(value)) {
			if (keys.some((existing) => existing.key === k.key)) continue;
			keys.push({ ...k, label: k.label || id });
		}
	}
	return new KeyRing(keys, settings.keyRingState);
}

export class WikipediaImporterSettingTab extends PluginSettingTab {
	plugin: WikipediaImporterPlugin;

	constructor(app: App, plugin: WikipediaImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		new Setting(containerEl)
			.setName("Note folder")
			.setDesc("Vault folder where imported notes land. Leave empty for the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Wikipedia")
					.setValue(settings.noteFolder)
					.onChange(async (value) => {
						settings.noteFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Attachments folder")
			.setDesc("Vault folder where downloaded images land.")
			.addText((text) =>
				text
					.setPlaceholder("Attachments")
					.setValue(settings.attachmentsFolder)
					.onChange(async (value) => {
						settings.attachmentsFolder = value.trim() || "Attachments";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Link mode")
			.setDesc("How links inside the article render in the note.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("standard", "Standard Markdown [text](URL)")
					.addOption("wikilink", "Wikilink [[target|text]]")
					.addOption("comment", "Commented-out text%%[link](URL)%%")
					.addOption("plain", "Plain text (strip links)")
					.setValue(settings.linkMode)
					.onChange(async (value) => {
						settings.linkMode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Omit references")
			.setDesc("Skip footnote markers, reference lists, and their headings.")
			.addToggle((toggle) =>
				toggle.setValue(settings.omitReferences).onChange(async (value) => {
					settings.omitReferences = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Images").setHeading();

		new Setting(containerEl)
			.setName("SVG images")
			.setDesc(
				"Many phone galleries can't open SVG. Converting saves a raster copy " +
					"rendered by Wikimedia at 1280px wide. PNG keeps transparency; JPG " +
					"fills it with white."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("png", "Convert to PNG")
					.addOption("jpg", "Convert to JPG")
					.addOption("svg", "Keep as SVG")
					.setValue(settings.svgMode)
					.onChange(async (value) => {
						settings.svgMode = value as SvgMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Offer gallery images")
			.setDesc(
				"The importer always brings the infobox picture and the article's captioned " +
					"figures. Galleries often hold dozens of loosely related thumbnails (flags, " +
					"emblems, logos); turn this on to list them in the checklist, unticked, so " +
					"you can pick the few you want."
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.offerGalleryImages).onChange(async (value) => {
					settings.offerGalleryImages = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Date-prefixed image names")
			.setDesc(
				"Prefix suggested image filenames with today's date, e.g. " +
					"“2026 07 11 The Gambler (2014) Theatrical Release Poster”."
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.imageNameDatePrefix).onChange(async (value) => {
					settings.imageNameDatePrefix = value;
					await this.plugin.saveSettings();
				})
			);

		this.displayGemini(containerEl);
	}

	private displayGemini(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName("Gemini (optional)").setHeading();

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"With a Google Gemini key, the importer detects film articles and writes " +
				"descriptive image names from captions. Without one, built-in heuristics " +
				"handle both. Keys live in Obsidian's keychain, never in this plugin's " +
				"data.json, and leave your device only in calls to Google's API. Add " +
				"several keys to form a ring: when one runs out of daily quota, the next " +
				"takes over until midnight Pacific, when Google resets the quota."
		});

		settings.geminiKeySecrets.forEach((id, index) => {
			new Setting(containerEl)
				.setName(`Key ${index + 1}`)
				.setDesc("Pick or create a keychain secret holding a Gemini API key.")
				.addComponent((el) =>
					new SecretComponent(this.app, el).setValue(id).onChange(async (value) => {
						settings.geminiKeySecrets[index] = value;
						await this.plugin.saveSettings();
						this.display();
					})
				)
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Remove from ring (the keychain secret stays)")
						.onClick(async () => {
							settings.geminiKeySecrets.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
						})
				);
		});

		new Setting(containerEl).addButton((button) =>
			button.setButtonText("Add key").onClick(async () => {
				settings.geminiKeySecrets.push("");
				await this.plugin.saveSettings();
				this.display();
			})
		);

		const ring = buildKeyRing(this.app, settings);
		if (ring.keys.length === 0) return;

		const status = new Setting(containerEl)
			.setName("Ring status")
			.setDesc("Fingerprints only — key values never appear here.");
		const list = status.descEl.createEl("ul", { cls: "wiki-imp-ring-status" });
		for (const k of ring.describe()) {
			list.createEl("li", { text: `${k.active ? "▶ " : ""}${k.label} · ${k.fp} · ${k.status}` });
		}
		status.addButton((button) =>
			button.setButtonText("Clear marks").onClick(async () => {
				settings.keyRingState = {};
				await this.plugin.saveSettings();
				this.display();
			})
		);
	}
}
