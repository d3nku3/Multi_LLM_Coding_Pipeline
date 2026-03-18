// 02_state.js — State schema definitions, normalization, and serialization
// Defines createDefaultState(), import/export transforms. No I/O.

let state = createDefaultState();

const ui = {
  workspaceIndicator: document.getElementById("workspaceIndicator"),
  statusStrip: document.getElementById("statusStrip"),
  runtimeStatusStrip: document.getElementById("runtimeStatusStrip"),
  currentActionRoot: document.getElementById("currentActionRoot"),
  savedArtifactsRoot: document.getElementById("savedArtifactsRoot"),
  lineageGraphRoot: document.getElementById("lineageGraphRoot"),
  recoveryRoot: document.getElementById("recoveryRoot"),
  technicalRoot: document.getElementById("technicalRoot"),
  backgroundRoot: document.getElementById("backgroundRoot"),
  exportBackupBtn: document.getElementById("exportBackupBtn"),
  importBackupBtn: document.getElementById("importBackupBtn"),
  downloadSummaryBtn: document.getElementById("downloadSummaryBtn"),
  resetBtn: document.getElementById("resetBtn"),
  backupInput: document.getElementById("backupInput")
};


function createSessionId() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultManifest() {
  return {
    version: "1.0",
    sessionId: createSessionId(),
    artifactCounter: 0,
    activeRunRootArtifactId: "",
    lastReconciledAt: "",
    slotHeads: {
      stage1Master: "",
      stage2Architecture: "",
      stage3Bundle: "",
      stage3Master: "",
      stage3Checklist: "",
      stage3Pause: "",
      packageContracts: {},
      packageImplementation: {},
      packageReviews: {},
      stage6Merge: ""
    },
    artifacts: {}
  };
}

function createDefaultState() {
  return {
    version: BACKUP_VERSION,
    projectName: "",
    projectNotes: "",
    referenceFiles: [],
    llms: {},
    llmCatalog: {},
    setup: {
      stage1ReadyConfirmed: false
    },
    manifest: createDefaultManifest(),
    workflow: {
      currentState: "WORKSPACE_NOT_SELECTED",
      actionKey: "selectWorkspace",
      stageLabel: "Workspace",
      stateLabel: "Workspace folder not selected",
      activePackageKey: "",
      activePackageLabel: "",
      allowedEvents: [],
      blockReason: "",
      unblockAction: "",
      expectedReturn: "",
      detail: "",
      lastEvent: "INITIAL_LOAD",
      nextSuggestedState: "",
      resolvedAt: ""
    },
    stage1: {
      requestPrepared: false,
      requestCopied: false,
      requestText: "",
      artifactText: "",
      savedAt: "",
      currentArtifactId: ""
    },
    stage2: {
      requestPrepared: false,
      requestCopied: false,
      requestText: "",
      artifactText: "",
      savedAt: "",
      currentArtifactId: "",
      readinessStatus: "",
      progressionStatus: "",
      retryRequestPrepared: false,
      retryRequestCopied: false,
      retryRequestText: "",
      retryReason: ""
    },
    stage3: {
      requestPrepared: false,
      requestCopied: false,
      requestText: "",
      rawOutputText: "",
      savedAt: "",
      outcome: "",
      bundleArtifactId: "",
      artifacts: [],
      pauseArtifactText: "",
      pauseQuestionnaireText: "",
      pauseResumeInstruction: "",
      pauseResumeTarget: "",
      pauseAnswerDraft: "",
      pauseResponsePrepared: false,
      pauseResponseCopied: false,
      pauseResponsePacketText: "",
      pauseWaitingForUpdatedResult: false
    },
    stage4: {
      selectedPackageKey: "",
      packages: {}
    },
    stage6: {
      requestPrepared: false,
      requestCopied: false,
      requestText: "",
      mergeResultText: "",
      mergeSavedAt: "",
      mergeVerdict: "",
      mergeArtifactId: "",
      includedPackageKeys: []
    }
  };
}

