// index.js
require("dotenv").config();
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- Configuration ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const outputDir = path.join(__dirname, "output");
const imagesDir = path.join(__dirname, "images");

/**
 * Fetches the HTML content of a given URL.
 * @param {string} url The URL to fetch.
 * @returns {Promise<string>} The HTML content of the page.
 */
async function fetchHtml(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
      }
    });
    return data;
  } catch (error) {
    console.error(`Error fetching URL ${url}:`, error.message);
    throw new Error(`Failed to fetch HTML from ${url}.`);
  }
}

/**
 * Uses the Gemini model to extract content and an image URL from HTML.
 * @param {string} html The HTML content to process.
 * @returns {Promise<{markdown: string, imageUrl: string}>}
 */
async function extractContentWithGemini(html) {
  const prompt = `
    You are an expert at converting Wikipedia articles to Markdown.
    You will be given the HTML of a Wikipedia article.
    Your task is to:
    1.  Extract the main article content.
    2.  Convert the content to well-formatted Markdown.
    3.  Identify the URL of the most relevant image in the article (usually in the infobox).
    The output should be a JSON object with two keys: "markdown" and "imageUrl".
  `;
  const result = await model.generateContent([prompt, html]);
  const response = await result.response;
  const text = await response.text();
  // Remove markdown code block delimiters if present
  const cleanedText = text.replace(/^```json\n|\n```$/g, '');
  return JSON.parse(cleanedText);
}

/**
 * Downloads an image from a URL and saves it to a local directory.
 * @param {string} url The URL of the image to download.
 * @param {string} directory The directory to save the image in.
 * @returns {Promise<string>} The path to the downloaded image.
 */
async function downloadImage(url, directory) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
      }
    });
    const imageName = path.basename(new URL(url).pathname);
    const imagePath = path.join(directory, imageName);
    await fs.writeFile(imagePath, response.data);
    return imagePath;
  } catch (error) {
    console.error(`Error downloading image ${url}:`, error.message);
    // It's okay if the image download fails, we can proceed without it.
    return null;
  }
}

/**
 * Saves the Markdown content to a file.
 * @param {string} content The Markdown content to save.
 * @param {string} title The title of the article.
 * @param {string} directory The directory to save the file in.
 * @returns {Promise<string>} The path to the saved file.
 */
async function saveMarkdown(content, title, directory) {
  const fileName = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content);
  return filePath;
}


/**
 * Ensures that a directory exists, creating it if necessary.
 * @param {string} directory The directory to check/create.
 */
async function ensureDirectoryExists(directory) {
  try {
    await fs.mkdir(directory, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

async function main() {
  await ensureDirectoryExists(outputDir);
  await ensureDirectoryExists(imagesDir);
  const url = process.argv[2];
  if (!url) {
    console.error("Please provide a Wikipedia URL as a command-line argument.");
    process.exit(1);
  }

  try {
    console.log(`Fetching HTML from ${url}...`);
    const html = await fetchHtml(url);

    console.log("Extracting content with Gemini...");
    const { markdown, imageUrl } = await extractContentWithGemini(html);

    let finalMarkdown = markdown;
    if (imageUrl) {
      console.log(`Downloading image from ${imageUrl}...`);
      const imagePath = await downloadImage(imageUrl, outputDir);
      if (imagePath) {
        const relativeImagePath = path.relative(outputDir, imagePath);
        finalMarkdown = `![${path.basename(imagePath)}](${path.basename(imagePath)})\n\n${markdown}`;
      }
    }

    const title = path.basename(new URL(url).pathname).replace(/_/g, ' ');
    const header = `# [${title}](${url})\n\n`;
    finalMarkdown = header + finalMarkdown;

    console.log(`Saving Markdown to file...`);
    const markdownPath = await saveMarkdown(finalMarkdown, title, outputDir);

    console.log(`\nSuccessfully converted ${url} to Markdown!`);
    console.log(`Markdown file saved at: ${markdownPath}`);
  } catch (error) {
    console.error("\nAn error occurred:", error.message);
    process.exit(1);
  }
}

main();
