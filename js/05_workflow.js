// 05_workflow.js — Workflow resolution, package selection, prompt matching, and state derivation
// Pure workflow/business logic. No direct I/O. No DOM rendering.

function workflowMetaFor(stateId) {
  return WORKFLOW_META[stateId] || { stageLabel: "Workflow", stateLabel: stateId || "Unknown", actionKey: "setup" };
}

function workflowAllowedEvents(stateId) {
  return WORKFLOW_TRANSITIONS[stateId] || [];
}

function packagePriorityScore(pkg) {
  if (!pkg) return 999;
  if (pkg.reviewUsable && pkg.reviewDisposition === "REWORK") return 10;
  if (!pkg.implementationOutputText.trim()) return 20;
  if (pkg.reviewOutputText.trim() && !pkg.reviewUsable) return 30;
  if (!pkg.reviewOutputText.trim()) return 40;
  if (pkg.reviewUsable && pkg.reviewDisposition === "ACCEPT") return 60;
  return 50;
}

function choosePriorityPackageKey(packages = getPackagesInOrder()) {
  if (!packages.length) return "";
  const selected = state.stage4.packages[state.stage4.selectedPackageKey] || null;
  const hasPendingOtherThanSelected = packages.some(pkg => pkg.key !== state.stage4.selectedPackageKey && !isPackageMergeReady(pkg));
  if (selected && (!isPackageMergeReady(selected) || !hasPendingOtherThanSelected)) return selected.key;
  const scored = packages.map((pkg, index) => ({ pkg, index, score: packagePriorityScore(pkg) }))
    .sort((a, b) => a.score - b.score || a.index - b.index);
  return scored[0] ? scored[0].pkg.key : "";
}

function resolvePackageWorkflowState(pkg) {
  if (!pkg) return WORKFLOW_STATES.STAGE4_PACKAGE_SELECTION_REQUIRED;
  if (pkg.reviewUsable && pkg.reviewDisposition === "REWORK") {
    if (!pkg.implementationRequestPrepared) return WORKFLOW_STATES.STAGE4_PACKAGE_REWORK_READY;
    if (!pkg.implementationRequestCopied) return WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_READY;
    return WORKFLOW_STATES.STAGE4_PACKAGE_WAITING_RETURN;
  }
  if (!pkg.implementationOutputText.trim()) {
    if (!pkg.implementationRequestPrepared) return WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_BUILD_READY;
    if (!pkg.implementationRequestCopied) return WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_READY;
    return WORKFLOW_STATES.STAGE4_PACKAGE_WAITING_RETURN;
  }
  if (pkg.reviewOutputText.trim() && !pkg.reviewUsable) {
    if (!pkg.reviewRequestPrepared) return WORKFLOW_STATES.STAGE5_REVIEW_STALE;
    if (!pkg.reviewRequestCopied) return WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_READY;
    return WORKFLOW_STATES.STAGE5_REVIEW_WAITING_RETURN;
  }
  if (!pkg.reviewOutputText.trim()) {
    if (!pkg.reviewRequestPrepared) return WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_BUILD_READY;
    if (!pkg.reviewRequestCopied) return WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_READY;
    return WORKFLOW_STATES.STAGE5_REVIEW_WAITING_RETURN;
  }
  if (pkg.reviewUsable && pkg.reviewDisposition === "ACCEPT") return WORKFLOW_STATES.STAGE5_PACKAGE_ACCEPTED;
  return WORKFLOW_STATES.STAGE4_PACKAGE_NEEDS_REVIEW;
}

function createWorkflowSnapshot(stateId, extras = {}) {
  const meta = workflowMetaFor(stateId);
  const activePackageKey = extras.activePackageKey || "";
  const activePackage = activePackageKey ? state.stage4.packages[activePackageKey] : null;
  return {
    currentState: stateId,
    actionKey: extras.actionKey || meta.actionKey,
    stageLabel: extras.stageLabel || meta.stageLabel,
    stateLabel: extras.stateLabel || meta.stateLabel,
    activePackageKey,
    activePackageLabel: activePackage ? (activePackage.packageId || activePackage.filename) : "",
    allowedEvents: workflowAllowedEvents(stateId),
    blockReason: extras.blockReason || "",
    unblockAction: extras.unblockAction || "",
    expectedReturn: extras.expectedReturn || meta.expectedReturn || "",
    detail: extras.detail || "",
    lastEvent: extras.lastEvent || state.workflow?.lastEvent || "RECONCILE",
    nextSuggestedState: extras.nextSuggestedState || "",
    resolvedAt: extras.resolvedAt || state.workflow?.resolvedAt || ""
  };
}