function createEmptyPackageRecord(filename, content) {
  const meta = parsePackageMeta(filename, content);
  return {
    key: filename,
    filename,
    packageId: meta.packageId,
    packageLabel: meta.packageLabel,
    objective: meta.objective,
    dependsOnIds: meta.dependsOnIds,
    requiredInputFiles: meta.requiredInputFiles || [],
    optionalRefFiles: meta.optionalRefFiles || [],
    packageText: safeText(content).trim(),
    packageFingerprint: textFingerprint(content),
    packageArtifactId: "",
    implementationRequestText: "",
    implementationRequestPrepared: false,
    implementationRequestCopied: false,
    implementationOutputText: "",
    implementationSavedAt: "",
    implementationArtifactId: "",
    implementationOutputFingerprint: "",
    implementationStatus: "",
    reviewRequestText: "",
    reviewRequestPrepared: false,
    reviewRequestCopied: false,
    reviewOutputText: "",
    reviewSavedAt: "",
    reviewArtifactId: "",
    reviewBoundFingerprint: "",
    reviewDisposition: "",
    reviewVerdict: "",
    reviewHasMergeBlockingFindings: false,
    reviewUsable: false
  };
}



function normalizeImportedStage4Packages(rawPackages, stage3Artifacts) {
  const out = {};
  const importedPackages = isPlainObject(rawPackages) ? rawPackages : {};
  (stage3Artifacts || []).filter(item => item.kind === "package").forEach(artifact => {
    const derived = createEmptyPackageRecord(artifact.filename, artifact.content);
    const importedPkg = isPlainObject(importedPackages[artifact.filename]) ? importedPackages[artifact.filename] : null;
    if (importedPkg) {
      const importedPackageText = safeText(importedPkg.packageText).trim();
      const importedPackageFingerprint = importedPackageText ? textFingerprint(importedPackageText) : "";
      if (!importedPackageText || importedPackageFingerprint === derived.packageFingerprint) {
        const implementationOutputText = safeText(importedPkg.implementationOutputText).trim();
        const reviewOutputText = safeText(importedPkg.reviewOutputText).trim();
        derived.implementationOutputText = implementationOutputText;
        derived.implementationSavedAt = safeText(importedPkg.implementationSavedAt).trim();
        derived.implementationOutputFingerprint = implementationOutputText ? textFingerprint(implementationOutputText) : "";
        derived.implementationStatus = implementationOutputText ? parseImplementationStatus(implementationOutputText) : "";
        derived.reviewOutputText = reviewOutputText;
        derived.reviewSavedAt = safeText(importedPkg.reviewSavedAt).trim();
        derived.reviewBoundFingerprint = reviewOutputText ? parseReviewBoundFingerprint(reviewOutputText) : "";
        derived.reviewDisposition = reviewOutputText ? parseReviewDisposition(reviewOutputText) : "";
        derived.reviewVerdict = reviewOutputText ? parseReviewVerdict(reviewOutputText) : "";
        derived.reviewHasMergeBlockingFindings = reviewOutputText ? parseReviewHasMergeBlockingFindings(reviewOutputText) : false;
        derived.reviewUsable = Boolean(
          derived.reviewBoundFingerprint &&
          derived.implementationOutputFingerprint &&
          derived.reviewBoundFingerprint === derived.implementationOutputFingerprint
        );
      }
    }
    out[derived.key] = derived;
  });
  return out;
}

