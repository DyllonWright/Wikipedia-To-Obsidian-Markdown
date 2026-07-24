// public/app.js

// Global state variables
let articleData = null; // Stores parsed data from the server

// DOM Elements
const elUrl = document.getElementById('wiki-url');
const elBtnAnalyze = document.getElementById('btn-analyze');
const elSaveToVault = document.getElementById('save-to-vault');
const elVaultSettings = document.getElementById('vault-settings');
const elVaultPath = document.getElementById('vault-path');
const elAttachmentsFolder = document.getElementById('attachments-folder');
const elImportDate = document.getElementById('import-date');
const elLinkMode = document.getElementById('link-mode');
const elOmitReferences = document.getElementById('omit-references');

// States
const stateInitial = document.getElementById('state-initial');
const stateLoading = document.getElementById('state-loading');
const stateReady = document.getElementById('state-ready');
const loadingTitle = document.getElementById('loading-title');
const loadingDesc = document.getElementById('loading-desc');

// Ready view elements
const elMovieBanner = document.getElementById('movie-banner');
const elMovieTitle = document.getElementById('movie-title');
const elMovieYear = document.getElementById('movie-year');
const elMovieDesc = document.getElementById('movie-desc');
const elImageCount = document.getElementById('image-count');

// Tabs
const tabButtons = document.querySelectorAll('.tab-button');
const tabPanes = document.querySelectorAll('.tab-pane');
const sectionsContainer = document.getElementById('sections-checklist-container');
const imagesContainer = document.getElementById('images-container');
const previewTextarea = document.getElementById('markdown-preview-textarea');

// Actions
const btnSelectAll = document.getElementById('btn-select-all');
const btnSelectNone = document.getElementById('btn-select-none');
const btnCopyPreview = document.getElementById('btn-copy-preview');
const btnExport = document.getElementById('btn-export');
const exportStatusSummary = document.getElementById('export-status-summary');
const consoleLogsContainer = document.getElementById('console-logs-container');
const btnClearConsole = document.getElementById('btn-clear-console');

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  // Set default date to today in the browser's local timezone. Local
  // components avoid the UTC roll-forward that toISOString() causes for
  // late-evening imports west of UTC.
  const today = new Date();
  elImportDate.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Load settings from localStorage
  loadSettings();

  // Setup Event Listeners
  elBtnAnalyze.addEventListener('click', analyzeArticle);
  elUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') analyzeArticle();
  });

  elSaveToVault.addEventListener('change', toggleVaultSettings);
  
  // Tab toggling
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // Section selectors
  btnSelectAll.addEventListener('click', () => toggleAllSections(true));
  btnSelectNone.addEventListener('click', () => toggleAllSections(false));
  
  // Exporter & Copy
  btnCopyPreview.addEventListener('click', copyMarkdownToClipboard);
  btnExport.addEventListener('click', exportArticleData);
  btnClearConsole.addEventListener('click', () => {
    consoleLogsContainer.innerHTML = '';
  });

  // Listeners that trigger preview auto-compilation
  elLinkMode.addEventListener('change', triggerPreviewUpdate);
  elOmitReferences.addEventListener('change', triggerPreviewUpdate);

  // Initialize UI displays
  toggleVaultSettings();
});

// Write to console logger panel
function log(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  line.innerText = `[${timestamp}] ${msg}`;
  consoleLogsContainer.appendChild(line);
  consoleLogsContainer.scrollTop = consoleLogsContainer.scrollHeight;
}

// Persist settings
function saveSettings() {
  const settings = {
    saveToVault: elSaveToVault.checked,
    vaultPath: elVaultPath.value,
    attachmentsFolder: elAttachmentsFolder.value,
    linkMode: elLinkMode.value,
    omitReferences: elOmitReferences.checked
  };
  localStorage.setItem('wiki_importer_settings', JSON.stringify(settings));
}

function loadSettings() {
  const saved = localStorage.getItem('wiki_importer_settings');
  if (saved) {
    try {
      const settings = JSON.parse(saved);
      elSaveToVault.checked = settings.saveToVault || false;
      elVaultPath.value = settings.vaultPath || '';
      elAttachmentsFolder.value = settings.attachmentsFolder || 'Attachments';
      elLinkMode.value = settings.linkMode || 'wikilink';
      elOmitReferences.checked = settings.omitReferences || false;
    } catch (e) {
      console.error('Failed to parse saved settings:', e);
    }
  }
}