function resolveWorkflowSnapshot() {
  if (!workspaceRootHandle) {
    return createWorkflowSnapshot(WORKFLOW_STATES.WORKSPACE_NOT_SELECTED, {
      blockReason: "A workspace folder must be selected before the workflow can proceed.",
      unblockAction: "Click the button below to choose or reopen a workspace folder.",
      detail: "All artifacts, the manifest, and the workspace state will be saved to the selected folder automatically."
    });
  }
  const packages = getPackagesInOrder();
  const readyCount = mergeReadyPackages().length;
  const activePackageKey = choosePriorityPackageKey(packages);
  const activePackage = activePackageKey ? state.stage4.packages[activePackageKey] : null;

  if (!hasTierBaseline() || !hasUsableStagePrompt("stage1")) {
    state.setup.stage1ReadyConfirmed = false;
    const missingBits = [];
    if (!hasTierBaseline()) missingBits.push("at least one Tier 1 slot and one Tier 2 slot");
    if (!hasUsableStagePrompt("stage1")) missingBits.push(`the Stage 01 prompt file (${STAGE_PROMPT_IMPORTS.stage1.preferredFilename})`);
    return createWorkflowSnapshot(WORKFLOW_STATES.SETUP_INPUT_NEEDED, {
      blockReason: `Progress is blocked until this workspace has ${missingBits.join(" and ")}.`,
      unblockAction: "Load the Stage 01 prompt, mark the available models, then prepare Stage 01.",
      detail: "Initial project notes are optional here. If they are omitted, the loaded Stage 01 prompt remains the authority for how the next interaction begins."
    });
  }

  if (!state.setup.stage1ReadyConfirmed && !state.stage1.requestPrepared && !state.stage1.artifactText.trim()) {
    return createWorkflowSnapshot(WORKFLOW_STATES.SETUP_INPUT_NEEDED, {
      detail: "The minimum setup is now complete. Review the selected local slots, then confirm when you want to move into Stage 01 packet creation.",
      unblockAction: "Press Prepare Stage 01 to confirm this setup and continue."
    });
  }

  if (!state.stage1.artifactText.trim()) {
    if (!state.stage1.requestPrepared) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE1_PACKET_BUILD_READY, { detail: "The workspace has enough operator context to build the Stage 01 packet now.", nextSuggestedState: WORKFLOW_STATES.STAGE1_REQUEST_READY });
    if (!state.stage1.requestCopied) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE1_REQUEST_READY, { detail: "The Stage 01 request is built and waiting to be copied into the Requirements Engineer chat.", nextSuggestedState: WORKFLOW_STATES.STAGE1_WAITING_RETURN });
    return createWorkflowSnapshot(WORKFLOW_STATES.STAGE1_WAITING_RETURN, { detail: "The external Requirements Engineer loop is active. Save the final Master Briefing here when it returns.", nextSuggestedState: WORKFLOW_STATES.STAGE1_COMPLETED });
  }

  if (!state.stage2.artifactText.trim()) {
    if (!state.stage1.artifactText.trim()) {
      return createWorkflowSnapshot(WORKFLOW_STATES.STAGE2_WAITING_PREREQUISITE, { blockReason: "Stage 02 cannot start until the Master Briefing is saved.", unblockAction: "Save the authoritative Master Briefing first." });
    }
    if (!state.stage2.requestPrepared) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE1_COMPLETED, { detail: "The Master Briefing is saved. The next clean transition is to build the Stage 02 packet.", nextSuggestedState: WORKFLOW_STATES.STAGE2_REQUEST_READY });
    if (!state.stage2.requestCopied) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE2_REQUEST_READY, { detail: "The Stage 02 request is built and waiting to be copied into the Technical Architect chat.", nextSuggestedState: WORKFLOW_STATES.STAGE2_WAITING_RETURN });
    return createWorkflowSnapshot(WORKFLOW_STATES.STAGE2_WAITING_RETURN, { detail: "The external Technical Architect loop is active. Save the returned Architecture Spec here when it comes back.", nextSuggestedState: WORKFLOW_STATES.STAGE2_COMPLETED });
  }

  if (architectureNeedsRetry()) {
    if (!state.stage2.retryRequestPrepared) {
      return createWorkflowSnapshot(WORKFLOW_STATES.STAGE2_BLOCKED_RETRY, { blockReason: describeArchitectureBlock(), unblockAction: "Create the Stage 02 retry request and replace the blocked Architecture Spec with the revised one.", detail: "The architecture gate is explicit here: Stage 03 is blocked until the revised Architecture Spec clears the readiness and progression checks.", nextSuggestedState: WORKFLOW_STATES.STAGE2_RETRY_REQUEST_READY });
    }
    if (!state.stage2.retryRequestCopied) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE2_RETRY_REQUEST_READY, { detail: "The retry request is built and ready to copy into the Technical Architect chat.", nextSuggestedState: WORKFLOW_STATES.STAGE2_RETRY_WAITING_RETURN, expectedReturn: "Revised Architecture Spec" });
    return createWorkflowSnapshot(WORKFLOW_STATES.STAGE2_RETRY_WAITING_RETURN, { detail: "The retry loop is active. Save the revised Architecture Spec here when it returns.", nextSuggestedState: WORKFLOW_STATES.STAGE2_COMPLETED, expectedReturn: "Revised Architecture Spec" });
  }

  if (!state.stage3.rawOutputText.trim()) {
    if (!state.stage3.requestPrepared) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE2_COMPLETED, { detail: "The Architecture Spec is saved and the Stage 03 gate is open enough to build the orchestration request now.", nextSuggestedState: WORKFLOW_STATES.STAGE3_REQUEST_READY });
    if (!state.stage3.requestCopied) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE3_REQUEST_READY, { detail: "The Stage 03 request is built and waiting to be copied into the Project Orchestrator chat.", nextSuggestedState: WORKFLOW_STATES.STAGE3_WAITING_RETURN });
    return createWorkflowSnapshot(WORKFLOW_STATES.STAGE3_WAITING_RETURN, { detail: "The external Stage 03 run is active. Save the full orchestration result or full pause artifact here when it returns.", nextSuggestedState: WORKFLOW_STATES.STAGE3_COMPLETED_CLOSED });
  }

  if (state.stage3.outcome === "pause") {
    if (!state.stage3.pauseResponsePrepared) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE3_COMPLETED_PAUSE, { blockReason: "Normal downstream progression is paused until the blocking decision response is prepared and routed upstream.", unblockAction: "Answer the Minimal Decision Questionnaire and build the decision-response packet.", detail: "The saved pause artifact is authoritative. The workflow engine treats this as a dedicated pause-resolution state, not as a vague side condition.", expectedReturn: "Updated authoritative result", nextSuggestedState: WORKFLOW_STATES.STAGE3_DECISION_REQUEST_READY });
    if (!state.stage3.pauseResponseCopied) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE3_DECISION_REQUEST_READY, { detail: "The decision-response packet is built and waiting to be copied into the upstream role named by the Resume Instruction.", expectedReturn: "Updated authoritative result", nextSuggestedState: WORKFLOW_STATES.STAGE3_DECISION_WAITING_RETURN });
    if (state.stage3.pauseWaitingForUpdatedResult) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE3_DECISION_WAITING_RETURN, { detail: "The pause-resolution roundtrip is active. Save the updated authoritative result here when it returns.", expectedReturn: "Updated authoritative result", nextSuggestedState: WORKFLOW_STATES.STAGE2_COMPLETED });
  }

  if (state.stage6.mergeResultText.trim()) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE6_COMPLETED, { detail: "The merge result is saved. The workflow now has an explicit merge-completed state for resume clarity." });

  if (state.stage6.requestPrepared) {
    if (!state.stage6.requestCopied) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE6_REQUEST_READY, { detail: "The Stage 06 request is built and waiting to be copied into the Merge Coordinator chat.", expectedReturn: "Integration Report", nextSuggestedState: WORKFLOW_STATES.STAGE6_WAITING_RETURN });
    return createWorkflowSnapshot(WORKFLOW_STATES.STAGE6_WAITING_RETURN, { detail: "The external Stage 06 run is active. Save the returned Integration Report here when it comes back.", expectedReturn: "Integration Report", nextSuggestedState: WORKFLOW_STATES.STAGE6_COMPLETED });
  }

  if (state.stage3.outcome !== "closed") return createWorkflowSnapshot(WORKFLOW_STATES.STAGE3_WAITING_PREREQUISITE, { blockReason: "The workflow is waiting for a CLOSED Stage 03 result or a completed pause-resolution roundtrip.", unblockAction: "Save the authoritative Stage 03 output before continuing." });

  if (!packages.length) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE4_IMPLEMENTATION_PHASE_READY, { actionKey: "noPackagesDetected", blockReason: "No Work Package file could be detected in the saved Stage 03 output.", unblockAction: "Recover or regenerate a Stage 03 result that includes detectable Work Package files.", detail: "The orchestration result is saved, but implementation cannot begin until at least one package file is detectable." });

  if (!activePackage) return createWorkflowSnapshot(WORKFLOW_STATES.STAGE4_PACKAGE_SELECTION_REQUIRED, { detail: readyCount ? `${readyCount} accepted package${readyCount === 1 ? " is" : "s are"} already eligible for Stage 06 handoff, but the next package still has to be chosen explicitly.` : "Choose one current package so the workflow surface can stay narrow." });

  const packageState = resolvePackageWorkflowState(activePackage);
  if (packageState === WORKFLOW_STATES.STAGE5_PACKAGE_ACCEPTED) {
    const others = remainingWorkPackages(activePackage.key).length;
    return createWorkflowSnapshot(WORKFLOW_STATES.STAGE5_PACKAGE_ACCEPTED, { activePackageKey, detail: others ? `This package is handoff-eligible. ${others} other package${others === 1 ? " still needs" : "s still need"} implementation or review before the whole run can move cleanly into Stage 06.` : "All currently detected packages are eligible for Stage 06 handoff. The next clean transition is Stage 06.", nextSuggestedState: readyCount ? WORKFLOW_STATES.STAGE6_CANDIDATES_AVAILABLE : "" });
  }
  if (packageState === WORKFLOW_STATES.STAGE5_REVIEW_STALE) return createWorkflowSnapshot(packageState, { activePackageKey, blockReason: "The saved review does not match the current implementation fingerprint for this package.", unblockAction: "Create a fresh Stage 05 request bound to the current output.", detail: "Stale review handling is explicit here: the package is not silently treated as accepted or ready." });
  if (packageState === WORKFLOW_STATES.STAGE4_PACKAGE_REWORK_READY) return createWorkflowSnapshot(packageState, { activePackageKey, detail: "The latest usable review for this package says REWORK. The next safe transition is a controlled Stage 04 rework request." });
  if ([WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_BUILD_READY, WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_READY, WORKFLOW_STATES.STAGE5_REVIEW_WAITING_RETURN].includes(packageState)) return createWorkflowSnapshot(packageState, { activePackageKey, detail: "This package already has a saved implementation output. The workflow now focuses on its review pair." });
  return createWorkflowSnapshot(packageState, { activePackageKey, detail: packageState === WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_BUILD_READY ? "The selected package is ready for its first Stage 04 implementation request." : packageState === WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_READY ? "The Stage 04 request for the selected package is built and waiting to be copied." : packageState === WORKFLOW_STATES.STAGE4_PACKAGE_WAITING_RETURN ? "The Stage 04 roundtrip for the selected package is active. Save the returned implementation output here when it comes back." : packageState === WORKFLOW_STATES.STAGE4_PACKAGE_NEEDS_REVIEW ? "The implementation output is saved. The next safe step is to create the review request for the same package." : "The current package is active." });
}

