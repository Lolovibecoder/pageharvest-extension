/**
 * PageHarvest Content Script
 * Injected into the active tab to extract visible text from the DOM.
 * Runs in the page context — no UI, pure data extraction logic.
 */

(function () {
  "use strict";

  /**
   * Tags whose text content should be completely skipped.
   */
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT",
    "EMBED", "SVG", "CANVAS", "VIDEO", "AUDIO",
    "HEAD", "META", "LINK", "TEMPLATE"
  ]);

  /**
   * Tags that act as block-level separators (add newlines around them).
   */
  const BLOCK_TAGS = new Set([
    "P", "DIV", "SECTION", "ARTICLE", "ASIDE", "MAIN", "HEADER",
    "FOOTER", "NAV", "H1", "H2", "H3", "H4", "H5", "H6",
    "LI", "DT", "DD", "BLOCKQUOTE", "PRE", "FIGURE", "FIGCAPTION",
    "TABLE", "TR", "TD", "TH", "CAPTION", "DETAILS", "SUMMARY",
    "DIALOG", "FORM", "FIELDSET", "LEGEND", "ADDRESS", "BR", "HR"
  ]);

  /**
   * Checks if a DOM node is visually hidden using computed styles
   * or HTML attributes.
   * @param {Element} element
   * @returns {boolean}
   */
  function isHidden(element) {
    try {
      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        parseFloat(style.opacity) === 0
      ) {
        return true;
      }

      // Check aria-hidden
      if (element.getAttribute("aria-hidden") === "true") return true;

      // Check hidden attribute
      if (element.hasAttribute("hidden")) return true;

      // Check if element has zero size (but not inline elements which can be 0x0)
      const rect = element.getBoundingClientRect();
      if (
        element.tagName !== "BR" &&
        rect.width === 0 &&
        rect.height === 0 &&
        element.children.length === 0
      ) {
        return true;
      }
    } catch (_) {
      // If we can't compute style, assume visible
    }
    return false;
  }

  /**
   * Recursively walks the DOM tree and collects visible text.
   * Uses a chunk-based approach to avoid call-stack overflows on deep DOMs.
   * @param {Node} root - Starting node
   * @returns {string} Extracted text
   */
  function extractText(root) {
    const parts = [];
    // Use iterative traversal to avoid stack overflow on deep DOM trees
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // Skip unwanted element tags
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (SKIP_TAGS.has(node.tagName)) {
              return NodeFilter.FILTER_REJECT; // Skip entire subtree
            }
            if (isHidden(node)) {
              return NodeFilter.FILTER_REJECT; // Skip hidden elements
            }
            return NodeFilter.FILTER_ACCEPT;
          }

          // Accept text nodes
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text && text.trim().length > 0) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let lastWasBlock = false;

    while (walker.nextNode()) {
      const node = walker.currentNode;

      if (node.nodeType === Node.ELEMENT_NODE) {
        // Insert newline separator before and after block elements
        if (BLOCK_TAGS.has(node.tagName)) {
          if (!lastWasBlock && parts.length > 0) {
            parts.push("\n");
          }
          lastWasBlock = true;
        } else {
          lastWasBlock = false;
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.textContent;
        // Normalize internal whitespace
        const cleaned = raw.replace(/[ \t\r]+/g, " ").trim();
        if (cleaned.length > 0) {
          // Check parent for block context
          const parentTag = node.parentElement?.tagName;
          if (parentTag && BLOCK_TAGS.has(parentTag)) {
            parts.push("\n" + cleaned + "\n");
          } else {
            parts.push(cleaned);
          }
          lastWasBlock = false;
        }
      }
    }

    return parts.join(" ");
  }

  /**
   * Post-processes raw extracted text:
   * - Removes excessive blank lines (max 2 consecutive)
   * - Removes excessive spaces
   * - Trims leading/trailing whitespace
   * @param {string} raw
   * @returns {string}
   */
  function cleanText(raw) {
    return raw
      .replace(/[ \t]+/g, " ")           // Collapse horizontal whitespace
      .replace(/\n[ \t]+/g, "\n")         // Remove leading spaces on lines
      .replace(/[ \t]+\n/g, "\n")         // Remove trailing spaces on lines
      .replace(/\n{3,}/g, "\n\n")         // Max 2 consecutive newlines
      .trim();
  }

  /**
   * Main extraction entry point.
   * Called via chrome.scripting.executeScript from popup.js
   * @returns {{ text: string, wordCount: number, charCount: number, url: string, title: string }}
   */
  function harvest() {
    try {
      const raw = extractText(document.body);
      const text = cleanText(raw);

      if (!text || text.length === 0) {
        return {
          success: false,
          error: "No visible text found on this page.",
          text: "",
          wordCount: 0,
          charCount: 0,
          url: window.location.href,
          title: document.title
        };
      }

      const wordCount = text
        .split(/\s+/)
        .filter(w => w.length > 0).length;

      return {
        success: true,
        text,
        wordCount,
        charCount: text.length,
        url: window.location.href,
        title: document.title
      };
    } catch (err) {
      return {
        success: false,
        error: `Extraction failed: ${err.message}`,
        text: "",
        wordCount: 0,
        charCount: 0,
        url: window.location.href,
        title: document.title
      };
    }
  }

  // Return harvest result immediately (called via executeScript)
  return harvest();
})();
