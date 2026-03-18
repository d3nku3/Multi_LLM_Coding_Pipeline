// 07_render.js — UI status helpers and render functions
// DOM rendering only. No file system access.

function runtimeStatusPills() {
  return [
    runtimeStatus.persistenceMessage ? pill("Storage", runtimeStatus.persistenceMessage, runtimeStatus.persistenceTone || "") : "",
    runtimeStatus.workspaceMessage ? pill("Notice", runtimeStatus.workspaceMessage, runtimeStatus.workspaceTone || "") : ""
  ].filter(Boolean).join("\n");
}

function renderPermissionStatus() {
  const strip = document.getElementById("runtimeStatusStrip");
  if (!strip) return;
  let html = runtimeStatusPills();
  if (!writePermissionLost && lastWriteError) {
    html = `
      <div class="status-pill danger" style="width:100%;">
        <strong>⚠ Last save failed:</strong> ${escapeHtml(lastWriteError)} — changes are in memory only until the next successful save
      </div>
    ` + html;
  }
  if (writePermissionLost) {
    html = `
      <div class="status-pill danger" style="width:100%;justify-content:center;cursor:pointer;" id="reauthorizeBtn">
        <strong>⚠ Write permission lost</strong> — Click here to re-authorize access to "${escapeHtml(workspaceRootHandle?.name || "workspace")}"
      </div>
    ` + html;
  }
  strip.innerHTML = html;
  if (writePermissionLost) {
    const btn = document.getElementById("reauthorizeBtn");
    if (btn) {
      btn.addEventListener("click", async () => {
        const ok = await verifyWritePermission();
        if (ok) {
          writePermissionLost = false;
          renderPermissionStatus();
          setPersistenceStatus(`Write access restored to "${workspaceRootHandle.name}"`, "success");
        } else {
          setPersistenceStatus("Permission was not granted. Please try again or reselect the workspace folder.", "danger");
        }
      });
    }
  }
}

function refreshRuntimeStatusStrip() {
  renderPermissionStatus();
}

function setWorkspaceStatus(message = "", tone = "") {
  runtimeStatus.workspaceMessage = safeText(message).trim();
  runtimeStatus.workspaceTone = tone || "";
  refreshRuntimeStatusStrip();
}

function setPersistenceStatus(message = "", tone = "") {
  runtimeStatus.persistenceMessage = safeText(message).trim();
  runtimeStatus.persistenceTone = tone || "";
  refreshRuntimeStatusStrip();
}

function renderWorkflowGuidance(workflow) {
  if (!workflow.stateLabel && !workflow.blockReason && !workflow.unblockAction) return "";
  const isBlocked = Boolean(workflow.blockReason);
  const tone = isBlocked ? "warn" : workflow.expectedReturn ? "success" : "";
  const titleText = (workflow.stageLabel || "Workflow") + " — " + (workflow.stateLabel || workflow.currentState);

  let primaryRow = "";
  if (isBlocked && workflow.unblockAction) {
    primaryRow = `<div class="action-banner-primary"><strong>Do next:</strong> ${escapeHtml(workflow.unblockAction)}</div>`;
  } else if (workflow.unblockAction) {
    primaryRow = `<div class="action-banner-primary">${escapeHtml(workflow.unblockAction)}</div>`;
  }

  const secondaryRows = [];
  if (isBlocked) secondaryRows.push(`<div class="action-banner-row"><strong>Blocked:</strong> ${escapeHtml(workflow.blockReason)}</div>`);
  if (workflow.expectedReturn) secondaryRows.push(`<div class="action-banner-row"><strong>Waiting for:</strong> ${escapeHtml(workflow.expectedReturn)}</div>`);
  if (workflow.activePackageLabel) secondaryRows.push(`<div class="action-banner-row"><strong>Package:</strong> ${escapeHtml(workflow.activePackageLabel)}</div>`);

  const detailBlock = workflow.detail
    ? `<details class="action-banner-details"><summary class="mini">Context</summary><div class="action-banner-row">${escapeHtml(workflow.detail)}</div></details>`
    : "";

  return `
    <div class="action-banner ${tone}">
      <div class="action-banner-head">
        <div class="action-banner-title">${escapeHtml(titleText)}</div>
      </div>
      ${primaryRow}
      ${secondaryRows.length ? `<div class="action-banner-grid">${secondaryRows.join("")}</div>` : ""}
      ${detailBlock}
    </div>
  `;
}

function renderWorkspaceIndicator() {
  const el = ui.workspaceIndicator;
  if (!el) return;
  const parts = [];
  if (workspaceRootHandle) {
    parts.push(`
      <div class="status-pill success" style="flex:1;">
        <strong>Project:</strong> <span>${escapeHtml(workspaceRootHandle.name)}</span>
      </div>
    `);
  } else {
    parts.push(`
      <div class="status-pill warn" style="flex:1;">
        <strong>Project:</strong> <span>No folder selected</span>
      </div>
    `);
  }
  if (promptFolderHandle) {
    parts.push(`
      <div class="status-pill" style="flex:1;">
        <strong>Prompts:</strong> <span>${escapeHtml(promptFolderHandle.name)}</span>
      </div>
    `);
  }
  parts.push(`
    <button class="ghost-btn" id="switchWorkspaceBtn" type="button" style="padding:8px 12px;font-size:0.85rem;">Switch project</button>
  `);
  el.innerHTML = parts.join("");

  const btn = document.getElementById("switchWorkspaceBtn");
  if (btn) {
    btn.addEventListener("click", async () => {
      if (!confirm("Switch to a different project workspace? The current session state will be saved first.")) return;
      await saveState("pre-switch save").catch(() => {});
      const result = await selectWorkspaceRoot();
      if (result.available) {
        const loaded = await loadPersistedWorkspaceState();
        if (loaded.found && loaded.state) {
          Object.assign(state, createDefaultState(), loaded.state);
          runtimeStatus._showResumeSummary = true;
          setPersistenceStatus(`Workspace switched to "${workspaceRootHandle.name}"`, "success");
        } else {
          Object.assign(state, createDefaultState());
          setPersistenceStatus(`Switched to empty workspace "${workspaceRootHandle.name}"`, "success");
        }
        await syncWorkflowState("SELECT_WORKSPACE_ROOT");
        render();
      }
    });
  }
}

function render() {
  ensureDerivedArtifactState();
  ensurePackageState();
  ensureProvenanceReconciled("restored from saved session");
  syncWorkflowState().then(workflow => {
    ui.statusStrip.innerHTML = stageStatusPills();
    ui.currentActionRoot.innerHTML = renderCurrentAction(workflow);
    ui.savedArtifactsRoot.innerHTML = renderSavedArtifacts();
    if (ui.lineageGraphRoot) ui.lineageGraphRoot.innerHTML = renderLineageGraph();
    ui.recoveryRoot.innerHTML = renderRecovery();
    ui.technicalRoot.innerHTML = renderTechnicalDetails();
    ui.backgroundRoot.innerHTML = renderBackground();
    bindDynamicEvents();
    renderWorkspaceIndicator();
    renderPermissionStatus();
  }).catch(error => console.error("Workflow rendering failed", error));
}

function renderActionSummary() {
  const msg = runtimeStatus.actionSummary;
  if (!msg) return "";
  const tone = runtimeStatus.actionSummaryTone || "success";
  return `<div class="notice ${tone}" style="margin-bottom:14px;">${escapeHtml(msg)}</div>`;
}

function setActionSummary(message, tone = "success") {
  runtimeStatus.actionSummary = message;
  runtimeStatus.actionSummaryTone = tone;
}

function clearActionSummary() {
  runtimeStatus.actionSummary = "";
  runtimeStatus.actionSummaryTone = "";
}

function buildResumeSummary(workflow) {
  const rows = [];
  const projectName = state.projectName ? `"${state.projectName}"` : "this workspace";
  rows.push(`Resumed ${projectName} at ${workflow.stageLabel || "Workflow"}.`);

  if (state.stage1.artifactText.trim()) rows.push("Master Briefing: saved.");
  if (state.stage2.artifactText.trim()) rows.push("Architecture Spec: saved.");
  if (state.stage3.rawOutputText.trim()) rows.push(`Stage 03: ${state.stage3.outcome === "closed" ? "CLOSED" : state.stage3.outcome === "pause" ? "PAUSED" : "saved"}.`);

  const packages = getPackagesInOrder();
  if (packages.length) {
    const accepted = packages.filter(p => p.reviewUsable && p.reviewDisposition === "ACCEPT").length;
    const rework = packages.filter(p => p.reviewUsable && p.reviewDisposition === "REWORK").length;
    const implemented = packages.filter(p => p.implementationOutputText.trim() && !p.reviewOutputText.trim()).length;
    const pending = packages.filter(p => !p.implementationOutputText.trim()).length;
    const parts = [];
    if (accepted) parts.push(`${accepted} accepted`);
    if (rework) parts.push(`${rework} rework needed`);
    if (implemented) parts.push(`${implemented} awaiting review`);
    if (pending) parts.push(`${pending} not yet implemented`);
    rows.push(`Packages (${packages.length}): ${parts.join(", ")}.`);
  }

  if (workflow.blockReason) rows.push(`Current blocker: ${workflow.blockReason}`);
  if (workflow.unblockAction) rows.push(`Next step: ${workflow.unblockAction}`);

  return rows;
}

function renderResumeSummary(workflow) {
  if (!runtimeStatus._showResumeSummary) return "";
  runtimeStatus._showResumeSummary = false;
  const rows = buildResumeSummary(workflow);
  if (rows.length <= 1) return "";
  return `
    <div class="resume-summary">
      <div class="resume-summary-title">Welcome back</div>
      ${rows.map(r => `<div class="resume-summary-row">${escapeHtml(r)}</div>`).join("")}
    </div>
  `;
}

