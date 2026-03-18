// 06_builders.js — Request packet builders, artifact parsers, and text-generation helpers
// Builds prompts and interprets returned artifacts. No direct I/O.

function buildRequestPacket(intro, stageKey, sections, extraNote = "") {
  return [
    intro,
    "",
    getStagePromptText(stageKey),
    ...sections
      .filter(([, body]) => body !== "" && body != null)
      .flatMap(([title, body]) => ["", requestSection(title, body)]),
    ...(extraNote ? ["", requestSection("OPERATOR NOTE", extraNote.trim())] : [])
  ].join("\n");
}

function buildStage1Request() {
  const notes = safeText(state.projectNotes).trim();
  return buildRequestPacket("Use this in a fresh chat with one of your selected local slots.", "stage1", [[
    "OPERATOR INPUT",
    [
      projectLabelLine() + "Initial operator context:",
      notes || "[No initial project notes were entered in the console. Use the Stage 01 prompt to determine the next required user interaction before drafting the Master Briefing.]",
      "",
      "Additional reference files:",
      formatReferenceFilesForPrompt()
    ].join("\n")
  ]]);
}

function buildStage2Request(extraNote = "") {
  return buildRequestPacket("Use this in a fresh chat with one of your stronger available LLMs.", "stage2", [
    ["CURRENT MASTER BRIEFING", safeText(state.stage1.artifactText).trim()],
    ["OPTIONAL EXISTING CONTEXT", state.referenceFiles.length ? formatReferenceFilesForPrompt() : null]
  ], extraNote);
}

function buildStage3Request(extraNote = "") {
  return buildRequestPacket("Use this in a fresh chat with one of your stronger available LLMs.", "stage3", [
    ["CURRENT MASTER BRIEFING", safeText(state.stage1.artifactText).trim()],
    ["CURRENT ARCHITECTURE SPEC", safeText(state.stage2.artifactText).trim()],
    ["AVAILABLE LLMs", formatAvailableLLMs()]
  ], extraNote);
}

function getUpstreamPackageContext(pkg) {
  const items = [];
  const seen = new Set();
  (pkg.dependsOnIds || []).forEach(id => {
    const match = getPackagesInOrder().find(item => item.packageId === id);
    if (!match || !match.implementationOutputText.trim()) return;
    const status = packagePlainStatus(match);
    const block = [
      `DEPENDENCY PACKAGE: ${match.packageId || match.filename}`,
      `Dependency status in this workspace: ${status}`,
      `Dependency file: ${match.filename}`,
      "",
      match.implementationOutputText.trim()
    ].join("\n");
    if (!seen.has(block)) {
      seen.add(block);
      items.push(block);
    }
  });
  return items;
}

function packageBindingBlock(pkg) {
  return [
    "RETURN THIS BINDING BLOCK VERBATIM IN THE REVIEW OUTPUT",
    `PACKAGE_FILE: ${pkg.filename}`,
    `PACKAGE_ID: ${pkg.packageId || "Not detected"}`,
    `IMPLEMENTATION_FINGERPRINT: ${pkg.implementationOutputFingerprint || "missing"}`,
    `REVIEW_BINDING_TOKEN: ${pkg.implementationOutputFingerprint || "missing"}`
  ].join("\n");
}

function buildStage4Request(pkg, mode = "normal") {
  const reworkNote = mode === "rework"
    ? [
        "The latest review for this package says REWORK. Revise this same package. Do not broaden scope.",
        "",
        "Latest implementation output that needs revision:",
        safeText(pkg.implementationOutputText).trim() || "[No previous implementation output saved]",
        "",
        "Latest review report for this same package:",
        safeText(pkg.reviewOutputText).trim() || "[No review report saved]"
      ].join("\n")
    : null;
  return buildRequestPacket("Use this in a fresh chat with one of your selected local slots.", "stage4", [
    ["CURRENT MASTER BRIEFING", safeText(state.stage1.artifactText).trim()],
    ["CURRENT ARCHITECTURE SPEC", safeText(state.stage2.artifactText).trim()],
    ["CURRENT WORK PACKAGE CONTRACT", safeText(pkg.packageText).trim()],
    ["UPSTREAM PACKAGE OUTPUTS AVAILABLE IN THIS WORKSPACE", getUpstreamPackageContext(pkg).join(PACKAGE_SEPARATOR) || null],
    ["OPERATOR NOTE — THIS PACKAGE IS IN REWORK", reworkNote]
  ]);
}

