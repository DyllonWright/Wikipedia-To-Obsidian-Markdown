// index.js
require("dotenv").config();
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cheerio = require('cheerio');

// --- Configuration ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const outputBaseDir = path.join(__dirname, "output");

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
    1.  Extract the main article content and convert it to well-formatted, Github-flavored Markdown.
    2.  **Crucially, convert all relative Wikipedia links (e.g., `/wiki/Some_Article`) to full URLs (e.g., `https://en.wikipedia.org/wiki/Some_Article`).**
    3.  Identify the URL of the most relevant image in the article.
    4.  Return the content in the following format, with no other text or explanation:

    MARKDOWN_CONTENT_START
    [The full article content in Markdown]
    MARKDOWN_CONTENT_END

    IMAGE_URL_START
    [The URL of the most relevant image]
    IMAGE_URL_END
  `;
  const result = await model.generateContent([prompt, html]);
  const response = await result.response;
  const text = await response.text();

  try {
    const markdownMatch = text.match(/MARKDOWN_CONTENT_START\n([\s\S]*)\nMARKDOWN_CONTENT_END/);
    const imageUrlMatch = text.match(/IMAGE_URL_START\n(.*)\nIMAGE_URL_END/);

    if (!markdownMatch || !imageUrlMatch) {
      throw new Error("Failed to parse model output.");
    }

    const markdown = markdownMatch[1].trim();
    const imageUrl = imageUrlMatch[1].trim();

    return { markdown, imageUrl };
  } catch(e) {
    console.error("Failed to parse custom format:", text);
    throw e;
  }
}


/**
 * Downloads a file from a URL and saves it to a local path.
 * @param {string} url The URL of the file to download.
 * @param {string} filePath The local path to save the file.
 * @returns {Promise<string>} The path to the downloaded file, or null on failure.
 */
async function downloadFile(url, filePath) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
      }
    });
    await fs.writeFile(filePath, response.data);
    return filePath;
  } catch (error) {
    console.error(`Error downloading file from ${url}:`, error.message);
    return null;
  }
}

/**
 * Scrapes and downloads all JPG and PNG images from the HTML content.
 * @param {string} html The HTML content of the page.
 * @param {string} articleDir The directory to save the images in.
 * @param {string} mainImageUrl The URL of the main image, to avoid re-downloading.
 */
async function downloadAllImages(html, articleDir, mainImageUrl) {
    const $ = cheerio.load(html);
    const imagePromises = [];

    $('img').each((i, img) => {
        const src = $(img).attr('src');
        if (src && (src.endsWith('.jpg') || src.endsWith('.png'))) {
            // Construct absolute URL if necessary
            let absoluteSrc = src;
            if (src.startsWith('//')) {
                absoluteSrc = `https:${src}`;
            } else if (!src.startsWith('http')) {
                // This logic might need to be more robust depending on the base URL
                // For Wikipedia, protocol-relative URLs are common.
                return; 
            }

            if (absoluteSrc === mainImageUrl) {
                return; // Skip the main image, it's handled separately
            }

            const imageName = path.basename(new URL(absoluteSrc).pathname);
            const imagePath = path.join(articleDir, imageName);
            
            console.log(`Found image: ${absoluteSrc}. Downloading...`);
            imagePromises.push(downloadFile(absoluteSrc, imagePath));
        }
    });

    await Promise.all(imagePromises);
}


/**
 * Saves the Markdown content to a file.
 * @param {string} content The Markdown content to save.
 * @param {string} filePath The full path for the file.
 * @returns {Promise<string>} The path to the saved file.
 */
async function saveMarkdown(content, filePath) {
  await fs.writeFile(filePath, content);
  return filePath;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Please provide a Wikipedia URL as a command-line argument.");
    process.exit(1);
  }

  try {
    const sanitizedTitle = path.basename(new URL(url).pathname)
      .replace(/_/g, ' ')
      .replace(/[^a-z0-9 ]/gi, '')
      .trim()
      .replace(/\s+/g, '_')
      .toLowerCase();
      
    const articleDir = path.join(outputBaseDir, sanitizedTitle);
    await fs.mkdir(articleDir, { recursive: true });

    console.log(`Fetching HTML from ${url}...`);
    const html = await fetchHtml(url);

    console.log("Extracting content with Gemini...");
    const { markdown, imageUrl } = await extractContentWithGemini(html);
    
    // Download all images found on the page
    console.log("Searching for and downloading all page images...");
    await downloadAllImages(html, articleDir, imageUrl);


    let finalMarkdown = markdown;
    if (imageUrl && imageUrl.startsWith('http')) {
      console.log(`Downloading main image from ${imageUrl}...`);
      const imageName = path.basename(new URL(imageUrl).pathname);
      const imagePath = path.join(articleDir, imageName);
      const downloadedImagePath = await downloadFile(imageUrl, imagePath);

      if (downloadedImagePath) {
        const relativeImagePath = path.basename(downloadedImagePath);
        finalMarkdown = `![${relativeImagePath}](${relativeImagePath})\n\n${markdown}`;
      }
    }

    const title = path.basename(new URL(url).pathname).replace(/_/g, ' ');
    const header = `# [${title}](${url})\n\n`;
    finalMarkdown = header + finalMarkdown;

    console.log(`Saving Markdown to file...`);
    const markdownPath = path.join(articleDir, 'article.md');
    await saveMarkdown(finalMarkdown, markdownPath);

    console.log(`\nSuccessfully converted ${url} to Markdown!`);
    console.log(`Content saved in: ${articleDir}`);
  } catch (error) {
    console.error("\nAn error occurred:", error.message);
    process.exit(1);
  }
}

main();