function renderCurrentAction(workflowSnapshot = null) {
  const workflow = workflowSnapshot || state.workflow || resolveWorkflowSnapshot();
  const key = workflow.actionKey;
  const artifactMessages = currentArtifactMessages();
  const notices = [renderResumeSummary(workflow), renderActionSummary(), renderWorkflowGuidance(workflow)];
  clearActionSummary();
  if (artifactMessages.length) notices.push(`<div class="notice">${artifactMessages.map(item => `<div>${escapeHtml(item)}</div>`).join("")}</div>`);
  const topNotice = notices.filter(Boolean).join("");

  const pkg = getSelectedPackage();
  const blocks = {
    selectWorkspace: renderSelectWorkspaceCard(),
    setup: renderSetupCard(),
    prepareStage1: renderPrepareStage1Card(),
    copyStage1: renderCopyRequestCard("Create the Stage 01 request", "Copy this into your Requirements Engineer chat. Then answer one question at a time there until you get the final Master Briefing.", state.stage1.requestText, "copyStage1Btn", "Use a fresh chat. When the final Master Briefing comes back, paste it here on return.", recommendedLLMFor("stage1")),
    saveStage1: renderSaveArtifactCard("Save the returned Master Briefing", "Paste the final Stage 01 result here. Save only the authoritative final Master Briefing, not a half-finished interview turn.", "stage1ReturnInput", "Save Master Briefing", "The next step will build the Stage 02 request from this saved briefing."),
    prepareStage2: renderPrepareStage2Card(),
    copyStage2: renderCopyRequestCard("Create the Stage 02 request", "Copy this into your Technical Architect chat. Bring back the resulting Architecture Spec and save it here.", state.stage2.requestText, "copyStage2Btn", "When the Architecture Spec returns, paste it back here and save it before moving on.", recommendedLLMFor("stage2")),
    saveStage2: renderSaveArtifactCard("Save the Architecture Spec", "Paste the returned Stage 02 result here. The tool will check the closure and readiness signals after you save it.", "stage2ReturnInput", "Save Architecture Spec", "After save, the tool will either move to Stage 03 or stop you clearly if the architecture gate is still blocked."),
    prepareStage2Retry: renderStage2RetryCard(),
    copyStage2Retry: renderCopyRequestCard("Fix the Architecture Spec", "Copy this retry request into your Technical Architect chat. Bring back the revised Architecture Spec and save it here.", state.stage2.retryRequestText, "copyStage2RetryBtn", "This retry exists because the current Architecture Spec still blocks safe Stage 03 work.", recommendedLLMFor("stage2")),
    saveStage2Retry: renderSaveArtifactCard("Save the revised Architecture Spec", "Paste the revised Architecture Spec here. This replaces the blocked Stage 02 result for the current workspace.", "stage2RetryInput", "Save revised Architecture Spec", "Once the gate clears, the tool will prepare the Stage 03 request."),
    prepareStage3: renderPrepareStage3Card(),
    copyStage3: renderCopyRequestCard(stage3CopyTitle(), stage3CopyLead(), state.stage3.requestText, "copyStage3Btn", stage3CopyNextText(), recommendedLLMFor("stage3")),
    saveStage3: renderSaveArtifactCard("Save the orchestration result", "Paste the returned Stage 03 result here. The tool will detect whether this is CLOSED or PAUSE_FOR_DECISIONS.", "stage3ReturnInput", "Save orchestration result", "After save, the tool will either guide the decision pause or open one package at a time for implementation."),
    preparePauseResponse: renderPauseResponseCard(),
    copyPauseResponse: renderCopyRequestCard("Resolve the decision pause", "Copy this resume packet into the role named by the Resume Instruction. Then bring back the updated authoritative result.", state.stage3.pauseResponsePacketText, "copyPauseResponseBtn", pauseNextText(), recommendedLLMFor(state.stage3.pauseResumeTarget === "stage2" ? "stage2" : state.stage3.pauseResumeTarget === "stage1" ? "stage1" : "stage3")),
    savePauseResult: renderSaveArtifactCard("Save the updated result", pauseReturnLead(), "pauseReturnInput", "Save updated result", "The tool will route you back into the correct next step automatically."),
    noPackagesDetected: renderNoPackagesDetectedCard(),
    choosePackage: renderChoosePackageCard(),
    prepareStage4: renderPrepareStage4Card(pkg, false),
    prepareStage4Rework: renderPrepareStage4Card(pkg, true),
    copyStage4: renderCopyRequestCard(`Create the implementation request${pkg ? ` for ${pkg.packageId || pkg.filename}` : ""}`, "Copy this into your Module Implementer chat. Bring back the returned implementation output for this same package and save it here.", pkg ? pkg.implementationRequestText : "", "copyStage4Btn", "Run the request in a fresh external chat. When the implementation output comes back, paste it here and save it before reviewing.", recommendedLLMFor("stage4")),
    saveStage4: renderSavePackageArtifactCard(pkg, "Save the returned implementation output", pkg && pkg.reviewUsable && pkg.reviewDisposition === "REWORK"
      ? "Paste the revised implementation output for this package. The previous review said rework, so the old accepted path is no longer valid."
      : "Paste the returned implementation output for this package. Save the full authoritative package output, not just a snippet.",
      "stage4ReturnInput", "Save implementation output",
      "After save, the tool will guide the review step for this same package."),
    prepareStage5: renderPrepareStage5Card(pkg),
    copyStage5: renderCopyRequestCard(`Create the review request${pkg ? ` for ${pkg.packageId || pkg.filename}` : ""}`, "Copy this into your Code Reviewer chat. The request is bound to the current implementation output of this package.", pkg ? pkg.reviewRequestText : "", "copyStage5Btn", "Run the request in a fresh external chat. Bring back the full review report and save it here. The review must repeat the binding block exactly.", recommendedLLMFor("stage5")),
    saveStage5: renderSavePackageArtifactCard(pkg, "Save the review result", "Paste the full review report for this package. The tool will check whether the review belongs to the current implementation output and then interpret the final disposition in plain language.", "stage5ReturnInput", "Save review result", "After save, the tool will either return this package to rework, mark it eligible for Stage 06 handoff, flag inconsistent review metadata, or tell you that the review belongs to an older output."),
    packageAccepted: renderPackageAcceptedCard(pkg),
    copyStage6: renderCopyRequestCard("Create the merge request", "Copy this into your Merge Coordinator chat. This request contains only exact accepted output/review pairs.", state.stage6.requestText, "copyStage6Btn", "Run this in a fresh external chat, then bring back the integration result and save it here.", recommendedLLMFor("stage6")),
    saveStage6: renderSaveMergeResultCard(),
    mergeComplete: renderMergeCompleteCard()
  };

  return topNotice + (blocks[key] || renderChoosePackageCard());
}

function llmRecommendationText(recommended) {
  if (!recommended) return "Use one of the local slots you marked as available. The concrete model label is operator-editable convenience text only.";
  return `Convenience suggestion from your saved local slots: ${escapeHtml(recommended.name)} (${escapeHtml(recommended.slot)}). Stage contracts and saved Stage 03 artifacts still outrank this hint.`;
}

