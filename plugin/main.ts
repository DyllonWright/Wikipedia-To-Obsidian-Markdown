import { Plugin } from "obsidian";
import { WikiImportModal } from "./modal";
import {
	DEFAULT_SETTINGS,
	WikipediaImporterSettingTab,
	WikipediaImporterSettings,
	migrateSettings
} from "./settings";

export default class WikipediaImporterPlugin extends Plugin {
	settings: WikipediaImporterSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon("book-open", "Import Wikipedia article", () => {
			new WikiImportModal(this.app, this).open();
		});

		this.addCommand({
			id: "import-article",
			name: "Import article",
			callback: () => {
				new WikiImportModal(this.app, this).open();
			}
		});

		this.addSettingTab(new WikipediaImporterSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		const { settings, migrated } = migrateSettings(raw);
		this.settings = settings;
		if (migrated) await this.saveData(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
