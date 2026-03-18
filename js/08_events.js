// 08_events.js — Operator actions, imports/exports, dynamic bindings, and event handlers
// Wires UI events to workflow mutations and persistence calls.


const debouncedKeystrokeSave = debounce((origin) => {
  saveState(origin, { audit: false }).catch(err => console.error("Persistence failed", err));
}, 1500);

function clearPackageData(key) {
  const pkg = state.stage4.packages[key];
  if (!pkg) return;
  const label = pkg.packageId || pkg.packageLabel || pkg.filename || key;
  const hadImpl = Boolean(pkg.implementationOutputText.trim());
  const hadReview = Boolean(pkg.reviewOutputText.trim());
  const artifactIds = normalizeAuditArtifactIds([pkg.packageArtifactId, pkg.implementationArtifactId, pkg.reviewArtifactId]);
  const fresh = createEmptyPackageRecord(pkg.filename, pkg.packageText);
  state.stage4.packages[key] = {
    ...fresh,
    packageId: pkg.packageId,
    packageLabel: pkg.packageLabel,
    objective: pkg.objective,
    dependsOnIds: pkg.dependsOnIds
  };
  state.stage6 = createDefaultState().stage6;

  // Supersede all package-owned artifacts for cleared package
  const packageClearedAt = nowStamp();
  const supersedableTypes = new Set(["implementation_file", "implementation_output", "review_report"]);
  manifestArtifactList(state).forEach(record => {
    if (
      supersedableTypes.has(record.artifactType) &&
      record.packageKey === key &&
      record.status === "current"
    ) {
      record.status = "superseded";
      record.statusReason = `Superseded by package clear at ${packageClearedAt}.`;
      record.supersededByArtifactId = record.supersededByArtifactId || `package_clear:${key}:${packageClearedAt}`;
    }
  });

  const cleared = [hadImpl ? "implementation output" : "", hadReview ? "review" : ""].filter(Boolean);
  setActionSummary(`Cleared ${label}: ${cleared.length ? cleared.join(" and ") + " superseded" : "reset to initial state"}. Ready for a fresh Stage 04 request.`);

  saveState("package data cleared", {
    auditEvent: "PACKAGE_CLEARED",
    artifactIds,
    message: `Cleared saved package data for ${label}.`
  }).catch(err => console.error("Persistence failed", err));
  render();
}

function clearStage(stageKey) {
  const selectedPackage = getSelectedPackage();
  const stageArtifactMap = {
    stage1: normalizeAuditArtifactIds([state.stage1.currentArtifactId, state.stage2.currentArtifactId, state.stage3.bundleArtifactId]),
    stage2: normalizeAuditArtifactIds([state.stage2.currentArtifactId, state.stage3.bundleArtifactId]),
    stage3: normalizeAuditArtifactIds([state.stage3.bundleArtifactId, ...(state.stage3.artifacts || []).map(item => item.artifactId)]),
    stage4: normalizeAuditArtifactIds([
      ...(Object.values(state.stage4.packages || {}).map(pkg => [pkg.packageArtifactId, pkg.implementationArtifactId, pkg.reviewArtifactId]).flat())
    ]),
    stage6: normalizeAuditArtifactIds([state.stage6.mergeArtifactId])
  };
  if (stageKey === "stage1") {
    state.stage1 = createDefaultState().stage1;
    state.stage2 = createDefaultState().stage2;
    state.stage3 = createDefaultState().stage3;
    clearLateStages();
  } else if (stageKey === "stage2") {
    state.stage2 = createDefaultState().stage2;
    state.stage3 = createDefaultState().stage3;
    clearLateStages();
  } else if (stageKey === "stage3") {
    state.stage3 = createDefaultState().stage3;
    clearLateStages();
  } else if (stageKey === "stage4") {
    syncPackagesFromStage3();
    Object.keys(state.stage4.packages).forEach(key => {
      state.stage4.packages[key] = createEmptyPackageRecord(state.stage4.packages[key].filename, state.stage4.packages[key].packageText);
    });
    state.stage6 = createDefaultState().stage6;
  } else if (stageKey === "stage6") {
    state.stage6 = createDefaultState().stage6;
  }
  saveState("stage cleared", {
    auditEvent: "STAGE_CLEARED",
    artifactIds: stageArtifactMap[stageKey] || normalizeAuditArtifactIds([selectedPackage?.implementationArtifactId, selectedPackage?.reviewArtifactId]),
    message: `Cleared saved data for ${stageKey.toUpperCase()}.`
  }).catch(err => console.error("Persistence failed", err));
  render();
}

function downloadAllSavedArtifacts() {
  if (workspaceRootHandle) {
    if (!confirm("All artifacts are already saved in your workspace folder. Download extra copies to a different location?")) return;
  }
  if (state.stage1.artifactText.trim()) downloadText("01_Master_Briefing.txt", state.stage1.artifactText);
  if (state.stage2.artifactText.trim()) downloadText("02_Architecture_Spec.txt", state.stage2.artifactText);
  if (state.stage3.artifacts.length) {
    state.stage3.artifacts.forEach((artifact, index) => {
      setTimeout(() => downloadText(artifact.filename, artifact.content), 120 * (index + 1));
    });
  } else if (state.stage3.rawOutputText.trim()) {
    downloadText(state.stage3.outcome === "pause" ? "03_Pause_For_Decisions.txt" : "03_Stage03_Output.txt", state.stage3.rawOutputText);
  }
  let offset = 8;
  getPackagesInOrder().forEach(pkg => {
    if (pkg.implementationOutputText.trim()) {
      const base = pkg.filename.replace(/\.txt$/i, "");
      setTimeout(() => downloadText(`${base}_Stage04_Output.txt`, pkg.implementationOutputText), 120 * (offset + 1));
      offset += 1;
    }
    if (pkg.reviewOutputText.trim()) {
      const base = pkg.filename.replace(/\.txt$/i, "");
      setTimeout(() => downloadText(`${base}_Stage05_Review.txt`, pkg.reviewOutputText), 120 * (offset + 1));
      offset += 1;
    }
  });
  if (state.stage6.mergeResultText.trim()) {
    setTimeout(() => downloadText("06_Integration_Report.txt", state.stage6.mergeResultText), 120 * (offset + 1));
  }
}

function exportBackup() {
  if (workspaceRootHandle) {
    if (!confirm("The workspace state is already saved on disk. Export a portable backup copy anyway?")) return;
  }
  ensureProvenanceReconciled("restored from saved session");
  const payload = {
    backupVersion: BACKUP_VERSION,
    exportedAt: nowStamp(),
    state: serializeStateForPersistence(state)
  };
  const serialized = JSON.stringify(payload, null, 2);
  downloadText("09_Operator_Console_REBUILT_STAGE01_TO_06_workspace_backup.json", serialized);
  setWorkspaceStatus(`Backup exported (${formatBytes(byteLengthOfText(serialized))})`, "success");
  render();
}

