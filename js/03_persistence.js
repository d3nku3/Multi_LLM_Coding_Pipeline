// 03_persistence.js — All file system I/O, IndexedDB handle caching, and audit logging
//
// SECURITY SUMMARY FOR REVIEWERS:
// ─────────────────────────────────
// This is the ONLY module that performs disk writes, reads, or browser storage access.
// • No network requests. No fetch(). No XMLHttpRequest. No WebSocket.
// • All file access uses the File System Access API with an operator-selected directory.
//   The user explicitly picks the folder via showDirectoryPicker({ mode: "readwrite" }).
// • IndexedDB is used ONLY to cache the directory handle for session resume.
//   It is a convenience cache, not the source of truth. The on-disk files are authoritative.
// • localStorage is accessed ONLY in hasLegacyLocalStorageData() and migrateLegacyLocalStorage()
//   for one-time migration from the old console version. After migration the key is deleted.
//
// To verify: grep -n "fetch\|XMLHttpRequest\|sendBeacon\|WebSocket" 03_persistence.js
// Expected result: zero matches.

function normalizeAuditArtifactIds(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeAuditPaths(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function buildAuditEntry(event, {
  artifactIds = [],
  paths = [],
  message = "",
  outcome = "success",
  error = null
} = {}) {
  return {
    timestamp: nowStamp(),
    event,
    artifactIds: normalizeAuditArtifactIds(artifactIds),
    paths: normalizeAuditPaths(paths),
    message: safeText(message).trim(),
    outcome,
    error: error == null ? null : safeText(error)
  };
}

async function writeTextFile(dirHandle, filename, text) {
  try {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    if (writePermissionLost) {
      writePermissionLost = false;
      renderPermissionStatus();
    }
    return new Blob([text]).size;
  } catch (error) {
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      writePermissionLost = true;
      renderPermissionStatus();
    }
    throw error;
  }
}

async function readTextFile(dirHandle, filename) {
  const fh = await dirHandle.getFileHandle(filename);
  const file = await fh.getFile();
  return await file.text();
}

async function fileExists(dirHandle, filename) {
  try {
    await dirHandle.getFileHandle(filename);
    return true;
  } catch (e) {
    return false;
  }
}

async function verifyWritePermission() {
  if (!workspaceRootHandle) return false;
  try {
    const permission = await workspaceRootHandle.queryPermission({ mode: "readwrite" });
    if (permission === "granted") return true;
    const requested = await workspaceRootHandle.requestPermission({ mode: "readwrite" });
    return requested === "granted";
  } catch (e) {
    return false;
  }
}

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("OperatorConsoleHandles", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_HANDLE_STORE)) {
        db.createObjectStore(IDB_HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheHandleInIDB(handle) {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(IDB_HANDLE_STORE, "readwrite");
    tx.objectStore(IDB_HANDLE_STORE).put(handle, IDB_HANDLE_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (e) {
    console.warn("Could not cache workspace handle in IndexedDB", e);
  }
}

async function loadHandleFromIDB() {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(IDB_HANDLE_STORE, "readonly");
    const req = tx.objectStore(IDB_HANDLE_STORE).get(IDB_HANDLE_KEY);
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result || null); req.onerror = rej; });
  } catch (e) {
    return null;
  }
}

async function clearHandleFromIDB() {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(IDB_HANDLE_STORE, "readwrite");
    tx.objectStore(IDB_HANDLE_STORE).delete(IDB_HANDLE_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (e) {
    console.warn("Could not clear workspace handle from IndexedDB", e);
  }
}

async function ensureWorkspaceDirectories() {
  workspaceSubHandles = {};
  for (const dirName of WORKSPACE_DIRS) {
    workspaceSubHandles[dirName] = await workspaceRootHandle.getDirectoryHandle(dirName, { create: true });
  }
}

function getWorkspaceRootStatus() {
  if (workspaceRootHandle) {
    return { available: true, label: workspaceRootHandle.name };
  }
  return { available: false, label: "" };
}

async function selectWorkspaceRoot() {
  try {
    workspaceRootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await ensureWorkspaceDirectories();
    await cacheHandleInIDB(workspaceRootHandle);
    await writeWorkspaceMetadata();
    await appendAuditEntry(buildAuditEntry("WORKSPACE_SELECTED", {
      message: `Workspace folder selected: ${workspaceRootHandle.name}`,
      outcome: "success"
    }));
    return { available: true, label: workspaceRootHandle.name };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { available: false, label: "" };
    }
    console.error("Workspace selection failed", error);
    return { available: false, label: "", error: error?.message || "Folder selection failed" };
  }
}

