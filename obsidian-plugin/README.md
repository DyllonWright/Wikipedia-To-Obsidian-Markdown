# Wikipedia Obsidian Importer (Companion Plugin)

This plugin allows you to import Wikipedia articles directly from within Obsidian, leveraging a local scraping and parsing server. It handles clean table formatting, section selection, movie poster/image renaming conventions, and downloading high-resolution attachments directly into your vault.

## Prerequisites & Zero-Friction Lifecycle

To make your experience as frictionless as possible, the Obsidian plugin can **automatically manage the local Node.js scraper server process** for you:
1. Ensure you have your `GEMINI_API_KEY` defined in the `.env` file of the server repository.
2. In the plugin settings within Obsidian, specify your absolute **Repository Root Path** (e.g. `c:\Users\djwri\Documents\GitHub\wikipedia_to_markdown`).
3. Turn on **Manage Server Automatically**.
4. **That's it!** Opening the Wikipedia Importer modal inside Obsidian will automatically spin up the scraping server in the background. When you close the modal (or complete your import), the server is cleanly shut down, freeing up port 3000 and leaving no stray background processes on your system.

*Note: You can also manually start/stop the server inside the plugin settings or run it continuously in your terminal via `npm start`.*

## Installation

Since this is a custom local companion plugin, you can install it manually in your vault:

1. Open your Obsidian Vault in your file explorer.
2. Locate the hidden `.obsidian/` folder (you may need to enable hidden folders in your OS settings).
3. Inside `.obsidian/`, navigate to `plugins/` (create the `plugins/` directory if it does not exist).
4. Create a new directory named `wikipedia-obsidian-importer`.
5. Copy the following files from this repository's `obsidian-plugin/` directory into that folder:
   - `manifest.json`
   - `main.js`
6. Open Obsidian, go to **Settings** -> **Community Plugins**.
7. Click the **Reload** icon, then locate **Wikipedia Obsidian Importer** in the list and toggle it **ON**.

## Usage

1. Click the **Document (Wikipedia Importer)** ribbon icon on the left sidebar, or open the Command Palette (`Ctrl + P` or `Cmd + P`) and type `Wikipedia Importer`.
2. Paste your target Wikipedia URL (e.g., `https://en.wikipedia.org/wiki/JavaScript` or `https://en.wikipedia.org/wiki/The_Gambler_(2014_film)`) and click **Analyze Page**.
3. Once analysis is complete, a configuration dialog will appear:
   - **Movie articles**: If the article is a movie, edit the Title and Release Year to automatically rename the movie poster.
   - **Sections Checklist**: Toggle checkboxes to include or exclude specific sections of the article.
   - **Image Attachments**: Edit the Obsidian filenames for images or check/uncheck them to download only the ones you want.
4. Click **Import Article**.
5. The note will be compiled, all attachments downloaded into your default Attachments folder, and the new note will be opened automatically with all images resolved!

## Plugin Settings

Go to Obsidian **Settings** -> **Wikipedia Importer** to configure:
- **Repository Root Path**: The absolute path to your local `wikipedia_to_markdown` folder (e.g., `c:\Users\djwri\Documents\GitHub\wikipedia_to_markdown`).
- **Manage Server Automatically**: When enabled, the plugin automatically spawns and kills the local scraping server process.
- **Server Status & Manual Control**: Monitor your scraper server status or trigger starts/stops manually.
- **Local Server URL** (default: `http://localhost:3000`)
- **Default Attachments Folder** (defaults to your vault's default attachments folder)
- **Link Mode** (Wikilinks, standard Markdown, commented-out links, or plain text)
- **Omit References** (toggles footnotes/reference blocks)