function importBackupFromFile(file) {
  if (!file) return;
  if (Number(file.size || 0) > SECURITY_LIMITS.maxBackupImportBytes) {
    const message = limitMessage(safeImportedFilename(file.name, "Backup file"), Number(file.size || 0), SECURITY_LIMITS.maxBackupImportBytes);
    setWorkspaceStatus(message, "danger");
    render();
    alert(message);
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const rawText = String(reader.result || "{}");
      const rawBytes = byteLengthOfText(rawText);
      if (rawBytes > SECURITY_LIMITS.maxBackupImportBytes) throw new Error(limitMessage(safeImportedFilename(file.name, "Backup file"), rawBytes, SECURITY_LIMITS.maxBackupImportBytes));
      const parsed = JSON.parse(rawText);
      const importedState = isPlainObject(parsed?.state) ? parsed.state : parsed;
      const normalized = normalizeImportedState(importedState);
      Object.assign(state, createDefaultState(), normalized);
      const saved = await saveState("restored from saved session", { audit: false });
      if (saved) {
        await appendAuditEntry(buildAuditEntry("BACKUP_IMPORTED", {
          message: `Backup imported from ${safeImportedFilename(file.name)}.`,
          outcome: "success"
        }));
      }
      setWorkspaceStatus(saved ? `Backup imported safely from ${safeImportedFilename(file.name)}.` : `Backup imported from ${safeImportedFilename(file.name)}, but persistence failed.`, saved ? "success" : "danger");
      render();
    } catch (error) {
      console.error(error);
      const message = safeText(error?.message).trim() || "The selected backup file could not be read safely.";
      setWorkspaceStatus(message, "danger");
      render();
      alert(message);
    }
  };
  reader.onerror = () => {
    const message = "The selected backup file could not be read.";
    setWorkspaceStatus(message, "danger");
    alert(message);
  };
  reader.readAsText(file);
}

function upsertReferenceFile(item) {
  const nextItem = {
    sourceMode: item.sourceMode || "manual-import",
    ...item,
    name: safeImportedFilename(item.name, "Imported_Reference.txt")
  };
  const promptStageKey = stageKeyForReferenceFile(nextItem);
  if (promptStageKey) {
    const promptItem = { ...nextItem, promptStageKey };
    const existingIndex = state.referenceFiles.findIndex(file => (file.promptStageKey || stageKeyForReferenceFile(file)) === promptStageKey);
    if (existingIndex >= 0) state.referenceFiles[existingIndex] = { ...state.referenceFiles[existingIndex], ...promptItem };
    else state.referenceFiles.push(promptItem);
  } else {
    delete nextItem.promptStageKey;
    const existingIndex = state.referenceFiles.findIndex(file => file.name === nextItem.name);
    if (existingIndex >= 0) state.referenceFiles[existingIndex] = { ...state.referenceFiles[existingIndex], ...nextItem };
    else state.referenceFiles.push(nextItem);
  }

  if (nextItem.text) {
    persistReferenceFile(nextItem.name, nextItem.text).catch(e =>
      console.warn("Reference persistence failed", e)
    );
  }
}

function attachReferenceFiles(fileList, sourceMode = "manual-import") {
  const files = Array.from(fileList || []);
  if (!files.length) return Promise.resolve({ loaded: 0, promptLoaded: 0, rejected: 0 });
  const validation = validateTextFileBatch(files, sourceMode === "folder-import" ? "selected text files" : "selected files");
  if (!validation.ok) {
    setWorkspaceStatus(validation.message, "danger");
    alert(validation.message);
    return Promise.resolve({ loaded: 0, promptLoaded: 0, rejected: files.length });
  }
  return Promise.all(files.map(file => readFileAsText(file, sourceMode))).then(results => {
    const accepted = results.filter(item => item && !item.error);
    const rejected = results.filter(item => item?.error);
    accepted.forEach(item => upsertReferenceFile(item));
    if (rejected.length) {
      setWorkspaceStatus(`Imported ${accepted.length} file(s). Skipped ${rejected.length} file(s) that failed validation or reading.`, accepted.length ? "warn" : "danger");
    } else if (accepted.length) {
      setWorkspaceStatus(`Imported ${accepted.length} file(s) safely.`, "success");
    } else {
      setWorkspaceStatus("No files were imported.", "warn");
    }
    saveState("reference files imported").catch(err => console.error("Persistence failed", err));
    render();
    return {
      loaded: accepted.length,
      promptLoaded: accepted.filter(item => isPromptReferenceFile(item)).length,
      rejected: rejected.length
    };
  });
}

function readFileAsText(file, sourceMode = "manual-import") {
  return new Promise(resolve => {
    const size = Number(file?.size || 0);
    if (size > SECURITY_LIMITS.maxSingleTextFileBytes) {
      resolve({ error: limitMessage(safeImportedFilename(file?.name, "Selected file"), size, SECURITY_LIMITS.maxSingleTextFileBytes) });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const actualBytes = byteLengthOfText(text);
      if (actualBytes > SECURITY_LIMITS.maxSingleTextFileBytes) {
        resolve({ error: limitMessage(safeImportedFilename(file?.name, "Selected file"), actualBytes, SECURITY_LIMITS.maxSingleTextFileBytes) });
        return;
      }
      resolve({
        name: safeImportedFilename(file.name, "Imported_Reference.txt"),
        text,
        size: actualBytes,
        lastModified: file.lastModified,
        sourceMode
      });
    };
    reader.onerror = () => resolve({ error: `The file ${safeImportedFilename(file?.name, "Selected file")} could not be read as text inside the browser.` });
    reader.readAsText(file);
  });
}

function setupTextareaFileImport(textareaId) {
  const textarea = document.getElementById(textareaId);
  if (!textarea) return;
  if (textarea.dataset.fileImportReady) return;
  textarea.dataset.fileImportReady = "true";

  async function readAndAppendFiles(files, source) {
    if (!files || !files.length) return;
    const fileArray = Array.from(files).sort((a, b) => a.name.localeCompare(b.name));
    const chunks = [];
    const errors = [];
    for (const file of fileArray) {
      try {
        const result = await readFileAsText(file, source);
        if (result?.error) {
          errors.push(`${file.name}: ${result.error}`);
        } else if (result?.text) {
          chunks.push(result.text);
        }
      } catch (error) {
        errors.push(`${file.name}: ${error?.message || "unknown error"}`);
      }
    }
    if (errors.length) alert("Could not read:\n" + errors.join("\n"));
    if (!chunks.length) return;
    const combined = chunks.join("\n\n");
    const existing = textarea.value.trim();
    textarea.value = existing ? existing + "\n\n" + combined : combined;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.scrollTop = textarea.scrollHeight;
  }

  const wrapper = textarea.closest(".field") || textarea.parentElement;
  if (wrapper) {
    const importRow = document.createElement("div");
    importRow.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;";
    importRow.innerHTML = `
      <button class="ghost-btn" type="button" style="padding:6px 12px;font-size:0.85rem;">Load from file(s)</button>
      <span class="mini" style="color:var(--muted);">or drag & drop text files onto the field above (multi-select supported, appends)</span>
    `;
    const fileBtn = importRow.querySelector("button");
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".txt,.md,.json,.py,.js,.ts,.html,.css,.xml,.yaml,.yml,.toml,.csv,.log,.rst,.cfg,.ini,.sh,.bat";
    fileInput.multiple = true;
    fileInput.hidden = true;
    importRow.appendChild(fileInput);

    fileBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      await readAndAppendFiles(fileInput.files, "file-import");
      fileInput.value = "";
    });

    wrapper.appendChild(importRow);
  }

  textarea.addEventListener("dragover", event => {
    event.preventDefault();
    textarea.style.borderColor = "var(--accent)";
    textarea.style.background = "rgba(110, 231, 183, 0.06)";
  });

  textarea.addEventListener("dragleave", () => {
    textarea.style.borderColor = "";
    textarea.style.background = "";
  });

  textarea.addEventListener("drop", async event => {
    event.preventDefault();
    textarea.style.borderColor = "";
    textarea.style.background = "";
    await readAndAppendFiles(event.dataTransfer?.files, "file-drop");
  });
}