function toggleVaultSettings() {
  saveSettings();
  if (elSaveToVault.checked) {
    elVaultSettings.classList.remove('collapsed');
    btnExport.innerText = 'Export to Obsidian';
  } else {
    elVaultSettings.classList.add('collapsed');
    btnExport.innerText = 'Download Markdown Bundle';
  }
}

function switchTab(tabId) {
  tabButtons.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  tabPanes.forEach(pane => {
    if (pane.id === tabId) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });

  // If entering preview tab, trigger compilation
  if (tabId === 'tab-preview') {
    updatePreviewText();
  }
}

// Fetch article and query Gemini analysis
async function analyzeArticle() {
  const url = elUrl.value.trim();
  if (!url) {
    log('Error: Please enter a Wikipedia URL.', 'error');
    alert('Please enter a Wikipedia URL.');
    return;
  }

  // Save current UI state settings
  saveSettings();

  // Update UI States
  stateInitial.classList.remove('active');
  stateReady.classList.remove('active');
  stateLoading.classList.add('active');
  
  const formattedDate = elImportDate.value.replace(/-/g, ' '); // YYYY MM DD
  
  loadingTitle.innerText = "Connecting to Wikipedia...";
  loadingDesc.innerText = "Downloading article HTML content...";
  log(`Fetching HTML for: ${url}`);

  try {
    const analyzeUrl = `/api/analyze?url=${encodeURIComponent(url)}&date=${encodeURIComponent(formattedDate)}`;
    
    // Periodically update loader description for better feedback
    const loaderInterval = setInterval(() => {
      if (loadingTitle.innerText.includes("Wikipedia")) {
        loadingTitle.innerText = "Calling Gemini API...";
        loadingDesc.innerText = "Analyzing article context, identifying movie structures, and generating image filenames...";
      }
    }, 2500);

    const response = await fetch(analyzeUrl);
    clearInterval(loaderInterval);

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Server failed to analyze the article.');
    }

    articleData = await response.json();
    log(`Successfully analyzed: "${articleData.title}"`, 'success');
    
    // Render the article configurations
    renderArticleView();
    
    // Transition UI State
    stateLoading.classList.remove('active');
    stateReady.classList.add('active');
    
    // Go to Sections tab first
    switchTab('tab-sections');
    
  } catch (error) {
    console.error(error);
    log(`Analysis failed: ${error.message}`, 'error');
    stateLoading.classList.remove('active');
    stateInitial.classList.add('active');
    alert(`Failed to analyze Wikipedia page: ${error.message}`);
  }
}

// Render the parsed content configs in the UI
function renderArticleView() {
  if (!articleData) return;

  // 1. Movie Banner Detection
  if (articleData.isMovie) {
    elMovieBanner.classList.remove('hidden');
    elMovieTitle.value = articleData.movieTitle;
    elMovieYear.value = articleData.releaseYear;
    elMovieDesc.innerText = articleData.briefDescription || '';
    
    // Add change listeners to auto update poster name when title/year edits occur
    elMovieTitle.removeEventListener('input', updatePosterNames);
    elMovieYear.removeEventListener('input', updatePosterNames);
    elMovieTitle.addEventListener('input', updatePosterNames);
    elMovieYear.addEventListener('input', updatePosterNames);
  } else {
    elMovieBanner.classList.add('hidden');
  }

  // 2. Sections checklist
  sectionsContainer.innerHTML = '';
  articleData.sections.forEach(section => {
    const item = document.createElement('div');
    
    item.className = `section-item lvl-${section.level}`;
    item.innerHTML = `
      <label class="checkbox-container">
        <input type="checkbox" class="section-check" data-id="${section.id}" checked>
        <span class="checkmark"></span>
        <span class="sec-badge badge-h${section.level}">H${section.level}</span>
        <span class="sec-title">${section.title}</span>
      </label>
    `;
    sectionsContainer.appendChild(item);
    
    // Add change listener to checkboxes to trigger count and preview update
    item.querySelector('.section-check').addEventListener('change', () => {
      updateSummaryCounts();
      triggerPreviewUpdate();
    });
  });

  // 3. Images grid
  imagesContainer.innerHTML = '';
  elImageCount.innerText = articleData.images.length;
  
  if (articleData.images.length === 0) {
    imagesContainer.innerHTML = '<p class="help-text" style="grid-column: 1/-1; text-align: center; padding: 20px;">No images found in this article.</p>';
  } else {
    articleData.images.forEach((img, idx) => {
      const card = document.createElement('div');
      card.className = 'image-card';
      card.setAttribute('data-idx', idx);
      
      card.innerHTML = `
        <div class="image-card-header">
          <label class="image-checkbox-label">
            <input type="checkbox" class="image-check" checked data-idx="${idx}">
            Include image
          </label>
          ${img.isPoster ? '<span class="poster-tag">Poster</span>' : ''}
        </div>
        <div class="image-preview-box">
          <img src="${img.originalUrl}" alt="Preview" onerror="this.src='https://placehold.co/150x150?text=No+Preview'">
        </div>
        <div class="image-card-details">
          <label>Obsidian Filename (No Ext)</label>
          <input type="text" class="image-name-input" data-idx="${idx}" value="${img.suggestedName}">
          <p class="image-caption-text" title="${img.caption || ''}">${img.caption || 'No caption'}</p>
        </div>
      `;
      imagesContainer.appendChild(card);
      
      // Add toggling transparency classes
      const checkbox = card.querySelector('.image-check');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          card.classList.remove('excluded');
        } else {
          card.classList.add('excluded');
        }
        updateSummaryCounts();
        triggerPreviewUpdate();
      });
      
      card.querySelector('.image-name-input').addEventListener('input', triggerPreviewUpdate);
    });
  }

  // Update footer summaries
  updateSummaryCounts();
}