async function tryRestoreWorkspaceHandle() {
  try {
    const handle = await loadHandleFromIDB();
    if (!handle) return false;
    // queryPermission does not require a user gesture
    const current = await handle.queryPermission({ mode: "readwrite" });
    if (current === "granted") {
      workspaceRootHandle = handle;
      await ensureWorkspaceDirectories();
      await writeWorkspaceMetadata();
      return true;
    }
    if (current === "prompt") {
      // Handle exists but browser requires a user gesture to re-grant permission
      pendingWorkspaceHandle = handle;
      return "pending";
    }
    // "denied" — user explicitly blocked access
    return false;
  } catch (e) {
    console.warn("Could not restore workspace handle", e);
    workspaceRootHandle = null;
    workspaceSubHandles = {};
    pendingWorkspaceHandle = null;
    return false;
  }
}

async function reconnectWorkspace() {
  if (!pendingWorkspaceHandle) return false;
  try {
    const permission = await pendingWorkspaceHandle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") return false;
    workspaceRootHandle = pendingWorkspaceHandle;
    pendingWorkspaceHandle = null;
    await ensureWorkspaceDirectories();
    await writeWorkspaceMetadata();
    return true;
  } catch (e) {
    console.warn("Workspace reconnect failed", e);
    pendingWorkspaceHandle = null;
    return false;
  }
}

async function selectPromptFolder() {
  try {
    promptFolderHandle = await window.showDirectoryPicker({ mode: "read" });
    await cachePromptHandleInIDB(promptFolderHandle);
    return { available: true, label: promptFolderHandle.name };
  } catch (error) {
    if (error?.name === "AbortError") return { available: false, label: "" };
    console.error("Prompt folder selection failed", error);
    return { available: false, label: "", error: error?.message || "Folder selection failed" };
  }
}

async function tryRestorePromptFolderHandle() {
  try {
    const handle = await loadPromptHandleFromIDB();
    if (!handle) return false;
    const permission = await handle.requestPermission({ mode: "read" });
    if (permission !== "granted") return false;
    promptFolderHandle = handle;
    return true;
  } catch (e) {
    console.warn("Could not restore prompt folder handle", e);
    promptFolderHandle = null;
    return false;
  }
}

async function cachePromptHandleInIDB(handle) {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(IDB_HANDLE_STORE, "readwrite");
    tx.objectStore(IDB_HANDLE_STORE).put(handle, IDB_PROMPT_HANDLE_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (e) {
    console.warn("Could not cache prompt folder handle in IndexedDB", e);
  }
}

async function loadPromptHandleFromIDB() {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(IDB_HANDLE_STORE, "readonly");
    const req = tx.objectStore(IDB_HANDLE_STORE).get(IDB_PROMPT_HANDLE_KEY);
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result || null); req.onerror = rej; });
  } catch (e) {
    return null;
  }
}

async function loadPromptsFromFolderHandle(handle) {
  return await loadPromptFilesFromDirectoryHandle(handle);
}

async function writeWorkspaceMetadata() {
  const consoleDir = workspaceSubHandles[CONSOLE_DIR];
  if (!consoleDir) return;
  let existing = {};
  try {
    const raw = await readTextFile(consoleDir, METADATA_FILE);
    existing = JSON.parse(raw);
  } catch (e) { }
  const meta = {
    consoleVersion: BACKUP_VERSION,
    createdAt: existing.createdAt || nowStamp(),
    lastOpenedAt: nowStamp(),
    browserUserAgent: navigator.userAgent
  };
  await writeTextFile(consoleDir, METADATA_FILE, JSON.stringify(meta, null, 2));
}