async function importFilesIntoPackage(pkg, files) {
  if (!workspaceRootHandle || !pkg || !files.length) return { imported: 0, failed: 0 };

  const totalBytes = files.reduce((sum, file) => sum + Math.max(0, Number(file?.size || 0) || 0), 0);
  if (totalBytes > SECURITY_LIMITS.maxBatchImportBytes) {
    return {
      imported: 0,
      failed: files.length,
      error: limitMessage("Selected files", totalBytes, SECURITY_LIMITS.maxBatchImportBytes)
    };
  }

  let imported = 0;
  let failed = 0;
  const stageDir = workspaceSubHandles["stage04"];
  if (!stageDir) return { imported: 0, failed: files.length };

  for (const file of files) {
    try {
      const result = await readFileAsText(file, "file-import");
      if (result?.error) {
        console.warn("Skipped file:", result.error);
        failed += 1;
        continue;
      }
      const fileText = result?.text || "";
      if (!fileText.trim()) {
        failed += 1;
        continue;
      }

      const safePkgKey = sanitizeFilenameSegment(pkg.packageId || pkg.key || "pkg", 30);
      const safeFileName = safeImportedFilename(file.name, "imported_file.txt");
      const diskFilename = `${safePkgKey}__${safeFileName}`;
      const relativePath = `stage04/${diskFilename}`;
      const parentArtifactIds = [pkg.packageArtifactId, pkg.implementationArtifactId].filter(Boolean);
      const logicalKey = `implementation_file:${pkg.key}:${safeFileName}`;

      await writeTextFile(stageDir, diskFilename, fileText);
      const hash = await computeContentHash(fileText);

      ensureManifestStructure(state);
      const previousHead = manifestArtifactList(state)
        .filter(record => record.logicalKey === logicalKey)
        .sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0))[0] || null;

      const artifactId = createOrReuseArtifactRecord(state, {
        currentArtifactId: previousHead?.artifactId || "",
        previousHeadId: previousHead?.artifactId || "",
        artifactType: "implementation_file",
        logicalKey,
        stageProduced: "Stage 04",
        text: fileText,
        title: `${pkg.packageId || pkg.key} — ${file.name}`,
        filename: file.name,
        packageKey: pkg.key,
        packageId: pkg.packageId || "",
        parentArtifactIds,
        consumedArtifactIds: [],
        consumingStageContext: "Imported implementation file attached to the current package workspace context.",
        sourceOrigin: "file-import",
        attributes: {
          originalFilename: file.name,
          fileSize: file.size,
          workspaceFilename: diskFilename
        }
      });

      const record = getManifestArtifact(artifactId, state);
      if (record) {
        record.relativePath = relativePath;
        record.contentHash = hash;
        record.promptSnapshotPath = safeText(record.promptSnapshotPath).trim();
      }

      await appendAuditEntry(buildAuditEntry("ARTIFACT_SAVED", {
        artifactIds: [artifactId],
        paths: [relativePath],
        message: `Implementation file imported: ${file.name} for ${pkg.packageId || pkg.key}`,
        outcome: "success"
      }));

      imported += 1;
    } catch (error) {
      console.error("File import failed for", file?.name, error);
      failed += 1;
    }
  }

  if (imported > 0) {
    reconcileArtifactStatuses(state);
    await persistManifest(state.manifest);
    await saveState("implementation files imported", {
      auditEvent: "ARTIFACT_SAVED",
      message: `${imported} implementation file(s) imported for ${pkg.packageId || pkg.key}`
    }).catch(() => {});
  }

  return { imported, failed };
}

function promptFilenameCandidates(stageKey) {
  const rule = STAGE_PROMPT_IMPORTS[stageKey];
  if (!rule) return [];
  const candidates = new Set([rule.preferredFilename]);
  const vMatch = (rule.preferredFilename || "").match(/_v(\d+)\./);
  const vTag = vMatch ? `_v${vMatch[1]}` : "";
  (rule.acceptedStems || []).forEach(stem => {
    candidates.add(`${rule.number}_${stem}.txt`);
    candidates.add(`${rule.number}_${stem}_.txt`);
    if (vTag) candidates.add(`${rule.number}_${stem}${vTag}.txt`);
  });
  return Array.from(candidates);
}

function missingPromptHints(stageKeys) {
  return (stageKeys || []).map(stageKey => {
    const rule = STAGE_PROMPT_IMPORTS[stageKey];
    return `${rule.label} (${rule.filenameHint})`;
  });
}

async function collectPromptFileHandlesFromDirectory(handle) {
  const fileHandles = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "file" && /\.txt$/i.test(entry.name || "")) fileHandles.push(entry);
  }
  return fileHandles;
}

async function loadPromptFilesFromDirectoryHandle(handle) {
  const fileHandles = await collectPromptFileHandlesFromDirectory(handle);
  const files = [];
  for (const fileHandle of fileHandles) {
    try {
      files.push(await fileHandle.getFile());
    } catch (error) {}
  }
  const validation = validateTextFileBatch(files, "selected prompt folder");
  if (!validation.ok) throw new Error(validation.message);

  const loadedItems = [];
  for (const file of files) {
    const item = await readFileAsText(file, "folder-import");
    if (!item?.error) loadedItems.push(item);
  }

  let loaded = 0;
  const missingStageKeys = [];
  for (const stageKey of STAGE_PROMPT_KEYS) {
    const matchingItem = chooseBestStagePromptMatch(loadedItems, stageKey);
    if (!matchingItem) {
      missingStageKeys.push(stageKey);
      continue;
    }
    upsertReferenceFile(matchingItem);
    loaded += 1;
  }
  setWorkspaceStatus(loaded ? `Imported ${loaded} stage prompt file(s) safely.` : "No matching stage prompt files were imported.", loaded ? "success" : "warn");
  saveState("prompt files imported").catch(err => console.error("Persistence failed", err));
  render();
  return { loaded, missingStageKeys };
}

async function tryAutoLoadSiblingPromptFiles() {
  const missingStageKeys = STAGE_PROMPT_KEYS.filter(stageKey => !hasUsableStagePrompt(stageKey));
  if (!missingStageKeys.length) return { attempted: false, loaded: 0, missingStageKeys: [] };

  // Try to restore cached prompt folder handle
  if (!promptFolderHandle) {
    const restored = await tryRestorePromptFolderHandle();
    if (!restored) return { attempted: false, loaded: 0, missingStageKeys };
  }

  try {
    const result = await loadPromptFilesFromDirectoryHandle(promptFolderHandle);
    if (result.loaded) {
      setWorkspaceStatus(`Loaded ${result.loaded} prompt file(s) from "${promptFolderHandle.name}".`, "success");
      saveState("prompt files auto-loaded").catch(err => console.error("Persistence failed", err));
      render();
    }
    return result;
  } catch (e) {
    console.warn("Auto-load from cached prompt folder failed", e);
    return { attempted: true, loaded: 0, missingStageKeys };
  }
}