function normalizeImportedState(rawInput) {
  const safeInput = sanitizeImportedNode(rawInput);
  if (!isPlainObject(safeInput)) throw new Error("Backup content must be a JSON object.");

  const normalized = createDefaultState();
  const llmIds = LLM_SLOT_OPTIONS.map(item => item.id);

  normalized.projectName = safeText(safeInput.projectName).trim().slice(0, 500);
  normalized.projectNotes = safeText(safeInput.projectNotes);
  normalized.referenceFiles = (Array.isArray(safeInput.referenceFiles) ? safeInput.referenceFiles : [])
    .map(normalizeImportedReferenceFile)
    .filter(Boolean)
    .filter(file => !isPromptReferenceFile(file));
  normalized.llms = normalizeBooleanMap(safeInput.llms, llmIds);
  normalized.llmCatalog = normalizeLabelMap(safeInput.llmCatalog, llmIds);
  normalized.setup.stage1ReadyConfirmed = Boolean(safeInput?.setup?.stage1ReadyConfirmed);

  normalized.stage1.artifactText = safeText(safeInput?.stage1?.artifactText).trim();
  normalized.stage1.savedAt = safeText(safeInput?.stage1?.savedAt).trim();

  normalized.stage2.artifactText = safeText(safeInput?.stage2?.artifactText).trim();
  normalized.stage2.savedAt = safeText(safeInput?.stage2?.savedAt).trim();
  normalized.stage2.readinessStatus = normalized.stage2.artifactText ? parseReadinessStatus(normalized.stage2.artifactText) : "";
  normalized.stage2.progressionStatus = normalized.stage2.artifactText ? parseProgressionStatus(normalized.stage2.artifactText) : "";

  normalized.stage3.rawOutputText = safeText(safeInput?.stage3?.rawOutputText).trim();
  normalized.stage3.savedAt = safeText(safeInput?.stage3?.savedAt).trim();
  normalized.stage3.pauseAnswerDraft = safeText(safeInput?.stage3?.pauseAnswerDraft);
  if (normalized.stage3.rawOutputText) {
    normalized.stage3.outcome = inferStage3Outcome(normalized.stage3.rawOutputText);
    normalized.stage3.artifacts = parseStage3Artifacts(normalized.stage3.rawOutputText);
    if (normalized.stage3.outcome === "pause") {
      const pauseArtifact = normalized.stage3.artifacts.find(item => item.kind === "pause");
      const pauseText = pauseArtifact ? pauseArtifact.content : normalized.stage3.rawOutputText;
      normalized.stage3.pauseArtifactText = pauseText;
      normalized.stage3.pauseQuestionnaireText = extractSectionBlock(pauseText, "Minimal Decision Questionnaire");
      normalized.stage3.pauseResumeInstruction = extractSectionBlock(pauseText, "Resume Instruction");
      normalized.stage3.pauseResumeTarget = inferPauseResumeTarget(normalized.stage3.pauseResumeInstruction || pauseText);
    }
  }

  normalized.stage4.packages = normalizeImportedStage4Packages(safeInput?.stage4?.packages, normalized.stage3.artifacts);
  const requestedSelectedKey = safeText(safeInput?.stage4?.selectedPackageKey).trim();
  normalized.stage4.selectedPackageKey = normalized.stage4.packages[requestedSelectedKey]
    ? requestedSelectedKey
    : (Object.keys(normalized.stage4.packages)[0] || "");

  normalized.stage6.mergeResultText = safeText(safeInput?.stage6?.mergeResultText).trim();
  normalized.stage6.mergeSavedAt = safeText(safeInput?.stage6?.mergeSavedAt).trim();
  normalized.stage6.mergeVerdict = normalized.stage6.mergeResultText ? parseMergeVerdict(normalized.stage6.mergeResultText) : "";
  normalized.stage6.includedPackageKeys = (Array.isArray(safeInput?.stage6?.includedPackageKeys) ? safeInput.stage6.includedPackageKeys : [])
    .map(item => safeText(item).trim())
    .filter(key => Boolean(normalized.stage4.packages[key]));

  stripPersistedPromptState(normalized);
  if (isPlainObject(safeInput.manifest)) {
    normalized.manifest = safeInput.manifest;
  }
  ensureManifestStructure(normalized);
  reconcileWorkspaceManifest(normalized, "restored from saved session");
  return normalized;
}