async function persistWorkspaceState(stateObj, origin = "save") {
  try {
    const consoleDir = workspaceSubHandles[CONSOLE_DIR];
    if (!consoleDir) return { success: false, bytes: 0, error: "Console directory not available" };

    const cloned = serializeStateForPersistence(stateObj);

    if (cloned.stage1) cloned.stage1.artifactText = "";
    if (cloned.stage2) cloned.stage2.artifactText = "";
    if (cloned.stage3) {
      cloned.stage3.rawOutputText = "";
      cloned.stage3.pauseArtifactText = "";
    }
    if (cloned.stage4 && cloned.stage4.packages) {
      Object.values(cloned.stage4.packages).forEach(pkg => {
        if (pkg) {
          pkg.packageText = "";
          pkg.implementationText = "";
          pkg.implementationOutputText = "";
          pkg.reviewOutputText = "";
        }
      });
    }
    if (cloned.stage6) cloned.stage6.mergeResultText = "";

    const json = JSON.stringify(cloned, null, 2);
    const bytes = await writeTextFile(consoleDir, STATE_FILE, json);
    return { success: true, bytes, error: null };
  } catch (error) {
    return { success: false, bytes: 0, error: error?.message || "State persistence failed" };
  }
}

async function loadPersistedWorkspaceState() {
  try {
    const consoleDir = workspaceSubHandles[CONSOLE_DIR];
    if (!consoleDir) return { found: false, state: null, bytes: 0, error: null };

    let raw;
    try {
      raw = await readTextFile(consoleDir, STATE_FILE);
    } catch (e) {
      return { found: false, state: null, bytes: 0, error: null };
    }

    const bytes = new Blob([raw]).size;
    const parsed = JSON.parse(raw);
    const importedState = isPlainObject(parsed?.state) ? parsed.state : parsed;

    // Recover manifest from separate file if the state JSON has none or an empty one
    if (!importedState.manifest || !importedState.manifest.artifacts || !Object.keys(importedState.manifest.artifacts).length) {
      try {
        const manifestRaw = await readTextFile(consoleDir, MANIFEST_FILE);
        const manifestParsed = JSON.parse(manifestRaw);
        if (isPlainObject(manifestParsed) && isPlainObject(manifestParsed.artifacts)) {
          importedState.manifest = manifestParsed;
        }
      } catch (e) {
        // No separate manifest file — continue without it
      }
    }

    await prehydrateRawState(importedState);
    const restored = normalizeImportedState(importedState);

    await rehydrateArtifactText(restored);

    // Check file integrity
    const integrity = await checkWorkspaceIntegrity(restored);
    if (!integrity.ok) {
      console.warn("Workspace integrity issues:", integrity.missing);
    }

    return { found: true, state: restored, bytes, error: null };
  } catch (error) {
    return { found: false, state: null, bytes: 0, error: error?.message || "Load failed" };
  }
}