async function loadAccompanyingPromptFiles() {
  if (window.showDirectoryPicker) {
    try {
      const result = await selectPromptFolder();
      if (!result.available) return;
      const loadResult = await loadPromptFilesFromDirectoryHandle(promptFolderHandle);
      const missingText = loadResult.missingStageKeys.length ? ` Missing: ${missingPromptHints(loadResult.missingStageKeys).join(", ")}` : "";
      alert(loadResult.loaded
        ? `Imported ${loadResult.loaded} matching stage prompt file(s) from "${promptFolderHandle.name}".${missingText} Only content-confirmed files become ready.`
        : `No matching stage prompt files were imported from "${promptFolderHandle.name}".${missingText}`);
    } catch (error) {
      if (error?.name !== "AbortError") {
        const message = safeText(error?.message).trim() || "The selected prompt folder could not be read.";
        setWorkspaceStatus(message, "danger");
        render();
        alert(message);
      }
    }
    return;
  }
  document.getElementById("promptFolderInput")?.click();
}

function promptReady(stageKey) {
  if (hasUsableStagePrompt(stageKey)) return true;
  alert(missingStagePromptMessage(stageKey));
  return false;
}

function resetMergeState() {
  const priorMergeArtifactId = state.stage6.mergeArtifactId;
  const hadMergeState = Boolean(
    safeText(state.stage6.requestText).trim() ||
    safeText(state.stage6.mergeResultText).trim() ||
    safeText(priorMergeArtifactId).trim() ||
    (state.stage6.includedPackageKeys || []).length
  );
  state.stage6 = createDefaultState().stage6;
  if (hadMergeState) {
    appendAuditEntry(buildAuditEntry("STAGE_CLEARED", {
      artifactIds: normalizeAuditArtifactIds([priorMergeArtifactId]),
      message: "Cleared saved Stage 06 merge state.",
      outcome: "success"
    })).catch(error => console.error("Audit logging failed", error));
  }
}

function setPacket(target, prefix, text) {
  target[`${prefix}Text`] = text;
  target[`${prefix}Prepared`] = true;
  target[`${prefix}Copied`] = false;
}

function clearPacket(target, prefix) {
  target[`${prefix}Text`] = "";
  target[`${prefix}Prepared`] = false;
  target[`${prefix}Copied`] = false;
}

function readRequiredInput(id, message) {
  const value = safeText(document.getElementById(id)?.value).trim();
  if (!value) {
    alert(message);
    return value;
  }
  return value;
}

function getRequiredPackage(message = "Choose a package first.") {
  const pkg = getSelectedPackage();
  if (!pkg) alert(message);
  return pkg;
}

async function copyPacket(text, onSuccess) {
  const ok = await copyToClipboard(text);
  if (!ok) alert(COPY_FAIL_MESSAGE);
  if (onSuccess) onSuccess();
  finalizeRender();
}

function applyArchitectureSpec(value) {
  state.stage2.artifactText = value;
  state.stage2.savedAt = nowStamp();
  state.stage2.readinessStatus = parseReadinessStatus(value);
  state.stage2.progressionStatus = parseProgressionStatus(value);
  clearPacket(state.stage2, "retryRequest");
  state.stage3 = createDefaultState().stage3;
  clearLateStages();
}

function saveImplementationOutput(pkg, value) {
  pkg.implementationOutputText = value;
  pkg.implementationSavedAt = nowStamp();
  pkg.implementationOutputFingerprint = textFingerprint(value);
  pkg.implementationStatus = parseImplementationStatus(value);
  clearPacket(pkg, "implementationRequest");
  clearPacket(pkg, "reviewRequest");
  pkg.reviewUsable = pkg.reviewBoundFingerprint && pkg.reviewBoundFingerprint === pkg.implementationOutputFingerprint;
  resetMergeState();

  // Supersede previous implementation_file artifacts for this package
  const implementationSupersededAt = nowStamp();
  manifestArtifactList(state).forEach(record => {
    if (
      record.artifactType === "implementation_file" &&
      record.packageKey === pkg.key &&
      record.status === "current"
    ) {
      record.status = "superseded";
      record.statusReason = `Superseded by new implementation output at ${implementationSupersededAt}.`;
      record.supersededByArtifactId = record.supersededByArtifactId || `implementation_output:${pkg.key}:${implementationSupersededAt}`;
    }
  });
}

function saveReviewOutput(pkg, value) {
  pkg.reviewOutputText = value;
  pkg.reviewSavedAt = nowStamp();
  pkg.reviewBoundFingerprint = parseReviewBoundFingerprint(value);
  pkg.reviewDisposition = parseReviewDisposition(value);
  pkg.reviewVerdict = parseReviewVerdict(value);
  pkg.reviewUsable = Boolean(pkg.reviewBoundFingerprint && pkg.reviewBoundFingerprint === pkg.implementationOutputFingerprint);
  clearPacket(pkg, "reviewRequest");
  if (pkg.reviewUsable && pkg.reviewDisposition === "REWORK") clearPacket(pkg, "implementationRequest");
  resetMergeState();
}

function downloadCurrentRequest() {
  const key = currentActionKey();
  const pkg = getSelectedPackage();
  const map = {
    copyStage1: ["01_Stage01_Request.txt", state.stage1.requestText],
    copyStage2: ["02_Stage02_Request.txt", state.stage2.requestText],
    copyStage2Retry: ["02_Stage02_Retry_Request.txt", state.stage2.retryRequestText],
    copyStage3: ["03_Stage03_Request.txt", state.stage3.requestText],
    copyPauseResponse: ["03_Pause_Response_Packet.txt", state.stage3.pauseResponsePacketText],
    copyStage4: [`${pkg ? pkg.filename.replace(/\.txt$/i, "") : "04_Package"}_Stage04_Request.txt`, pkg ? pkg.implementationRequestText : ""],
    copyStage5: [`${pkg ? pkg.filename.replace(/\.txt$/i, "") : "05_Package"}_Stage05_Request.txt`, pkg ? pkg.reviewRequestText : ""],
    copyStage6: ["06_Merge_Request.txt", state.stage6.requestText]
  };
  const [filename, body] = map[key] || ["request.txt", ""];
  if (body) downloadText(filename, body);
}

