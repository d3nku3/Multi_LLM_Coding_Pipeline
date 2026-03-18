// 01_utilities.js — Pure helper functions (formatting, validation, sanitization)
// No I/O. No state mutation. No DOM access.

function nowStamp() {
  return new Date().toLocaleString();
}

function escapeHtml(value) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function safeText(value) {
  return value == null ? "" : String(value);
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isDangerousImportKey(key) {
  return DANGEROUS_IMPORT_KEYS.has(safeText(key));
}

function sanitizeImportedNode(value, depth = 0) {
  if (depth > 40) return null;
  if (Array.isArray(value)) return value.map(item => sanitizeImportedNode(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const out = {};
  Object.keys(value).forEach(key => {
    if (isDangerousImportKey(key)) return;
    out[key] = sanitizeImportedNode(value[key], depth + 1);
  });
  return out;
}

function byteLengthOfText(value) {
  return new Blob([safeText(value)]).size;
}

function formatBytes(bytes) {
  const amount = Number(bytes || 0);
  if (amount >= 1024 * 1024) return `${(amount / (1024 * 1024)).toFixed(amount >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (amount >= 1024) return `${Math.round(amount / 1024)} KB`;
  return `${amount} B`;
}

function limitMessage(label, bytes, maxBytes) {
  return `${label} is too large for this console (${formatBytes(bytes)}). Limit: ${formatBytes(maxBytes)}.`;
}

function isQuotaExceededError(error) {
  return Boolean(
    error && (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014
    )
  );
}

function safeImportedFilename(value, fallback = "Imported_File.txt") {
  const cleaned = safeText(value)
    .replace(/[\\/]+/g, "_")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .trim()
    .slice(0, 240);
  return cleaned || fallback;
}

function previewText(value, maxChars = SECURITY_LIMITS.maxRenderedPreviewChars, label = "Content preview shortened") {
  const text = safeText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}

[${label}. Showing first ${maxChars.toLocaleString()} characters. Full content is still kept internally.]`;
}

function previewJson(value, maxChars = SECURITY_LIMITS.maxTechnicalPreviewChars) {
  let json = "";
  try {
    json = JSON.stringify(value, null, 2);
  } catch (error) {
    json = "[Technical preview unavailable because the data could not be serialized safely.]";
  }
  return previewText(json, maxChars, "Technical JSON preview shortened");
}

function normalizeBooleanMap(rawMap, allowedIds) {
  const out = {};
  const source = isPlainObject(rawMap) ? rawMap : {};
  allowedIds.forEach(id => {
    out[id] = Boolean(source[id]);
  });
  return out;
}

function normalizeLabelMap(rawMap, allowedIds) {
  const out = {};
  const source = isPlainObject(rawMap) ? rawMap : {};
  allowedIds.forEach(id => {
    const label = safeText(source?.[id]?.label).trim();
    if (label) out[id] = { label: label.slice(0, 200) };
  });
  return out;
}

function normalizeImportedReferenceFile(item) {
  if (!isPlainObject(item)) return null;
  const text = safeText(item.text);
  return {
    name: safeImportedFilename(item.name, "Imported_Reference.txt"),
    text,
    size: Math.max(0, Number(item.size || byteLengthOfText(text)) || 0),
    lastModified: Math.max(0, Number(item.lastModified || 0) || 0),
    sourceMode: safeText(item.sourceMode).trim() || "manual-import"
  };
}

function deepMerge(base, incoming) {
  if (Array.isArray(base)) {
    return Array.isArray(incoming) ? incoming : base;
  }
  if (isPlainObject(base)) {
    const out = { ...base };
    Object.keys(incoming || {}).forEach(key => {
      if (isDangerousImportKey(key)) return;
      if (
        isPlainObject(base[key]) &&
        isPlainObject(incoming[key])
      ) {
        out[key] = deepMerge(base[key], incoming[key]);
      } else if (incoming[key] !== undefined) {
        out[key] = incoming[key];
      }
    });
    return out;
  }
  return incoming ?? base;
}

function textFingerprint(text) {
  const source = safeText(text).replace(/\r\n/g, "\n");
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const normalized = (hash >>> 0).toString(16).padStart(8, "0");
  return `fp_${normalized}_${source.length}`;
}

function debounce(fn, delayMs) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.warn("Clipboard write failed", error);
    return false;
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeImportedFilename(filename, "download.txt");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

function formatCharCount(count) {
  return `${count.toLocaleString()} characters`;
}

function summarizeNotes(text) {
  const trimmed = safeText(text).trim();
  if (!trimmed) return "No notes saved yet.";
  return trimmed.length <= 700 ? trimmed : trimmed.slice(0, 700) + "\n\n[Preview truncated here inside the tool.]";
}

function sanitizeFilenameSegment(text, maxLen = 60) {
  return text.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, maxLen) || "artifact";
}

function normalizeFilename(value) {
  return safeText(value)
    .trim()
    .toLowerCase()
    .replace(/^.*[\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function requestSection(title, body) {
  return [REQUEST_DIVIDER, title, REQUEST_DIVIDER, body].join("\n");
}

function pill(label, value, tone = "") {
  return `<div class="status-pill ${escapeHtml(tone)}"><strong>${escapeHtml(label)}:</strong> <span>${escapeHtml(value)}</span></div>`;
}