async function prehydrateRawState(rawState) {
  // Reads artifact text from disk files and injects it into the raw JSON
  // BEFORE normalizeImportedState runs, so that stage3 parsing and package
  // creation have the full text available.
  if (!workspaceRootHandle) return;
  const manifest = rawState?.manifest;
  if (!manifest || !manifest.artifacts) return;
  const slotHeads = manifest.slotHeads || {};

  async function readArtifactContent(relativePath) {
    if (!relativePath) return null;
    const parts = relativePath.split("/");
    if (parts.length === 2) {
      const dirHandle = workspaceSubHandles[parts[0]];
      if (dirHandle) {
        try { return await readTextFile(dirHandle, parts[1]); } catch (e) { return null; }
      }
    } else if (parts.length === 1) {
      try { return await readTextFile(workspaceRootHandle, parts[0]); } catch (e) { return null; }
    }
    return null;
  }

  function artifactPath(id) {
    return id && manifest.artifacts[id] ? (manifest.artifacts[id].relativePath || "") : "";
  }

  // Stage 1 — Master Briefing
  if (!rawState?.stage1?.artifactText?.trim()) {
    const path = artifactPath(slotHeads.stage1Master);
    if (path) {
      const text = await readArtifactContent(path);
      if (text != null) {
        if (!rawState.stage1) rawState.stage1 = {};
        rawState.stage1.artifactText = text;
      }
    }
  }

  // Stage 2 — Architecture Spec
  if (!rawState?.stage2?.artifactText?.trim()) {
    const path = artifactPath(slotHeads.stage2Architecture);
    if (path) {
      const text = await readArtifactContent(path);
      if (text != null) {
        if (!rawState.stage2) rawState.stage2 = {};
        rawState.stage2.artifactText = text;
      }
    }
  }

  // Stage 3 — Bundle (critical: packages are derived from this)
  if (!rawState?.stage3?.rawOutputText?.trim()) {
    const path = artifactPath(slotHeads.stage3Bundle);
    if (path) {
      const text = await readArtifactContent(path);
      if (text != null) {
        if (!rawState.stage3) rawState.stage3 = {};
        rawState.stage3.rawOutputText = text;
      }
    }
  }

  // Stage 4 — Package contracts, implementation outputs, reviews
  const packages = rawState?.stage4?.packages;
  if (packages && typeof packages === "object") {
    for (const key of Object.keys(packages)) {
      const pkg = packages[key];
      if (!pkg || typeof pkg !== "object") continue;

      if (!pkg.packageText?.trim()) {
        const path = artifactPath((slotHeads.packageContracts || {})[key]);
        if (path) {
          const text = await readArtifactContent(path);
          if (text != null) pkg.packageText = text;
        }
      }
      if (!pkg.implementationOutputText?.trim()) {
        const path = artifactPath((slotHeads.packageImplementation || {})[key]);
        if (path) {
          const text = await readArtifactContent(path);
          if (text != null) {
            pkg.implementationOutputText = text;
            pkg.implementationText = text;
          }
        }
      }
      if (!pkg.reviewOutputText?.trim()) {
        const path = artifactPath((slotHeads.packageReviews || {})[key]);
        if (path) {
          const text = await readArtifactContent(path);
          if (text != null) pkg.reviewOutputText = text;
        }
      }
    }
  }

  // Stage 6 — Merge result
  if (!rawState?.stage6?.mergeResultText?.trim()) {
    const path = artifactPath(slotHeads.stage6Merge);
    if (path) {
      const text = await readArtifactContent(path);
      if (text != null) {
        if (!rawState.stage6) rawState.stage6 = {};
        rawState.stage6.mergeResultText = text;
      }
    }
  }
}

async function rehydrateArtifactText(targetState) {
  const manifest = targetState.manifest;
  if (!manifest || !manifest.artifacts) return;

  const slotHeads = manifest.slotHeads || {};

  async function readArtifactContent(relativePath) {
    if (!relativePath) return null;
    const parts = relativePath.split("/");
    if (parts.length === 2) {
      const dirHandle = workspaceSubHandles[parts[0]];
      if (dirHandle) {
        try { return await readTextFile(dirHandle, parts[1]); } catch (e) { return null; }
      }
    } else if (parts.length === 1) {
      try { return await readTextFile(workspaceRootHandle, parts[0]); } catch (e) { return null; }
    }
    return null;
  }

  const s1Id = slotHeads.stage1Master;
  if (s1Id && manifest.artifacts[s1Id]?.relativePath) {
    const text = await readArtifactContent(manifest.artifacts[s1Id].relativePath);
    if (text != null) targetState.stage1.artifactText = text;
  }

  const s2Id = slotHeads.stage2Architecture;
  if (s2Id && manifest.artifacts[s2Id]?.relativePath) {
    const text = await readArtifactContent(manifest.artifacts[s2Id].relativePath);
    if (text != null) targetState.stage2.artifactText = text;
  }

  const s3Id = slotHeads.stage3Bundle;
  if (s3Id && manifest.artifacts[s3Id]?.relativePath) {
    const text = await readArtifactContent(manifest.artifacts[s3Id].relativePath);
    if (text != null) targetState.stage3.rawOutputText = text;
  }

  const pauseId = slotHeads.stage3Pause;
  if (pauseId && manifest.artifacts[pauseId]?.relativePath) {
    const text = await readArtifactContent(manifest.artifacts[pauseId].relativePath);
    if (text != null) targetState.stage3.pauseArtifactText = text;
  }

  const packages = targetState.stage4?.packages || {};
  for (const [key, pkg] of Object.entries(packages)) {
    const contractId = (slotHeads.packageContracts || {})[key];
    if (contractId && manifest.artifacts[contractId]?.relativePath) {
      const text = await readArtifactContent(manifest.artifacts[contractId].relativePath);
      if (text != null) pkg.packageText = text;
    }
    const implId = (slotHeads.packageImplementation || {})[key];
    if (implId && manifest.artifacts[implId]?.relativePath) {
      const text = await readArtifactContent(manifest.artifacts[implId].relativePath);
      if (text != null) {
        pkg.implementationText = text;
        pkg.implementationOutputText = text;
      }
    }
    const revId = (slotHeads.packageReviews || {})[key];
    if (revId && manifest.artifacts[revId]?.relativePath) {
      const text = await readArtifactContent(manifest.artifacts[revId].relativePath);
      if (text != null) pkg.reviewOutputText = text;
    }
  }

  const s6Id = slotHeads.stage6Merge;
  if (s6Id && manifest.artifacts[s6Id]?.relativePath) {
    const text = await readArtifactContent(manifest.artifacts[s6Id].relativePath);
    if (text != null) targetState.stage6.mergeResultText = text;
  }

  if (targetState.stage3.artifacts && targetState.stage3.artifacts.length) {
    for (const art of targetState.stage3.artifacts) {
      if (art.artifactId && manifest.artifacts[art.artifactId]?.relativePath) {
        const text = await readArtifactContent(manifest.artifacts[art.artifactId].relativePath);
        if (text != null) art.content = text;
      }
    }
  }
}