function bindDynamicEvents() {
  const bindAttr = (selector, eventName, handler) => document.querySelectorAll(selector).forEach(el => el.addEventListener(eventName, event => handler(el, event)));

  bindAttr("#projectNameInput", "input", (_, event) => { state.projectName = event.target.value; debouncedKeystrokeSave("project name edited"); });
  bindAttr("#projectNotesInput", "input", (_, event) => { state.projectNotes = event.target.value; debouncedKeystrokeSave("project notes edited"); });
  bindAttr("#pauseAnswersInput", "input", (_, event) => { state.stage3.pauseAnswerDraft = event.target.value; debouncedKeystrokeSave("pause answers edited"); });

  bindIf("reconnectWorkspaceBtn", async () => {
    const ok = await reconnectWorkspace();
    if (ok) {
      const loaded = await loadPersistedWorkspaceState();
      if (loaded.found && loaded.state) {
        Object.assign(state, createDefaultState(), loaded.state);
        runtimeStatus._showResumeSummary = true;
        setPersistenceStatus(`Workspace reconnected from "${workspaceRootHandle.name}" (${formatBytes(loaded.bytes)})`, "success");
        await appendAuditEntry(buildAuditEntry("WORKSPACE_LOADED", {
          message: `Reconnected workspace from ${workspaceRootHandle.name}`,
          outcome: "success"
        }));
        const integrity = await checkWorkspaceIntegrity(state);
        if (!integrity.ok) {
          const names = integrity.missing.map(m => m.title).join(", ");
          await persistManifest(state.manifest);
          setWorkspaceStatus(`Warning: ${integrity.missing.length} artifact file(s) missing on disk: ${names}. These artifacts are marked as missing in the manifest.`, "warn");
        }
      } else {
        setPersistenceStatus(`Workspace reconnected to "${workspaceRootHandle.name}" — no saved state found`, "");
      }
      await syncWorkflowState("SELECT_WORKSPACE_ROOT");
      render();
      renderWorkspaceIndicator();
    } else {
      setPersistenceStatus("Permission was not granted. Try selecting the folder manually.", "warn");
      render();
    }
  });

  bindIf("selectWorkspaceFolderBtn", async () => {
    const result = await selectWorkspaceRoot();
    if (result.available) {
      const loaded = await loadPersistedWorkspaceState();
      if (loaded.found && loaded.state) {
        Object.assign(state, createDefaultState(), loaded.state);
        runtimeStatus._showResumeSummary = true;
        setPersistenceStatus(`Workspace loaded from "${workspaceRootHandle.name}"`, "success");
      } else if (hasLegacyLocalStorageData()) {
        if (confirm("Found saved workspace data from a previous console version in this browser. Import it into the new disk-backed workspace?")) {
          const migrated = await migrateLegacyLocalStorage();
          if (migrated) {
            setPersistenceStatus(`Legacy workspace migrated to "${workspaceRootHandle.name}"`, "success");
          } else {
            setPersistenceStatus(`Migration failed — starting fresh in "${workspaceRootHandle.name}"`, "warn");
          }
        } else {
          setPersistenceStatus(`New workspace in "${workspaceRootHandle.name}"`, "success");
        }
      } else {
        setPersistenceStatus(`New workspace in "${workspaceRootHandle.name}"`, "success");
      }
      await syncWorkflowState("SELECT_WORKSPACE_ROOT");
      render();
    }
  });
  bindAttr("#referenceFileInput", "change", (_, event) => {
    attachReferenceFiles(event.target.files, "manual-import");
    event.target.value = "";
  });
  bindAttr("#promptFolderInput", "change", (_, event) => {
    const promptFiles = Array.from(event.target.files || []).filter(file => /\.txt$/i.test(file.name || ""));
    attachReferenceFiles(promptFiles, "folder-import").then(result => {
      const missingStageKeys = STAGE_PROMPT_KEYS.filter(stageKey => !hasUsableStagePrompt(stageKey));
      const missingText = missingStageKeys.length ? ` Missing: ${missingPromptHints(missingStageKeys).join(", ")}` : "";
      if (result.loaded) alert(`Imported ${result.loaded} matching stage prompt file(s) from the selected folder.${missingText} Only content-confirmed files become ready.`);
      else alert(`No matching stage prompt files were imported from the selected folder.${missingText}`);
    });
    event.target.value = "";
  });
  bindAttr("[data-llm-id]", "change", (el, event) => {
    state.llms[el.getAttribute("data-llm-id")] = event.target.checked;
    if (!state.stage1.requestPrepared && !state.stage1.artifactText.trim()) state.setup.stage1ReadyConfirmed = false;
    finalizeRender();
  });
  bindAttr("[data-llm-label]", "input", (el, event) => {
    const id = el.getAttribute("data-llm-label");
    state.llmCatalog[id] = { ...(state.llmCatalog[id] || {}), label: event.target.value };
    saveState("llm label edited", { audit: false }).catch(err => console.error("Persistence failed", err));
  });
  bindAttr("[data-select-package]", "click", el => selectPackage(el.getAttribute("data-select-package")));
  bindAttr("[data-open-package-chooser]", "click", () => { state.stage4.selectedPackageKey = ""; finalizeRender(); });
  bindAttr("[data-download-request]", "click", downloadCurrentRequest);
  bindAttr("[data-download-single]", "click", el => {
    const file = { "01_Master_Briefing.txt": state.stage1.artifactText, "02_Architecture_Spec.txt": state.stage2.artifactText }[el.getAttribute("data-download-single")];
    if (file) downloadText(el.getAttribute("data-download-single"), file);
  });
  bindAttr("[data-download-artifact]", "click", el => {
    const artifact = state.stage3.artifacts.find(item => item.filename === el.getAttribute("data-download-artifact"));
    if (artifact) downloadText(artifact.filename, artifact.content);
  });
  bindAttr("[data-download-package-output]", "click", el => {
    const pkg = state.stage4.packages[el.getAttribute("data-download-package-output")];
    if (pkg?.implementationOutputText.trim()) downloadText(`${pkg.filename.replace(/\.txt$/i, "")}_Stage04_Output.txt`, pkg.implementationOutputText);
  });
  bindAttr("[data-download-package-review]", "click", el => {
    const pkg = state.stage4.packages[el.getAttribute("data-download-package-review")];
    if (pkg?.reviewOutputText.trim()) downloadText(`${pkg.filename.replace(/\.txt$/i, "")}_Stage05_Review.txt`, pkg.reviewOutputText);
  });
  bindAttr("[data-download-merge-result]", "click", () => state.stage6.mergeResultText.trim() && downloadText("06_Integration_Report.txt", state.stage6.mergeResultText));
  bindAttr("[data-clear-artifact]", "click", el => { if (confirm("Remove this saved artifact from the current workspace?")) clearStage(el.getAttribute("data-clear-artifact")); });
  bindAttr("[data-clear-package]", "click", el => {
    const key = el.getAttribute("data-clear-package");
    const pkg = state.stage4.packages[key];
    if (!pkg) return;
    const consequences = buildClearPackageConsequences(pkg);
    const message = consequences.length
      ? `Clear this package?\n\n${consequences.join("\n")}`
      : "Clear the saved implementation output and review for this package?";
    if (confirm(message)) clearPackageData(key);
  });
  bindAttr("[data-remove-ref]", "click", el => { state.referenceFiles = state.referenceFiles.filter(file => file.name !== el.getAttribute("data-remove-ref")); finalizeRender(); });
  bindAttr("[data-download-ref]", "click", el => {
    const file = state.referenceFiles.find(item => item.name === el.getAttribute("data-download-ref"));
    if (file) downloadText(file.name, file.text);
  });

  bindIf("prepareStage1Btn", () => {
    if (!hasUsableStagePrompt("stage1")) return alert(missingStagePromptMessage("stage1"));
    if (!hasTierBaseline()) return alert("Select at least one Tier 1 slot and one Tier 2 slot first.");
    state.setup.stage1ReadyConfirmed = true;
    finalizeRender();
  });
  bindIf("prepareStage1RequestBtn", async () => {
    if (!promptReady("stage1")) return;
    setPacket(state.stage1, "request", buildStage1Request());
    const snapshotPath = await writePromptSnapshot("stage1", getStagePromptText("stage1"));
    if (snapshotPath) state.stage1._lastPromptSnapshotPath = snapshotPath;
    finalizeRender();
  });
  bindIf("copyStage1Btn", () => copyPacket(state.stage1.requestText, () => { state.stage1.requestCopied = true; }));
  bindIf("SaveMasterBriefingBtn", () => {
    const value = readRequiredInput("stage1ReturnInput", "Paste the final Master Briefing first.");
    if (!value) return;
    const isUpdate = Boolean(state.stage1.artifactText.trim());
    state.stage1.artifactText = value;
    state.stage1.savedAt = nowStamp();
    setActionSummary(isUpdate ? "Master Briefing updated. Downstream artifacts remain saved but may need re-evaluation." : "Master Briefing saved. The next step is to build the Stage 02 request.");
    finalizeRender();
  });

  bindIf("prepareStage2Btn", async () => {
    if (!promptReady("stage2")) return;
    setPacket(state.stage2, "request", buildStage2Request());
    const snapshotPath = await writePromptSnapshot("stage2", getStagePromptText("stage2"));
    if (snapshotPath) state.stage2._lastPromptSnapshotPath = snapshotPath;
    finalizeRender();
  });
  bindIf("copyStage2Btn", () => copyPacket(state.stage2.requestText, () => { state.stage2.requestCopied = true; }));
  bindIf("SaveArchitectureSpecBtn", () => {
    const value = readRequiredInput("stage2ReturnInput", "Paste the Architecture Spec first.");
    if (!value) return;
    const isUpdate = Boolean(state.stage2.artifactText.trim());
    applyArchitectureSpec(value);
    if (architectureNeedsRetry()) {
      setActionSummary(`Architecture Spec saved but the readiness gate is blocked: ${describeArchitectureBlock()}`, "warn");
    } else {
      setActionSummary(isUpdate ? "Architecture Spec updated. The Stage 03 gate is open." : "Architecture Spec saved. The next step is to build the Stage 03 request.");
    }
    finalizeRender();
  });
  bindIf("prepareStage2RetryBtn", async () => {
    if (!promptReady("stage2")) return;
    state.stage2.retryReason = describeArchitectureBlock();
    setPacket(state.stage2, "retryRequest", buildStage2Request([
      "Please revise the current Architecture Spec so the downstream gate is operationally usable.",
      "Preserve unaffected contracts where possible.",
      "",
      "Current blocking reason:",
      describeArchitectureBlock(),
      "",
      "Current Architecture Spec to revise:",
      safeText(state.stage2.artifactText).trim()
    ].join("\n")));
    const snapshotPath = await writePromptSnapshot("stage2", getStagePromptText("stage2"));
    if (snapshotPath) state.stage2._lastPromptSnapshotPath = snapshotPath;
    state.stage2.progressionStatus = "";
    finalizeRender();
  });
  bindIf("copyStage2RetryBtn", () => copyPacket(state.stage2.retryRequestText, () => { state.stage2.retryRequestCopied = true; }));
  bindIf("SaverevisedArchitectureSpecBtn", () => {
    const value = readRequiredInput("stage2RetryInput", "Paste the revised Architecture Spec first.");
    if (!value) return;
    applyArchitectureSpec(value);
    if (architectureNeedsRetry()) {
      setActionSummary(`Revised Architecture Spec saved but the gate is still blocked: ${describeArchitectureBlock()}`, "warn");
    } else {
      setActionSummary("Revised Architecture Spec saved. The Stage 03 gate is now open.");
    }
    finalizeRender();
  });

  bindIf("prepareStage3Btn", async () => {
    if (!promptReady("stage3")) return;
    setPacket(state.stage3, "request", buildStage3Request(isStage3PausePrep() ? [
      "The current Architecture Spec signals PAUSE_FOR_DECISIONS.",
      "Run Stage 03 only to obtain the single PAUSE artifact.",
      "Do not generate implementation work packages in this run."
    ].join("\n") : ""));
    const snapshotPath = await writePromptSnapshot("stage3", getStagePromptText("stage3"));
    if (snapshotPath) state.stage3._lastPromptSnapshotPath = snapshotPath;
    finalizeRender();
  });
  bindIf("copyStage3Btn", () => copyPacket(state.stage3.requestText, () => { state.stage3.requestCopied = true; }));
  bindIf("SaveorchestrationresultBtn", () => {
    const value = readRequiredInput("stage3ReturnInput", "Paste the full Stage 03 result first.");
    if (!value) return;
    commitStage3Result(value);
    const packages = getPackagesInOrder();
    if (state.stage3.outcome === "pause") {
      setActionSummary("Stage 03 result saved — PAUSE detected. Answer the decision questionnaire to continue.", "warn");
    } else if (state.stage3.outcome === "closed" && packages.length) {
      setActionSummary(`Stage 03 result saved — CLOSED. ${packages.length} work package${packages.length === 1 ? "" : "s"} detected. Ready for implementation.`);
    } else {
      setActionSummary("Stage 03 result saved.");
    }
  });
  bindIf("preparePauseResponseBtn", async () => {
    const answers = readRequiredInput("pauseAnswersInput", "Write your decision answers first.");
    if (!answers) return;
    state.stage3.pauseAnswerDraft = answers;
    setPacket(state.stage3, "pauseResponse", buildPauseResponsePacket());
    const pauseSnapshotStageKey = state.stage3.pauseResumeTarget || "stage3";
    const snapshotPath = await writePromptSnapshot(pauseSnapshotStageKey, getStagePromptText(pauseSnapshotStageKey));
    if (snapshotPath) state.stage3._lastPromptSnapshotPath = snapshotPath;
    finalizeRender();
  });
  bindIf("copyPauseResponseBtn", () => copyPacket(state.stage3.pauseResponsePacketText, () => {
    state.stage3.pauseResponseCopied = true;
    state.stage3.pauseWaitingForUpdatedResult = true;
  }));
  bindIf("SaveupdatedresultBtn", () => {
    const value = readRequiredInput("pauseReturnInput", "Paste the updated authoritative result first.");
    if (value) savePauseReturn(value);
  });

  bindIf("prepareStage4Btn", async () => {
    if (!promptReady("stage4")) return;
    const pkg = getRequiredPackage();
    if (!pkg) return;
    setPacket(pkg, "implementationRequest", buildStage4Request(pkg, pkg.reviewUsable && pkg.reviewDisposition === "REWORK" ? "rework" : "normal"));
    const snapshotPath = await writePromptSnapshot("stage4", getStagePromptText("stage4"));
    if (snapshotPath) pkg._lastPromptSnapshotPath = snapshotPath;
    resetMergeState();
    finalizeRender();
  });
  bindIf("copyStage4Btn", () => {
    const pkg = getRequiredPackage();
    if (pkg) copyPacket(pkg.implementationRequestText, () => { pkg.implementationRequestCopied = true; });
  });
  bindIf("SaveimplementationoutputBtn", () => {
    const pkg = getRequiredPackage();
    const value = readRequiredInput("stage4ReturnInput", "Paste the full implementation output first.");
    if (!pkg || !value) return;
    const hadReview = pkg.reviewUsable;
    const hadOutput = Boolean(pkg.implementationOutputText.trim());
    saveImplementationOutput(pkg, value);
    const parts = [`Implementation output saved for ${pkg.packageId || pkg.filename}.`];
    if (hadOutput) parts.push("Previous output superseded.");
    if (hadReview) parts.push("Existing review is now stale — a new review is required.");
    setActionSummary(parts.join(" "));
    finalizeRender();
  });

  bindIf("prepareStage5Btn", async () => {
    if (!promptReady("stage5")) return;
    const pkg = getRequiredPackage();
    if (!pkg?.implementationOutputText.trim()) return alert("You cannot start review yet because this package has no saved implementation output.");
    setPacket(pkg, "reviewRequest", buildStage5Request(pkg));
    const snapshotPath = await writePromptSnapshot("stage5", getStagePromptText("stage5"));
    if (snapshotPath) pkg._lastPromptSnapshotPath = snapshotPath;
    resetMergeState();
    finalizeRender();
  });
  bindIf("copyStage5Btn", () => {
    const pkg = getRequiredPackage();
    if (pkg) copyPacket(pkg.reviewRequestText, () => { pkg.reviewRequestCopied = true; });
  });
  bindIf("SavereviewresultBtn", () => {
    const pkg = getRequiredPackage();
    const value = readRequiredInput("stage5ReturnInput", "Paste the full review report first.");
    if (!pkg || !value) return;
    const hadReview = Boolean(pkg.reviewOutputText.trim());
    saveReviewOutput(pkg, value);
    const label = pkg.packageId || pkg.filename;
    if (pkg.reviewUsable && pkg.reviewDisposition === "ACCEPT") {
      setActionSummary(`Review saved for ${label} — ACCEPTED. This package is now eligible for Stage 06 merge.`);
    } else if (pkg.reviewUsable && pkg.reviewDisposition === "REWORK") {
      setActionSummary(`Review saved for ${label} — REWORK required. The next step is a revised Stage 04 implementation.`, "warn");
    } else if (!pkg.reviewUsable) {
      setActionSummary(`Review saved for ${label}, but the binding fingerprint does not match the current implementation output. A new review bound to the current output is needed.`, "warn");
    } else {
      setActionSummary(`Review saved for ${label}.${hadReview ? " Previous review replaced." : ""}`);
    }
    finalizeRender();
  });

  bindIf("chooseAnotherPackageBtn", () => { state.stage4.selectedPackageKey = ""; finalizeRender(); });
  ["prepareMergeBtn", "prepareMergeBtnAlt"].forEach(id => bindIf(id, prepareMergeFromCurrentState));
  bindIf("SaveMergeResultBtn", () => {
    const value = readRequiredInput("stage6ReturnInput", "Paste the full merge result first.");
    if (!value) return;
    state.stage6.mergeResultText = value;
    state.stage6.mergeSavedAt = nowStamp();
    state.stage6.mergeVerdict = parseMergeVerdict(value);
    clearPacket(state.stage6, "request");
    const verdict = state.stage6.mergeVerdict;
    if (verdict) {
      setActionSummary(`Merge result saved — verdict: ${verdict}.`);
    } else {
      setActionSummary("Merge result saved.");
    }
    finalizeRender();
  });
  bindIf("downloadManifestBtn", () => downloadText("09_Operator_Console_Artifact_Manifest.json", JSON.stringify(state.manifest, null, 2)));
  bindIf("downloadStage3SetBtn", () => state.stage3.rawOutputText.trim() ? downloadAllSavedArtifacts() : alert("No Stage 03 result is saved yet."));
  bindIf("downloadSummaryBtnInline", downloadAllSavedArtifacts);
  bindIf("loadPromptFolderBtn", loadAccompanyingPromptFiles);
  bindIf("importFilesBtn", () => document.getElementById("referenceFileInput")?.click());

  [
    "stage1ReturnInput",
    "stage2ReturnInput",
    "stage2RetryInput",
    "stage3ReturnInput",
    "pauseReturnInput",
    "stage4ReturnInput",
    "stage5ReturnInput",
    "stage6ReturnInput"
  ].forEach(id => setupTextareaFileImport(id));

  const dropZone = document.getElementById("packageFileDropZone");
  const packageFileInput = document.getElementById("packageFileInput");
  if (dropZone && packageFileInput) {
    dropZone.addEventListener("click", () => packageFileInput.click());

    dropZone.addEventListener("dragover", event => {
      event.preventDefault();
      dropZone.style.borderColor = "var(--accent)";
      dropZone.style.background = "rgba(110, 231, 183, 0.06)";
      dropZone.textContent = "Release to import";
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.style.borderColor = "";
      dropZone.style.background = "";
      dropZone.textContent = "Drop files here or click to select";
    });

    dropZone.addEventListener("drop", async event => {
      event.preventDefault();
      dropZone.style.borderColor = "";
      dropZone.style.background = "";
      const files = Array.from(event.dataTransfer?.files || []);
      if (!files.length) return;
      const pkg = getSelectedPackage();
      if (!pkg) {
        alert("No package is selected.");
        return;
      }
      dropZone.textContent = `Importing ${files.length} file(s)...`;
      try {
        const result = await importFilesIntoPackage(pkg, files);
        if (result.error) {
          setWorkspaceStatus(result.error, "danger");
        } else {
          const msg = `Imported ${result.imported} file(s)${result.failed ? `, ${result.failed} failed` : ""}.`;
          setWorkspaceStatus(msg, result.failed ? "warn" : "success");
        }
      } finally {
        dropZone.textContent = "Drop files here or click to select";
        render();
      }
    });

    packageFileInput.addEventListener("change", async () => {
      const files = Array.from(packageFileInput.files || []);
      if (!files.length) return;
      const pkg = getSelectedPackage();
      if (!pkg) {
        alert("No package is selected.");
        packageFileInput.value = "";
        return;
      }
      const result = await importFilesIntoPackage(pkg, files);
      packageFileInput.value = "";
      if (result.error) {
        setWorkspaceStatus(result.error, "danger");
      } else {
        const msg = `Imported ${result.imported} file(s)${result.failed ? `, ${result.failed} failed` : ""}.`;
        setWorkspaceStatus(msg, result.failed ? "warn" : "success");
      }
      render();
    });
  }

  // Lineage graph zoom controls
  const lineageRoot = ui.lineageGraphRoot;
  if (lineageRoot) {
    lineageRoot.addEventListener("click", event => {
      const zoomAction = event.target.closest("[data-lineage-zoom]")?.dataset?.lineageZoom;
      if (!zoomAction) return;
      const svg = lineageRoot.querySelector(".lineage-svg");
      const label = lineageRoot.querySelector("[data-lineage-zoom-label]");
      const viewport = lineageRoot.querySelector("[data-lineage-viewport]");
      if (!svg) return;
      const current = parseFloat(svg.style.transform?.match(/scale\(([^)]+)\)/)?.[1]) || 1;
      let next;
      if (zoomAction === "in") next = Math.min(2, current + 0.15);
      else if (zoomAction === "out") next = Math.max(0.2, current - 0.15);
      else {
        const vw = viewport?.clientWidth || lineageRoot.clientWidth || 800;
        const svgW = parseFloat(svg.getAttribute("width")) || 800;
        next = Math.min(1, vw / svgW);
      }
      svg.style.transform = `scale(${next})`;
      svg.style.transformOrigin = "0 0";
      if (label) label.textContent = `${Math.round(next * 100)}%`;
    });

    lineageRoot.addEventListener("wheel", event => {
      const viewport = lineageRoot.querySelector("[data-lineage-viewport]");
      if (!viewport?.contains(event.target)) return;
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const svg = viewport.querySelector(".lineage-svg");
      const label = lineageRoot.querySelector("[data-lineage-zoom-label]");
      if (!svg) return;
      const current = parseFloat(svg.style.transform?.match(/scale\(([^)]+)\)/)?.[1]) || 1;
      const delta = event.deltaY > 0 ? -0.08 : 0.08;
      const next = Math.max(0.2, Math.min(2, current + delta));
      svg.style.transform = `scale(${next})`;
      svg.style.transformOrigin = "0 0";
      if (label) label.textContent = `${Math.round(next * 100)}%`;
    }, { passive: false });
  }
}

