import { App, PluginSettingTab, Setting } from "obsidian";
import type WikipediaImporterPlugin from "./main";

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
	/** Optional Gemini API key for smarter film detection and image naming. */
	geminiApiKey: string;
}

export const DEFAULT_SETTINGS: WikipediaImporterSettings = {
	attachmentsFolder: "Attachments",
	noteFolder: "",
	linkMode: "wikilink",
	omitReferences: false,
	imageNameDatePrefix: true,
	geminiApiKey: ""
};

/**
 * Accept the pre-2.0 data.json shape, which carried local-server plumbing
 * (serverUrl, autoManageServer, repoPath). Those keys get dropped; the
 * formatting preferences carry over unchanged.
 */
export function migrateSettings(raw: Record<string, unknown>): {
	settings: WikipediaImporterSettings;
	migrated: boolean;
} {
	const legacyKeys = ["serverUrl", "autoManageServer", "repoPath"];
	const data = { ...raw };
	let migrated = false;
	for (const key of legacyKeys) {
		if (key in data) {
			delete data[key];
			migrated = true;
		}
	}
	const settings: WikipediaImporterSettings = { ...DEFAULT_SETTINGS, ...data };
	return { settings, migrated };
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

		new Setting(containerEl)
			.setName("Note folder")
			.setDesc("Vault folder where imported notes land. Leave empty for the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Wikipedia")
					.setValue(this.plugin.settings.noteFolder)
					.onChange(async (value) => {
						this.plugin.settings.noteFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Attachments folder")
			.setDesc("Vault folder where downloaded images land.")
			.addText((text) =>
				text
					.setPlaceholder("Attachments")
					.setValue(this.plugin.settings.attachmentsFolder)
					.onChange(async (value) => {
						this.plugin.settings.attachmentsFolder = value.trim() || "Attachments";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Link mode")
			.setDesc("How links inside the article render in the note.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("standard", "Standard markdown [Text](URL)")
					.addOption("wikilink", "Wikilink [[Target|Text]]")
					.addOption("comment", "Commented-out Text%%[Link](URL)%%")
					.addOption("plain", "Plain text (strip links)")
					.setValue(this.plugin.settings.linkMode)
					.onChange(async (value) => {
						this.plugin.settings.linkMode = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Omit references")
			.setDesc("Skip reference footnotes and bibliography sections.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.omitReferences).onChange(async (value) => {
					this.plugin.settings.omitReferences = value;
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
				toggle.setValue(this.plugin.settings.imageNameDatePrefix).onChange(async (value) => {
					this.plugin.settings.imageNameDatePrefix = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Gemini API key")
			.setDesc(
				"Optional. With a key, Google Gemini detects film articles and writes " +
					"descriptive image names from captions. Without one, built-in heuristics " +
					"handle both — no account needed. The key gets stored in this plugin's " +
					"data.json and leaves your machine only in calls to Google's API."
			)
			.addText((text) => {
				text
					.setPlaceholder("AIza…")
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});
	}
}