async function checkWorkspaceIntegrity(targetState) {
  const manifest = targetState.manifest;
  if (!manifest || !manifest.artifacts) return { ok: true, missing: [] };

  const missing = [];

  for (const [artifactId, record] of Object.entries(manifest.artifacts)) {
    if (!record.relativePath) continue;
    if (record.status === "superseded" || record.status === "orphaned") continue;

    const parts = record.relativePath.split("/");
    let exists = false;
    try {
      if (parts.length === 2) {
        const dirHandle = workspaceSubHandles[parts[0]];
        if (dirHandle) {
          await dirHandle.getFileHandle(parts[1]);
          exists = true;
        }
      } else if (parts.length === 1) {
        await workspaceRootHandle.getFileHandle(parts[0]);
        exists = true;
      }
    } catch (e) {
      // file not found
    }

    if (!exists) {
      missing.push({
        artifactId,
        title: record.title || record.artifactType,
        relativePath: record.relativePath,
        status: record.status
      });
      record.status = "missing_on_disk";
      record.statusReason = `File not found at ${record.relativePath} during workspace load.`;
    } else if (record.status === "missing_on_disk") {
      record.status = "reusable";
      record.statusReason = "Artifact file found during workspace load.";
    }
  }

  return { ok: missing.length === 0, missing };
}

async function persistManifest(manifestObj) {
  try {
    const consoleDir = workspaceSubHandles[CONSOLE_DIR];
    if (!consoleDir) return { success: false, error: "Console directory not available" };
    await writeTextFile(consoleDir, MANIFEST_FILE, JSON.stringify(manifestObj, null, 2));
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error?.message || "Manifest write failed" };
  }
}

async function persistArtifactFile(artifactRecord, textContent) {
  try {
    const stageDir = resolveArtifactStageDir(artifactRecord);
    const filename = buildArtifactFilename(artifactRecord);
    const dirHandle = workspaceSubHandles[stageDir] || workspaceRootHandle;
    await writeTextFile(dirHandle, filename, textContent);
    const hash = await computeContentHash(textContent);
    const relativePath = stageDir + "/" + filename;
    artifactRecord.relativePath = relativePath;
    artifactRecord.contentHash = hash;
    return { success: true, relativePath, error: null };
  } catch (error) {
    return { success: false, relativePath: null, error: error?.message || "Artifact write failed" };
  }
}