async function prepareMergeFromCurrentState() {
  if (!hasUsableStagePrompt("stage6")) {
    alert(missingStagePromptMessage("stage6"));
    return;
  }
  const ready = mergeReadyPackages();
  if (!ready.length) {
    alert("You cannot prepare merge yet because no package is currently eligible for Stage 06 handoff.");
    return;
  }
  state.stage6.requestText = buildStage6Request(ready);
  state.stage6.requestPrepared = true;
  state.stage6.requestCopied = false;
  state.stage6.mergeResultText = "";
  state.stage6.mergeSavedAt = "";
  state.stage6.mergeVerdict = "";
  state.stage6.includedPackageKeys = ready.map(pkg => pkg.key);
  const snapshotPath = await writePromptSnapshot("stage6", getStagePromptText("stage6"));
  if (snapshotPath) state.stage6._lastPromptSnapshotPath = snapshotPath;
  saveState("merge request prepared").catch(err => console.error("Persistence failed", err));
  render();
}

function bindIf(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", handler);
}

function commitStage3Result(value) {
  state.stage3.rawOutputText = value;
  state.stage3.savedAt = nowStamp();
  state.stage3.outcome = inferStage3Outcome(value);
  state.stage3.artifacts = parseStage3Artifacts(value);
  const pauseArtifact = state.stage3.artifacts.find(item => item.kind === "pause");

  if (state.stage3.outcome === "pause") {
    const pauseText = pauseArtifact ? pauseArtifact.content : value;
    state.stage3.pauseArtifactText = pauseText;
    state.stage3.pauseQuestionnaireText = extractSectionBlock(pauseText, "Minimal Decision Questionnaire");
    state.stage3.pauseResumeInstruction = extractSectionBlock(pauseText, "Resume Instruction");
    state.stage3.pauseResumeTarget = inferPauseResumeTarget(state.stage3.pauseResumeInstruction || pauseText);
    state.stage3.pauseResponsePrepared = false;
    state.stage3.pauseResponseCopied = false;
    state.stage3.pauseResponsePacketText = "";
    state.stage3.pauseWaitingForUpdatedResult = false;
    clearLateStages();
  } else {
    state.stage3.pauseArtifactText = "";
    state.stage3.pauseQuestionnaireText = "";
    state.stage3.pauseResumeInstruction = "";
    state.stage3.pauseResumeTarget = "";
    state.stage3.pauseResponsePrepared = false;
    state.stage3.pauseResponseCopied = false;
    state.stage3.pauseResponsePacketText = "";
    state.stage3.pauseWaitingForUpdatedResult = false;
    syncPackagesFromStage3();
    state.stage6 = createDefaultState().stage6;
  }
  saveState("stage 3 result saved").catch(err => console.error("Persistence failed", err));
  render();
}