// Auto update image names if movie title or year is changed in banner
function updatePosterNames() {
  const mTitle = elMovieTitle.value.trim();
  const mYear = elMovieYear.value.trim();
  const formattedDate = elImportDate.value.replace(/-/g, ' '); // YYYY MM DD
  
  // Find poster images in our grid and update their name values
  articleData.images.forEach((img, idx) => {
    if (img.isPoster) {
      const input = document.querySelector(`.image-name-input[data-idx="${idx}"]`);
      if (input) {
        input.value = `${formattedDate} ${mTitle} (${mYear || 'Year'}) Theatrical Release Poster`;
      }
    }
  });
  triggerPreviewUpdate();
}

function toggleAllSections(checked) {
  document.querySelectorAll('.section-check').forEach(box => {
    box.checked = checked;
  });
  updateSummaryCounts();
  triggerPreviewUpdate();
}

function getSelectedSectionIds() {
  const ids = [];
  document.querySelectorAll('.section-check').forEach(box => {
    if (box.checked) {
      ids.push(box.getAttribute('data-id'));
    }
  });
  return ids;
}

function getSelectedImages() {
  const list = [];
  document.querySelectorAll('.image-check').forEach(box => {
    if (box.checked) {
      const idx = parseInt(box.getAttribute('data-idx'));
      const input = document.querySelector(`.image-name-input[data-idx="${idx}"]`);
      list.push({
        originalUrl: articleData.images[idx].originalUrl,
        finalName: input.value.trim()
      });
    }
  });
  return list;
}

function updateSummaryCounts() {
  const selectedSecs = getSelectedSectionIds().length;
  const selectedImgs = getSelectedImages().length;
  
  document.getElementById('summary-section-count').innerText = selectedSecs;
  document.getElementById('summary-image-count').innerText = selectedImgs;
  
  if (elSaveToVault.checked) {
    btnExport.innerText = 'Export to Obsidian';
  } else {
    btnExport.innerText = 'Download Markdown Bundle';
  }
}

// Compile article content locally or through server
let previewTimeout = null;
function triggerPreviewUpdate() {
  // Debounce to prevent heavy rendering on fast typing in input boxes
  if (previewTimeout) clearTimeout(previewTimeout);
  previewTimeout = setTimeout(() => {
    if (stateReady.classList.contains('active') && document.getElementById('tab-preview').classList.contains('active')) {
      updatePreviewText();
    }
  }, 400);
}

