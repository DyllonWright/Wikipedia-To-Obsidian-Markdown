import { App, Modal, Notice, Setting, Vault, normalizePath, requestUrl } from "obsidian";
import { assembleMarkdown } from "../src/markdown";
import { analyzeArticle, getHighResUrl, vaultDateToday } from "./pipeline";
import type WikipediaImporterPlugin from "./main";
import type { AnalyzedArticle } from "./types";

/** Resolve vault path conflicts by suffixing " (1)", " (2)", … — never overwrite. */
export async function getSafeVaultPath(vault: Vault, path: string): Promise<string> {
	let fileExists = await vault.adapter.exists(path);
	if (!fileExists) return path;

	const lastSlash = path.lastIndexOf("/");
	const dir = lastSlash !== -1 ? path.substring(0, lastSlash) : "";
	const fullFilename = lastSlash !== -1 ? path.substring(lastSlash + 1) : path;

	const lastDot = fullFilename.lastIndexOf(".");
	const ext = lastDot !== -1 ? fullFilename.substring(lastDot) : "";
	const base = lastDot !== -1 ? fullFilename.substring(0, lastDot) : fullFilename;

	let counter = 1;
	let newPath = path;
	while (fileExists) {
		const newFilename = `${base} (${counter})${ext}`;
		newPath = dir ? `${dir}/${newFilename}` : newFilename;
		fileExists = await vault.adapter.exists(newPath);
		counter++;
	}
	return newPath;
}

function extensionFor(contentType: string): string {
	if (contentType.includes("image/png")) return ".png";
	if (contentType.includes("image/webp")) return ".webp";
	if (contentType.includes("image/gif")) return ".gif";
	if (contentType.includes("image/svg+xml")) return ".svg";
	return ".jpg";
}

export class WikiImportModal extends Modal {
	plugin: WikipediaImporterPlugin;
	articleData: AnalyzedArticle | null = null;

	constructor(app: App, plugin: WikipediaImporterPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.renderUrlInput();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderUrlInput(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Import Wikipedia article" });

		const container = contentEl.createDiv({ cls: "wiki-imp-container" });
		container.createEl("p", {
			text: "Paste a Wikipedia URL. The importer fetches the article, maps its sections and images, and lets you choose what comes in."
		});

		let urlInput = "";
		new Setting(container)
			.setName("Article URL")
			.setDesc("e.g. https://en.wikipedia.org/wiki/Metropolis_(1927_film)")
			.addText((text) => {
				text.setPlaceholder("https://en.wikipedia.org/wiki/...").onChange((value) => {
					urlInput = value.trim();
				});
				text.inputEl.addClass("wiki-imp-url-input");
				text.inputEl.addEventListener("keypress", (e: KeyboardEvent) => {
					if (e.key === "Enter" && urlInput) void this.analyzeUrl(urlInput);
				});
			});

		const buttonRow = container.createDiv({ cls: "wiki-imp-buttons" });
		const btn = buttonRow.createEl("button", { text: "Analyze page", cls: "mod-cta" });
		btn.addEventListener("click", () => {
			if (urlInput) void this.analyzeUrl(urlInput);
			else new Notice("Enter a Wikipedia URL first.");
		});
	}

	private async analyzeUrl(url: string): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Analyzing Wikipedia page…" });
		const loading = contentEl.createDiv({ cls: "wiki-imp-loading" });
		loading.createEl("p", { text: "Fetching the article…" });
		loading.createEl("p", {
			text: "Mapping headings, resolving image structures, suggesting names…",
			cls: "wiki-imp-dim"
		});

		try {
			this.articleData = await analyzeArticle(url, {
				geminiApiKey: this.plugin.settings.geminiApiKey,
				imageNameDatePrefix: this.plugin.settings.imageNameDatePrefix
			});
			this.renderConfiguration();
		} catch (e) {
			console.error(e);
			new Notice(`Failed to analyze the page: ${(e as Error).message}`);
			this.renderUrlInput();
			contentEl.createEl("p", {
				text: "Check the URL and your internet connection, then try again.",
				cls: "wiki-imp-error"
			});
		}
	}