async function writePromptSnapshot(stageKey, promptText) {
  if (!workspaceRootHandle || !safeText(promptText).trim()) return null;
  try {
    const consoleDir = workspaceSubHandles[CONSOLE_DIR];
    if (!consoleDir) return null;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    // Extract a version hint from the prompt text (looks for patterns like "v4", "v3.6", "Version 4")
    const versionMatch = promptText.match(/\b[Vv](?:ersion\s*)?(\d+(?:\.\d+)?)\b/);
    const versionTag = versionMatch ? `_v${versionMatch[1]}` : "";
    const filename = `prompt_snapshot_${stageKey}${versionTag}_${timestamp}.txt`;
    await writeTextFile(consoleDir, filename, promptText);
    return CONSOLE_DIR + "/" + filename;
  } catch (e) {
    console.warn("Prompt snapshot write failed", e);
    return null;
  }
}

async function persistReferenceFile(name, text) {
  if (!workspaceRootHandle) return null;
  try {
    const refsDir = workspaceSubHandles["references"];
    if (!refsDir) return null;
    const safeName = safeImportedFilename(name, "reference.txt");
    await writeTextFile(refsDir, safeName, text);
    await appendAuditEntry(buildAuditEntry("REFERENCE_SAVED", {
      paths: ["references/" + safeName],
      message: `Reference file written: ${safeName}`,
      outcome: "success"
    }));
    return "references/" + safeName;
  } catch (e) {
    console.warn("Reference file write failed", e);
    return null;
  }
}

function hasLegacyLocalStorageData() {
  try {
    return Boolean(localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch (e) {
    return false;
  }
}

async function migrateLegacyLocalStorage() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const importedState = isPlainObject(parsed?.state) ? parsed.state : parsed;
    const normalized = normalizeImportedState(importedState);
    Object.assign(state, createDefaultState(), normalized);
    if (workspaceRootHandle) {
      state.workflow.currentState = WORKFLOW_STATES.SETUP_INPUT_NEEDED;
      state.workflow.actionKey = "setup";
      state.workflow.stageLabel = "Setup";
      state.workflow.stateLabel = "Workspace input needed";
    }
    await saveState("migrated from localStorage", {
      auditEvent: "BACKUP_IMPORTED",
      message: "Legacy localStorage data migrated into disk workspace"
    });
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch (e) { }
    return true;
  } catch (e) {
    console.error("localStorage migration failed", e);
    return false;
  }
}

function resolveArtifactStageDir(record) {
  const stage = (record.stageProduced || "").toLowerCase();
  if (stage.includes("01") || stage === "stage01") return "stage01";
  if (stage.includes("02") || stage === "stage02") return "stage02";
  if (stage.includes("03") || stage === "stage03") return "stage03";
  if (stage.includes("04") || stage === "stage04") return "stage04";
  if (stage.includes("05") || stage === "stage05") return "stage05";
  if (stage.includes("06") || stage === "stage06") return "stage06";
  return "stage04";
}

function buildArtifactFilename(record) {
  const raw = (record.stageProduced || "").trim();
  const numMatch = raw.match(/(\d{2})/);
  const stagePrefix = numMatch ? numMatch[1] : "XX";
  const title = sanitizeFilenameSegment(record.title || record.artifactType || "artifact");
  const id = record.artifactId || "unknown";
  const rev = String(record.revision || 1).padStart(3, "0");
  return `${stagePrefix}_${title}__${id}__r${rev}.txt`;
}

async function appendAuditEntry(entry) {
  console.log("[AUDIT]", JSON.stringify(entry));
  try {
    const consoleDir = workspaceSubHandles[CONSOLE_DIR];
    if (!consoleDir) return { success: true, error: null };

    let existing = "";
    try { existing = await readTextFile(consoleDir, AUDIT_FILE); } catch (e) { }
    const updated = existing + JSON.stringify(entry) + "\n";
    await writeTextFile(consoleDir, AUDIT_FILE, updated);
    return { success: true, error: null };
  } catch (error) {
    console.error("Audit log write failed", error);
    return { success: false, error: error?.message || "Audit write failed" };
  }
}

async function computeContentHash(text) {
  if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest) {
    try {
      const encoded = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return "sha256_" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
    }
  }
  return textFingerprint(text);
}