function renderSelectWorkspaceCard() {
  const hasPending = Boolean(pendingWorkspaceHandle);
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">${hasPending ? "Reconnect project workspace" : "Select project workspace folder"}</h2>
    <p class="lead">${hasPending
      ? "Your previous workspace was found but the browser needs permission to access it again. Click below to reconnect."
      : "Choose or create an empty folder for this project. All artifacts, the manifest, and the session state will be saved there automatically."}</p>
    ${hasPending ? `
    <div class="notice success">
      Found a cached workspace handle. A single click will restore your full session.
    </div>
    <div class="section-block">
      <button class="primary-btn" id="reconnectWorkspaceBtn" type="button">Reconnect workspace</button>
      <p class="small" style="margin-top:12px;">Or pick a different folder instead:</p>
      <button class="ghost-btn" id="selectWorkspaceFolderBtn" type="button">Select a different workspace folder</button>
    </div>
    ` : `
    <div class="notice warn">
      No project workspace is selected. The workflow cannot proceed until a writable folder is chosen.
    </div>
    <div class="section-block">
      <p class="small">This folder is for project output only. Stage prompt files are loaded separately via the setup screen. Pick an empty folder for a new project, or reopen an existing workspace folder to resume.</p>
      <button class="primary-btn" id="selectWorkspaceFolderBtn" type="button">Select project workspace folder</button>
    </div>
    `}
  `;
}

function renderSetupCard() {
  const selectedIds = new Set(llmSelections().map(item => item.id));
  const llmHtml = LLM_SLOT_OPTIONS.map(item => {
    const localLabel = llmLocalLabel(item);
    return `
      <div class="llm-item">
        <input type="checkbox" data-llm-id="${escapeHtml(item.id)}" ${selectedIds.has(item.id) ? "checked" : ""}>
        <div>
          <div class="llm-name">${escapeHtml(item.slot)} <span class="mini">• ${escapeHtml(item.tier)}</span></div>
          <div class="llm-meta">${escapeHtml(item.description)}</div>
          <div class="field" style="margin-top:10px;">
            <label class="mini" for="llmLabel_${escapeHtml(item.id)}">Local model label <span class="mini">optional</span></label>
            <input type="text" id="llmLabel_${escapeHtml(item.id)}" data-llm-label="${escapeHtml(item.id)}" value="${escapeHtml(localLabel)}" placeholder="${escapeHtml(item.exampleLabel)}">
          </div>
          <div class="mini">Example mapping only: ${escapeHtml(item.exampleLabel)}</div>
        </div>
      </div>
    `;
  }).join("");

  const promptBundleReady = STAGE_PROMPT_KEYS.every(stageKey => hasUsableStagePrompt(stageKey));
  const stage1Blockers = [];
  if (!hasTierBaseline()) stage1Blockers.push("pick at least one Tier 1 slot and one Tier 2 slot");
  if (!hasUsableStagePrompt("stage1")) stage1Blockers.push("load the Stage 01 prompt file");
  const stage1Ready = !stage1Blockers.length;

  const promptFileList = Object.entries(STAGE_PROMPT_IMPORTS).map(([stageKey, rule]) => {
    const file = getImportedStagePrompt(stageKey);
    const source = stagePromptSourceLabel(stageKey);
    const meta = file
      ? `${formatCharCount(file.text.length)} • local prompt import for ${rule.label} packets`
      : `Filename hint: ${rule.filenameHint}`;
    return `
      <div class="artifact-item compact">
        <div class="artifact-title">${escapeHtml(rule.label)}</div>
        <div class="artifact-meta">${escapeHtml(meta)}</div>
        <div class="small">${escapeHtml(source)}</div>
        ${file ? `
          <div class="artifact-actions" style="margin-top:10px;">
            <button class="ghost-btn" type="button" data-download-ref="${escapeHtml(file.name)}">Download copy</button>
            <button class="ghost-btn" type="button" data-remove-ref="${escapeHtml(file.name)}">Remove</button>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");

  const otherReferenceFiles = nonPromptReferenceFiles();
  const fileList = otherReferenceFiles.length
    ? `<div class="artifact-list">${otherReferenceFiles.map(file => `
        <div class="artifact-item compact">
          <div class="artifact-title">${escapeHtml(file.name)}</div>
          <div class="artifact-meta">${escapeHtml(formatCharCount(file.text.length))}</div>
          <div class="artifact-actions">
            <button class="ghost-btn" type="button" data-download-ref="${escapeHtml(file.name)}">Download copy</button>
            <button class="ghost-btn" type="button" data-remove-ref="${escapeHtml(file.name)}">Remove</button>
          </div>
        </div>
      `).join("")}</div>`
    : `<div class="empty">No optional reference files loaded yet.</div>`;

  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">Start this project</h2>
    <p class="lead">Finish the required setup first. Optional project notes can wait.</p>

    ${promptBundleReady ? `
    <div class="section-block compact">
      <details>
        <summary>
          Prompt files <span class="mini" style="color:var(--success);">✓ All loaded${promptFolderHandle ? ` from "${escapeHtml(promptFolderHandle.name)}"` : ""}</span>
        </summary>
        <div class="details-body">
          <div class="artifact-actions" style="margin-bottom:12px;">
            <button class="ghost-btn" id="loadPromptFolderBtn" type="button">Reload prompt folder</button>
            <button class="ghost-btn" id="importFilesBtn" type="button">Load individual files</button>
          </div>
          <div class="artifact-list">${promptFileList}</div>
        </div>
      </details>
    </div>
` : `
    <div class="section-block">
      <h3>Required first-time setup</h3>
      <p class="small">Select the folder where your stage prompt files (01–06 .txt files) are stored. This is separate from the project workspace. Prompt files are read-only and can be shared across projects. Stage 01 can start only after the Stage 01 prompt is available and the minimum LLM baseline is set.</p>
      <div class="artifact-actions" style="margin-bottom:12px;">
        <button class="primary-btn" id="loadPromptFolderBtn" type="button">Load prompt folder</button>
        <button class="ghost-btn" id="importFilesBtn" type="button">Load individual files</button>
      </div>
      <div class="notice warn" style="margin-bottom:12px;">
        Prompt bundle incomplete. ${promptImportPillText()}. Select the folder that contains the 01–06 stage prompt .txt files.
      </div>
      <div class="artifact-list">${promptFileList}</div>
    </div>
`}

    <div class="section-block">
      <h3>Do this now</h3>
      <p class="small">Pick only the slots you actually have. These labels are local operator notes, not pipeline truth.</p>
      <div class="llm-grid">${llmHtml}</div>
      <div class="notice ${hasTierBaseline() ? "success" : "warn"}">
        ${hasTierBaseline()
          ? "LLM baseline ready. Review the selection, then confirm when you want to continue."
          : "Still needed: pick at least one Tier 1 slot and one Tier 2 slot."}
      </div>
      <div class="notice ${stage1Ready ? "success" : "danger"}" style="margin-top:12px; margin-bottom:12px;">
        ${stage1Ready
          ? (state.setup.stage1ReadyConfirmed
              ? "Stage 01 is ready."
              : "Stage 01 is ready, but the setup screen will stay open until you confirm.")
          : `Stage 01 is blocked. Still needed: ${stage1Blockers.join(" · ")}.`}
      </div>
      <button class="primary-btn" id="prepareStage1Btn" type="button" ${stage1Ready ? "" : "disabled"}>Prepare Stage 01</button>
    </div>

    <div class="section-block compact">
      <h3>Optional project context</h3>
      <p class="small">Stage 01 can gather missing detail through Q&amp;A, so notes are optional.</p>
      <div class="inline-inputs">
        <div class="field">
          <label for="projectNameInput">Project name <span class="mini">optional</span></label>
          <input type="text" id="projectNameInput" value="${escapeHtml(state.projectName)}" placeholder="Example: CAD batch exporter">
        </div>
      </div>
      <div class="field">
        <label for="projectNotesInput">Initial project notes <span class="mini">optional</span></label>
        <textarea id="projectNotesInput" placeholder="Optional: idea sketch, goals, constraints, or existing context. You can also leave this empty and start Stage 01.">${escapeHtml(state.projectNotes)}</textarea>
      </div>
      <details style="margin-top:12px;">
        <summary>Optional reference files <span class="mini">${otherReferenceFiles.length ? `${otherReferenceFiles.length} loaded` : "none loaded"}</span></summary>
        <div class="details-body">${fileList}</div>
      </details>
    </div>

    <div class="section-block compact">
      <h3>What happens next</h3>
      <p class="small">The tool builds one Stage 01 packet. You copy it into a fresh Requirements Engineer chat, answer questions there, then bring back the final Master Briefing.</p>
    </div>
  `;
}

function renderPrepareStage1Card() {
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">Create the Stage 01 request</h2>
    <p class="lead">Stage 01 is ready. Build one clean request packet now.</p>
    <div class="section-block">
      <h3>What you need now</h3>
      <p class="small">This packet includes the Stage 01 prompt plus any optional notes or reference files already saved here.</p>
      <div class="notice ${hasUsableStagePrompt("stage1") ? "success" : "danger"}">${escapeHtml(stagePromptSourceLabel("stage1"))}</div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <div class="muted-box">${nl2br(summarizeNotes(state.projectNotes))}</div>
      <button class="primary-btn" id="prepareStage1RequestBtn" type="button" ${hasUsableStagePrompt("stage1") ? "" : "disabled"}>Build request</button>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">You will get one copy-ready request block. Then you can start the external LLM loop without guessing what belongs in it.</p>
    </div>
  `;
}

function renderPrepareStage2Card() {
  const promptReady = hasUsableStagePrompt("stage2");
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">Create the Stage 02 request</h2>
    <p class="lead">The saved Master Briefing is now the authoritative input. Build the Stage 02 packet from it.</p>
    <div class="section-block">
      <h3>What you need now</h3>
      <p class="small">You need the saved Master Briefing. The tool already has it in this workspace.</p>
      <div class="notice success">Previous Stage 01 result found in this workspace. It will be used now unless you replace it.</div>
      <div class="notice ${promptReady ? "success" : "danger"}">${escapeHtml(stagePromptSourceLabel("stage2"))}</div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <button class="primary-btn" id="prepareStage2Btn" type="button" ${promptReady ? "" : "disabled"}>Build Stage 02 request</button>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">You will copy the Stage 02 packet into a Technical Architect chat. Then you will bring back the returned Architecture Spec and save it here.</p>
    </div>
  `;
}

function renderPrepareStage3Card() {
  const restricted = state.stage2.readinessStatus === "Partially Ready - Restricted Areas";
  const pausePrep = isStage3PausePrep();
  const promptReady = hasUsableStagePrompt("stage3");
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">${pausePrep ? "Create the Stage 03 pause request" : "Create the Stage 03 request"}</h2>
    <p class="lead">${pausePrep
      ? "The Architecture Spec is not fully closed yet. Stage 03 now runs only to produce the single PAUSE artifact."
      : "The Architecture Spec is saved and the Stage 03 route is clear enough to proceed."}</p>
    <div class="section-block">
      <h3>What you need now</h3>
      <div class="stack">
        <div class="notice success">Earlier Architecture Spec found in this workspace. It will be used now.</div>
        <div class="notice">${restricted
          ? "This Architecture Spec says some areas are restricted. Stage 03 may generate packages only for allowed areas."
          : pausePrep
          ? "This Architecture Spec currently points to PAUSE_FOR_DECISIONS. Stage 03 should return only the pause artifact."
          : "This Architecture Spec is ready enough for Stage 03 package planning."}</div>
        <div class="notice">Available LLMs were already selected in this workspace. They will be included as a Stage 03 input helper.</div>
        <div class="notice ${promptReady ? "success" : "danger"}">${escapeHtml(stagePromptSourceLabel("stage3"))}</div>
      </div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <button class="primary-btn" id="prepareStage3Btn" type="button" ${promptReady ? "" : "disabled"}>Build Stage 03 request</button>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">${pausePrep
        ? "You will copy the Stage 03 packet into a Project Orchestrator chat. Bring back the full PAUSE artifact exactly as returned. The tool will then guide the decision path."
        : "You will copy the Stage 03 packet into a Project Orchestrator chat. Bring back the full result exactly as returned. The tool will then open one package at a time for implementation, review, rework, and merge."}</p>
    </div>
  `;
}

function renderStage2RetryCard() {
  const blockReason = describeArchitectureBlock();
  const promptReady = hasUsableStagePrompt("stage2");
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">The architecture gate is still blocked</h2>
    <p class="lead">Stage 03 should not run from the current Architecture Spec.</p>
    <div class="section-block">
      <h3>What is missing</h3>
      <div class="notice danger">${escapeHtml(blockReason)}</div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <p class="small">Create a Stage 02 retry request. That request keeps the current Master Briefing and asks the Technical Architect for a usable downstream gate result.</p>
      <div class="notice ${promptReady ? "success" : "danger"}" style="margin-top:12px;">${escapeHtml(stagePromptSourceLabel("stage2"))}</div>
      <button class="primary-btn" id="prepareStage2RetryBtn" type="button" ${promptReady ? "" : "disabled"}>Create Stage 02 retry request</button>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">You will send the retry packet to the Technical Architect, bring back the revised Architecture Spec, and replace the blocked one here.</p>
    </div>
  `;
}

function renderPauseResponseCard() {
  const questionnaire = state.stage3.pauseQuestionnaireText.trim() || "The questionnaire could not be extracted cleanly. Use the full pause artifact below.";
  const resumeInstruction = state.stage3.pauseResumeInstruction.trim() || "Resume exactly as instructed inside the saved pause artifact.";
  const targetText = pauseTargetLabel();

  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">Resolve the decision pause</h2>
    <p class="lead">Work cannot continue yet. A contract-critical decision is required before Stage 03 can proceed.</p>
    <div class="section-block">
      <h3>What you need now</h3>
      <div class="notice warn">The full Stage 03 pause artifact is saved. Do not discard it. Only the questionnaire portion gets answered, but the whole artifact stays authoritative.</div>
      <div class="notice">Planned resume path: <strong>${escapeHtml(targetText)}</strong></div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <label for="pauseAnswersInput">Answer the Minimal Decision Questionnaire</label>
      <div class="small" style="margin: 8px 0 10px;">Questionnaire extracted from the saved pause artifact:</div>
      <pre>${escapeHtml(previewText(questionnaire))}</pre>
      <div class="field">
        <label for="pauseAnswersInput">Your answers</label>
        <textarea id="pauseAnswersInput" class="compact" placeholder="Write direct answers to the questions above.">${escapeHtml(state.stage3.pauseAnswerDraft)}</textarea>
      </div>
      <button class="primary-btn" id="preparePauseResponseBtn" type="button">Create decision-response packet</button>
      <details style="margin-top:12px;">
        <summary>Show saved Resume Instruction <span class="mini">optional</span></summary>
        <div class="details-body"><pre>${escapeHtml(previewText(resumeInstruction))}</pre></div>
      </details>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">The tool will build one resume packet using the role named by the Resume Instruction. You will copy that packet into the right upstream chat, then bring back the updated authoritative result.</p>
    </div>
  `;
}

function renderCopyRequestCard(title, lead, requestText, buttonId, nextText, recommended) {
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">${escapeHtml(title)}</h2>
    <p class="lead">${escapeHtml(lead)}</p>
    <div class="section-block">
      <h3>What you need now</h3>
      <p class="small">${llmRecommendationText(recommended)}</p>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <pre>${escapeHtml(previewText(requestText))}</pre>
      <button class="primary-btn" id="${escapeHtml(buttonId)}" type="button">Copy request</button>
      <div class="sub-actions">
        <button class="ghost-btn" type="button" data-download-request="${escapeHtml(title)}">Download as .txt</button>
      </div>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">${escapeHtml(nextText)}</p>
    </div>
  `;
}