	private renderConfiguration(): void {
		const { contentEl } = this;
		const data = this.articleData;
		if (!data) return;
		contentEl.empty();

		contentEl.createEl("h2", { text: `Configure: ${data.title}` });

		const container = contentEl.createDiv({ cls: "wiki-imp-configure" });

		// 1. Film details banner
		if (data.isMovie) {
			const banner = container.createDiv({ cls: "wiki-imp-movie-banner" });
			banner.createEl("h3", { text: "🎬 Film article detected" });

			const fields = banner.createDiv({ cls: "wiki-imp-movie-fields" });

			const tField = fields.createDiv({ cls: "wiki-imp-field" });
			tField.createEl("label", { text: "Film title" });
			const titleInput = tField.createEl("input", { type: "text", value: data.movieTitle });
			titleInput.addEventListener("input", () => {
				data.movieTitle = titleInput.value.trim();
				this.updatePosterSuggestedNames();
			});

			const yField = fields.createDiv({ cls: "wiki-imp-field" });
			yField.createEl("label", { text: "Release year" });
			const yearInput = yField.createEl("input", { type: "text", value: data.releaseYear });
			yearInput.addEventListener("input", () => {
				data.releaseYear = yearInput.value.trim();
				this.updatePosterSuggestedNames();
			});
		}

		// 2. Sections checklist
		container.createEl("h3", { text: "Sections to include" });
		const secList = container.createDiv({ cls: "wiki-imp-section-list" });
		data.sections.forEach((sec) => {
			const row = secList.createDiv({ cls: "wiki-imp-section-row" });
			row.style.setProperty("--wiki-imp-indent", String((sec.level - 2) * 15) + "px");

			const check = row.createEl("input", { type: "checkbox" });
			check.checked = true;
			check.addClass("wiki-imp-section-checkbox");
			check.setAttribute("data-id", sec.id);

			row.createSpan({ text: `H${sec.level}`, cls: "wiki-imp-level-tag" });
			row.createSpan({ text: sec.title, cls: "wiki-imp-section-title" });
		});

		// 3. Image renamer list
		if (data.images.length > 0) {
			container.createEl("h3", { text: "Image attachments" });
			const imgList = container.createDiv({ cls: "wiki-imp-image-list" });

			data.images.forEach((img, idx) => {
				const item = imgList.createDiv({ cls: "wiki-imp-image-item" });
				const row = item.createDiv({ cls: "wiki-imp-image-row" });

				const thumbDiv = row.createDiv({ cls: "wiki-imp-thumb" });
				const previewImg = thumbDiv.createEl("img");
				previewImg.src = img.originalUrl;

				const rightDiv = row.createDiv({ cls: "wiki-imp-image-details" });

				const header = rightDiv.createDiv({ cls: "wiki-imp-image-header" });
				const left = header.createDiv({ cls: "wiki-imp-image-label" });
				const imgCheck = left.createEl("input", { type: "checkbox" });
				imgCheck.checked = true;
				imgCheck.addClass("wiki-imp-image-checkbox");
				imgCheck.setAttribute("data-idx", String(idx));
				left.createSpan({ text: `Image #${idx + 1}` });

				if (img.isPoster) {
					header.createSpan({ text: "Poster", cls: "wiki-imp-poster-tag" });
				}

				const input = rightDiv.createEl("input", { type: "text", value: img.suggestedName });
				input.addClass("wiki-imp-image-name-input");
				input.setAttribute("data-idx", String(idx));

				rightDiv.createEl("p", { text: img.caption || "No caption", cls: "wiki-imp-caption" });
			});
		}

		// 4. Action buttons
		const buttons = contentEl.createDiv({ cls: "wiki-imp-buttons" });
		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const importBtn = buttons.createEl("button", { text: "Import article", cls: "mod-cta" });
		importBtn.addEventListener("click", () => void this.runImport(importBtn));
	}

	private updatePosterSuggestedNames(): void {
		const data = this.articleData;
		if (!data) return;
		const datePrefix = this.plugin.settings.imageNameDatePrefix ? `${vaultDateToday()} ` : "";
		data.images.forEach((img, idx) => {
			if (!img.isPoster) return;
			const input = this.contentEl.querySelector<HTMLInputElement>(
				`.wiki-imp-image-name-input[data-idx="${idx}"]`
			);
			if (input) {
				input.value = `${datePrefix}${data.movieTitle} (${data.releaseYear || "Year"}) Theatrical Release Poster`;
			}
		});
	}