async function loadState() {
  if (!workspaceRootHandle) {
    runtimeStatus.lastSavedBytes = 0;
    setPersistenceStatus("Select a workspace folder to begin", "");
    return createDefaultState();
  }
  const loaded = await loadPersistedWorkspaceState();
  if (!loaded.found || !loaded.state) {
    runtimeStatus.lastSavedBytes = 0;
    if (loaded.error) {
      console.error(loaded.error);
      setPersistenceStatus("Workspace could not be restored", "danger");
    } else {
      setPersistenceStatus(`Workspace folder "${workspaceRootHandle.name}" opened — no saved state found`, "");
    }
    return createDefaultState();
  }
  runtimeStatus.lastSavedBytes = loaded.bytes;
  setPersistenceStatus(
    loaded.bytes >= SECURITY_LIMITS.persistWarningBytes
      ? `Workspace loaded from "${workspaceRootHandle.name}" (${formatBytes(loaded.bytes)}) • approaching storage limits`
      : `Workspace loaded from "${workspaceRootHandle.name}" (${formatBytes(loaded.bytes)})`,
    loaded.bytes >= SECURITY_LIMITS.persistWarningBytes ? "warn" : "success"
  );
  await appendAuditEntry(buildAuditEntry("STATE_LOADED", {
    message: `Workspace loaded from ${workspaceRootHandle.name}`,
    outcome: "success"
  }));
  return loaded.state;
}

async function writeNewArtifactFiles(targetState) {
  if (!workspaceRootHandle) return;
  const manifest = targetState.manifest;
  if (!manifest || !manifest.artifacts) return;

  const textSources = {};

  if (targetState.stage1.artifactText.trim() && targetState.stage1.currentArtifactId) {
    textSources[targetState.stage1.currentArtifactId] = targetState.stage1.artifactText;
  }
  if (targetState.stage2.artifactText.trim() && targetState.stage2.currentArtifactId) {
    textSources[targetState.stage2.currentArtifactId] = targetState.stage2.artifactText;
  }
  if (targetState.stage3.rawOutputText.trim() && targetState.stage3.bundleArtifactId) {
    textSources[targetState.stage3.bundleArtifactId] = targetState.stage3.rawOutputText;
  }
  if (targetState.stage3.artifacts) {
    targetState.stage3.artifacts.forEach(art => {
      if (art.artifactId && art.content?.trim()) {
        textSources[art.artifactId] = art.content;
      }
    });
  }
  Object.values(targetState.stage4?.packages || {}).forEach(pkg => {
    if (pkg.packageArtifactId && pkg.packageText?.trim()) {
      textSources[pkg.packageArtifactId] = pkg.packageText;
    }
    if (pkg.implementationArtifactId && (pkg.implementationOutputText || pkg.implementationText || "").trim()) {
      textSources[pkg.implementationArtifactId] = pkg.implementationOutputText || pkg.implementationText;
    }
    if (pkg.reviewArtifactId && pkg.reviewOutputText?.trim()) {
      textSources[pkg.reviewArtifactId] = pkg.reviewOutputText;
    }
  });
  if (targetState.stage6.mergeResultText?.trim() && targetState.stage6.mergeArtifactId) {
    textSources[targetState.stage6.mergeArtifactId] = targetState.stage6.mergeResultText;
  }

  for (const [artifactId, textValue] of Object.entries(textSources)) {
    const record = manifest.artifacts[artifactId];
    if (!record) continue;
    if (record.relativePath) continue;

    if (!record.promptSnapshotPath) {
      let snapshotPath = null;

      if (artifactId === targetState.stage1.currentArtifactId) {
        snapshotPath = targetState.stage1?._lastPromptSnapshotPath || targetState.stage3?._lastPromptSnapshotPath || null;
      } else if (artifactId === targetState.stage2.currentArtifactId) {
        snapshotPath = targetState.stage2?._lastPromptSnapshotPath || targetState.stage3?._lastPromptSnapshotPath || null;
      } else if (artifactId === targetState.stage3.bundleArtifactId || (targetState.stage3.artifacts || []).some(item => item.artifactId === artifactId)) {
        snapshotPath = targetState.stage3?._lastPromptSnapshotPath || null;
      } else if (artifactId === targetState.stage6.mergeArtifactId) {
        snapshotPath = targetState.stage6?._lastPromptSnapshotPath || null;
      }

      if (!snapshotPath) {
        const matchPkg = Object.values(targetState.stage4?.packages || {}).find(p =>
          p.packageArtifactId === artifactId ||
          p.implementationArtifactId === artifactId ||
          p.reviewArtifactId === artifactId
        );
        if (matchPkg && matchPkg._lastPromptSnapshotPath) {
          snapshotPath = matchPkg._lastPromptSnapshotPath;
        }
      }

      if (snapshotPath) record.promptSnapshotPath = snapshotPath;
    }

    const result = await persistArtifactFile(record, textValue);
    if (result.success) {
      await appendAuditEntry(buildAuditEntry("ARTIFACT_SAVED", {
        artifactIds: [artifactId],
        paths: [result.relativePath],
        message: `Artifact written: ${record.title || artifactId}`,
        outcome: "success"
      }));
    } else {
      await appendAuditEntry(buildAuditEntry("WRITE_FAILURE", {
        artifactIds: [artifactId],
        message: `Failed to write artifact: ${record.title || artifactId}`,
        outcome: "failure",
        error: result.error
      }));
    }
  }
}