function inferWorkflowEvent(previousWorkflow, nextWorkflow) {
  const prevState = previousWorkflow?.currentState || "";
  const nextState = nextWorkflow.currentState;
  if (!prevState || prevState === nextState) return previousWorkflow?.lastEvent || "RECONCILE";
  const pairMap = {
    [`${WORKFLOW_STATES.SETUP_INPUT_NEEDED}->${WORKFLOW_STATES.STAGE1_PACKET_BUILD_READY}`]: "SETUP_READY",
    [`${WORKFLOW_STATES.STAGE1_PACKET_BUILD_READY}->${WORKFLOW_STATES.STAGE1_REQUEST_READY}`]: "PREPARE_STAGE1_REQUEST",
    [`${WORKFLOW_STATES.STAGE1_REQUEST_READY}->${WORKFLOW_STATES.STAGE1_WAITING_RETURN}`]: "COPY_STAGE1_REQUEST",
    [`${WORKFLOW_STATES.STAGE1_WAITING_RETURN}->${WORKFLOW_STATES.STAGE1_COMPLETED}`]: "SAVE_STAGE1_RESULT",
    [`${WORKFLOW_STATES.STAGE1_COMPLETED}->${WORKFLOW_STATES.STAGE2_REQUEST_READY}`]: "PREPARE_STAGE2_REQUEST",
    [`${WORKFLOW_STATES.STAGE2_REQUEST_READY}->${WORKFLOW_STATES.STAGE2_WAITING_RETURN}`]: "COPY_STAGE2_REQUEST",
    [`${WORKFLOW_STATES.STAGE2_WAITING_RETURN}->${WORKFLOW_STATES.STAGE2_BLOCKED_RETRY}`]: "SAVE_STAGE2_RESULT",
    [`${WORKFLOW_STATES.STAGE2_WAITING_RETURN}->${WORKFLOW_STATES.STAGE2_COMPLETED}`]: "SAVE_STAGE2_RESULT",
    [`${WORKFLOW_STATES.STAGE2_BLOCKED_RETRY}->${WORKFLOW_STATES.STAGE2_RETRY_REQUEST_READY}`]: "PREPARE_STAGE2_RETRY",
    [`${WORKFLOW_STATES.STAGE2_RETRY_REQUEST_READY}->${WORKFLOW_STATES.STAGE2_RETRY_WAITING_RETURN}`]: "COPY_STAGE2_RETRY",
    [`${WORKFLOW_STATES.STAGE2_RETRY_WAITING_RETURN}->${WORKFLOW_STATES.STAGE2_COMPLETED}`]: "SAVE_STAGE2_RETRY_RESULT",
    [`${WORKFLOW_STATES.STAGE2_COMPLETED}->${WORKFLOW_STATES.STAGE3_REQUEST_READY}`]: "PREPARE_STAGE3_REQUEST",
    [`${WORKFLOW_STATES.STAGE3_REQUEST_READY}->${WORKFLOW_STATES.STAGE3_WAITING_RETURN}`]: "COPY_STAGE3_REQUEST",
    [`${WORKFLOW_STATES.STAGE3_WAITING_RETURN}->${WORKFLOW_STATES.STAGE3_COMPLETED_PAUSE}`]: "SAVE_STAGE3_RESULT",
    [`${WORKFLOW_STATES.STAGE3_WAITING_RETURN}->${WORKFLOW_STATES.STAGE3_COMPLETED_CLOSED}`]: "SAVE_STAGE3_RESULT",
    [`${WORKFLOW_STATES.STAGE3_COMPLETED_PAUSE}->${WORKFLOW_STATES.STAGE3_DECISION_REQUEST_READY}`]: "PREPARE_PAUSE_RESPONSE",
    [`${WORKFLOW_STATES.STAGE3_DECISION_REQUEST_READY}->${WORKFLOW_STATES.STAGE3_DECISION_WAITING_RETURN}`]: "COPY_PAUSE_RESPONSE",
    [`${WORKFLOW_STATES.STAGE3_DECISION_WAITING_RETURN}->${WORKFLOW_STATES.STAGE2_COMPLETED}`]: "SAVE_PAUSE_RESULT",
    [`${WORKFLOW_STATES.STAGE3_DECISION_WAITING_RETURN}->${WORKFLOW_STATES.STAGE3_COMPLETED_CLOSED}`]: "SAVE_PAUSE_RESULT",
    [`${WORKFLOW_STATES.STAGE4_PACKAGE_SELECTION_REQUIRED}->${WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_BUILD_READY}`]: "SELECT_PACKAGE",
    [`${WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_BUILD_READY}->${WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_READY}`]: "PREPARE_STAGE4_REQUEST",
    [`${WORKFLOW_STATES.STAGE4_PACKAGE_REWORK_READY}->${WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_READY}`]: "PREPARE_STAGE4_REWORK",
    [`${WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_READY}->${WORKFLOW_STATES.STAGE4_PACKAGE_WAITING_RETURN}`]: "COPY_STAGE4_REQUEST",
    [`${WORKFLOW_STATES.STAGE4_PACKAGE_WAITING_RETURN}->${WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_BUILD_READY}`]: "SAVE_STAGE4_RESULT",
    [`${WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_BUILD_READY}->${WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_READY}`]: "PREPARE_STAGE5_REQUEST",
    [`${WORKFLOW_STATES.STAGE5_REVIEW_STALE}->${WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_BUILD_READY}`]: "REPLACE_STALE_REVIEW",
    [`${WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_READY}->${WORKFLOW_STATES.STAGE5_REVIEW_WAITING_RETURN}`]: "COPY_STAGE5_REQUEST",
    [`${WORKFLOW_STATES.STAGE5_REVIEW_WAITING_RETURN}->${WORKFLOW_STATES.STAGE5_PACKAGE_ACCEPTED}`]: "SAVE_STAGE5_RESULT",
    [`${WORKFLOW_STATES.STAGE5_REVIEW_WAITING_RETURN}->${WORKFLOW_STATES.STAGE4_PACKAGE_REWORK_READY}`]: "SAVE_STAGE5_RESULT",
    [`${WORKFLOW_STATES.STAGE5_PACKAGE_ACCEPTED}->${WORKFLOW_STATES.STAGE6_REQUEST_READY}`]: "PREPARE_STAGE6_REQUEST",
    [`${WORKFLOW_STATES.STAGE6_CANDIDATES_AVAILABLE}->${WORKFLOW_STATES.STAGE6_REQUEST_READY}`]: "PREPARE_STAGE6_REQUEST",
    [`${WORKFLOW_STATES.STAGE6_REQUEST_READY}->${WORKFLOW_STATES.STAGE6_WAITING_RETURN}`]: "COPY_STAGE6_REQUEST",
    [`${WORKFLOW_STATES.STAGE6_WAITING_RETURN}->${WORKFLOW_STATES.STAGE6_COMPLETED}`]: "SAVE_STAGE6_RESULT"
  };
  return pairMap[`${prevState}->${nextState}`] || previousWorkflow?.lastEvent || "RECONCILE";
}