function renderSaveArtifactCard(title, lead, textareaId, buttonLabel, nextText) {
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">${escapeHtml(title)}</h2>
    <p class="lead">${escapeHtml(lead)}</p>
    <div class="section-block">
      <h3>What you need now</h3>
      <p class="small">Paste the exact returned artifact. This tool works best when you save authoritative results immediately instead of relying on chat history later.</p>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <div class="field">
        <label for="${escapeHtml(textareaId)}">Returned text</label>
        <textarea id="${escapeHtml(textareaId)}" class="mono" placeholder="Paste the full returned text here."></textarea>
      </div>
      <button class="primary-btn" id="${escapeHtml(buttonLabel.replace(/\s+/g, ""))}Btn" type="button">${escapeHtml(buttonLabel)}</button>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">${escapeHtml(nextText)}</p>
    </div>
  `;
}

function renderConsequencePreview(consequences) {
  if (!consequences || !consequences.length) return "";
  return `
    <div class="consequence-preview">
      <strong>What this will change:</strong>
      ${consequences.map(c => `<div style="margin-top:4px;">• ${escapeHtml(c)}</div>`).join("")}
    </div>
  `;
}

function buildSaveImplementationConsequences(pkg) {
  if (!pkg) return [];
  const consequences = [];
  if (pkg.implementationOutputText.trim()) {
    consequences.push("The current saved implementation output will be superseded by the new one.");
  }
  if (pkg.reviewOutputText.trim()) {
    if (pkg.reviewUsable) {
      consequences.push("The existing ACCEPTED review will become stale — a new review will be required.");
    } else {
      consequences.push("The existing review is already stale and will remain so.");
    }
  }
  const importedFiles = getImportedPackageFiles(pkg);
  if (importedFiles.length) {
    consequences.push(`${importedFiles.length} imported implementation file(s) will be superseded.`);
  }
  if (mergeReadyPackages().some(p => p.key === pkg.key)) {
    consequences.push("This package will lose its merge-ready status.");
  }
  return consequences;
}

function buildSaveReviewConsequences(pkg) {
  if (!pkg) return [];
  const consequences = [];
  if (pkg.reviewOutputText.trim() && pkg.reviewUsable) {
    consequences.push(`The current ${pkg.reviewDisposition || "saved"} review will be replaced.`);
  }
  if (pkg.reviewOutputText.trim() && !pkg.reviewUsable) {
    consequences.push("The stale review will be replaced with the new one.");
  }
  return consequences;
}

function buildClearPackageConsequences(pkg) {
  if (!pkg) return [];
  const consequences = [];
  if (pkg.implementationOutputText.trim()) consequences.push("The saved implementation output will be superseded.");
  if (pkg.reviewOutputText.trim()) consequences.push("The saved review will be superseded.");
  const importedFiles = getImportedPackageFiles(pkg);
  if (importedFiles.length) consequences.push(`${importedFiles.length} imported file(s) will be superseded.`);
  if (mergeReadyPackages().some(p => p.key === pkg.key)) consequences.push("This package will lose its merge-ready status.");
  consequences.push("The package contract itself is preserved — only outputs and reviews are cleared.");
  return consequences;
}

function renderPackageContextBlock(pkg) {
  if (!pkg) return "";
  const importedFileCount = getImportedPackageFiles(pkg).length;
  const importedFileNote = importedFileCount
    ? `<div class="small" style="margin-top:8px;">${importedFileCount} implementation file(s) imported into workspace</div>`
    : "";
  return `
    <div class="section-block">
      <h3>Current package</h3>
      <div class="artifact-item">
        <div class="package-line">
          <div>
            <div class="package-name">${escapeHtml(pkg.packageId ? `${pkg.packageId} — ${pkg.packageLabel}` : pkg.packageLabel)}</div>
            <div class="artifact-meta">${escapeHtml(pkg.filename)}</div>
          </div>
          <div class="tag">${escapeHtml(packagePlainStatus(pkg))}</div>
        </div>
        <div class="small" style="margin-top:10px;">${escapeHtml(packageStatusDetail(pkg))}</div>
        ${importedFileNote}
        <details style="margin-top:12px;">
          <summary>Switch package <span class="mini">optional</span></summary>
          <div class="details-body">${renderPackagePicker(pkg.key)}</div>
        </details>
      </div>
    </div>
  `;
}

function renderPackagePicker(selectedKey = "") {
  const packages = getPackagesInOrder();
  if (!packages.length) return `<div class="empty">No Work Package files detected yet.</div>`;
  return `<div class="artifact-list">${packages.map(pkg => `
    <div class="artifact-item">
      <div class="package-line">
        <div>
          <div class="package-name">${escapeHtml(pkg.packageId ? `${pkg.packageId} — ${pkg.packageLabel}` : pkg.packageLabel)}</div>
          <div class="artifact-meta">${escapeHtml(pkg.filename)}</div>
        </div>
        <div class="tag">${escapeHtml(packagePlainStatus(pkg))}</div>
      </div>
      <div class="small" style="margin-top:10px;">${escapeHtml(pkg.objective || "No objective text detected. The full package file is still saved and usable.")}</div>
      <div class="artifact-actions" style="margin-top:10px;">
        <button class="ghost-btn" type="button" data-select-package="${escapeHtml(pkg.key)}" ${pkg.key === selectedKey ? "disabled" : ""}>
          ${pkg.key === selectedKey ? "Current package" : "Open package"}
        </button>
      </div>
      <details style="margin-top:10px;">
        <summary>Preview package contract <span class="mini">optional</span></summary>
        <div class="details-body"><pre>${escapeHtml(previewText(pkg.packageText))}</pre></div>
      </details>
    </div>
  `).join("")}</div>`;
}

function renderChoosePackageCard() {
  const readyCount = mergeReadyPackages().length;
  const mergePromptReady = hasUsableStagePrompt("stage6");
  const mergeNotice = readyCount
    ? `<div class="notice success">${readyCount} package${readyCount === 1 ? "" : "s"} already have a matching accepted review with no merge-blocking findings and can enter Stage 06 handoff now.</div>`
    : `<div class="notice">No package is eligible for Stage 06 handoff yet. Start with one package below.</div>`;

  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">Open the next package</h2>
    <p class="lead">The orchestration result is saved. Pick one package and keep the surface narrow.</p>
    <div class="section-block">
      <h3>What you need now</h3>
      <p class="small">Pick the package you want to work on right now. The main workflow view will then show only that package’s current action.</p>
      ${mergeNotice}
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      ${renderPackagePicker("")}
      <div class="sub-actions">
        <button class="ghost-btn" id="prepareMergeBtn" type="button" ${readyCount && mergePromptReady ? "" : "disabled"}>Create Stage 06 merge request</button>
      </div>
      <div class="notice ${mergePromptReady ? "success" : "danger"}" style="margin-top:12px;">${escapeHtml(stagePromptSourceLabel("stage6"))}</div>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">After you open a package, the screen will narrow to that single package. You will be guided through implementation, review, and if needed a controlled rework loop.</p>
    </div>
  `;
}

function resolveInputFileStatus(fileEntries) {
  if (!fileEntries || !fileEntries.length) return [];
  const packages = getPackagesInOrder();
  return fileEntries.map(entry => {
    const lower = entry.toLowerCase();
    if (/architecture\s*spec/i.test(entry)) {
      return { label: entry, available: !!state.stage2.artifactText.trim(), source: "Workspace Stage 02" };
    }
    if (/master\s*briefing/i.test(entry)) {
      return { label: entry, available: !!state.stage1.artifactText.trim(), source: "Workspace Stage 01" };
    }
    const outputMatch = entry.match(/OUTPUT_(T\d+)/i);
    if (outputMatch) {
      const depId = outputMatch[1];
      const depPkg = packages.find(p => p.packageId === depId);
      const has = depPkg && depPkg.implementationOutputText.trim();
      return { label: entry, available: !!has, source: has ? `${depId} implementation output` : `${depId} not yet implemented` };
    }
    const tRefMatch = entry.match(/\b(T\d+)\b/);
    if (tRefMatch) {
      const depId = tRefMatch[1];
      const depPkg = packages.find(p => p.packageId === depId);
      const has = depPkg && depPkg.implementationOutputText.trim();
      return { label: entry, available: !!has, source: has ? `${depId} implementation output` : `${depId} not yet implemented` };
    }
    if (/all\s*(module\s*)?files/i.test(entry)) {
      const allPkgIds = entry.match(/T\d+/g) || [];
      if (allPkgIds.length >= 2) {
        const missing = allPkgIds.filter(id => {
          const p = packages.find(pkg => pkg.packageId === id);
          return !p || !p.implementationOutputText.trim();
        });
        return { label: entry, available: missing.length === 0, source: missing.length ? `Missing: ${missing.join(", ")}` : "All available" };
      }
    }
    return { label: entry, available: null, source: "Cannot resolve automatically" };
  });
}

function renderInputFileChecklist(pkg) {
  const required = resolveInputFileStatus(pkg.requiredInputFiles || []);
  const optional = resolveInputFileStatus(pkg.optionalRefFiles || []);
  if (!required.length && !optional.length) return "";
  const renderRow = (item, isRequired) => {
    const icon = item.available === true ? "✓" : item.available === false ? "✗" : "?";
    const color = item.available === true ? "var(--accent, #6ee7b7)" : item.available === false ? "#fca5a5" : "var(--muted)";
    const tag = isRequired ? "" : " <span class=\"mini\" style=\"opacity:0.7;\">(optional)</span>";
    return `<div style="display:flex;gap:8px;align-items:baseline;padding:3px 0;">
      <span style="color:${color};font-weight:700;min-width:16px;text-align:center;">${icon}</span>
      <span class="small">${escapeHtml(item.label)}${tag}</span>
      <span class="mini" style="color:var(--muted);margin-left:auto;">${escapeHtml(item.source)}</span>
    </div>`;
  };
  return `<div class="notice" style="padding:12px;">
    <div style="font-weight:600;margin-bottom:6px;">Input files for this package</div>
    ${required.map(r => renderRow(r, true)).join("")}
    ${optional.map(r => renderRow(r, false)).join("")}
  </div>`;
}

