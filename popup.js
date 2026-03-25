/**
 * PageHarvest Popup Controller
 * Orchestrates UI state, extraction calls, and download triggers.
 */

"use strict";

/* ─── DOM References ─────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const statusBadge   = $("statusBadge");
const statusText    = $("statusText");
const pageUrl       = $("pageUrl");
const statWords     = $("statWords");
const statChars     = $("statChars");
const statLines     = $("statLines");
const previewBox    = $("previewBox");
const previewPlaceholder = $("previewPlaceholder");
const extractBtn    = $("extractBtn");
const extractBtnText = $("extractBtnText");
const downloadBtn   = $("downloadBtn");
const copyBtn       = $("copyBtn");
const copyBtnText   = $("copyBtnText");
const errorMessage  = $("errorMessage");
const errorText     = $("errorText");
const toast         = $("toast");
const footerTimestamp = $("footerTimestamp");
const toggleAutoExtract  = $("toggleAutoExtract");
const toggleAutoDownload = $("toggleAutoDownload");

/* ─── App State ──────────────────────────────────────────────────── */
const state = {
  status: "idle",       // idle | extracting | done | error
  extractedText: null,
  currentTab: null,
  lastDownloadId: null,
  isDownloading: false,
  toastTimer: null
};

/* ─── Status Helpers ─────────────────────────────────────────────── */
function setStatus(newStatus, label) {
  state.status = newStatus;
  statusBadge.className = `status-badge ${newStatus}`;
  statusText.textContent = label || newStatus.toUpperCase();
}

function showError(msg) {
  setStatus("error", "ERROR");
  errorText.textContent = msg;
  errorMessage.classList.add("visible");
}

function hideError() {
  errorMessage.classList.remove("visible");
}

/* ─── Toast ──────────────────────────────────────────────────────── */
function showToast(msg, type = "info", duration = 2800) {
  if (state.toastTimer) clearTimeout(state.toastTimer);
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  state.toastTimer = setTimeout(() => {
    toast.className = `toast ${type}`;
  }, duration);
}

/* ─── Stats Display ──────────────────────────────────────────────── */
function updateStats(text) {
  if (!text) {
    statWords.textContent = "—";
    statChars.textContent = "—";
    statLines.textContent = "—";
    return;
  }

  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const chars = text.length;
  const lines = text.split("\n").length;

  statWords.textContent = formatNumber(words);
  statChars.textContent = formatNumber(chars);
  statLines.textContent = formatNumber(lines);
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

/* ─── Preview Display ────────────────────────────────────────────── */
function renderPreview(text) {
  // Remove the placeholder span
  if (previewPlaceholder) {
    previewPlaceholder.style.display = "none";
  }
  previewBox.classList.add("has-content");

  // Limit preview to first ~4000 chars to avoid rendering lag
  const MAX_PREVIEW = 4000;
  const truncated = text.length > MAX_PREVIEW
    ? text.slice(0, MAX_PREVIEW) + `\n\n… [${formatNumber(text.length - MAX_PREVIEW)} more chars — download to see full content]`
    : text;

  previewBox.textContent = truncated;
  previewBox.scrollTop = 0;
}

function clearPreview() {
  previewBox.classList.remove("has-content");
  previewBox.textContent = "";
  if (previewPlaceholder) {
    previewPlaceholder.style.display = "";
    previewBox.appendChild(previewPlaceholder);
  }
}

/* ─── Button State ───────────────────────────────────────────────── */
function setExtracting(active) {
  if (active) {
    extractBtn.disabled = true;
    extractBtnText.textContent = "Extracting…";
    // Replace icon with spinner
    const icon = extractBtn.querySelector(".btn-icon");
    if (icon) {
      icon.outerHTML = `<span class="btn-spinner" id="extractSpinner"></span>`;
    }
  } else {
    extractBtn.disabled = false;
    extractBtnText.textContent = "Extract";
    const spinner = $("extractSpinner");
    if (spinner) {
      spinner.outerHTML = `<svg class="btn-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M3 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H3zm1 1.5h8v7H4v-7zm0 8.5v-1h8v1H4z"/>
      </svg>`;
    }
  }
}

function setDownloading(active) {
  if (active) {
    downloadBtn.disabled = true;
    downloadBtnText.textContent = "Saving…";
    const icon = downloadBtn.querySelector(".btn-icon");
    if (icon) {
      icon.outerHTML = `<span class="btn-spinner" id="downloadSpinner"></span>`;
    }
  } else {
    downloadBtn.disabled = !state.extractedText;
    downloadBtnText.textContent = "Download";
    const spinner = $("downloadSpinner");
    if (spinner) {
      spinner.outerHTML = `<svg class="btn-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 10.5 4.5 7H7V2h2v5h2.5L8 10.5zm-5 2v-1.5h10V12.5H3z"/>
      </svg>`;
    }
  }
}

/* ─── Filename Generation ────────────────────────────────────────── */
function buildFilename(tab) {
  try {
    const url = new URL(tab.url);
    const domain = url.hostname.replace(/^www\./, "");
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "_",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join("");
    return `pageharvest_${domain}_${ts}.txt`;
  } catch {
    return `pageharvest_${Date.now()}.txt`;
  }
}

/* ─── Core: Extract Text ─────────────────────────────────────────── */
async function extractText() {
  if (!state.currentTab) {
    showError("No active tab found.");
    return;
  }

  const tabId = state.currentTab.id;
  const tabUrl = state.currentTab.url || "";

  // Block on restricted pages
  if (tabUrl.startsWith("chrome://") || tabUrl.startsWith("chrome-extension://") || tabUrl.startsWith("about:") || tabUrl === "") {
    showError("Cannot extract from browser internal pages.\nNavigate to a regular webpage and try again.");
    return;
  }

  hideError();
  clearPreview();
  updateStats(null);
  setStatus("extracting", "EXTRACTING");
  setExtracting(true);
  state.extractedText = null;
  downloadBtn.disabled = true;
  copyBtn.disabled = true;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: contentScriptFn,
    });

    if (!results || results.length === 0) {
      throw new Error("Script execution returned no results.");
    }

    const result = results[0].result;

    if (!result) {
      throw new Error("Content script returned null. The page may have restricted scripting.");
    }

    if (!result.success) {
      throw new Error(result.error || "Unknown extraction error.");
    }

    // Success
    state.extractedText = result.text;
    setStatus("done", "DONE");
    renderPreview(result.text);
    updateStats(result.text);
    downloadBtn.disabled = false;
    copyBtn.disabled = false;
    showToast(`Extracted ${formatNumber(result.wordCount)} words successfully`, "success");

    // Auto-download if toggle is on
    if (toggleAutoDownload.checked) {
      await downloadText();
    }

  } catch (err) {
    let userMsg = err.message || "Extraction failed.";
    // Friendly message for common errors
    if (userMsg.includes("Cannot access")) {
      userMsg = "Permission denied. This page restricts script injection.";
    } else if (userMsg.includes("No tab")) {
      userMsg = "No active tab detected. Please reload the extension.";
    }
    showError(userMsg);
    setExtracting(false);
    return;
  }

  setExtracting(false);
}