async function syncWorkflowState(explicitEvent = "", options = {}) {
  const previous = state.workflow || createDefaultState().workflow;
  const next = resolveWorkflowSnapshot();
  const lastEvent = explicitEvent || inferWorkflowEvent(previous, next);
  const resolvedAt = previous.currentState !== next.currentState || previous.activePackageKey !== next.activePackageKey || explicitEvent ? nowStamp() : previous.resolvedAt || nowStamp();
  const merged = { ...next, lastEvent, resolvedAt };
  const changed = JSON.stringify(previous) !== JSON.stringify(merged);
  state.workflow = merged;
  if (changed && options.persist !== false) await saveState("workflow state reconciled", { audit: false });
  return merged;
}


// ═══════════════════════════════════════════════════════════
// PERSISTENCE LAYER — all durable storage goes through here
// ═══════════════════════════════════════════════════════════

/**
 * Persistence Layer API — durable storage is handled through the File System Access API.
 * These function signatures are the persistence contract for the console.
 */

function llmLocalLabel(item, targetState = state) {
  const saved = safeText(targetState.llmCatalog?.[item.id]?.label).trim();
  return saved || "";
}

function llmDisplayLabel(item, targetState = state) {
  return llmLocalLabel(item, targetState) || `${item.slot} (local label not set)`;
}

function llmSelections(targetState = state) {
  return LLM_SLOT_OPTIONS
    .filter(item => targetState.llms[item.id])
    .map(item => ({
      ...item,
      name: llmDisplayLabel(item, targetState),
      customLabel: llmLocalLabel(item, targetState)
    }));
}

function hasTierBaseline() {
  const selected = llmSelections();
  return selected.some(item => item.tier === "Tier 1") && selected.some(item => item.tier === "Tier 2");
}

function recommendedLLMFor(stageKey) {
  const selected = llmSelections();
  const byId = id => selected.find(item => item.id === id);
  if (stageKey === "stage1") return byId("t1_reasoning") || byId("t2_structured") || selected[0] || null;
  if (stageKey === "stage2") return byId("t1_reasoning") || byId("t1_precision") || selected[0] || null;
  if (stageKey === "stage3") return byId("t1_context") || byId("t1_reasoning") || selected[0] || null;
  if (stageKey === "stage4") return byId("t2_structured") || byId("t1_reasoning") || selected[0] || null;
  if (stageKey === "stage5") return byId("t1_precision") || byId("t1_reasoning") || selected[0] || null;
  if (stageKey === "stage6") return byId("t1_context") || byId("t1_precision") || byId("t1_reasoning") || selected[0] || null;
  return selected[0] || null;
}

function promptFilenameScore(fileOrName, stageKey) {
  const rule = STAGE_PROMPT_IMPORTS[stageKey];
  const normalized = normalizeFilename(typeof fileOrName === "string" ? fileOrName : fileOrName?.name);
  if (!rule || !normalized) return -1;
  let score = 0;
  if (normalized === normalizeFilename(rule.preferredFilename)) score += 1000;
  if (normalized.startsWith(`${rule.number}_`)) score += 200;
  if ((rule.acceptedStems || []).some(stem => normalized.includes(stem))) score += 100;
  if ((rule.keywords || []).some(keyword => normalized.includes(normalizeFilename(keyword)))) score += 25;
  return score;
}