async function saveState(origin = "manually pasted and saved", options = {}) {
  if (!workspaceRootHandle) return false;
  const auditEnabled = options.audit !== false;
  const artifactIds = normalizeAuditArtifactIds(options.artifactIds);
  const paths = normalizeAuditPaths(options.paths);
  const message = safeText(options.message).trim();
  const auditEvent = safeText(options.auditEvent).trim();
  const auditErrorEvent = safeText(options.auditErrorEvent).trim() || "WRITE_FAILURE";
  try {
    ensureManifestStructure(state);
    reconcileWorkspaceManifest(state, origin);
    await writeNewArtifactFiles(state);
    const manifestPersisted = await persistManifest(state.manifest);
    if (!manifestPersisted.success) {
      throw new Error(manifestPersisted.error || "Manifest write failed");
    }
    const persisted = await persistWorkspaceState(state, origin);
    if (!persisted.success) {
      const failureMessage = "Changes are only in memory right now because persistence failed";
      lastWriteError = persisted.error || failureMessage;
      setPersistenceStatus(failureMessage, "danger");
      await appendAuditEntry(buildAuditEntry(auditErrorEvent, {
        artifactIds,
        paths,
        message: message || `Persistence failed during ${origin}`,
        outcome: "failure",
        error: persisted.error || failureMessage
      }));
      return false;
    }
    runtimeStatus.lastSavedBytes = persisted.bytes;
    lastWriteError = null;
    setPersistenceStatus(
      persisted.bytes >= SECURITY_LIMITS.persistWarningBytes
        ? `Workspace saved to "${workspaceRootHandle.name}" • ${formatBytes(persisted.bytes)} stored • approaching storage limits`
        : `Workspace saved to "${workspaceRootHandle.name}" • ${formatBytes(persisted.bytes)} stored`,
      persisted.bytes >= SECURITY_LIMITS.persistWarningBytes ? "warn" : "success"
    );
    if (auditEnabled) {
      await appendAuditEntry(buildAuditEntry("STATE_SAVED", {
        artifactIds,
        paths,
        message: message || "Workspace saved",
        outcome: "success"
      }));
    }
    if (auditEvent) {
      await appendAuditEntry(buildAuditEntry(auditEvent, {
        artifactIds,
        paths,
        message: message || origin,
        outcome: "success"
      }));
    }
    return true;
  } catch (error) {
    console.error(error);
    const failureMessage = "Changes are only in memory right now because persistence failed";
    lastWriteError = safeText(error?.message).trim() || failureMessage;
    setPersistenceStatus(failureMessage, "danger");
    await appendAuditEntry(buildAuditEntry(auditErrorEvent, {
      artifactIds,
      paths,
      message: message || `Persistence failed during ${origin}`,
      outcome: "failure",
      error: safeText(error?.message).trim() || failureMessage
    }));
    return false;
  }
}