/* ─── Content Script Function ────────────────────────────────────── */
/**
 * This function is serialized and injected into the page via chrome.scripting.
 * It must be self-contained — no external references.
 */
function contentScriptFn() {
  "use strict";

  const SKIP_TAGS = new Set([
    "SCRIPT","STYLE","NOSCRIPT","IFRAME","OBJECT",
    "EMBED","SVG","CANVAS","VIDEO","AUDIO",
    "HEAD","META","LINK","TEMPLATE"
  ]);

  const BLOCK_TAGS = new Set([
    "P","DIV","SECTION","ARTICLE","ASIDE","MAIN","HEADER",
    "FOOTER","NAV","H1","H2","H3","H4","H5","H6",
    "LI","DT","DD","BLOCKQUOTE","PRE","FIGURE","FIGCAPTION",
    "TABLE","TR","TD","TH","CAPTION","DETAILS","SUMMARY",
    "DIALOG","FORM","FIELDSET","LEGEND","ADDRESS","BR","HR"
  ]);

  function isHidden(el) {
    try {
      const s = window.getComputedStyle(el);
      if (s.display==="none"||s.visibility==="hidden"||s.visibility==="collapse"||parseFloat(s.opacity)===0) return true;
      if (el.getAttribute("aria-hidden")==="true") return true;
      if (el.hasAttribute("hidden")) return true;
      const r = el.getBoundingClientRect();
      if (el.tagName!=="BR"&&r.width===0&&r.height===0&&el.children.length===0) return true;
    } catch(_) {}
    return false;
  }

  function extractText(root) {
    const parts = [];
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
            if (isHidden(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
          if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent?.trim().length > 0
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let lastWasBlock = false;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (BLOCK_TAGS.has(node.tagName)) {
          if (!lastWasBlock && parts.length > 0) parts.push("\n");
          lastWasBlock = true;
        } else { lastWasBlock = false; }
      } else if (node.nodeType === Node.TEXT_NODE) {
        const cleaned = node.textContent.replace(/[ \t\r]+/g," ").trim();
        if (cleaned.length > 0) {
          const pt = node.parentElement?.tagName;
          parts.push(pt && BLOCK_TAGS.has(pt) ? "\n"+cleaned+"\n" : cleaned);
          lastWasBlock = false;
        }
      }
    }
    return parts.join(" ");
  }

  function cleanText(raw) {
    return raw
      .replace(/[ \t]+/g," ")
      .replace(/\n[ \t]+/g,"\n")
      .replace(/[ \t]+\n/g,"\n")
      .replace(/\n{3,}/g,"\n\n")
      .trim();
  }

  try {
    const raw = extractText(document.body);
    const text = cleanText(raw);
    if (!text) return { success:false, error:"No visible text found on this page.", text:"", wordCount:0, charCount:0, url:location.href, title:document.title };
    const wordCount = text.split(/\s+/).filter(w=>w.length>0).length;
    return { success:true, text, wordCount, charCount:text.length, url:location.href, title:document.title };
  } catch(err) {
    return { success:false, error:`Extraction failed: ${err.message}`, text:"", wordCount:0, charCount:0, url:location.href, title:document.title };
  }
}