function validateTextFileBatch(fileList, sourceLabel = "selected files") {
  const files = Array.from(fileList || []);
  const totalBytes = files.reduce((sum, file) => sum + Math.max(0, Number(file?.size || 0)), 0);
  if (totalBytes > SECURITY_LIMITS.maxBatchImportBytes) {
    return { ok: false, message: `The ${sourceLabel} are too large for one import action (${formatBytes(totalBytes)}). Limit: ${formatBytes(SECURITY_LIMITS.maxBatchImportBytes)}.` };
  }
  const oversize = files.find(file => Number(file?.size || 0) > SECURITY_LIMITS.maxSingleTextFileBytes);
  if (oversize) {
    return { ok: false, message: `${safeImportedFilename(oversize.name, "Selected file")} exceeds the per-file limit of ${formatBytes(SECURITY_LIMITS.maxSingleTextFileBytes)}.` };
  }
  return { ok: true, totalBytes };
}

function clearPersistedPromptPackets(targetState) {
  if (!targetState) return targetState;
  targetState.stage1.requestPrepared = false;
  targetState.stage1.requestCopied = false;
  targetState.stage1.requestText = "";

  targetState.stage2.requestPrepared = false;
  targetState.stage2.requestCopied = false;
  targetState.stage2.requestText = "";
  targetState.stage2.retryRequestPrepared = false;
  targetState.stage2.retryRequestCopied = false;
  targetState.stage2.retryRequestText = "";

  targetState.stage3.requestPrepared = false;
  targetState.stage3.requestCopied = false;
  targetState.stage3.requestText = "";
  targetState.stage3.pauseResponsePrepared = false;
  targetState.stage3.pauseResponseCopied = false;
  targetState.stage3.pauseResponsePacketText = "";

  Object.values(targetState.stage4?.packages || {}).forEach(pkg => {
    pkg.implementationRequestPrepared = false;
    pkg.implementationRequestCopied = false;
    pkg.implementationRequestText = "";
    pkg.reviewRequestPrepared = false;
    pkg.reviewRequestCopied = false;
    pkg.reviewRequestText = "";
  });

  targetState.stage6.requestPrepared = false;
  targetState.stage6.requestCopied = false;
  targetState.stage6.requestText = "";
  return targetState;
}

function stripPersistedPromptState(targetState) {
  if (!targetState) return targetState;
  targetState.referenceFiles = (targetState.referenceFiles || []).filter(file => {
    const explicitStageKey = typeof file?.promptStageKey === "string" ? file.promptStageKey.trim() : "";
    return !explicitStageKey && !isPromptReferenceFile(file);
  });
  return clearPersistedPromptPackets(targetState);
}

function serializeStateForPersistence(targetState = state) {
  const cloned = JSON.parse(JSON.stringify(targetState));
  if (cloned.stage1) delete cloned.stage1._lastPromptSnapshotPath;
  if (cloned.stage2) delete cloned.stage2._lastPromptSnapshotPath;
  if (cloned.stage3) delete cloned.stage3._lastPromptSnapshotPath;
  if (cloned.stage6) delete cloned.stage6._lastPromptSnapshotPath;
  Object.values(cloned.stage4?.packages || {}).forEach(pkg => {
    if (pkg) delete pkg._lastPromptSnapshotPath;
  });
  return stripPersistedPromptState(cloned);
}

function renderUnsupportedBrowserBlock() {
  document.querySelector(".app").innerHTML = `
    <div style="max-width:620px;margin:80px auto;text-align:center;">
      <h1 style="color:var(--danger);margin-bottom:16px;">Browser not supported</h1>
      <p style="color:var(--text);font-size:1.1rem;line-height:1.6;">
        This Operator Console requires a Chromium-based browser (Chrome, Edge, Brave, Opera)
        with File System Access API support.<br><br>
        Firefox and Safari do not support the required APIs.<br>
        Mobile browsers are not supported.<br><br>
        Please reopen this file in a compatible desktop browser.
      </p>
    </div>
  `;
}