function renderPrepareStage4Card(pkg, isRework) {
  if (!pkg) return renderChoosePackageCard();
  const promptReady = hasUsableStagePrompt("stage4");
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">${isRework ? "Create the rework request" : "Create the implementation request"}</h2>
    <p class="lead">${isRework
      ? "This package must be revised before it can continue. The earlier accepted path is not valid anymore."
      : "This package is ready for implementation. Build the Stage 04 packet from the saved package contract now."}</p>
    ${renderPackageContextBlock(pkg)}
    <div class="section-block">
      <h3>What you need now</h3>
      <p class="small">${isRework
        ? "You need the current package, the saved review report that requested rework, and the saved architecture context. The tool already has them."
        : "You need the saved package contract and the architecture context. The tool already has them in this workspace."}</p>
      ${renderInputFileChecklist(pkg)}
      ${pkg.dependsOnIds.length ? `<div class="notice">This package appears to reference upstream packages: <strong>${escapeHtml(pkg.dependsOnIds.join(", "))}</strong>. Any saved dependency outputs found in this workspace will be included as context.</div>` : ""}
      <div class="notice ${promptReady ? "success" : "danger"}">${escapeHtml(stagePromptSourceLabel("stage4"))}</div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <button class="primary-btn" id="prepareStage4Btn" type="button" ${promptReady ? "" : "disabled"}>${isRework ? "Build rework request" : "Build Stage 04 request"}</button>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">${isRework
        ? "You will copy the rework packet into a Module Implementer chat, bring back the revised implementation output, and save it here. After that, the package needs a fresh review."
        : "You will copy the Stage 04 packet into a Module Implementer chat, bring back the implementation output for this exact package, and save it here before review."}</p>
    </div>
  `;
}

function renderSavePackageArtifactCard(pkg, title, lead, textareaId, buttonLabel, nextText) {
  if (!pkg) return renderChoosePackageCard();
  const importedFiles = getImportedPackageFiles(pkg);
  const importSection = textareaId === "stage4ReturnInput" ? `
    <div class="section-block">
      <h3>Import implementation files <span class="mini">optional</span></h3>
      <p class="small">If the LLM produced downloadable files (code, configs, docs), you can import them here. They will be written to the workspace and tracked in the manifest alongside the main implementation output.</p>
      <div id="packageFileDropZone" style="border:2px dashed var(--border);border-radius:var(--radius-sm);padding:24px;text-align:center;color:var(--muted);cursor:pointer;transition:0.2s;">Drop files here or click to select</div>
      <input id="packageFileInput" type="file" multiple accept=".txt,.md,.json,.py,.js,.ts,.html,.css,.xml,.yaml,.yml,.toml,.csv,.log,.rst,.cfg,.ini,.sh,.bat,.jsx,.tsx,.vue,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.cs,.swift,.kt,.sql,.r,.m,.pl,.lua" hidden>
      ${importedFiles.length ? `
        <div style="margin-top:12px;">
          <div class="mini" style="margin-bottom:6px;"><strong>${importedFiles.length} file(s) imported for this package:</strong></div>
          <div class="artifact-list">
            ${importedFiles.map(record => `
              <div class="artifact-item compact">
                <div class="artifact-title">${escapeHtml(record.filename || record.title)}</div>
                <div class="artifact-meta">${escapeHtml(record.relativePath || "")} • ${formatCharCount(record.contentLength || 0)}</div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  ` : "";
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">${escapeHtml(title)}</h2>
    <p class="lead">${escapeHtml(lead)}</p>
    ${renderPackageContextBlock(pkg)}
    <div class="section-block">
      <h3>What you need now</h3>
      <p class="small">Paste the full returned text for this same package. Save the authoritative result immediately so the next step uses the correct version.</p>
      ${renderConsequencePreview(textareaId === "stage4ReturnInput" ? buildSaveImplementationConsequences(pkg) : buildSaveReviewConsequences(pkg))}
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <div class="field">
        <label for="${escapeHtml(textareaId)}">Returned text for ${escapeHtml(pkg.packageId || pkg.filename)}</label>
        <textarea id="${escapeHtml(textareaId)}" class="mono" placeholder="Paste the full returned text here."></textarea>
      </div>
      <button class="primary-btn" id="${escapeHtml(buttonLabel.replace(/\s+/g, ""))}Btn" type="button">${escapeHtml(buttonLabel)}</button>
    </div>
    ${importSection}
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">${escapeHtml(nextText)}</p>
    </div>
  `;
}

function renderPrepareStage5Card(pkg) {
  if (!pkg) return renderChoosePackageCard();
  const promptReady = hasUsableStagePrompt("stage5");
  const warning = pkg.reviewOutputText.trim() && !pkg.reviewUsable
    ? "An older review was found, but it does not belong to the current implementation output. This package needs a new review now."
    : "The current implementation output is saved. The next safe step is review.";
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">Create the review request</h2>
    <p class="lead">Review is a separate step. The request will be bound to the current implementation output of this package.</p>
    ${renderPackageContextBlock(pkg)}
    <div class="section-block">
      <h3>What you need now</h3>
      <div class="notice">${escapeHtml(warning)}</div>
      <p class="small">The review packet will include the saved Master Briefing, Architecture Spec, current Work Package Contract, the current implementation output, and any saved upstream dependency outputs found in this workspace.</p>
      <div class="notice ${promptReady ? "success" : "danger"}">${escapeHtml(stagePromptSourceLabel("stage5"))}</div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <button class="primary-btn" id="prepareStage5Btn" type="button" ${promptReady ? "" : "disabled"}>Build Stage 05 request</button>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">You will copy the review packet into a Code Reviewer chat, bring back the full review report, and save it here. The tool will then tell you whether the package is accepted, needs rework, or needs a fresh review because the report belongs to an older output.</p>
    </div>
  `;
}

function renderPackageAcceptedCard(pkg) {
  if (!pkg) return renderChoosePackageCard();
  const others = remainingWorkPackages(pkg.key);
  const mergeReady = mergeReadyPackages();
  const mergePromptReady = hasUsableStagePrompt("stage6");
  const primaryLabel = others.length ? "Choose the next package" : "Create merge request";
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">This package is eligible for Stage 06</h2>
    <p class="lead">The current review matches the current implementation output and accepts it.</p>
    ${renderPackageContextBlock(pkg)}
    <div class="section-block">
      <h3>What you need now</h3>
      <div class="notice success">This review matches the current package output. The exact pair is valid and can enter merge.</div>
      <div class="tag-row">
        <div class="tag">${mergeReady.length} Stage-06-eligible package${mergeReady.length === 1 ? "" : "s"}</div>
        <div class="tag">${others.length} package${others.length === 1 ? "" : "s"} still not Stage-06-eligible</div>
      </div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <button class="primary-btn" id="${others.length ? "chooseAnotherPackageBtn" : "prepareMergeBtn"}" type="button" ${others.length || mergePromptReady ? "" : "disabled"}>${primaryLabel}</button>
      <div class="sub-actions">
        <button class="ghost-btn" type="button" data-open-package-chooser="true">Open package list</button>
        <button class="ghost-btn" id="prepareMergeBtnAlt" type="button" ${mergeReady.length && mergePromptReady ? "" : "disabled"}>Create Stage 06 merge request now</button>
      </div>
      <div class="notice ${mergePromptReady ? "success" : "danger"}" style="margin-top:12px;">${escapeHtml(stagePromptSourceLabel("stage6"))}</div>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">${others.length
        ? "You can move calmly to the next package. Merge can wait until you want to assemble the accepted package set."
        : "You can prepare the Stage 06 merge request now. Only packages with a matching accepted review will be included."}</p>
    </div>
  `;
}

function renderNoPackagesDetectedCard() {
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">No package file was detected yet</h2>
    <p class="lead">The Stage 03 result is saved, but this tool could not confidently separate any Work Package file from it.</p>
    <div class="section-block">
      <h3>What is missing</h3>
      <div class="notice warn">You cannot start Stage 04 here until at least one Work Package file is detectable inside the saved Stage 03 output.</div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <p class="small">Download the saved Stage 03 files and check whether the orchestration result actually contains separately labeled package artifacts. <code>_Work_Package.txt</code> is the normal marker, but the saved Stage 03 artifact content is what matters.</p>
      <button class="primary-btn" id="downloadStage3SetBtn" type="button">Download saved Stage 03 files</button>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">Once the package files are present in the saved Stage 03 result, this screen will open one package at a time for implementation and review.</p>
    </div>
  `;
}

function renderSaveMergeResultCard() {
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">Save the merge result</h2>
    <p class="lead">Paste the returned Stage 06 integration result here. The request already includes only exact accepted pairs.</p>
    <div class="section-block">
      <h3>What you need now</h3>
      <p class="small">Paste the full Integration Report and merged output exactly as returned.</p>
      <div class="notice">Included in this merge request: <strong>${escapeHtml(state.stage6.includedPackageKeys.map(key => (state.stage4.packages[key]?.packageId || key)).join(", ") || "None")}</strong></div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <div class="field">
        <label for="stage6ReturnInput">Returned merge result</label>
        <textarea id="stage6ReturnInput" class="mono" placeholder="Paste the full Integration Report here."></textarea>
      </div>
      <button class="primary-btn" id="SaveMergeResultBtn" type="button">Save merge result</button>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">After save, the tool will show the merge verdict clearly and keep the included package set visible in plain language.</p>
    </div>
  `;
}

function renderMergeCompleteCard() {
  const included = state.stage6.includedPackageKeys
    .map(key => state.stage4.packages[key])
    .filter(Boolean);
  return `
    <div class="section-label">Current action</div>
    <h2 class="current-title">Integration Report saved</h2>
    <p class="lead">The Stage 06 result is saved in this workspace.</p>
    <div class="section-block">
      <h3>What you have now</h3>
      <div class="tag-row">
        <div class="tag">${escapeHtml(state.stage6.mergeVerdict || "Integration Report saved")}</div>
        <div class="tag">${included.length} package${included.length === 1 ? "" : "s"} included</div>
      </div>
      <div class="notice success" style="margin-top:12px;">The merge request was built only from packages whose current output had a matching accepted review.</div>
      <div style="margin-top:12px;">${included.length
        ? `<div class="artifact-list">${included.map(pkg => `
            <div class="artifact-item">
              <div class="artifact-title">${escapeHtml(pkg.packageId || pkg.filename)}</div>
              <div class="artifact-meta">${escapeHtml(pkg.filename)}</div>
            </div>
          `).join("")}</div>`
        : `<div class="empty">No included packages were recorded.</div>`}</div>
    </div>
    <div class="section-block">
      <h3>Do this now</h3>
      <button class="primary-btn" id="downloadSummaryBtnInline" type="button">Download saved artifacts</button>
    </div>
    <div class="section-block">
      <h3>What happens next</h3>
      <p class="small">You can keep this merge result, export a full workspace backup, or clear the merge state if you need to prepare a different merge set later.</p>
    </div>
  `;
}