/* ─── Core: Download Text ────────────────────────────────────────── */
async function downloadText() {
  if (!state.extractedText) {
    showToast("Nothing to download — extract first.", "error");
    return;
  }
  if (state.isDownloading) return;

  state.isDownloading = true;
  setDownloading(true);

  try {
    const filename = buildFilename(state.currentTab);

    // Build metadata header for the file
    const header = [
      "═══════════════════════════════════════════════════════",
      "  PageHarvest — Extracted Text",
      "═══════════════════════════════════════════════════════",
      `  Source  : ${state.currentTab?.url || "unknown"}`,
      `  Title   : ${state.currentTab?.title || "unknown"}`,
      `  Extracted: ${new Date().toISOString()}`,
      `  Words   : ${formatNumber(state.extractedText.split(/\s+/).filter(w=>w.length>0).length)}`,
      `  Chars   : ${formatNumber(state.extractedText.length)}`,
      "═══════════════════════════════════════════════════════",
      "",
      ""
    ].join("\n");

    const fullContent = header + state.extractedText;

    const response = await chrome.runtime.sendMessage({
      action: "downloadText",
      payload: { text: fullContent, filename }
    });

    if (response?.success) {
      state.lastDownloadId = response.downloadId;
      showToast(`Saved as ${filename}`, "success");
    } else {
      throw new Error(response?.error || "Download failed.");
    }
  } catch (err) {
    showToast(`Download error: ${err.message}`, "error", 4000);
  } finally {
    state.isDownloading = false;
    setDownloading(false);
  }
}

/* ─── Copy to Clipboard ──────────────────────────────────────────── */
async function copyToClipboard() {
  if (!state.extractedText) return;

  try {
    await navigator.clipboard.writeText(state.extractedText);
    copyBtnText.textContent = "COPIED!";
    copyBtn.classList.add("copied");
    showToast("Copied to clipboard", "success", 2000);
    setTimeout(() => {
      copyBtnText.textContent = "COPY";
      copyBtn.classList.remove("copied");
    }, 2000);
  } catch {
    showToast("Clipboard access denied.", "error");
  }
}

/* ─── Settings Persistence ───────────────────────────────────────── */
async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(["autoExtract", "autoDownload"]);
    toggleAutoExtract.checked = data.autoExtract === true;
    toggleAutoDownload.checked = data.autoDownload === true;
  } catch {
    // Defaults: both off
  }
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({
      autoExtract: toggleAutoExtract.checked,
      autoDownload: toggleAutoDownload.checked
    });
  } catch {
    // Non-critical
  }
}

/* ─── Initialization ─────────────────────────────────────────────── */
async function init() {
  // Set footer timestamp
  footerTimestamp.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // Load user settings
  await loadSettings();

  // Get current active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.currentTab = tab;

    if (tab?.url) {
      const displayUrl = tab.url.replace(/^https?:\/\//, "").slice(0, 60);
      pageUrl.textContent = displayUrl || tab.url;
    } else {
      pageUrl.textContent = "No active tab";
    }
  } catch (err) {
    pageUrl.textContent = "Error loading tab";
    showError("Could not get active tab: " + err.message);
    return;
  }

  // Auto-extract if setting is on
  if (toggleAutoExtract.checked) {
    // Small delay to let popup render fully first
    setTimeout(() => extractText(), 150);
  }
}

/* ─── Event Listeners ────────────────────────────────────────────── */
extractBtn.addEventListener("click", () => extractText());
downloadBtn.addEventListener("click", () => downloadText());
copyBtn.addEventListener("click", () => copyToClipboard());

toggleAutoExtract.addEventListener("change", saveSettings);
toggleAutoDownload.addEventListener("change", saveSettings);

/* ─── Boot ───────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", init);