function buildStage5Request(pkg) {
  return buildRequestPacket("Use this in a fresh chat with one of your selected local slots.", "stage5", [
    ["CURRENT MASTER BRIEFING", safeText(state.stage1.artifactText).trim()],
    ["CURRENT ARCHITECTURE SPEC", safeText(state.stage2.artifactText).trim()],
    ["CURRENT WORK PACKAGE CONTRACT", safeText(pkg.packageText).trim()],
    ["CURRENT IMPLEMENTATION OUTPUT TO REVIEW", safeText(pkg.implementationOutputText).trim()],
    [
      "REVIEW BINDING BLOCK",
      [
        packageBindingBlock(pkg),
        "",
        "The review output must repeat the binding block above verbatim somewhere before the Final Disposition section. Do not change the fingerprint."
      ].join("\n")
    ],
    ["UPSTREAM PACKAGE OUTPUTS AVAILABLE IN THIS WORKSPACE", getUpstreamPackageContext(pkg).join(PACKAGE_SEPARATOR) || null]
  ]);
}

function buildStage6Request(mergePackages) {
  const excluded = getPackagesInOrder().filter(pkg => !isPackageMergeReady(pkg));
  return buildRequestPacket("Use this in a fresh chat with one of your stronger available LLMs.", "stage6", [
    ["PROJECT NAME", state.projectName.trim() || "Unnamed project"],
    ["CURRENT ARCHITECTURE SPEC", safeText(state.stage2.artifactText).trim()],
    [
      "MERGE-READY PACKAGE SET",
      mergePackages.map(pkg => [
        `PACKAGE: ${pkg.packageId || pkg.filename}`,
        `PACKAGE FILE: ${pkg.filename}`,
        `IMPLEMENTATION FINGERPRINT: ${pkg.implementationOutputFingerprint}`,
        "",
        "WORK PACKAGE CONTRACT",
        safeText(pkg.packageText).trim(),
        "",
        "IMPLEMENTATION OUTPUT",
        safeText(pkg.implementationOutputText).trim(),
        "",
        "REVIEW REPORT",
        safeText(pkg.reviewOutputText).trim()
      ].join("\n")).join(MERGE_SEPARATOR)
    ],
    ["PACKAGES EXCLUDED FROM THIS MERGE REQUEST", excluded.length ? excluded.map(pkg => `- ${pkg.packageId || pkg.filename} — ${packagePlainStatus(pkg)}`).join("\n") : null]
  ]);
}