function renderLineageGraph() {
  const stageInfo = [
    { key: "stage1", label: "Stage 01 (Requirements)", color: "#93c5fd" },
    { key: "stage2", label: "Stage 02 (Architecture)", color: "#c4b5fd" },
    { key: "stage3", label: "Stage 03 (Orchestration)", color: "#6ee7b7" },
    { key: "stage4", label: "Stage 04 (Implementation)", color: "#fca5a5" },
    { key: "stage5", label: "Stage 05 (Review)", color: "#86efac" },
    { key: "stage6", label: "Stage 06 (Merge)", color: "#fcd34d" }
  ];
  const stageIndex = Object.fromEntries(stageInfo.map((item, index) => [item.key, index]));
  const artifacts = manifestArtifactList(state);
  const visibleArtifacts = artifacts.filter(item => item.status === "current" || item.status === "missing_on_disk");
  if (!visibleArtifacts.length) {
    return `<div class="lineage-empty">No artifacts saved yet. Start Stage 01 to begin.</div>`;
  }

  const contentMinX = 80;
  let contentMaxX = 780;
  let contentWidth = contentMaxX - contentMinX;
  const laneHeight = 70;
  const laneTop = 20;
  const nodeHeight = 40;
  let centerX = (contentMinX + contentMaxX) / 2;
  const baseText = "#edf2f7";
  const mutedText = "#97a3b6";
  const borderColor = "#2b3546";
  const normalEdge = "#97a3b6";
  const warnEdge = "#fbbf24";

  const deriveStage = artifact => {
    const logicalMatch = safeText(artifact.logicalKey).match(/^stage\s*([1-6])\//i);
    if (logicalMatch) return `stage${logicalMatch[1]}`;
    const producedMatch = safeText(artifact.stageProduced).match(/([1-6])/);
    return producedMatch ? `stage${producedMatch[1]}` : "stage3";
  };
  const packageLabel = pkg => pkg?.packageId || pkg?.packageLabel || pkg?.filename?.replace(/\.txt$/i, "") || "Package";
  const reviewSubtitle = pkg => {
    if (!pkg?.reviewOutputText.trim()) return "pending";
    if (pkg.reviewDisposition === "ACCEPT") return "ACCEPT";
    if (pkg.reviewDisposition === "REWORK") return "REWORK";
    return "pending";
  };
  const packages = getPackagesInOrder();
  const packageMap = Object.fromEntries(packages.map(pkg => [pkg.key, pkg]));

  // Dynamic graph width: scale content area so nodes don't overlap in wide lanes
  const maxLaneCount = Math.max(1, packages.length);
  const minSlotWidth = 116; // minimum px per node slot (node width + gap)
  const requiredContentWidth = maxLaneCount * minSlotWidth;
  if (requiredContentWidth > contentWidth) {
    contentWidth = requiredContentWidth;
    contentMaxX = contentMinX + contentWidth;
    centerX = (contentMinX + contentMaxX) / 2;
  }

  const visibleById = new Map(visibleArtifacts.map(artifact => [artifact.artifactId, artifact]));
  const hiddenBundleIds = new Set(visibleArtifacts.filter(artifact => artifact.artifactType === "stage3_bundle").map(artifact => artifact.artifactId));
  const nodeById = new Map();
  const nodes = [];
  const edges = [];
  const stage3PackageArtifacts = visibleArtifacts.filter(artifact => deriveStage(artifact) === "stage3" && artifact.artifactType === "work_package").sort((a, b) => {
    const left = packageMap[a.packageKey]?.packageId || a.packageId || a.title || a.filename || a.artifactId;
    const right = packageMap[b.packageKey]?.packageId || b.packageId || b.title || b.filename || b.artifactId;
    return String(left).localeCompare(String(right));
  });
  const stage3SummaryMode = stage3PackageArtifacts.length > 4;

  const centeredY = stageKey => laneTop + (stageIndex[stageKey] * laneHeight) + (laneHeight / 2);
  const laneColor = stageKey => stageInfo[stageIndex[stageKey]]?.color || "#97a3b6";
  const displayTitle = artifact => {
    if (!artifact) return "Artifact";
    if (artifact.artifactType === "work_package") return artifact.packageId || packageLabel(packageMap[artifact.packageKey]) || "Work Package";
    if (artifact.artifactType === "implementation_output") return artifact.packageId || packageLabel(packageMap[artifact.packageKey]) || "Implementation";
    if (artifact.artifactType === "review_report") return artifact.packageId || packageLabel(packageMap[artifact.packageKey]) || "Review";
    if (artifact.artifactType === "master_orchestration") return "Master Orchestration";
    if (artifact.artifactType === "execution_checklist") return "Execution Checklist";
    return artifact.title || artifactTypeLabel(artifact.artifactType);
  };
  const realSubtitle = artifact => {
    if (!artifact) return "";
    if (artifact.status === "missing_on_disk") return "missing from disk";
    if (artifact.artifactType === "review_report") {
      const disposition = artifact.attributes?.reviewDisposition || reviewSubtitle(packageMap[artifact.packageKey]);
      return disposition ? `${disposition} • r${artifact.revision || 1}` : `r${artifact.revision || 1}`;
    }
    return `r${artifact.revision || 1}`;
  };
  const textWidth = value => Math.max(0, String(value || "").length * 7 + 26);
  const laneWidthCap = count => {
    if (count <= 0) return 180;
    return Math.max(96, Math.min(180, Math.floor((contentWidth / count) - 16)));
  };
  const nodeWidthFor = (title, count) => Math.max(Math.min(120, laneWidthCap(count)), Math.min(laneWidthCap(count), Math.max(96, Math.min(180, textWidth(title)))));
  const laneCenters = count => {
    if (count <= 0) return [];
    if (count === 1) return [centerX];
    const segment = contentWidth / count;
    return Array.from({ length: count }, (_, index) => contentMinX + segment * (index + 0.5));
  };
  const edgeKey = (fromId, toId, tone) => `${fromId}__${toId}__${tone}`;
  const seenEdges = new Set();

  const addNode = config => {
    if (!config?.id || nodeById.has(config.id)) return nodeById.get(config.id) || null;
    const node = {
      id: config.id,
      artifactId: config.artifactId || "",
      stageKey: config.stageKey,
      cx: config.cx,
      cy: config.cy,
      width: config.width,
      height: nodeHeight,
      title: config.title,
      subtitle: config.subtitle || "",
      fill: config.fill,
      stroke: config.stroke,
      strokeDasharray: config.strokeDasharray || "",
      opacity: config.opacity == null ? 1 : config.opacity,
      subtitleColor: config.subtitleColor || mutedText,
      kind: config.kind || "artifact"
    };
    nodeById.set(node.id, node);
    nodes.push(node);
    return node;
  };

  const addEdge = (fromNode, toNode, tone = "normal", dashed = false) => {
    if (!fromNode || !toNode || fromNode.id === toNode.id) return;
    const key = edgeKey(fromNode.id, toNode.id, `${tone}:${dashed}`);
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from: fromNode, to: toNode, tone, dashed });
  };

  const buildArtifactNode = (artifact, stageKey, cx, count) => {
    if (!artifact) return null;
    const missing = artifact.status === "missing_on_disk";
    const subtitle = realSubtitle(artifact);
    let stroke = laneColor(stageKey);
    let subtitleColor = mutedText;
    let dash = "";
    let opacity = 1;
    if (missing) {
      stroke = warnEdge;
      subtitleColor = warnEdge;
      dash = "5 3";
      opacity = 0.9;
    } else if (artifact.artifactType === "review_report") {
      const disposition = artifact.attributes?.reviewDisposition || reviewSubtitle(packageMap[artifact.packageKey]);
      if (disposition === "ACCEPT") subtitleColor = "#86efac";
      if (disposition === "REWORK") subtitleColor = warnEdge;
    }
    const title = displayTitle(artifact);
    return addNode({
      id: artifact.artifactId,
      artifactId: artifact.artifactId,
      kind: "artifact",
      stageKey,
      cx,
      cy: centeredY(stageKey),
      width: nodeWidthFor(title, count),
      title,
      subtitle,
      fill: laneColor(stageKey),
      stroke,
      strokeDasharray: dash,
      opacity,
      subtitleColor
    });
  };

  const buildSummaryNode = (id, stageKey, cx, count, title, subtitle) => addNode({
    id,
    kind: "summary",
    stageKey,
    cx,
    cy: centeredY(stageKey),
    width: nodeWidthFor(title, count),
    title,
    subtitle,
    fill: laneColor(stageKey),
    stroke: laneColor(stageKey),
    opacity: 1,
    subtitleColor: mutedText
  });

  const buildGhostNode = (id, stageKey, cx, count, title, subtitle, tone = "ghost") => {
    const blocked = tone === "blocked";
    return addNode({
      id,
      kind: "ghost",
      stageKey,
      cx,
      cy: centeredY(stageKey),
      width: nodeWidthFor(title, count),
      title,
      subtitle,
      fill: laneColor(stageKey),
      stroke: blocked ? warnEdge : laneColor(stageKey),
      strokeDasharray: "5 3",
      opacity: blocked ? 0.55 : 0.4,
      subtitleColor: blocked ? warnEdge : mutedText
    });
  };

  const stage1Artifacts = visibleArtifacts.filter(artifact => deriveStage(artifact) === "stage1" && artifact.artifactType === "master_briefing");
  const stage2Artifacts = visibleArtifacts.filter(artifact => deriveStage(artifact) === "stage2" && artifact.artifactType === "architecture_spec");
  const stage3MasterArtifacts = visibleArtifacts.filter(artifact => deriveStage(artifact) === "stage3" && artifact.artifactType === "master_orchestration");
  const stage3ChecklistArtifacts = visibleArtifacts.filter(artifact => deriveStage(artifact) === "stage3" && artifact.artifactType === "execution_checklist");
  const stage6Artifacts = visibleArtifacts.filter(artifact => deriveStage(artifact) === "stage6" && artifact.artifactType === "merge_result");

  const masterNode = buildArtifactNode(stage1Artifacts[0] || null, "stage1", centerX, 1);
  const architectureNode = buildArtifactNode(stage2Artifacts[0] || null, "stage2", centerX, 1);

  const stage3Items = [];
  if (stage3MasterArtifacts[0]) stage3Items.push({ key: stage3MasterArtifacts[0].artifactId, artifact: stage3MasterArtifacts[0], type: "artifact" });
  if (stage3ChecklistArtifacts[0]) stage3Items.push({ key: stage3ChecklistArtifacts[0].artifactId, artifact: stage3ChecklistArtifacts[0], type: "artifact" });
  if (stage3SummaryMode) {
    stage3Items.push({ key: "summary:stage3:packages", type: "summary", count: stage3PackageArtifacts.length });
  } else {
    stage3PackageArtifacts.forEach(artifact => stage3Items.push({ key: artifact.artifactId, artifact, type: "artifact" }));
  }
  const stage3Centers = laneCenters(Math.max(stage3Items.length, 1));
  const stage3PackageNodeByKey = {};
  let stage3SummaryNode = null;
  stage3Items.forEach((item, index) => {
    if (item.type === "summary") {
      stage3SummaryNode = buildSummaryNode(item.key, "stage3", stage3Centers[index], Math.max(stage3Items.length, 1), `${item.count} work packages`, "current package contracts");
      return;
    }
    const node = buildArtifactNode(item.artifact, "stage3", stage3Centers[index], Math.max(stage3Items.length, 1));
    if (item.artifact?.artifactType === "work_package") stage3PackageNodeByKey[item.artifact.packageKey] = node;
  });

  const stage4Centers = laneCenters(Math.max(packages.length, 1));
  const stage4NodeByPackage = {};
  const stage5NodeByPackage = {};

  packages.forEach((pkg, index) => {
    const implArtifact = visibleById.get(pkg.implementationArtifactId) || null;
    const reviewArtifact = visibleById.get(pkg.reviewArtifactId) || null;
    const stage4Title = packageLabel(pkg);
    const stage5Title = packageLabel(pkg);
    const cx = stage4Centers[index] || centerX;
    const hasBlockingDeps = (pkg.dependsOnIds || []).some(depId => {
      const depPkg = packages.find(item => item.packageId === depId);
      return depPkg && !depPkg.implementationOutputText.trim();
    });
    stage4NodeByPackage[pkg.key] = implArtifact
      ? buildArtifactNode(implArtifact, "stage4", cx, Math.max(packages.length, 1))
      : buildGhostNode(`ghost:stage4:${pkg.key}`, "stage4", cx, Math.max(packages.length, 1), stage4Title, hasBlockingDeps ? "waiting on dependency" : "not started", hasBlockingDeps ? "blocked" : "ghost");
    stage5NodeByPackage[pkg.key] = reviewArtifact
      ? buildArtifactNode(reviewArtifact, "stage5", cx, Math.max(packages.length, 1))
      : buildGhostNode(`ghost:stage5:${pkg.key}`, "stage5", cx, Math.max(packages.length, 1), stage5Title, implArtifact ? "awaiting review" : "awaiting implementation", implArtifact ? "ghost" : "blocked");
  });

  const mergeArtifact = stage6Artifacts[0] || null;
  const mergeNode = mergeArtifact
    ? buildArtifactNode(mergeArtifact, "stage6", centerX, 1)
    : buildGhostNode("ghost:stage6:merge", "stage6", centerX, 1, "Integration Report", "not merged yet");

  const stage3FallbackParent = architectureNode || masterNode || null;
  const remapParents = artifact => {
    const out = [];
    (artifact.parentArtifactIds || []).filter(Boolean).forEach(parentId => {
      if (hiddenBundleIds.has(parentId)) {
        if (stage3FallbackParent) out.push(stage3FallbackParent.id);
        return;
      }
      if (nodeById.has(parentId)) out.push(parentId);
    });
    return Array.from(new Set(out));
  };

  nodes.filter(node => node.kind === "artifact" && node.artifactId).forEach(node => {
    const artifact = visibleById.get(node.artifactId);
    if (!artifact) return;
    remapParents(artifact).forEach(parentId => addEdge(nodeById.get(parentId), node, "normal", false));
  });

  packages.forEach(pkg => {
    const workPackageNode = stage3SummaryMode ? stage3SummaryNode : stage3PackageNodeByKey[pkg.key] || null;
    const implNode = stage4NodeByPackage[pkg.key];
    const reviewNode = stage5NodeByPackage[pkg.key];
    if (implNode && implNode.kind === "ghost") addEdge(workPackageNode, implNode, (implNode.subtitle || "").includes("dependency") ? "warn" : "normal", true);
    if (reviewNode && reviewNode.kind === "ghost") addEdge(implNode, reviewNode, (reviewNode.subtitle || "").includes("implementation") ? "warn" : "normal", true);
    if (!mergeArtifact && reviewNode && reviewSubtitle(pkg) === "ACCEPT" && reviewNode.kind === "artifact") addEdge(reviewNode, mergeNode, "normal", true);
  });

  const svgHeight = laneTop + (stageInfo.length * laneHeight) + 10;
  const defs = `
    <defs>
      <marker id="lineageArrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L7,3 z" fill="${normalEdge}"></path>
      </marker>
      <marker id="lineageArrowWarn" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L7,3 z" fill="${warnEdge}"></path>
      </marker>
    </defs>`;

  const laneLines = stageInfo.slice(1).map((stage, index) => {
    const y = laneTop + (index + 1) * laneHeight;
    return `<line x1="${contentMinX}" y1="${y}" x2="${contentMaxX}" y2="${y}" stroke="${borderColor}" stroke-width="0.5" stroke-dasharray="4 4"></line>`;
  }).join("");

  const labels = stageInfo.map((stage, index) => {
    const y = laneTop + index * laneHeight + 38;
    return `<text x="10" y="${y}" fill="${mutedText}" font-size="11">${escapeHtml(stage.label)}</text>`;
  }).join("");

  const edgeMarkup = edges.map(edge => {
    const fromX = edge.from.cx;
    const fromY = edge.from.cy + (edge.from.height / 2);
    const toX = edge.to.cx;
    const toY = edge.to.cy - (edge.to.height / 2);
    const color = edge.tone === "warn" ? warnEdge : normalEdge;
    const dash = edge.dashed ? ' stroke-dasharray="4 3"' : "";
    const marker = edge.tone === "warn" ? "lineageArrowWarn" : "lineageArrow";
    if (Math.abs(fromX - toX) < 2) {
      return `<line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" stroke="${color}" stroke-width="0.5"${dash} marker-end="url(#${marker})"></line>`;
    }
    const midY = Math.round((fromY + toY) / 2);
    return `<path d="M${fromX},${fromY} L${fromX},${midY} L${toX},${midY} L${toX},${toY}" fill="none" stroke="${color}" stroke-width="0.5"${dash} marker-end="url(#${marker})"></path>`;
  }).join("");

  const nodeMarkup = nodes.sort((a, b) => (stageIndex[a.stageKey] - stageIndex[b.stageKey]) || (a.cx - b.cx)).map(node => {
    const x = Math.round(node.cx - (node.width / 2));
    const y = Math.round(node.cy - (node.height / 2));
    const titleY = y + 17;
    const subtitleY = y + 31;
    const fillOpacity = node.kind === "ghost" ? 0.08 : 0.12;
    return `
      <g opacity="${node.opacity}">
        <rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="8" fill="${node.fill}" fill-opacity="${fillOpacity}" stroke="${node.stroke}" stroke-opacity="0.6" stroke-width="0.5"${node.strokeDasharray ? ` stroke-dasharray="${node.strokeDasharray}"` : ""}></rect>
        <text x="${node.cx}" y="${titleY}" fill="${baseText}" font-size="13" font-weight="700" text-anchor="middle">${escapeHtml(node.title)}</text>
        <text x="${node.cx}" y="${subtitleY}" fill="${node.subtitleColor}" font-size="11" text-anchor="middle">${escapeHtml(node.subtitle)}</text>
      </g>`;
  }).join("");

  const svgWidth = contentMaxX + 20;
  const fitScale = Math.min(1, 800 / svgWidth);
  const initialPct = Math.round(fitScale * 100);

  return `
    <div class="lineage-toolbar">
      <button type="button" class="ghost-btn lineage-zoom-btn" data-lineage-zoom="out" title="Zoom out">−</button>
      <span class="lineage-zoom-label" data-lineage-zoom-label>${initialPct}%</span>
      <button type="button" class="ghost-btn lineage-zoom-btn" data-lineage-zoom="in" title="Zoom in">+</button>
      <button type="button" class="ghost-btn lineage-zoom-btn" data-lineage-zoom="fit" title="Fit to width">Fit</button>
    </div>
    <div class="lineage-viewport" data-lineage-viewport>
      <svg class="lineage-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Artifact lineage graph" style="transform-origin:0 0;transform:scale(${fitScale});">
        ${defs}
        ${laneLines}
        ${labels}
        ${edgeMarkup}
        ${nodeMarkup}
      </svg>
    </div>
  `;
}