	private async runImport(importBtn: HTMLButtonElement): Promise<void> {
		const data = this.articleData;
		if (!data) return;

		importBtn.disabled = true;
		importBtn.setText("Importing…");
		new Notice("Starting Wikipedia import…");

		// 1. Gather choices
		const selectedSections: string[] = [];
		this.contentEl
			.querySelectorAll<HTMLInputElement>(".wiki-imp-section-checkbox")
			.forEach((box) => {
				if (box.checked) selectedSections.push(box.getAttribute("data-id") ?? "");
			});

		const selectedImages: Array<{ originalUrl: string; finalName: string }> = [];
		this.contentEl
			.querySelectorAll<HTMLInputElement>(".wiki-imp-image-checkbox")
			.forEach((box) => {
				if (!box.checked) return;
				const idx = parseInt(box.getAttribute("data-idx") ?? "-1");
				const input = this.contentEl.querySelector<HTMLInputElement>(
					`.wiki-imp-image-name-input[data-idx="${idx}"]`
				);
				if (idx >= 0 && input) {
					selectedImages.push({
						originalUrl: data.images[idx].originalUrl,
						finalName: input.value.trim()
					});
				}
			});

		try {
			// 2. Assemble markdown in-process (formerly the server's /api/generate)
			const noteTitle = data.isMovie
				? `${data.movieTitle} (${data.releaseYear})`
				: data.title;
			let markdown = assembleMarkdown(
				noteTitle,
				data.url,
				data.rawSections,
				selectedSections,
				this.plugin.settings.linkMode,
				this.plugin.settings.omitReferences
			);

			// 3. Ensure the attachments folder exists
			const attachFolder = normalizePath(this.plugin.settings.attachmentsFolder || "");
			if (attachFolder && !(await this.app.vault.adapter.exists(attachFolder))) {
				await this.app.vault.createFolder(attachFolder);
			}

			// 4. Download and save selected images
			const finalImageMap: Record<string, string> = {};
			if (selectedImages.length > 0) {
				new Notice(`Downloading ${selectedImages.length} images…`);
			}

			for (const img of selectedImages) {
				try {
					let imgResponse;
					try {
						imgResponse = await requestUrl({ url: getHighResUrl(img.originalUrl), method: "GET", throw: true });
					} catch {
						imgResponse = await requestUrl({ url: img.originalUrl, method: "GET", throw: true });
					}

					const ext = extensionFor(imgResponse.headers["content-type"] || "");
					const filename = `${img.finalName}${ext}`;
					const initialPath = normalizePath(
						attachFolder ? `${attachFolder}/${filename}` : filename
					);

					const savePath = await getSafeVaultPath(this.app.vault, initialPath);
					const finalFilename = savePath.includes("/")
						? savePath.substring(savePath.lastIndexOf("/") + 1)
						: savePath;

					await this.app.vault.createBinary(savePath, imgResponse.arrayBuffer);
					finalImageMap[img.originalUrl] = finalFilename;
				} catch (e) {
					console.error(`Failed to download image ${img.originalUrl}:`, e);
					new Notice(`Failed to download image: ${img.finalName}`);
				}
			}

			// 5. Replace image placeholders in the markdown
			for (const [url, filename] of Object.entries(finalImageMap)) {
				const placeholder = `{{IMAGE:${url}}}`;
				let imgLink: string;
				if (this.plugin.settings.linkMode === "wikilink") {
					imgLink = `![[${filename}]]`;
				} else {
					const relativePath = attachFolder
						? `${attachFolder}/${encodeURIComponent(filename)}`
						: encodeURIComponent(filename);
					imgLink = `![${filename}](${relativePath})`;
				}
				markdown = markdown.split(placeholder).join(imgLink);
			}
			markdown = markdown.replace(/\{\{IMAGE:([^}]+)\}\}/g, "");

			// 6. Create the note without clobbering anything that exists
			const cleanNoteName = noteTitle.replace(/[\\/*?:"<>|]/g, "-").trim();
			const noteFolder = normalizePath(this.plugin.settings.noteFolder || "");
			if (noteFolder && !(await this.app.vault.adapter.exists(noteFolder))) {
				await this.app.vault.createFolder(noteFolder);
			}
			const initialNotePath = normalizePath(
				noteFolder ? `${noteFolder}/${cleanNoteName}.md` : `${cleanNoteName}.md`
			);
			const notePath = await getSafeVaultPath(this.app.vault, initialNotePath);
			const noteFile = await this.app.vault.create(notePath, markdown);
			new Notice("Note created successfully!");

			// 7. Open it
			await this.app.workspace.getLeaf(false).openFile(noteFile);
			this.close();
		} catch (error) {
			console.error(error);
			new Notice(`Import failed: ${(error as Error).message}`);
			importBtn.disabled = false;
			importBtn.setText("Import article");
		}
	}
}