function buildPauseResponsePacket() {
  const answered = safeText(state.stage3.pauseAnswerDraft).trim();
  const questionnaire = safeText(state.stage3.pauseQuestionnaireText).trim();
  const resumeInstruction = safeText(state.stage3.pauseResumeInstruction).trim();
  const resumeTarget = state.stage3.pauseResumeTarget;
  const answeredBlock = requestSection("ANSWERED MINIMAL DECISION QUESTIONNAIRE", answered || "[No answers entered]");
  const pauseNote = [
    "Resume from the saved Stage 03 pause path.",
    "",
    "Full PAUSE artifact:",
    safeText(state.stage3.pauseArtifactText).trim(),
    "",
    answeredBlock,
    "",
    "Original extracted questionnaire:",
    questionnaire || "[Questionnaire could not be extracted cleanly.]",
    "",
    "Resume exactly as instructed below:",
    resumeInstruction
  ].join("\n");

  if (resumeTarget === "stage2") return buildStage2Request(pauseNote);
  if (resumeTarget === "stage1") {
    return buildRequestPacket("Use this in a fresh chat with one of your selected local slots.", "stage1", [
      [
        "ORIGINAL PROJECT INPUT",
        [
          projectLabelLine() + "Initial operator context:",
          safeText(state.projectNotes).trim() || "[No initial project notes were entered in the console. Use the Stage 01 prompt to determine the next required user interaction.]",
          "",
          "Additional reference files:",
          formatReferenceFilesForPrompt()
        ].join("\n")
      ],
      ["PAUSE ARTIFACT", safeText(state.stage3.pauseArtifactText).trim()],
      ["ANSWERED MINIMAL DECISION QUESTIONNAIRE", answered || "[No answers entered]"],
      ["ORIGINAL EXTRACTED QUESTIONNAIRE", questionnaire || "[Questionnaire could not be extracted cleanly.]"],
      ["RESUME INSTRUCTION", resumeInstruction]
    ]);
  }
  return buildStage3Request(pauseNote);
}

function describeArchitectureBlock() {
  if (!state.stage2.readinessStatus) return "The current Architecture Spec does not expose a clear readiness status. The next safe action is to bring back a revised spec with an explicit readiness and progression gate.";
  if (state.stage2.readinessStatus === "Not Safe to Freeze") return "The current Architecture Spec says it is not safe to freeze. Stage 03 should not run from it yet.";
  if (!state.stage2.progressionStatus) return "The current Architecture Spec does not expose a clear Progression Status line. The next safe action is to bring back a revised spec with an explicit gate result.";
  return "The current Architecture Spec still blocks downstream work.";
}

function pauseTargetLabel() {
  if (state.stage3.pauseResumeTarget === "stage1") return "Stage 01 / Requirements Engineer";
  if (state.stage3.pauseResumeTarget === "stage2") return "Stage 02 / Technical Architect";
  return "Stage 03 / Project Orchestrator";
}

function pauseNextText() {
  return `Use the role named by the Resume Instruction. The current best match is ${pauseTargetLabel()}. After that chat returns the updated authoritative result, paste it back here and save it.`;
}

function isStage3PausePrep() {
  return state.stage2.progressionStatus === "PAUSE_FOR_DECISIONS";
}

function stage3CopyTitle() {
  return isStage3PausePrep() ? "Create the Stage 03 pause request" : "Create the Stage 03 request";
}

function stage3CopyLead() {
  return isStage3PausePrep()
    ? "Copy this into your Project Orchestrator chat. This run should return only one PAUSE artifact, not Work Package files."
    : "Copy this into your Project Orchestrator chat. Bring back the full result exactly as returned.";
}

function stage3CopyNextText() {
  return isStage3PausePrep()
    ? "This run should return one full PAUSE artifact containing Gate Result, Blocking Contract-Critical Decisions, Minimal Decision Questionnaire, and Resume Instruction. Save the full artifact here."
    : "If the result pauses, save the full pause artifact. If it is CLOSED, save the separated Stage 03 artifacts.";
}

function pauseReturnLead() {
  if (state.stage3.pauseResumeTarget === "stage1") return "Paste the updated authoritative result here. Because the Resume Instruction points upstream to Stage 01, this may be a revised Master Briefing.";
  if (state.stage3.pauseResumeTarget === "stage2") return "Paste the updated authoritative result here. Because the Resume Instruction points to Stage 02, this will usually be a revised Architecture Spec.";
  return "Paste the updated authoritative result here. This can be a revised Architecture Spec or a fresh Stage 03 result, depending on the Resume Instruction.";
}

function describeStage3Artifact(item) {
  if (item.kind === "master") return "Master orchestration file";
  if (item.kind === "package") return "Work Package file";
  if (item.kind === "checklist") return "Execution checklist";
  if (item.kind === "pause") return "Pause artifact";
  return "Saved Stage 03 artifact";
}
