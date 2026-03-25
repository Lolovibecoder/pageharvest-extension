/**
 * PageHarvest Background Service Worker
 * Handles download requests and auto-extract triggers from popup.
 * Manifest V3 service worker — no DOM access.
 */

"use strict";

/**
 * Listens for messages from popup.js
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "downloadText") {
    handleDownload(message.payload)
      .then(result => sendResponse({ success: true, downloadId: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    // Return true to keep the message channel open for async response
    return true;
  }

  if (message.action === "ping") {
    sendResponse({ alive: true });
    return false;
  }
});

/**
 * Creates a download for the extracted text.
 * @param {{ text: string, filename: string }} payload
 * @returns {Promise<number>} Chrome download ID
 */
async function handleDownload({ text, filename }) {
  if (!text || typeof text !== "string") {
    throw new Error("Invalid text payload for download.");
  }

  // Encode text as a data URL (blob approach not available in SW)
  const encoded = encodeURIComponent(text);
  const dataUrl = `data:text/plain;charset=utf-8,${encoded}`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename: sanitizeFilename(filename),
        saveAs: false,
        conflictAction: "uniquify"
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

/**
 * Sanitizes a filename by removing illegal characters.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 200);
}

/**
 * Listen for tab updates to support auto-extract on navigation.
 * Stores a flag that popup reads on open.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && !tab.url.startsWith("chrome://")) {
    // Store the last completed tab info so popup can check if re-extraction is needed
    chrome.storage.local.set({
      [`tab_completed_${tabId}`]: {
        url: tab.url,
        timestamp: Date.now()
      }
    }).catch(() => {});
  }
});

console.log("[PageHarvest] Background service worker initialized.");