function renderSavedArtifacts() {
  const groups = [];
  groups.push(renderArtifactGroup("Stage 01", state.stage1.artifactText, "01_Master_Briefing.txt", "stage1"));
  groups.push(renderArtifactGroup("Stage 02", state.stage2.artifactText, "02_Architecture_Spec.txt", "stage2"));

  if (state.stage3.rawOutputText.trim()) {
    const items = state.stage3.artifacts.length ? state.stage3.artifacts : [{
      filename: state.stage3.outcome === "pause" ? "03_Pause_For_Decisions.txt" : "03_Stage03_Output.txt",
      content: state.stage3.rawOutputText,
      kind: state.stage3.outcome || "raw"
    }];
    groups.push(`
      <div class="artifact-item">
        <div class="artifact-title">Stage 03 saved artifacts</div>
        <div class="artifact-meta">${escapeHtml(state.stage3.savedAt || "Saved")}</div>
        <div class="artifact-list">
          ${items.map(item => `
            <div class="artifact-item">
              <div class="artifact-title">${escapeHtml(item.filename)}</div>
              <div class="artifact-meta">${escapeHtml(describeStage3Artifact(item))}</div>
              <div class="artifact-actions">
                <button class="ghost-btn" type="button" data-download-artifact="${escapeHtml(item.filename)}">Download</button>
              </div>
              <details style="margin-top:10px;">
                <summary>Preview <span class="mini">optional</span></summary>
                <div class="details-body"><pre>${escapeHtml(previewText(item.content))}</pre></div>
              </details>
            </div>
          `).join("")}
        </div>
      </div>
    `);
  }

  const packages = getPackagesInOrder();
  if (packages.length) {
    groups.push(`
      <div class="artifact-item">
        <div class="artifact-title">Saved package results</div>
        <div class="artifact-meta">Saved Stage 04 / 05 package work in this workspace</div>
        <div class="artifact-list">
          ${packages.map(pkg => {
            const pkgFiles = getImportedPackageFiles(pkg);
            const fileListHtml = pkgFiles.length
              ? `<div class="small" style="margin-top:4px;">${pkgFiles.length} imported file(s): ${pkgFiles.map(r => escapeHtml(r.filename)).join(", ")}</div>`
              : "";
            return `
            <div class="artifact-item">
              <div class="artifact-title">${escapeHtml(pkg.packageId ? `${pkg.packageId} — ${pkg.packageLabel}` : pkg.packageLabel)}</div>
              <div class="artifact-meta">${escapeHtml(packagePlainStatus(pkg))}</div>
              <div class="artifact-actions">
                ${pkg.implementationOutputText.trim() ? `<button class="ghost-btn" type="button" data-download-package-output="${escapeHtml(pkg.key)}">Download implementation</button>` : ""}
                ${pkg.reviewOutputText.trim() ? `<button class="ghost-btn" type="button" data-download-package-review="${escapeHtml(pkg.key)}">Download review</button>` : ""}
                <button class="ghost-btn" type="button" data-select-package="${escapeHtml(pkg.key)}">Open package</button>
              </div>
              ${fileListHtml}
              ${pkg.implementationOutputText.trim() ? `<details style="margin-top:10px;"><summary>Implementation preview <span class="mini">optional</span></summary><div class="details-body"><pre>${escapeHtml(previewText(pkg.implementationOutputText))}</pre></div></details>` : ""}
              ${pkg.reviewOutputText.trim() ? `<details style="margin-top:10px;"><summary>Review preview <span class="mini">optional</span></summary><div class="details-body"><pre>${escapeHtml(previewText(pkg.reviewOutputText))}</pre></div></details>` : ""}
            </div>
          `;}).join("")}
        </div>
      </div>
    `);
  }

  if (state.stage6.mergeResultText.trim()) {
    groups.push(`
      <div class="artifact-item">
        <div class="artifact-title">Stage 06 merge result</div>
        <div class="artifact-meta">${escapeHtml(state.stage6.mergeSavedAt || "Saved")}</div>
        <div class="artifact-actions">
          <button class="ghost-btn" type="button" data-download-merge-result="true">Download merge result</button>
        </div>
        <details style="margin-top:10px;">
          <summary>Preview <span class="mini">optional</span></summary>
          <div class="details-body"><pre>${escapeHtml(previewText(state.stage6.mergeResultText))}</pre></div>
        </details>
      </div>
    `);
  }

  return groups.filter(Boolean).join("") || `<div class="empty">No saved artifacts yet.</div>`;
}