function promptContentScore(fileOrName, stageKey) {
  const rule = STAGE_PROMPT_IMPORTS[stageKey];
  const body = safeText(typeof fileOrName === "string" ? "" : fileOrName?.text).toLowerCase();
  if (!rule || !body.trim()) return 0;
  const hits = (rule.contentMarkers || []).filter(marker => body.includes(safeText(marker).toLowerCase()));
  if (!hits.length) return 0;
  return hits.length === (rule.contentMarkers || []).length ? 700 : hits.length * 160;
}

function promptMatchScore(fileOrName, stageKey) {
  return promptFilenameScore(fileOrName, stageKey) + promptContentScore(fileOrName, stageKey);
}

function isContentConfirmedStagePrompt(fileOrName, stageKey) {
  return promptContentScore(fileOrName, stageKey) >= 320;
}

function isLikelyStagePromptMatch(fileOrName, stageKey) {
  const filenameScore = promptFilenameScore(fileOrName, stageKey);
  const contentScore = promptContentScore(fileOrName, stageKey);
  return contentScore >= 320 || (filenameScore >= 1000 && contentScore > 0);
}

function chooseBestStagePromptMatch(items, stageKey) {
  return (items || [])
    .filter(item => isLikelyStagePromptMatch(item, stageKey))
    .sort((a, b) => {
      const confirmedDelta = Number(isContentConfirmedStagePrompt(b, stageKey)) - Number(isContentConfirmedStagePrompt(a, stageKey));
      if (confirmedDelta) return confirmedDelta;
      const contentDelta = promptContentScore(b, stageKey) - promptContentScore(a, stageKey);
      if (contentDelta) return contentDelta;
      const scoreDelta = promptMatchScore(b, stageKey) - promptMatchScore(a, stageKey);
      if (scoreDelta) return scoreDelta;
      const modifiedDelta = Number(b?.lastModified || 0) - Number(a?.lastModified || 0);
      if (modifiedDelta) return modifiedDelta;
      return safeText(a?.name).localeCompare(safeText(b?.name));
    })[0] || null;
}

function stageKeyForReferenceFile(fileOrName) {
  const candidates = STAGE_PROMPT_KEYS
    .map(stageKey => ({ stageKey, score: promptMatchScore(fileOrName, stageKey) }))
    .sort((a, b) => b.score - a.score);
  return candidates[0] && isLikelyStagePromptMatch(fileOrName, candidates[0].stageKey) ? candidates[0].stageKey : "";
}

function isPromptReferenceFile(fileOrName) {
  return Boolean(stageKeyForReferenceFile(fileOrName));
}

function getImportedStagePrompt(stageKey) {
  return chooseBestStagePromptMatch(state.referenceFiles, stageKey);
}

function importedPromptFiles() {
  return STAGE_PROMPT_KEYS.map(stageKey => getImportedStagePrompt(stageKey)).filter(Boolean);
}

function nonPromptReferenceFiles() {
  return state.referenceFiles.filter(file => !isPromptReferenceFile(file));
}

function getStagePromptText(stageKey) {
  const imported = getImportedStagePrompt(stageKey);
  return imported && hasUsableStagePrompt(stageKey) ? safeText(imported.text).trim() : "";
}

function hasUsableStagePrompt(stageKey) {
  const imported = getImportedStagePrompt(stageKey);
  return Boolean(imported && safeText(imported.text).trim() && isContentConfirmedStagePrompt(imported, stageKey));
}

function stagePromptSourceLabel(stageKey) {
  const rule = STAGE_PROMPT_IMPORTS[stageKey];
  const imported = getImportedStagePrompt(stageKey);
  if (imported && safeText(imported.text).trim()) {
    const sourceMode = imported.sourceMode === "relative-fetch"
      ? "Session import from accompanying file"
      : imported.sourceMode === "folder-import"
      ? "Session import from selected folder"
      : "Session import from loaded file";
    if (hasUsableStagePrompt(stageKey)) return `${sourceMode}: ${imported.name} • content-confirmed`;
    if (promptFilenameScore(imported, stageKey) >= 200) return `${sourceMode}: ${imported.name} • candidate only; filename matched but content was not confirmed`;
    if (promptContentScore(imported, stageKey) > 0) return `${sourceMode}: ${imported.name} • candidate only; prompt markers were incomplete`;
    return `${sourceMode}: ${imported.name} • not usable as this stage prompt`;
  }
  return `Not loaded for this session. Normal filename hint: ${rule.filenameHint}`;
}

function missingStagePromptMessage(stageKey) {
  const rule = STAGE_PROMPT_IMPORTS[stageKey];
  if (!rule) return "This stage prompt is missing.";
  return `Load the ${rule.label} prompt for this session first. Normal filename hint: ${rule.filenameHint}. Filenames are treated as hints only. A stage prompt becomes ready only after its imported content is confirmed. Prompt files and built request packets are not persisted across sessions or backups.`;
}

function promptImportPillText() {
  const ready = STAGE_PROMPT_KEYS.filter(stageKey => hasUsableStagePrompt(stageKey)).length;
  return ready === STAGE_PROMPT_KEYS.length ? "Stages 01–06 ready" : `${ready} / ${STAGE_PROMPT_KEYS.length} prompts ready`;
}

function formatAvailableLLMs() {
  const selected = llmSelections();
  if (!selected.length) return "[Not set yet in this workspace.]";
  return [
    "[Operator-local availability snapshot. Slot semantics and actual operator access matter more than the concrete labels below. These labels are editable convenience text only.]",
    ...selected.map(item => `- ${item.slot}: ${item.name}`)
  ].join("\n");
}

function formatReferenceFilesForPrompt() {
  const files = nonPromptReferenceFiles();
  if (!files.length) return "No reference files included.";
  return files.map(file => [
    `--- FILE: ${file.name} ---`,
    safeText(file.text).trim() || "[Empty file]"
  ].join("\n")).join("\n\n");
}

function projectLabelLine() {
  return state.projectName.trim() ? `Project name: ${state.projectName.trim()}\n` : "";
}

function getStage3PackageArtifacts() {
  return state.stage3.artifacts.filter(item => item.kind === "package");
}

function getPackagesInOrder() {
  const order = getStage3PackageArtifacts().map(item => item.filename);
  return order
    .map(key => state.stage4.packages[key])
    .filter(Boolean);
}

function getSelectedPackage() {
  const preferredKey = state.workflow?.activePackageKey || state.stage4.selectedPackageKey;
  return state.stage4.packages[preferredKey] || null;
}

function getImportedPackageFiles(pkg) {
  if (!pkg) return [];
  return manifestArtifactList(state)
    .filter(record =>
      record.artifactType === "implementation_file" &&
      record.packageKey === pkg.key &&
      record.status === "current"
    )
    .sort((a, b) => {
      const left = safeText(a.filename || a.title).toLowerCase();
      const right = safeText(b.filename || b.title).toLowerCase();
      return left.localeCompare(right) || safeText(a.createdAt).localeCompare(safeText(b.createdAt));
    });
}