function savePauseReturn(value) {
  const looksLikeStage3 = Boolean(inferStage3Outcome(value));
  if (/Progression Status\s*:/i.test(value)) {
    state.stage2.artifactText = value;
    state.stage2.savedAt = nowStamp();
    state.stage2.readinessStatus = parseReadinessStatus(value);
    state.stage2.progressionStatus = parseProgressionStatus(value);
    state.stage2.requestPrepared = false;
    state.stage2.requestCopied = false;
    state.stage2.requestText = "";
    state.stage2.retryRequestPrepared = false;
    state.stage2.retryRequestCopied = false;
    state.stage2.retryRequestText = "";
    state.stage3 = createDefaultState().stage3;
    clearLateStages();
  } else if (state.stage3.pauseResumeTarget === "stage1" && !looksLikeStage3) {
    state.stage1.artifactText = value;
    state.stage1.savedAt = nowStamp();
    state.stage2 = createDefaultState().stage2;
    state.stage3 = createDefaultState().stage3;
    clearLateStages();
  } else {
    commitStage3Result(value);
    state.stage3.pauseWaitingForUpdatedResult = false;
  }
  saveState("pause return saved").catch(err => console.error("Persistence failed", err));
  render();
}

function bindEvents() {
  ui.exportBackupBtn.addEventListener("click", exportBackup);
  ui.importBackupBtn.addEventListener("click", () => ui.backupInput.click());
  ui.backupInput.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) importBackupFromFile(file);
    event.target.value = "";
  });
  ui.downloadSummaryBtn.addEventListener("click", downloadAllSavedArtifacts);
  ui.resetBtn.addEventListener("click", async () => {
    if (!confirm("Reset the workspace? Existing artifact files and the audit log will be preserved on disk. The workspace state will be archived.")) return;
    try {
      if (workspaceRootHandle && workspaceSubHandles.archive) {
        const archiveTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
        try {
          const archiveDir = await workspaceSubHandles.archive.getDirectoryHandle(
            `reset_${archiveTimestamp}`, { create: true }
          );
          const consoleDir = workspaceSubHandles[CONSOLE_DIR];
          if (consoleDir) {
            try {
              const stateText = await readTextFile(consoleDir, STATE_FILE);
              await writeTextFile(archiveDir, STATE_FILE, stateText);
            } catch (e) { }
            try {
              const manifestText = await readTextFile(consoleDir, MANIFEST_FILE);
              await writeTextFile(archiveDir, MANIFEST_FILE, manifestText);
            } catch (e) { }
          }
        } catch (e) {
          console.warn("Archive before reset failed", e);
        }
      }

      Object.assign(state, createDefaultState());
      await clearHandleFromIDB();
      workspaceRootHandle = null;
      workspaceSubHandles = {};
      await saveState("workspace reset", {
        auditEvent: "WORKSPACE_RESET",
        message: "Workspace reset to defaults. Previous state archived."
      });
      render();
    } catch (err) {
      console.error("Reset failed", err);
    }
  });
}
