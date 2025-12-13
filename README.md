# Wikipedia to Markdown Converter (Node.js)

This tool is a command-line interface (CLI) built with Node.js that converts a Wikipedia article into a clean, readable Markdown file. It leverages the Gemini API to intelligently extract the main article content and identify the most relevant image.

## Features

-   **Intelligent Content Extraction:** Uses a large language model to parse the main content of a Wikipedia article, ignoring irrelevant elements like navigation bars and sidebars.
-   **Image Identification:** Automatically identifies the most relevant image in the article (typically from the infobox) and includes it in the Markdown output.
-   **Markdown Conversion:** Converts the extracted HTML into well-formatted Markdown.
-   **Local File Storage:** Saves the final Markdown file and the downloaded image to a local `output` directory.

## Technology Stack

-   **Runtime:** Node.js
-   **Dependencies:**
    -   `axios`: To fetch the HTML from the Wikipedia URL and download images.
    -   `@google/generative-ai`: To interact with the Gemini API.
    -   `dotenv`: To manage environment variables for the API key.

## Project Structure

```
.
├── output/           <-- Generated Markdown files and images are saved here
├── .env              <-- For your GEMINI_API_KEY
├── .gitignore        <-- To exclude node_modules and .env from Git
├── index.js          <-- The main script
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

The script will create a new Markdown file and download the main image to the `output` directory.

## How to Update Your GitHub Repository

To integrate this new pipeline into your existing project, follow these steps:

1.  **Copy the Files:** Copy all the files from this project (`index.js`, `package.json`, `package-lock.json`, `.gitignore`, and the new `README.md`) into your existing repository, except for the `GEMINI.md` file.

2.  **Add a `.gitignore` File:** A `.gitignore` file has been included to prevent you from accidentally committing your `.env` file (which contains your secret API key) and the `node_modules` directory to your repository. This is crucial for security and to keep your repository lightweight.

3.  **Commit and Push the Changes:** Use the following Git commands to add the new files and push them to your repository:

    ```bash
    git add .
    git commit -m "feat: Add Wikipedia to Markdown conversion pipeline"
    git push
    ```

4.  **Replicating on Other Devices:**

    To use this pipeline on another device, clone your repository and then create a new `.env` file on that device with your `GEMINI_API_KEY`. This ensures that your API key remains secure and is never stored in the repository.