function selectPackage(key) {
  if (!state.stage4.packages[key]) return;
  state.stage4.selectedPackageKey = key;
  saveState("package selected", { audit: false }).catch(err => console.error("Persistence failed", err));
  render();
}

function syncPackagesFromStage3() {
  const packageArtifacts = getStage3PackageArtifacts();
  const newPackages = {};
  let changed = false;

  packageArtifacts.forEach(artifact => {
    const key = artifact.filename;
    const nextFingerprint = textFingerprint(artifact.content);
    const existing = state.stage4.packages[key];
    if (existing && existing.packageFingerprint === nextFingerprint) {
      newPackages[key] = {
        ...existing,
        filename: artifact.filename,
        packageText: artifact.content.trim(),
        packageFingerprint: nextFingerprint,
        ...parsePackageMeta(artifact.filename, artifact.content)
      };
    } else {
      newPackages[key] = createEmptyPackageRecord(artifact.filename, artifact.content);
      if (existing) changed = true;
    }
  });

  if (Object.keys(state.stage4.packages).length !== Object.keys(newPackages).length) {
    changed = true;
  }

  state.stage4.packages = newPackages;

  if (!state.stage4.selectedPackageKey || !newPackages[state.stage4.selectedPackageKey]) {
    state.stage4.selectedPackageKey = packageArtifacts[0] ? packageArtifacts[0].filename : "";
  }

  if (changed) {
    state.stage6 = createDefaultState().stage6;
  }
}

function clearLateStages() {
  state.stage4 = createDefaultState().stage4;
  state.stage6 = createDefaultState().stage6;
}

function parseReadinessStatus(text) {
  const value = safeText(text);
  const order = ["Partially Ready - Restricted Areas", "Ready for Orchestration", "Not Safe to Freeze"];
  for (const status of order) {
    if (value.toLowerCase().includes(status.toLowerCase())) return status;
  }
  return "";
}

function parseProgressionStatus(text) {
  const match = safeText(text).match(/Progression Status\s*:\s*([A-Z_ -]+)/i);
  if (match) {
    const cleaned = match[1].trim().toUpperCase();
    if (cleaned.includes("PAUSE_FOR_DECISIONS")) return "PAUSE_FOR_DECISIONS";
    if (cleaned.includes("CLOSED")) return "CLOSED";
  }
  if (/PAUSE_FOR_DECISIONS/i.test(text) && !/CLOSED/i.test(text)) return "PAUSE_FOR_DECISIONS";
  return "";
}

function architectureNeedsRetry() {
  if (!state.stage2.artifactText.trim()) return false;
  if (!state.stage2.readinessStatus) return true;
  if (state.stage2.readinessStatus === "Not Safe to Freeze") return true;
  return !state.stage2.progressionStatus;
}

function inferStage3Outcome(text) {
  const value = safeText(text);
  const hasPauseSections = /Minimal Decision Questionnaire/i.test(value) && /Resume Instruction/i.test(value);
  const hasWorkPackage =
    /Work Package File/i.test(value) ||
    /_Work_Package\.txt/i.test(value) ||
    /Master Orchestration File/i.test(value) ||
    /_Master_Orchestration\.txt/i.test(value) ||
    /_Execution_Checklist\.txt/i.test(value);

  if (hasPauseSections || (/PAUSE_FOR_DECISIONS/i.test(value) && !hasWorkPackage)) return "pause";
  if (hasWorkPackage) return "closed";
  return "";
}

function cleanDetectedFilename(value) {
  return safeText(value)
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/^`|`$/g, "")
    .replace(/^["']|["']$/g, "");
}

function parseStage3Artifacts(text) {
  const source = safeText(text).replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const markers = [];
  const markerRegexes = [
    /^(?:\*\*)?(?:Intended )?Filename(?:\*\*)?\s*:\s*(.+\.txt)\s*$/i,
    /^#+\s*(.+\.txt)\s*$/i,
    /^\s*(?:[-*]\s*)?([A-Za-z0-9][A-Za-z0-9_\-]*\.txt)\s*$/i
  ];

  lines.forEach((line, index) => {
    for (const regex of markerRegexes) {
      const match = line.match(regex);
      if (!match) continue;
      const filename = cleanDetectedFilename(match[1]);
      if (!/\.txt$/i.test(filename)) continue;
      if (!(/Work_Package/i.test(filename) || /Master_Orchestration/i.test(filename) || /Execution_Checklist/i.test(filename) || /Pause/i.test(filename))) continue;
      const duplicate = markers.find(item => item.index === index && item.filename === filename);
      if (!duplicate) markers.push({ index, filename });
      break;
    }
  });

  if (!markers.length) {
    const fallbackName = inferStage3Outcome(source) === "pause" ? "03_Pause_For_Decisions.txt" : "03_Stage03_Output.txt";
    return [{ filename: fallbackName, content: source.trim(), kind: inferStage3Outcome(source) || "raw" }];
  }

  const artifacts = [];
  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const next = markers[i + 1];
    const start = current.index + 1;
    const end = next ? next.index : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    const kind = /Pause/i.test(current.filename)
      ? "pause"
      : /Execution_Checklist/i.test(current.filename)
      ? "checklist"
      : /Master_Orchestration/i.test(current.filename)
      ? "master"
      : /Work_Package/i.test(current.filename)
      ? "package"
      : "artifact";
    artifacts.push({ filename: current.filename, content: body, kind });
  }

  return artifacts.length ? artifacts : [{ filename: "03_Stage03_Output.txt", content: source.trim(), kind: "raw" }];
}

