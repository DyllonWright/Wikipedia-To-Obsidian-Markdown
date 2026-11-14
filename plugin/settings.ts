import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type { SettingDefinitionGroup, SettingDefinitionItem, SettingDefinitionRender } from "obsidian";
import { KeyRing, parseKeyList } from "../src/keyring";
import { normalizeImageWidth } from "../src/imagelink";
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
	/** How image embeds render: auto (follow linkMode) | wikilink | markdown. */
	imageLinkMode: string;
	/** Display width in pixels appended to embeds as "|width"; 0 = original size. */
	imageWidth: number;
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
	imageLinkMode: "auto",
	imageWidth: 0,
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
	if (!["auto", "wikilink", "markdown"].includes(settings.imageLinkMode)) settings.imageLinkMode = "auto";
	settings.imageWidth = normalizeImageWidth(settings.imageWidth);
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

/** One settings row: `name` and `desc` feed settings search, `render` builds the control. */
function row(name: string, desc: string, build: (setting: Setting) => void): SettingDefinitionRender {
	return {
		name,
		desc,
		render: (setting) => {
			setting.setName(name).setDesc(desc);
			build(setting);
		}
	};
}

export class WikipediaImporterSettingTab extends PluginSettingTab {
	plugin: WikipediaImporterPlugin;

	constructor(app: App, plugin: WikipediaImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Declarative settings (Obsidian 1.13.0+): these rows show up in settings search. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [...this.generalRows(), this.imageGroup(), this.geminiGroup()];
	}

	/**
	 * Fallback for Obsidian older than 1.13.0, which knows nothing of
	 * getSettingDefinitions(). Newer versions render the definitions and skip this.
	 */
	display(): void {
		this.renderLegacy();
	}

	/** Re-render after a change that adds or removes rows. */
	private refresh(): void {
		const tab = this as unknown as { update?: () => void };
		if (typeof tab.update === "function") tab.update();
		else this.renderLegacy();
	}

	private renderLegacy(): void {
		const { containerEl } = this;
		containerEl.empty();
		const draw = (def: SettingDefinitionRender) => {
			def.render(new Setting(containerEl), undefined as never);
		};
		this.generalRows().forEach(draw);
		for (const group of [this.imageGroup(), this.geminiGroup()]) {
			new Setting(containerEl).setName(group.heading ?? "").setHeading();
			(group.items as SettingDefinitionRender[]).forEach(draw);
		}
	}

	private generalRows(): SettingDefinitionRender[] {
		const settings = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		return [
			row("Note folder", "Vault folder where imported notes land. Leave empty for the vault root.", (s) =>
				s.addText((text) =>
					text
						.setPlaceholder("Wikipedia")
						.setValue(settings.noteFolder)
						.onChange(async (value) => {
							settings.noteFolder = value.trim();
							await save();
						})
				)
			),
			row("Attachments folder", "Vault folder where downloaded images land.", (s) =>
				s.addText((text) =>
					text
						.setPlaceholder("Attachments")
						.setValue(settings.attachmentsFolder)
						.onChange(async (value) => {
							settings.attachmentsFolder = value.trim() || "Attachments";
							await save();
						})
				)
			),
			row("Link mode", "How links inside the article render in the note.", (s) =>
				s.addDropdown((dropdown) =>
					dropdown
						.addOption("standard", "Standard Markdown [text](URL)")
						.addOption("wikilink", "Wikilink [[target|text]]")
						.addOption("comment", "Commented-out text%%[link](URL)%%")
						.addOption("plain", "Plain text (strip links)")
						.setValue(settings.linkMode)
						.onChange(async (value) => {
							settings.linkMode = value;
							await save();
						})
				)
			),
			row("Omit references", "Skip footnote markers, reference lists, and their headings.", (s) =>
				s.addToggle((toggle) =>
					toggle.setValue(settings.omitReferences).onChange(async (value) => {
						settings.omitReferences = value;
						await save();
					})
				)
			)
		];
	}

