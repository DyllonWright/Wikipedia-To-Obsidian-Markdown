# Wikipedia ✦ Obsidian Importer

A modern, highly-polished tool designed to clean, structure, and import Wikipedia articles directly into your **Obsidian Vault** with zero friction. It converts headings, lists, and tables into perfect Markdown, downloads high-resolution page attachments, and supports automated image naming rules.

This project consists of three main components:
1. **Programmatic Scraper & Parser**: A robust backend that strips unnecessary Wikipedia layouts, resolves thumbnail images to high-resolution originals, and flattens complex tables into clean GFM Markdown tables.
2. **Interactive Web GUI Dashboard**: A premium, glassmorphic dark-mode web application to paste URLs, customize section selections, rename files with dynamic suggestions, and preview live Markdown.
3. **Companion Obsidian Plugin**: A native Obsidian plugin that interacts with the local server to run the import panel directly inside your vault.

---

## ✦ Key Features

- **Smart Gemini Integration**:
  - Automatically identifies if the page is about a **movie/film**.
  - Extracts the official title and release year.
  - Suggests descriptive, clean image filenames (omitting icons/layout assets) based on a prefix date and the image's caption.
- **Custom Image Naming Conventions**:
  - Automatically formats standard images as: `YYYY MM DD Brief Description.ext`
  - Formats movie covers as: `YYYY MM DD Movie Title (YYYY) Theatrical Release Poster.ext`
- **Obsidian Vault Integration**:
  - Save directly to your vault root or subfolders.
  - Places attachments into your default Obsidian attachments folder (e.g. `Attachments/`), instantly resolving all in-context links.
- **Section Selection Checklist**:
  - Preview the structure of the article and toggle individual headings on or off before exporting.
  - Automatically excludes index lists, external links, and stub sections by default.
- **Robust Link Processing**:
  - Select between standard Markdown links `[Text](URL)`, native Obsidian Wikilinks `[[Target|Text]]`, commented-out links using Obsidian's hidden comment markers `Text%%[Link](URL)%%`, or pure plain text.
- **Table Flattener**:
  - Programmatically resolves HTML tables containing cells with `colspan` and `rowspan` parameters, ensuring table structures do not break when rendered in Markdown.

---

## ✦ Quick Start

### 1. Installation

Clone this repository and install the dependencies:
```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the root of the project (you can copy `.env.example` as a starting point) and add your Gemini API Key:
```env
GEMINI_API_KEY=YOUR_ACTUAL_GEMINI_API_KEY
PORT=3000
```

### 3. Run the Server

Start the local server in watch mode:
```bash
npm run dev
```
Once started, you will see a console printout:
```
==================================================
Wikipedia to Obsidian Markdown Server Running!
Access GUI: http://localhost:3000
==================================================
```

Open your browser and navigate to `http://localhost:3000` to access the full-featured dashboard.

---

## ✦ Companion Obsidian Plugin Setup

To import Wikipedia pages without leaving Obsidian, you can install the custom companion plugin located in the `obsidian-plugin/` directory:

1. Open your Obsidian vault folder in your file explorer.
2. Locate or create the directory: `<vault-root>/.obsidian/plugins/` (note: `.obsidian` is a hidden directory).
3. Create a subfolder named `wikipedia-obsidian-importer`.
4. Copy the following files from this repository's `obsidian-plugin/` folder into that subfolder:
   - `manifest.json`
   - `main.js`
5. Open Obsidian, navigate to **Settings** -> **Community Plugins**, click **Reload**, and enable **Wikipedia Obsidian Importer**.
6. Make sure the local Node.js server (`npm run dev`) is running. Click the new ribbon icon or run the command `Import Wikipedia Page` to start importing notes natively inside Obsidian!

---

## ✦ Project Architecture

```
.
├── public/                 <-- Interactive Web GUI Dashboard
│   ├── index.html          <-- UI layout structure
│   ├── style.css           <-- Premium glassmorphic styling
│   └── app.js              <-- Front-end controller & states
├── src/                    <-- Backend logic modules
│   ├── parser.js           <-- Programmatic cheerio scraping & element filtering
│   ├── gemini.js           <-- Gemini metadata extraction & image naming suggestions
│   └── exporter.js         <-- High-res image download & file export manager
├── obsidian-plugin/        <-- Obsidian Plugin Companion
│   ├── manifest.json       <-- Plugin configuration
│   ├── main.js             <-- Native Obsidian modal, settings, and file writers
│   └── README.md           <-- Plugin installation instructions
├── output/                 <-- Fallback local output folder
├── .env.example            <-- Environment template
├── server.js               <-- Express server entrypoint
└── package.json            <-- Dependency configuration
```