async function updatePreviewText() {
  if (!articleData) return;

  const selectedSections = getSelectedSectionIds();
  const selectedImages = getSelectedImages();
  const linkMode = elLinkMode.value;
  const omitReferences = elOmitReferences.checked;

  previewTextarea.value = "Compiling preview...";

  try {
    // 1. Generate core markdown from server
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: articleData.title,
        url: articleData.url,
        rawSections: articleData.rawSections,
        selectedSections,
        linkMode,
        omitReferences
      })
    });

    if (!response.ok) throw new Error('Failed to generate markdown');
    
    const genData = await response.json();
    let md = genData.markdown;

    // 2. Inline images locally for preview representation
    const attachmentsFolder = elAttachmentsFolder.value || 'Attachments';
    selectedImages.forEach(img => {
      const placeholder = `{{IMAGE:${img.originalUrl}}}`;
      let replaceLink = '';
      if (linkMode === 'wikilink') {
        replaceLink = `![[${img.finalName}.png]]`;
      } else {
        replaceLink = `![${img.finalName}](${attachmentsFolder}/${encodeURIComponent(img.finalName)}.png)`;
      }
      md = md.split(placeholder).join(replaceLink);
    });

    // Clean remaining placeholders
    md = md.replace(/\{\{IMAGE:([^}]+)\}\}/g, (_, url) => `*[Image Attachment]*`);

    previewTextarea.value = md;
  } catch (e) {
    console.error(e);
    previewTextarea.value = `Error generating preview: ${e.message}`;
  }
}

function copyMarkdownToClipboard() {
  previewTextarea.select();
  document.execCommand('copy');
  log('Copied preview markdown to clipboard.', 'success');
}

// Export action: compiles, downloads files, and writes to disk
async function exportArticleData() {
  if (!articleData) return;

  saveSettings();

  const selectedSections = getSelectedSectionIds();
  const selectedImages = getSelectedImages();
  const linkMode = elLinkMode.value;
  const omitReferences = elOmitReferences.checked;
  const saveToVault = elSaveToVault.checked;
  const vaultPath = elVaultPath.value.trim();
  const attachmentsFolder = elAttachmentsFolder.value.trim();

  if (saveToVault && !vaultPath) {
    alert('Please enter an absolute Obsidian Vault path in the sidebar.');
    elVaultPath.focus();
    return;
  }

  // Update export button UI state
  btnExport.disabled = true;
  const btnText = btnExport.querySelector('.btn-text');
  const btnSpinner = btnExport.querySelector('.spinner-small');
  
  const originalBtnText = btnText.innerText;
  btnText.innerText = saveToVault ? 'Exporting...' : 'Downloading...';
  btnSpinner.classList.remove('hidden');

  log(`Starting export process for article: "${articleData.title}"`);
  if (saveToVault) log(`Targeting Obsidian Vault: ${vaultPath}`);

  try {
    // 1. Get raw compiled markdown (retains image placeholders for file exporter to replace)
    const genResponse = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: articleData.isMovie ? `${articleData.movieTitle} (${articleData.releaseYear})` : articleData.title,
        url: articleData.url,
        rawSections: articleData.rawSections,
        selectedSections,
        linkMode,
        omitReferences
      })
    });

    if (!genResponse.ok) throw new Error('Markdown assembly endpoint failed.');
    const { markdown } = await genResponse.json();

    // 2. Post export call with attachments downloads
    log(`Downloading and saving ${selectedImages.length} attachments...`);
    const exportResponse = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: articleData.isMovie ? `${articleData.movieTitle} (${articleData.releaseYear})` : articleData.title,
        markdown,
        images: selectedImages,
        saveToVault,
        vaultPath,
        attachmentsFolder,
        linkMode
      })
    });

    if (!exportResponse.ok) {
      const errData = await exportResponse.json();
      throw new Error(errData.error || 'Server failed to write files.');
    }

    const report = await exportResponse.json();
    
    log(`Export Completed!`, 'success');
    log(`Markdown written to: ${report.markdownPath}`, 'success');
    log(`Images saved in: ${report.attachmentsPath} (Downloaded: ${report.imagesDownloaded}, Failed: ${report.imagesFailed})`, 'success');
    
    if (report.errors && report.errors.length > 0) {
      report.errors.forEach(err => {
        log(`Failed image download: ${err.url} -> ${err.error}`, 'error');
      });
    }

    alert(`Successfully exported Wikipedia Article!\n\nNote written to: ${report.markdownPath}\nImages saved: ${report.imagesDownloaded}`);

  } catch (error) {
    console.error(error);
    log(`Export failed: ${error.message}`, 'error');
    alert(`Export failed: ${error.message}`);
  } finally {
    btnExport.disabled = false;
    btnText.innerText = originalBtnText;
    btnSpinner.classList.add('hidden');
  }
}