function extractSectionBlock(text, heading) {
  const source = safeText(text).replace(/\r\n/g, "\n");
  const sectionHeads = [
    "Gate Result",
    "Blocking Contract-Critical Decisions",
    "Minimal Decision Questionnaire",
    "Resume Instruction",
    "Project Analysis",
    "Work Packages",
    "Review Gates",
    "Assembly"
  ];
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const others = sectionHeads
    .filter(item => item !== heading)
    .map(item => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(
    `(?:^|\\n)(?:##+\\s*)?${escapedHeading}\\s*[:\\n]+([\\s\\S]*?)(?=\\n(?:##+\\s*)?(?:${others})\\s*[:\\n]+|$)`,
    "i"
  );
  const match = source.match(regex);
  return match ? match[1].trim() : "";
}

function inferPauseResumeTarget(text) {
  const source = safeText(text);
  if (/Requirements Engineer|Stage 01/i.test(source)) return "stage1";
  if (/Technical Architect|Stage 02/i.test(source)) return "stage2";
  if (/Project Orchestrator|Stage 03/i.test(source)) return "stage3";
  return "stage3";
}

function parsePackageMeta(filename, content) {
  const source = safeText(content);
  const baseName = safeText(filename).replace(/\.txt$/i, "");
  const fallbackId = (baseName.match(/(?:^|_)(T\d+[A-Za-z0-9_-]*)/) || [])[1] || "";
  const idMatch =
    source.match(/Package ID\s*[:\-]\s*([A-Za-z0-9_-]+)/i) ||
    source.match(/\*\*Package ID:\*\*\s*([A-Za-z0-9_-]+)/i) ||
    source.match(/#\s+[^\n:]+:\s*([A-Za-z0-9_-]+)/);
  const nameMatch =
    source.match(/Package Name\s*[:\-]\s*(.+)/i) ||
    source.match(/Short Title\s*[:\-]\s*(.+)/i);
  const objectiveMatch = source.match(/Objective\s*[:\-]\s*(.+)/i);
  const depContext = [];
  const depRegex = /(Depends On|Dependencies|Dependency Assumptions|Inputs Consumed)([\s\S]{0,500})/ig;
  let depMatch;
  while ((depMatch = depRegex.exec(source)) !== null) {
    depContext.push(depMatch[2]);
  }
  const depTokens = Array.from(new Set(depContext.join("\n").match(/\bT\d+[A-Za-z0-9_-]*\b/g) || []))
    .filter(token => token !== (idMatch ? idMatch[1] : fallbackId));
  const label = (nameMatch ? nameMatch[1] : baseName.replace(/_/g, " ")).trim();

  const parseFileList = (pattern) => {
    const match = source.match(pattern);
    if (!match) return [];
    return match[1].split(/,\s*/).map(entry => entry.trim()).filter(Boolean);
  };
  const requiredInputFiles = parseFileList(/Required input files\s*[:\-]\s*\*?\*?\s*(.+)/i);
  const optionalRefFiles = parseFileList(/Optional reference files\s*[:\-]\s*\*?\*?\s*(.+)/i);

  return {
    packageId: (idMatch ? idMatch[1] : fallbackId).trim(),
    packageLabel: label,
    objective: (objectiveMatch ? objectiveMatch[1] : "").trim(),
    dependsOnIds: depTokens,
    requiredInputFiles,
    optionalRefFiles
  };
}

function parseImplementationStatus(text) {
  const match = safeText(text).match(/\*\*Status:\*\*\s*([A-Za-z]+)/i) || safeText(text).match(/Status:\s*(Complete|Partial|Blocked)/i);
  return match ? match[1].trim() : "";
}

function parseReviewDisposition(text) {
  const match = safeText(text).match(/FINAL_DISPOSITION\s*:\s*(ACCEPT|REWORK)/i);
  return match ? match[1].toUpperCase() : "";
}

function parseReviewVerdict(text) {
  const match = safeText(text).match(/##\s*Verdict\s*:\s*([^\n]+)/i) || safeText(text).match(/Verdict\s*:\s*([^\n]+)/i);
  return match ? match[1].trim() : "";
}

function parseReviewHasMergeBlockingFindings(text) {
  return /Merge-Blocking:\s*YES/i.test(safeText(text));
}

function parseReviewBoundFingerprint(text) {
  const source = safeText(text);
  const token = source.match(/REVIEW_BINDING_TOKEN\s*:\s*([A-Za-z0-9_:-]+)/i) || source.match(/IMPLEMENTATION_FINGERPRINT\s*:\s*([A-Za-z0-9_:-]+)/i);
  return token ? token[1].trim() : "";
}

function parseMergeVerdict(text) {
  const match = safeText(text).match(/Integration Verdict\s*:\s*\[?([^\]\n]+)\]?/i);
  return match ? match[1].trim() : "";
}

function resolvePackageLineage(pkg, targetState = state) {
  if (!pkg) {
    return {
      label: "No package selected",
      detail: "Choose a package first.",
      mergeReady: false
    };
  }

  const packageArtifact = getCurrentPackageContractArtifact(pkg, targetState);
  const implementationArtifact = getCurrentImplementationArtifact(pkg, targetState);
  const reviewArtifact = getCurrentReviewArtifact(pkg, targetState);

  if (!packageArtifact) {
    return {
      label: "Package contract missing",
      detail: "The current package record is not attached to a current work package artifact.",
      mergeReady: false
    };
  }

  if (!implementationArtifact) {
    return {
      label: pkg.implementationRequestPrepared ? "Implementation request ready" : "Ready for implementation",
      detail: "No implementation output is saved for this package yet.",
      mergeReady: false
    };
  }

  if (implementationArtifact.status === "stale") {
    return {
      label: "Output belongs to an older work package",
      detail: implementationArtifact.statusReason,
      mergeReady: false
    };
  }

  if (!reviewArtifact) {
    return {
      label: "Needs review",
      detail: "The current implementation output is saved. The next safe step is review.",
      mergeReady: false
    };
  }

  if ((reviewArtifact.attributes?.boundArtifactId || "") !== implementationArtifact.artifactId) {
    return {
      label: "Needs a new review for the current output",
      detail: reviewArtifact.statusReason || "The saved review belongs to a different implementation lineage.",
      mergeReady: false
    };
  }

  if (reviewArtifact.status === "stale") {
    return {
      label: "Needs a new review for the current output",
      detail: reviewArtifact.statusReason,
      mergeReady: false
    };
  }

  if (reviewArtifact.status === "blocked_from_reuse" || reviewArtifact.status === "orphaned") {
    return {
      label: "Review lineage is ambiguous",
      detail: reviewArtifact.statusReason,
      mergeReady: false
    };
  }

  if (reviewArtifact.attributes?.reviewDisposition === "REWORK") {
    return {
      label: "Review says rework",
      detail: "The current review matches this output and sends the package back to rework.",
      mergeReady: false
    };
  }

  if (reviewArtifact.attributes?.reviewDisposition === "ACCEPT" && reviewArtifact.attributes?.reviewHasMergeBlockingFindings) {
    return {
      label: "Review metadata is inconsistent",
      detail: "This review ends with FINAL_DISPOSITION: ACCEPT but still contains Merge-Blocking: YES. Do not treat it as Stage 06 handoff-eligible until the review artifact is corrected or replaced.",
      mergeReady: false
    };
  }

  if (reviewArtifact.attributes?.reviewDisposition === "ACCEPT" && reviewArtifact.status === "current") {
    return {
      label: "Eligible for Stage 06 handoff",
      detail: "The current review matches the current implementation output, ends with FINAL_DISPOSITION: ACCEPT, and contains no merge-blocking findings. Stage 06 remains the final merge authority.",
      mergeReady: true
    };
  }

  return {
    label: "Review saved",
    detail: reviewArtifact.statusReason || "A review is saved, but it is not yet merge-valid.",
    mergeReady: false
  };
}

function isPackageMergeReady(pkg) {
  return resolvePackageLineage(pkg).mergeReady;
}

function packagePlainStatus(pkg) {
  if (!pkg) return "No package selected";
  if (state.stage6.mergeResultText.trim() && state.stage6.includedPackageKeys.includes(pkg.key)) return "Included in merge result";
  const resolved = resolvePackageLineage(pkg);
  if (resolved.mergeReady) {
    return state.stage6.includedPackageKeys.includes(pkg.key) ? "Included in merge set" : resolved.label;
  }
  return resolved.label;
}

function packageStatusDetail(pkg) {
  return resolvePackageLineage(pkg).detail;
}

function mergeReadyPackages() {
  return getPackagesInOrder().filter(pkg => resolvePackageLineage(pkg).mergeReady);
}

function remainingWorkPackages(excludeKey = "") {
  return getPackagesInOrder().filter(pkg => pkg.key !== excludeKey && !isPackageMergeReady(pkg));
}

function currentActionKey() {
  return state.workflow?.actionKey || resolveWorkflowSnapshot().actionKey;
}

function stageStatusPills() {
  const readyCount = mergeReadyPackages().length;
  const totalCount = getPackagesInOrder().length;
  const workflow = state.workflow?.currentState ? state.workflow : resolveWorkflowSnapshot();
  const workflowTone = workflow.blockReason ? "warn" : workflow.expectedReturn ? "primary" : "primary";
  const llmTone = hasTierBaseline() ? "success" : "warn";
  const promptTone = STAGE_PROMPT_KEYS.every(stageKey => hasUsableStagePrompt(stageKey)) ? "success" : "warn";
  const stage6Tone = state.stage6.mergeResultText.trim() ? "success" : state.stage6.requestPrepared ? "primary" : "";
  return [
    pill("Now", `${workflow.stageLabel || "Workflow"} — ${workflow.stateLabel || workflow.currentState}`, workflowTone),
    pill("LLM baseline", hasTierBaseline() ? "Ready" : "Pick 1 Tier 1 + 1 Tier 2 slot", llmTone),
    pill("Prompt imports", promptImportPillText(), promptTone),
    pill("Packages", totalCount ? `${readyCount} / ${totalCount} ready for Stage 06` : state.stage3.outcome === "closed" ? "No package file detected yet" : "Waiting"),
    pill("Stage 06", state.stage6.mergeResultText.trim() ? (state.stage6.mergeVerdict || "Integration Report saved") : state.stage6.requestPrepared ? "Request prepared" : "Not started", stage6Tone),
    pill("Workspace", state.projectName.trim() || (workspaceRootHandle ? workspaceRootHandle.name : "No folder selected"), workspaceRootHandle ? "" : "warn")
  ].join("\n");
}

function currentArtifactMessages() {
  const messages = [];
  const currentStage1 = getManifestArtifact(state.stage1.currentArtifactId);
  const currentStage2 = getManifestArtifact(state.stage2.currentArtifactId);
  const currentStage3Bundle = getManifestArtifact(state.stage3.bundleArtifactId);

  if (currentStage1) {
    messages.push(`Current Master Briefing found in this workspace. Source: ${currentStage1.sourceOrigin}.`);
  }
  if (currentStage2) {
    messages.push(currentStage2.status === "current"
      ? `Current Architecture Spec found in this workspace. Source: ${currentStage2.sourceOrigin}.`
      : "A previous Architecture Spec is saved, but it is not current for the active lineage.");
  }
  if (currentStage3Bundle) {
    messages.push(currentStage3Bundle.status === "current"
      ? "Current Stage 03 artifact set found in this workspace."
      : "A Stage 03 artifact set is saved, but it belongs to an older run branch.");
  }

  const pkg = getSelectedPackage();
  if (pkg) {
    const implementationArtifact = getCurrentImplementationArtifact(pkg);
    const reviewArtifact = getCurrentReviewArtifact(pkg);
    if (implementationArtifact) {
      messages.push(implementationArtifact.status === "current"
        ? `Current implementation output found for ${pkg.packageId || pkg.filename}.`
        : `${pkg.packageId || pkg.filename} has a saved implementation output, but it is not current.`);
    }
    if (reviewArtifact) {
      messages.push(reviewArtifact.status === "current"
        ? `Current review found for ${pkg.packageId || pkg.filename}.`
        : reviewArtifact.status === "stale"
        ? `A saved review exists for ${pkg.packageId || pkg.filename}, but it belongs to an older output.`
        : `A saved review exists for ${pkg.packageId || pkg.filename}, but its lineage is not clean enough for reuse.`);
    }
  }
  return messages;
}

function ensureDerivedArtifactState() {
  if (state.stage2.artifactText.trim()) {
    state.stage2.readinessStatus = state.stage2.readinessStatus || parseReadinessStatus(state.stage2.artifactText);
    state.stage2.progressionStatus = state.stage2.progressionStatus || parseProgressionStatus(state.stage2.artifactText);
  }

  if (state.stage3.rawOutputText.trim()) {
    state.stage3.outcome = state.stage3.outcome || inferStage3Outcome(state.stage3.rawOutputText);
    if (!state.stage3.artifacts.length) {
      state.stage3.artifacts = parseStage3Artifacts(state.stage3.rawOutputText);
    }
    if (state.stage3.outcome === "pause") {
      const pauseArtifact = state.stage3.artifacts.find(item => item.kind === "pause");
      const pauseText = pauseArtifact ? pauseArtifact.content : state.stage3.rawOutputText;
      state.stage3.pauseArtifactText = state.stage3.pauseArtifactText || pauseText;
      state.stage3.pauseQuestionnaireText = state.stage3.pauseQuestionnaireText || extractSectionBlock(pauseText, "Minimal Decision Questionnaire");
      state.stage3.pauseResumeInstruction = state.stage3.pauseResumeInstruction || extractSectionBlock(pauseText, "Resume Instruction");
      state.stage3.pauseResumeTarget = state.stage3.pauseResumeTarget || inferPauseResumeTarget(state.stage3.pauseResumeInstruction || pauseText);
    }
  }

  ensureProvenanceReconciled("restored from saved session");
  syncPackageDerivedFieldsFromManifest(state);
}

function ensurePackageState() {
  if (state.stage3.outcome === "closed" && getStage3PackageArtifacts().length) {
    const missing = getStage3PackageArtifacts().some(item => !state.stage4.packages[item.filename]);
    if (missing || !Object.keys(state.stage4.packages).length) syncPackagesFromStage3();
  }
  if (state.stage3.outcome !== "closed" && (Object.keys(state.stage4.packages).length || state.stage6.mergeResultText.trim())) {
    clearLateStages();
  }
}
