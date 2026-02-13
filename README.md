# Wikipedia to Markdown Converter (Node.js)

This tool is a command-line interface (CLI) built with Node.js that converts a Wikipedia article into a clean, readable Markdown file. It leverages the Gemini API to intelligently extract the main article content, identify the most relevant image, and download all images from the article.

## Features

-   **Intelligent Content Extraction:** Uses a large language model to parse the main content of a Wikipedia article, ignoring irrelevant elements.
-   **Image Identification:** Automatically identifies the most relevant image in the article and includes it in the Markdown output.
-   **Full Image Scraping:** Downloads all other `.jpg` and `.png` images from the article and saves them locally.
-   **Organized Output:** Creates a dedicated directory for each article to store the Markdown file and all associated images.
-   **Markdown Conversion:** Converts the extracted HTML into well-formatted Markdown.

## Technology Stack

-   **Runtime:** Node.js
-   **Dependencies:**
    -   `axios`: To fetch the HTML from the Wikipedia URL and download images.
    -   `@google/generative-ai`: To interact with the Gemini API.
    -   `cheerio`: To parse the HTML and extract all image tags.
    -   `dotenv`: To manage environment variables for the API key.

## Project Structure

```
.
├── output/
│   └── [article_title]/    <-- A directory is created for each article
│       ├── article.md      <-- The generated Markdown file
│       └── ...images...    <-- All downloaded images for the article
├── .env                      <-- For your GEMINI_API_KEY
├── .gitignore                <-- To exclude node_modules and .env from Git
├── index.js                  <-- The main script
└── package.json
```

## Setup and Usage

**1. Installation:**

First, install the necessary dependencies:

```bash
npm install
```

**2. API Key Configuration:**

Create a `.env` file in the root of the project and add your Gemini API key:

```
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

Replace `YOUR_GEMINI_API_KEY` with your actual API key.

**3. Running the Script:**

Execute the script from your terminal with a Wikipedia URL as the argument:

```bash
node index.js "https://en.wikipedia.org/wiki/JavaScript"
```

The script will create a new directory named after the article (e.g., `output/javascript/`) containing the `article.md` file and all images downloaded from the page.