	private imageGroup(): SettingDefinitionGroup {
		const settings = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		return {
			type: "group",
			heading: "Images",
			items: [
				row(
					"Image embeds",
					"How downloaded images embed in the note. Wikilink embeds resolve anywhere in the vault.",
					(s) =>
						s.addDropdown((dropdown) =>
							dropdown
								.addOption("auto", "Follow link mode")
								.addOption("wikilink", "Wikilink ![[image]]")
								.addOption("markdown", "Standard Markdown ![image](path)")
								.setValue(settings.imageLinkMode)
								.onChange(async (value) => {
									settings.imageLinkMode = value;
									await save();
								})
						)
				),
				row(
					"Image width",
					"Display width in pixels, written into each embed as |width. Leave empty to show images at their original size.",
					(s) =>
						s.addText((text) =>
							text
								.setPlaceholder("Original size")
								.setValue(settings.imageWidth ? String(settings.imageWidth) : "")
								.onChange(async (value) => {
									settings.imageWidth = normalizeImageWidth(value.trim());
									await save();
								})
						)
				),
				row(
					"SVG images",
					"Many phone galleries can't open SVG. Converting saves a raster copy " +
						"rendered by Wikimedia at 1280px wide. PNG keeps transparency; JPG " +
						"fills it with white.",
					(s) =>
						s.addDropdown((dropdown) =>
							dropdown
								.addOption("png", "Convert to PNG")
								.addOption("jpg", "Convert to JPG")
								.addOption("svg", "Keep as SVG")
								.setValue(settings.svgMode)
								.onChange(async (value) => {
									settings.svgMode = value as SvgMode;
									await save();
								})
						)
				),
				row(
					"Offer gallery images",
					"The importer always brings the infobox picture and the article's captioned " +
						"figures. Galleries often hold dozens of loosely related thumbnails (flags, " +
						"emblems, logos); turn this on to list them in the checklist, unticked, so " +
						"you can pick the few you want.",
					(s) =>
						s.addToggle((toggle) =>
							toggle.setValue(settings.offerGalleryImages).onChange(async (value) => {
								settings.offerGalleryImages = value;
								await save();
							})
						)
				),
				row(
					"Date-prefixed image names",
					"Prefix suggested image filenames with today's date, e.g. " +
						"“2026 07 11 The Gambler (2014) Theatrical Release Poster”.",
					(s) =>
						s.addToggle((toggle) =>
							toggle.setValue(settings.imageNameDatePrefix).onChange(async (value) => {
								settings.imageNameDatePrefix = value;
								await save();
							})
						)
				)
			]
		};
	}

	private geminiGroup(): SettingDefinitionGroup {
		const settings = this.plugin.settings;
		const items: SettingDefinitionRender[] = [
			row(
				"Key storage",
				"With a Google Gemini key, the importer detects film articles and writes " +
					"descriptive image names from captions. Without one, built-in heuristics " +
					"handle both. Keys live in Obsidian's keychain, never in this plugin's " +
					"data.json, and leave your device only in calls to Google's API. Add " +
					"several keys to form a ring: when one runs out of daily quota, the next " +
					"takes over until midnight Pacific, when Google resets the quota.",
				() => {}
			)
		];

		settings.geminiKeySecrets.forEach((id, index) => {
			items.push(
				row(`Key ${index + 1}`, "Pick or create a keychain secret holding a Gemini API key.", (s) =>
					s
						.addComponent((el) =>
							new SecretComponent(this.app, el).setValue(id).onChange(async (value) => {
								settings.geminiKeySecrets[index] = value ?? "";
								await this.plugin.saveSettings();
								this.refresh();
							})
						)
						.addExtraButton((button) =>
							button
								.setIcon("trash")
								.setTooltip("Remove from ring (the keychain secret stays)")
								.onClick(async () => {
									settings.geminiKeySecrets.splice(index, 1);
									await this.plugin.saveSettings();
									this.refresh();
								})
						)
				)
			);
		});

		items.push(
			row("Add key", "Add another Gemini key to the ring.", (s) =>
				s.addButton((button) =>
					button.setButtonText("Add key").onClick(async () => {
						settings.geminiKeySecrets.push("");
						await this.plugin.saveSettings();
						this.refresh();
					})
				)
			)
		);

		const ring = buildKeyRing(this.app, settings);
		if (ring.keys.length > 0) {
			items.push(
				row("Ring status", "Fingerprints only — key values never appear here.", (s) => {
					const list = s.descEl.createEl("ul", { cls: "wiki-imp-ring-status" });
					for (const k of ring.describe()) {
						list.createEl("li", {
							text: `${k.active ? "▶ " : ""}${k.label} · ${k.fp} · ${k.status}`
						});
					}
					s.addButton((button) =>
						button.setButtonText("Clear marks").onClick(async () => {
							settings.keyRingState = {};
							await this.plugin.saveSettings();
							this.refresh();
						})
					);
				})
			);
		}

		return { type: "group", heading: "Gemini (optional)", items };
	}
}
