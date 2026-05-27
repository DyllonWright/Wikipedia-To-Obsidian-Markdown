// obsidian-plugin/main.js
const { Plugin, Modal, Setting, requestUrl, Notice, PluginSettingTab } = require('obsidian');

const DEFAULT_SETTINGS = {
  serverUrl: 'http://localhost:3000',
  attachmentsFolder: 'Attachments',
  linkMode: 'wikilink',
  omitReferences: false,
  autoManageServer: true,
  repoPath: 'c:\\Users\\djwri\\Documents\\GitHub\\wikipedia_to_markdown'
};

// Helper function to resolve vault path conflicts safely (overwrite safeguard)
async function getSafeVaultPath(vault, path) {
  let fileExists = await vault.adapter.exists(path);
  if (!fileExists) return path;

  // Split path into dir, name, ext
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash !== -1 ? path.substring(0, lastSlash) : '';
  const fullFilename = lastSlash !== -1 ? path.substring(lastSlash + 1) : path;
  
  const lastDot = fullFilename.lastIndexOf('.');
  const ext = lastDot !== -1 ? fullFilename.substring(lastDot) : '';
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

class WikiImporterPlugin extends Plugin {
  async onload() {
    console.log('Loading Wikipedia Obsidian Importer Plugin');
    this.serverProcess = null;
    this.serverStatus = 'stopped';

    await this.loadSettings();

    // Add ribbon icon
    this.addRibbonIcon('document', 'Wikipedia Importer', () => {
      new WikiImportModal(this.app, this).open();
    });

    // Add command
    this.addCommand({
      id: 'import-wikipedia-page',
      name: 'Import Wikipedia Page',
      callback: () => {
        new WikiImportModal(this.app, this).open();
      }
    });

    // Add settings tab
    this.addSettingTab(new WikiImporterSettingTab(this.app, this));
  }

  onunload() {
    console.log('Unloading Wikipedia Obsidian Importer Plugin');
    this.stopLocalServer(true); // silent exit
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  startLocalServer() {
    if (this.serverProcess) {
      return;
    }

    const { spawn } = require('child_process');
    const repoPath = this.settings.repoPath;
    if (!repoPath) {
      new Notice('Automatic Server Start: Please set your Repository Path in settings.');
      return;
    }

    console.log(`[Plugin] Spawning local scraping server in CWD: ${repoPath}`);
    this.serverStatus = 'starting';

    try {
      this.serverProcess = spawn('node', ['server.js'], {
        cwd: repoPath,
        shell: true,
        env: process.env
      });

      this.serverProcess.stdout.on('data', (data) => {
        const text = data.toString();
        console.log(`[Server STDOUT] ${text}`);
        if (text.includes('Server Running')) {
          this.serverStatus = 'running';
          new Notice('Wikipedia scraping server is ready!');
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        console.error(`[Server STDERR] ${data.toString()}`);
      });

      this.serverProcess.on('close', (code) => {
        console.log(`[Server] Process exited with code ${code}`);
        this.serverProcess = null;
        this.serverStatus = 'stopped';
      });

      new Notice('Starting Wikipedia local server...');
    } catch (e) {
      console.error('[Plugin] Failed to start server process:', e);
      new Notice(`Failed to start server: ${e.message}`);
      this.serverStatus = 'stopped';
    }
  }

  stopLocalServer(silent = false) {
    if (this.serverProcess) {
      console.log('[Plugin] Stopping local server process...');
      this.serverProcess.kill();
      this.serverProcess = null;
      this.serverStatus = 'stopped';
      if (!silent) {
        new Notice('Wikipedia local server stopped.');
      }
    }
  }
}

class WikiImportModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.settings = plugin.settings;
    this.articleData = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    // Auto-start server if enabled
    if (this.plugin.settings.autoManageServer && this.plugin.settings.repoPath) {
      this.plugin.startLocalServer();
    }
    
    contentEl.createEl('h2', { text: 'Import Wikipedia Page' });
    
    // Initial UI state
    this.renderUrlInput();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    
    // Stop server if auto-manage is enabled
    if (this.plugin.settings.autoManageServer) {
      // Delay slightly just in case an analysis/import is completing
      setTimeout(() => {
        this.plugin.stopLocalServer();
      }, 500);
    }
  }

  renderUrlInput() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Import Wikipedia Page' });

    const container = contentEl.createDiv({ cls: 'wiki-modal-container' });
    
    // Add server status banner
    const statusBanner = container.createEl('div');
    statusBanner.style.padding = '8px 12px';
    statusBanner.style.borderRadius = '4px';
    statusBanner.style.marginBottom = '12px';
    statusBanner.style.fontSize = '11px';
    statusBanner.style.fontWeight = 'bold';
    statusBanner.style.display = 'flex';
    statusBanner.style.justifyContent = 'space-between';
    statusBanner.style.alignItems = 'center';
    
    if (this.plugin.serverProcess) {
      statusBanner.style.background = 'var(--background-modifier-success)';
      statusBanner.style.color = 'var(--text-success)';
      statusBanner.createEl('span', { text: '● Scraper Server: Running' });
    } else {
      statusBanner.style.background = 'var(--background-secondary)';
      statusBanner.style.color = 'var(--text-muted)';
      statusBanner.createEl('span', { text: '○ Scraper Server: Stopped' });
      
      // Add a handy manual start button directly in the modal!
      const startBtn = statusBanner.createEl('button', { text: 'Start Server', cls: 'mod-cta' });
      startBtn.style.padding = '4px 8px';
      startBtn.style.fontSize = '10px';
      startBtn.addEventListener('click', () => {
        this.plugin.startLocalServer();
        // Wait a second and re-render UrlInput to update status
        setTimeout(() => this.renderUrlInput(), 1000);
      });
    }

    container.createEl('p', { 
      text: 'Enter a Wikipedia URL to fetch and parse the article structure, sections, and images.' 
    });

    let urlInput = '';
    new Setting(container)
      .setName('Wikipedia Article URL')
      .setDesc('e.g., https://en.wikipedia.org/wiki/JavaScript')
      .addText(text => {
        text.setPlaceholder('https://en.wikipedia.org/wiki/...')
          .onChange(value => { urlInput = value.trim(); });
        text.inputEl.style.width = '100%';
        text.inputEl.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && urlInput) {
            this.analyzeUrl(urlInput);
          }
        });
      });

    const buttonContainer = container.createDiv({ cls: 'wiki-modal-buttons' });
    const btn = buttonContainer.createEl('button', { 
      text: 'Analyze Page',
      cls: 'mod-cta'
    });
    btn.style.marginTop = '15px';
    btn.addEventListener('click', () => {
      if (urlInput) {
        this.analyzeUrl(urlInput);
      } else {
        new Notice('Please enter a Wikipedia URL first.');
      }
    });
  }

  async analyzeUrl(url) {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Analyzing Wikipedia Page...' });
    
    const loadingDiv = contentEl.createDiv({ cls: 'wiki-modal-loading' });
    loadingDiv.createEl('p', { text: 'Connecting to local scraping server...' });
    loadingDiv.createEl('p', { text: 'Analyzing headers, fetching image structures, and generating names via Gemini...' }).style.fontSize = '12px';

    const formattedDate = new Date().toISOString().split('T')[0].replace(/-/g, ' ');

    try {
      const apiUrl = `${this.settings.serverUrl}/api/analyze?url=${encodeURIComponent(url)}&date=${encodeURIComponent(formattedDate)}`;
      
      const response = await requestUrl({
        url: apiUrl,
        method: 'GET'
      });

      if (response.status !== 200) {
        throw new Error('Server returned an error status.');
      }

      this.articleData = response.json;
      this.renderConfiguration();
    } catch (e) {
      console.error(e);
      new Notice(`Failed to connect to local server: ${e.message}`);
      this.renderUrlInput();
      
      const errorMsg = contentEl.createEl('p', { 
        text: `Error details: Make sure your local server is running at ${this.settings.serverUrl}.` 
      });
      errorMsg.style.color = 'var(--text-error)';
      errorMsg.style.marginTop = '15px';
    }
  }

  renderConfiguration() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: `Configure: ${this.articleData.title}` });

    const container = contentEl.createDiv({ cls: 'wiki-modal-configure-grid' });
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '15px';
    container.style.maxHeight = '480px';
    container.style.overflowY = 'auto';
    container.style.paddingRight = '10px';

    // 1. Movie details banner
    if (this.articleData.isMovie) {
      const banner = container.createDiv({ cls: 'wiki-movie-banner' });
      banner.style.background = 'var(--background-modifier-error-hover)';
      banner.style.padding = '12px';
      banner.style.borderRadius = '6px';
      banner.style.border = '1px solid var(--border-color)';
      banner.style.marginBottom = '10px';
      
      banner.createEl('h3', { text: '🎬 Movie Article Detected' }).style.margin = '0 0 10px 0';
      
      const fields = banner.createDiv();
      fields.style.display = 'flex';
      fields.style.gap = '15px';
      
      const tField = fields.createDiv();
      tField.style.display = 'flex';
      tField.style.flexDirection = 'column';
      tField.createEl('label', { text: 'Movie Title' }).style.fontSize = '10px';
      const titleInput = tField.createEl('input', { type: 'text', value: this.articleData.movieTitle });
      titleInput.addEventListener('input', () => {
        this.articleData.movieTitle = titleInput.value.trim();
        this.updatePosterSuggestedNames();
      });

      const yField = fields.createDiv();
      yField.style.display = 'flex';
      yField.style.flexDirection = 'column';
      yField.createEl('label', { text: 'Release Year' }).style.fontSize = '10px';
      const yearInput = yField.createEl('input', { type: 'text', value: this.articleData.releaseYear });
      yearInput.addEventListener('input', () => {
        this.articleData.releaseYear = yearInput.value.trim();
        this.updatePosterSuggestedNames();
      });
    }

    // 2. Sections Checklist
    container.createEl('h3', { text: 'Sections to Include' });
    const secList = container.createDiv();
    secList.style.display = 'flex';
    secList.style.flexDirection = 'column';
    secList.style.gap = '6px';
    secList.style.background = 'var(--background-secondary)';
    secList.style.padding = '10px';
    secList.style.borderRadius = '6px';

    this.articleData.sections.forEach(sec => {
      const row = secList.createDiv();
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.marginLeft = `${(sec.level - 2) * 15}px`;

      const check = row.createEl('input', { type: 'checkbox' });
      check.checked = true; // Default to including all sections
      check.className = 'wiki-section-checkbox';
      check.setAttribute('data-id', sec.id);

      row.createEl('span', { text: `H${sec.level}` }).style.fontSize = '10px';
      row.createEl('span', { text: sec.title }).style.fontWeight = '500';
    });

    // 3. Images Renamer List
    if (this.articleData.images.length > 0) {
      container.createEl('h3', { text: 'Image Attachments' });
      const imgList = container.createDiv();
      imgList.style.display = 'flex';
      imgList.style.flexDirection = 'column';
      imgList.style.gap = '10px';

      this.articleData.images.forEach((img, idx) => {
        const item = imgList.createDiv();
        item.style.display = 'flex';
        item.style.flexDirection = 'column';
        item.style.gap = '6px';
        item.style.background = 'var(--background-secondary)';
        item.style.padding = '10px';
        item.style.borderRadius = '6px';

        const header = item.createDiv();
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';

        const left = header.createDiv();
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '8px';
        const imgCheck = left.createEl('input', { type: 'checkbox' });
        imgCheck.checked = true;
        imgCheck.className = 'wiki-image-checkbox';
        imgCheck.setAttribute('data-idx', idx);
        left.createEl('span', { text: `Image #${idx + 1}` }).style.fontWeight = 'bold';

        if (img.isPoster) {
          header.createEl('span', { text: 'Poster' }).style.background = 'var(--text-success)';
          header.style.color = '#ffffff';
          header.style.fontSize = '10px';
        }

        const input = item.createEl('input', { type: 'text', value: img.suggestedName });
        input.className = 'wiki-image-name-input';
        input.setAttribute('data-idx', idx);
        input.style.width = '100%';

        item.createEl('p', { text: img.caption || 'No caption' }).style.fontSize = '11px';
      });
    }

    // 4. Action Buttons
    const buttons = contentEl.createDiv();
    buttons.style.marginTop = '20px';
    buttons.style.display = 'flex';
    buttons.style.justifyContent = 'flex-end';
    buttons.style.gap = '10px';

    const cancelBtn = buttons.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const importBtn = buttons.createEl('button', { text: 'Import Article', cls: 'mod-cta' });
    importBtn.addEventListener('click', () => this.runImport());
  }

  updatePosterSuggestedNames() {
    const mTitle = this.articleData.movieTitle;
    const mYear = this.articleData.releaseYear;
    const formattedDate = new Date().toISOString().split('T')[0].replace(/-/g, ' ');

    this.articleData.images.forEach((img, idx) => {
      if (img.isPoster) {
        const input = this.contentEl.querySelector(`.wiki-image-name-input[data-idx="${idx}"]`);
        if (input) {
          input.value = `${formattedDate} ${mTitle} (${mYear || 'Year'}) Theatrical Release Poster`;
        }
      }
    });
  }

  async runImport() {
    const importBtn = this.contentEl.querySelector('.mod-cta');
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.innerText = 'Importing...';
    }

    new Notice('Starting Wikipedia import...');

    // 1. Gather choices
    const selectedSections = [];
    this.contentEl.querySelectorAll('.wiki-section-checkbox').forEach(box => {
      if (box.checked) {
        selectedSections.push(box.getAttribute('data-id'));
      }
    });

    const selectedImages = [];
    this.contentEl.querySelectorAll('.wiki-image-checkbox').forEach(box => {
      if (box.checked) {
        const idx = parseInt(box.getAttribute('data-idx'));
        const input = this.contentEl.querySelector(`.wiki-image-name-input[data-idx="${idx}"]`);
        selectedImages.push({
          originalUrl: this.articleData.images[idx].originalUrl,
          finalName: input.value.trim()
        });
      }
    });

    try {
      // 2. Call local server to generate markdown
      const genResponse = await requestUrl({
        url: `${this.settings.serverUrl}/api/generate`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: this.articleData.isMovie ? `${this.articleData.movieTitle} (${this.articleData.releaseYear})` : this.articleData.title,
          url: this.articleData.url,
          rawSections: this.articleData.rawSections,
          selectedSections,
          linkMode: this.settings.linkMode,
          omitReferences: this.settings.omitReferences
        })
      });

      if (genResponse.status !== 200) {
        throw new Error('Failed to assemble markdown on server.');
      }

      let markdown = genResponse.json.markdown;

      // 3. Ensure Attachments Directory Exists
      const attachFolder = this.settings.attachmentsFolder || '';
      if (attachFolder) {
        const exists = await this.app.vault.adapter.exists(attachFolder);
        if (!exists) {
          await this.app.vault.createFolder(attachFolder);
        }
      }

      // 4. Download and save selected attachments
      const finalImageMap = {};
      new Notice(`Downloading ${selectedImages.length} images...`);

      for (const img of selectedImages) {
        try {
          // Query local server to fetch file properties & convert to original
          const dlResponse = await requestUrl({
            url: `${this.settings.serverUrl}/api/export`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: 'temp_download_val',
              markdown: 'temp',
              images: [img],
              saveToVault: false, // Save to server local temp
              attachmentsFolder: 'temp_attachments'
            })
          });

          // Wait, instead of writing on server, let's fetch the image buffer from the wikipedia url directly
          // or ask the server to download it and return the binary!
          // Fetching the original high-res URL directly in Obsidian is easier:
          const highResUrl = this.getHighResUrl(img.originalUrl);
          
          let imgResponse;
          try {
            imgResponse = await requestUrl({
              url: highResUrl,
              method: 'GET'
            });
          } catch (e) {
            // Fallback to original url
            imgResponse = await requestUrl({
              url: img.originalUrl,
              method: 'GET'
            });
          }

          const contentType = imgResponse.headers['content-type'] || '';
          let ext = '.jpg';
          if (contentType.includes('image/png')) ext = '.png';
          else if (contentType.includes('image/jpeg')) ext = '.jpg';
          else if (contentType.includes('image/webp')) ext = '.webp';
          else if (contentType.includes('image/gif')) ext = '.gif';
          else if (contentType.includes('image/svg+xml')) ext = '.svg';

          const filename = `${img.finalName}${ext}`;
          const initialPath = attachFolder ? `${attachFolder}/${filename}` : filename;
          
          // Safeguard: Check if attachment already exists, and if so, append suffix to avoid overwrite/corruption
          const savePath = await getSafeVaultPath(this.app.vault, initialPath);
          const finalFilename = savePath.includes('/') ? savePath.substring(savePath.lastIndexOf('/') + 1) : savePath;

          // Save binary safely
          await this.app.vault.createBinary(savePath, imgResponse.arrayBuffer);
          finalImageMap[img.originalUrl] = finalFilename;
        } catch (e) {
          console.error(`Failed to download image ${img.originalUrl}:`, e);
          new Notice(`Failed to download image: ${img.finalName}`);
        }
      }

      // 5. Replace placeholders in Markdown
      for (const [url, filename] of Object.entries(finalImageMap)) {
        const placeholder = `{{IMAGE:${url}}}`;
        let imgLink = '';
        if (this.settings.linkMode === 'wikilink') {
          imgLink = `![[${filename}]]`;
        } else {
          const relativePath = attachFolder ? `${attachFolder}/${encodeURIComponent(filename)}` : encodeURIComponent(filename);
          imgLink = `![${filename}](${relativePath})`;
        }
        markdown = markdown.split(placeholder).join(imgLink);
      }

      // Clean remaining placeholders
      markdown = markdown.replace(/\{\{IMAGE:([^}]+)\}\}/g, '');

      // 6. Create Markdown file safely with suffix naming to prevent note obliteration
      const noteName = this.articleData.isMovie ? `${this.articleData.movieTitle} (${this.articleData.releaseYear})` : this.articleData.title;
      const cleanNoteName = noteName.replace(/[\\/*?:"<>|]/g, '-').trim();
      const initialNotePath = `${cleanNoteName}.md`;
      
      const notePath = await getSafeVaultPath(this.app.vault, initialNotePath);
      const noteFile = await this.app.vault.create(notePath, markdown);
      new Notice('Note created successfully!');

      // 7. Open the created file
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(noteFile);

      this.close();
    } catch (error) {
      console.error(error);
      new Notice(`Import failed: ${error.message}`);
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.innerText = 'Import Article';
      }
    }
  }

  getHighResUrl(url) {
    if (!url) return '';
    if (url.includes('/thumb/')) {
      const parts = url.split('/');
      const thumbIndex = parts.indexOf('thumb');
      if (thumbIndex !== -1) {
        parts.splice(thumbIndex, 1);
        const lastPart = parts[parts.length - 1];
        if (lastPart.match(/^\d+px-/) || (lastPart.toLowerCase().endsWith('.png') && parts[parts.length - 2].toLowerCase().endsWith('.svg'))) {
          parts.pop();
        }
        return parts.join('/');
      }
    }
    return url;
  }
}

class WikiImporterSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Wikipedia Importer Settings' });

    containerEl.createEl('h3', { text: 'Local Scraping Server Lifecycle' });

    new Setting(containerEl)
      .setName('Repository Root Path')
      .setDesc('Absolute directory path to your wikipedia_to_markdown root folder (needed to manage process)')
      .addText(text => text
        .setPlaceholder('c:\\Users\\djwri\\Documents\\GitHub\\wikipedia_to_markdown')
        .setValue(this.plugin.settings.repoPath)
        .onChange(async (value) => {
          this.plugin.settings.repoPath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Manage Server Automatically')
      .setDesc('Automatically spin up the local server when opening the importer modal, and stop it on exit')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoManageServer)
        .onChange(async (value) => {
          this.plugin.settings.autoManageServer = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Server Status & Manual Control')
      .setDesc(`Current process status: ${this.plugin.serverProcess ? 'RUNNING 🟢' : 'STOPPED 🔴'}`)
      .addButton(btn => {
        const isRunning = this.plugin.serverProcess !== null;
        btn.setButtonText(isRunning ? 'Stop Server' : 'Start Server')
           .onClick(async () => {
             if (isRunning) {
               this.plugin.stopLocalServer();
             } else {
               this.plugin.startLocalServer();
             }
             // Force refresh display quickly
             setTimeout(() => this.display(), 1000);
           });
        if (isRunning) {
          btn.setClass('mod-warning');
        } else {
          btn.setClass('mod-cta');
        }
      });

    containerEl.createEl('h3', { text: 'Import Formatting & Paths' });

    new Setting(containerEl)
      .setName('Local Server URL')
      .setDesc('The address of your running local Node server')
      .addText(text => text
        .setPlaceholder('http://localhost:3000')
        .setValue(this.plugin.settings.serverUrl)
        .onChange(async (value) => {
          this.plugin.settings.serverUrl = value.trim() || 'http://localhost:3000';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Default Attachments Folder')
      .setDesc('Folder in your vault where downloaded images are saved')
      .addText(text => text
        .setPlaceholder('Attachments')
        .setValue(this.plugin.settings.attachmentsFolder)
        .onChange(async (value) => {
          this.plugin.settings.attachmentsFolder = value.trim() || 'Attachments';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Link Mode')
      .setDesc('How Wikipedia internal links are processed')
      .addDropdown(dropdown => dropdown
        .addOption('standard', 'Standard Markdown [Text](URL)')
        .addOption('wikilink', 'Obsidian Wikilink [[Target|Text]]')
        .addOption('comment', 'Commented-out Link Text%%[Link](URL)%%')
        .addOption('plain', 'Plain Text (Strip Links)')
        .setValue(this.plugin.settings.linkMode)
        .onChange(async (value) => {
          this.plugin.settings.linkMode = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Omit References')
      .setDesc('If enabled, reference footnotes and bibliography sections are skipped')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.omitReferences)
        .onChange(async (value) => {
          this.plugin.settings.omitReferences = value;
          await this.plugin.saveSettings();
        }));
  }
}

// Support Obsidian plugin class loading
module.exports = WikiImporterPlugin;