function renderArtifactGroup(label, text, filename, clearKey) {
  if (!safeText(text).trim()) return "";
  const savedAt = clearKey === "stage1" ? state.stage1.savedAt : clearKey === "stage2" ? state.stage2.savedAt : "";
  return `
    <div class="artifact-item">
      <div class="artifact-title">${escapeHtml(label)}</div>
      <div class="artifact-meta">${escapeHtml(savedAt || "Saved in this workspace")}</div>
      <div class="artifact-actions">
        <button class="ghost-btn" type="button" data-download-single="${escapeHtml(filename)}">Download</button>
        <button class="ghost-btn" type="button" data-clear-artifact="${escapeHtml(clearKey)}">Remove from workspace</button>
      </div>
      <details style="margin-top:10px;">
        <summary>Preview <span class="mini">optional</span></summary>
        <div class="details-body"><pre>${escapeHtml(previewText(text))}</pre></div>
      </details>
    </div>
  `;
}

function renderRecovery() {
  const pkg = getSelectedPackage();
  return `
    <div class="stack">
      <div class="artifact-item">
        <div class="artifact-title">Clear or replace saved results</div>
        <div class="artifact-meta">Use this only when a saved artifact is wrong, stale, or from the wrong run.</div>
        <div class="artifact-actions">
          <button class="ghost-btn" type="button" data-clear-artifact="stage1">Clear Stage 01</button>
          <button class="ghost-btn" type="button" data-clear-artifact="stage2">Clear Stage 02</button>
          <button class="ghost-btn" type="button" data-clear-artifact="stage3">Clear Stage 03 and package flow</button>
          <button class="ghost-btn" type="button" data-clear-artifact="stage4">Clear package work</button>
          <button class="ghost-btn" type="button" data-clear-artifact="stage6">Clear merge result</button>
        </div>
      </div>
      ${pkg ? `
        <div class="artifact-item">
          <div class="artifact-title">Current package recovery</div>
          <div class="artifact-meta">${escapeHtml(pkg.packageId || pkg.filename)}</div>
          <div class="artifact-actions">
            <button class="ghost-btn" type="button" data-clear-package="${escapeHtml(pkg.key)}">Clear this package output and review</button>
          </div>
        </div>
      ` : ""}
      <div class="artifact-item">
        <div class="artifact-title">If currentness is unclear, stop</div>
        <div class="small">Primary rule lives in 08 VERSION RULE and the manifest. If two files both look current, stop, resolve authority there, then return here.</div>
      </div>
      <div class="artifact-item">
        <div class="artifact-title">Before Stage 06, check the exact pair</div>
        <div class="small">Primary rule lives in 05, 07, 08, and the manifest. Stage 06 handoff eligibility requires the current implementation output, the matching review for that exact output, FINAL_DISPOSITION: ACCEPT, and no merge-blocking findings.</div>
      </div>
      <div class="artifact-item">
        <div class="artifact-title">If the run is paused, do not push forward</div>
        <div class="small">Primary rule lives in 07, 08, and the saved pause artifact. Keep the full pause artifact, answer only the questionnaire portion, and resume only after the updated authoritative artifact is saved.</div>
      </div>
    </div>
  `;
}

function renderTechnicalDetails() {
  const packageSnapshot = getPackagesInOrder().map(pkg => {
    const packageArtifact = getCurrentPackageContractArtifact(pkg);
    const implementationArtifact = getCurrentImplementationArtifact(pkg);
    const reviewArtifact = getCurrentReviewArtifact(pkg);
    const resolved = resolvePackageLineage(pkg);
    return {
      packageKey: pkg.key,
      packageId: pkg.packageId,
      currentPackageRevision: packageArtifact?.revision || "(none)",
      currentImplementationRevision: implementationArtifact?.revision || "(none)",
      currentReviewRevision: reviewArtifact?.revision || "(none)",
      implementationFingerprint: implementationArtifact?.fingerprint || "(none)",
      reviewBindingFingerprint: reviewArtifact?.attributes?.bindingFingerprint || "(none)",
      implementationStatus: implementationArtifact?.status || "(none)",
      reviewStatus: reviewArtifact?.status || "(none)",
      reviewDisposition: reviewArtifact?.attributes?.reviewDisposition || "(none)",
      reviewHasMergeBlockingFindings: Boolean(reviewArtifact?.attributes?.reviewHasMergeBlockingFindings),
      mergeReady: resolved.mergeReady,
      lineageNote: resolved.detail
    };
  });

  const manifestCounts = manifestStatusCounts();
  const authoritative = currentAuthoritativeArtifacts().map(item => ({
    artifactId: item.artifactId,
    type: item.artifactType,
    title: item.title,
    revision: item.revision,
    packageId: item.packageId || "",
    status: item.status,
    fingerprint: item.fingerprint,
    parents: item.parentArtifactIds
  }));

  const technical = {
    workflow: state.workflow,
    currentAction: currentActionKey(),
    stage2Readiness: state.stage2.readinessStatus || "(not detected)",
    stage2Progression: state.stage2.progressionStatus || "(not detected)",
    stage3Outcome: state.stage3.outcome || "(not detected)",
    stage3PauseTarget: state.stage3.pauseResumeTarget || "(not detected)",
    selectedPackage: state.stage4.selectedPackageKey || "(none)",
    mergeIncludedPackageKeys: state.stage6.includedPackageKeys,
    selectedLLMs: llmSelections().map(item => `${item.slot} — ${item.name}`).join("\n") || "(none)",
    promptSources: Object.fromEntries(Object.keys(STAGE_PROMPT_IMPORTS).map(stageKey => [stageKey, stagePromptSourceLabel(stageKey)])),
    manifestSummary: manifestCounts,
    authoritativeArtifacts: authoritative,
    packageSnapshot
  };

  const statusTags = Object.entries(manifestCounts)
    .filter(([, count]) => count)
    .map(([label, count]) => `<div class="tag">${escapeHtml(artifactStatusLabel(label))}: ${count}</div>`)
    .join("");

  return `
    <div class="stack">
      <div class="artifact-item">
        <div class="artifact-title">Manifest summary</div>
        <div class="artifact-meta">Machine-readable artifact identity, lineage, supersession, and lifecycle state.</div>
        <div class="tag-row">${statusTags || `<div class="tag">No manifest entries yet</div>`}</div>
        <div class="artifact-actions" style="margin-top:10px;">
          <button class="ghost-btn" id="downloadManifestBtn" type="button">Download manifest JSON</button>
        </div>
      </div>
      <div class="artifact-item">
        <div class="artifact-title">Current authoritative artifacts</div>
        ${authoritative.length ? `
          <div class="artifact-list">
            ${authoritative.map(item => `
              <div class="artifact-item">
                <div class="artifact-title">${escapeHtml(item.title)}${item.packageId ? ` — ${escapeHtml(item.packageId)}` : ""}</div>
                <div class="artifact-meta">${escapeHtml(artifactTypeLabel(item.type))} • revision ${escapeHtml(String(item.revision))} • ${escapeHtml(item.fingerprint)}</div>
                <div class="small">${escapeHtml(item.parents.length ? `Parents: ${item.parents.join(", ")}` : "No recorded parents.")}</div>
              </div>
            `).join("")}
          </div>
        ` : `<div class="empty">No authoritative artifacts are registered yet.</div>`}
      </div>
      <div class="artifact-item">
        <div class="artifact-title">Package lineage snapshot</div>
        <pre>${escapeHtml(previewJson(packageSnapshot))}</pre>
      </div>
      <div class="artifact-item">
        <div class="artifact-title">Resolver and manifest snapshot</div>
        <pre>${escapeHtml(previewJson(technical))}</pre>
      </div>
      <div class="artifact-item">
        <div class="artifact-title">How provenance now drives decisions</div>
        <div class="small">Review reuse, stale detection, Stage 06 handoff eligibility, and authoritative-artifact selection are now resolved against the manifest plus saved review metadata, not only filenames or revision heuristics.</div>
      </div>
    </div>
  `;
}

function renderBackground() {
  return `
    <div class="stack">
      <div class="artifact-item">
        <div class="artifact-title">Why the main surface stays narrow</div>
        <div class="small">Even after Stage 03, the working surface stays focused on one current package and one current action.</div>
      </div>
      <div class="artifact-item">
        <div class="artifact-title">Quick workflow reminder</div>
        <div class="small">Use 07 for the workflow rules, 08 for live-run action rules, and the saved artifact chain plus manifest for currentness. The list below is helper text only.</div>
        <ul class="hint-list">
          <li>Reminder only: Stage 01 normally yields the saved Master Briefing used downstream.</li>
          <li>Reminder only: Stage 02 normally yields the saved Architecture Spec and the readiness / progression gate.</li>
          <li>Reminder only: Stage 03 normally yields separated execution artifacts or one saved PAUSE artifact.</li>
          <li>Reminder only: Stage 04 works one package at a time inside the saved package boundaries.</li>
          <li>Reminder only: Stage 05 reviews the current saved output for that same package.</li>
          <li>Reminder only: Stage 06 integrates only from accepted saved pairs; exact merge authority still lives in 06 plus the saved artifact set.</li>
        </ul>
      </div>
      <div class="artifact-item">
        <div class="artifact-title">Deliberate limits</div>
        <ul class="hint-list">
          <li>No package dashboard wall</li>
          <li>No review matrix as the main surface</li>
          <li>No merge control center</li>
          <li>No always-visible artifact administration board</li>
        </ul>
      </div>
    </div>
  `;
}

function finalizeRender() {

  saveState().catch(err => console.error("Persistence failed", err));
  render();
}
