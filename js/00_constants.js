// 00_constants.js — All configuration constants, feature flags, and static data
// No executable logic. No I/O. No function calls.

const FSAPI_SUPPORTED = (
  typeof window.showDirectoryPicker === "function" &&
  typeof FileSystemDirectoryHandle !== "undefined"
);
let workspaceRootHandle = null;
let workspaceSubHandles = {};
let pendingWorkspaceHandle = null;
let promptFolderHandle = null;
const IDB_PROMPT_HANDLE_KEY = "lastPromptFolder";
const WORKSPACE_DIRS = [
  "_console", "stage01", "stage02", "stage03",
  "stage04", "stage05", "stage06", "references", "archive"
];
const CONSOLE_DIR = "_console";
const STATE_FILE = "workspace_state.json";
const MANIFEST_FILE = "artifact_manifest.json";
const AUDIT_FILE = "audit_log.ndjson";
const METADATA_FILE = "workspace_metadata.json";
const IDB_HANDLE_STORE = "workspaceHandles";
const IDB_HANDLE_KEY = "lastWorkspaceRoot";
const BACKUP_VERSION = "3.0";
const LEGACY_STORAGE_KEY = "operatorConsoleRebuiltStage01to06Guided_v2";
const SECURITY_LIMITS = Object.freeze({
  maxBackupImportBytes: 5 * 1024 * 1024,
  maxSingleTextFileBytes: 1 * 1024 * 1024,
  maxBatchImportBytes: 15 * 1024 * 1024,
  maxRenderedPreviewChars: 50000,
  maxTechnicalPreviewChars: 20000,
  persistWarningBytes: 3 * 1024 * 1024
});
const DANGEROUS_IMPORT_KEYS = Object.freeze(new Set(["__proto__", "prototype", "constructor"]));
const runtimeStatus = {
  workspaceMessage: "",
  workspaceTone: "",
  persistenceMessage: "",
  persistenceTone: "",
  lastSavedBytes: 0,
  actionSummary: "",
  actionSummaryTone: ""
};
let writePermissionLost = false;
let lastWriteError = null;


const STAGE_PROMPT_IMPORTS = Object.freeze({
  stage1: {
    label: "Stage 01 — Requirements Engineer",
    preferredFilename: "01_Requirements_Engineer_v5.txt",
    number: "01",
    acceptedStems: ["requirements_engineer", "requirement_engineer"],
    keywords: ["requirements_engineer", "requirement_engineer", "requirements engineer", "requirement engineer"],
    filenameHint: "01_Requirements_Engineer_v5.txt",
    contentMarkers: ["Requirements Engineer", "Master Briefing", "iterative interview"]
  },
  stage2: {
    label: "Stage 02 — Technical Architect",
    preferredFilename: "02_Technical_Architect_v5.txt",
    number: "02",
    acceptedStems: ["technical_architect"],
    keywords: ["technical_architect", "technical architect"],
    filenameHint: "02_Technical_Architect_v5.txt",
    contentMarkers: ["Technical Architect", "Architecture Spec", "binding technical contract"]
  },
  stage3: {
    label: "Stage 03 — Project Orchestrator",
    preferredFilename: "03_Project_Orchestrator_v5.txt",
    number: "03",
    acceptedStems: ["project_orchestrator"],
    keywords: ["project_orchestrator", "project orchestrator"],
    filenameHint: "03_Project_Orchestrator_v5.txt",
    contentMarkers: ["Project Orchestrator", "Work Package", "Master Orchestration File"]
  },
  stage4: {
    label: "Stage 04 — Module Implementer",
    preferredFilename: "04_Module_Implementer_v5.txt",
    number: "04",
    acceptedStems: ["module_implementer"],
    keywords: ["module_implementer", "module implementer"],
    filenameHint: "04_Module_Implementer_v5.txt",
    contentMarkers: ["Module Implementer", "Work Package Contract", "Delivery Report"]
  },
  stage5: {
    label: "Stage 05 — Code Reviewer",
    preferredFilename: "05_Code_Reviewer_v5.txt",
    number: "05",
    acceptedStems: ["code_reviewer"],
    keywords: ["code_reviewer", "code reviewer"],
    filenameHint: "05_Code_Reviewer_v5.txt",
    contentMarkers: ["Code Reviewer", "Review Process", "FAIL — REVISION REQUIRED"]
  },
  stage6: {
    label: "Stage 06 — Merge Coordinator",
    preferredFilename: "06_Merge_Coordinator_v5.txt",
    number: "06",
    acceptedStems: ["merge_coordinator"],
    keywords: ["merge_coordinator", "merge coordinator"],
    filenameHint: "06_Merge_Coordinator_v5.txt",
    contentMarkers: ["Merge Coordinator", "Integration Report", "Architecture Spec"]
  }
});

const STAGE_PROMPT_KEYS = Object.freeze(Object.keys(STAGE_PROMPT_IMPORTS));


const LLM_SLOT_OPTIONS = Object.freeze([
  {
    id: "t1_reasoning",
    slot: "T1-Reasoning",
    tier: "Tier 1",
    description: "Strong reasoning for briefing, architecture, hard review, and merge analysis.",
    exampleLabel: "Example: ChatGPT o3 / o4"
  },
  {
    id: "t1_context",
    slot: "T1-Context",
    tier: "Tier 1",
    description: "Best when a lot of package or merge context must stay visible.",
    exampleLabel: "Example: Gemini 2.5 Pro"
  },
  {
    id: "t1_precision",
    slot: "T1-Precision",
    tier: "Tier 1",
    description: "High precision for difficult contract and edge-case checks.",
    exampleLabel: "Example: Claude Opus"
  },
  {
    id: "t2_structured",
    slot: "T2-Structured",
    tier: "Tier 2",
    description: "Strong instruction-following for structured implementation and review output.",
    exampleLabel: "Example: Claude Sonnet"
  },
  {
    id: "t2_fast",
    slot: "T2-Fast",
    tier: "Tier 2",
    description: "Fast and practical for standard package turns.",
    exampleLabel: "Example: GPT-4o-mini"
  },
  {
    id: "t2_bulk",
    slot: "T2-Bulk",
    tier: "Tier 2",
    description: "Useful when long package artifacts have to be moved cheaply.",
    exampleLabel: "Example: Gemini Flash"
  },
  {
    id: "t3_light",
    slot: "T3-Light",
    tier: "Tier 3",
    description: "Light helper tasks only.",
    exampleLabel: "Example: Claude Haiku"
  },
  {
    id: "t3_bulk",
    slot: "T3-Bulk",
    tier: "Tier 3",
    description: "Very simple bulk helper tasks only.",
    exampleLabel: "Example: Gemini Flash Lite"
  }
]);


const WORKFLOW_STATES = Object.freeze({
  WORKSPACE_NOT_SELECTED: "WORKSPACE_NOT_SELECTED",
  SETUP_INPUT_NEEDED: "SETUP_INPUT_NEEDED",
  STAGE1_PACKET_BUILD_READY: "STAGE1_PACKET_BUILD_READY",
  STAGE1_REQUEST_READY: "STAGE1_REQUEST_READY",
  STAGE1_WAITING_RETURN: "STAGE1_WAITING_RETURN",
  STAGE1_COMPLETED: "STAGE1_COMPLETED",
  STAGE2_WAITING_PREREQUISITE: "STAGE2_WAITING_PREREQUISITE",
  STAGE2_PACKET_BUILD_READY: "STAGE2_PACKET_BUILD_READY",
  STAGE2_REQUEST_READY: "STAGE2_REQUEST_READY",
  STAGE2_WAITING_RETURN: "STAGE2_WAITING_RETURN",
  STAGE2_BLOCKED_RETRY: "STAGE2_BLOCKED_RETRY",
  STAGE2_RETRY_REQUEST_READY: "STAGE2_RETRY_REQUEST_READY",
  STAGE2_RETRY_WAITING_RETURN: "STAGE2_RETRY_WAITING_RETURN",
  STAGE2_COMPLETED: "STAGE2_COMPLETED",
  STAGE3_WAITING_PREREQUISITE: "STAGE3_WAITING_PREREQUISITE",
  STAGE3_PACKET_BUILD_READY: "STAGE3_PACKET_BUILD_READY",
  STAGE3_REQUEST_READY: "STAGE3_REQUEST_READY",
  STAGE3_WAITING_RETURN: "STAGE3_WAITING_RETURN",
  STAGE3_COMPLETED_CLOSED: "STAGE3_COMPLETED_CLOSED",
  STAGE3_COMPLETED_PAUSE: "STAGE3_COMPLETED_PAUSE",
  STAGE3_DECISION_PACKET_BUILD_READY: "STAGE3_DECISION_PACKET_BUILD_READY",
  STAGE3_DECISION_REQUEST_READY: "STAGE3_DECISION_REQUEST_READY",
  STAGE3_DECISION_WAITING_RETURN: "STAGE3_DECISION_WAITING_RETURN",
  STAGE4_IMPLEMENTATION_PHASE_READY: "STAGE4_IMPLEMENTATION_PHASE_READY",
  STAGE4_PACKAGE_SELECTION_REQUIRED: "STAGE4_PACKAGE_SELECTION_REQUIRED",
  STAGE4_PACKAGE_REQUEST_BUILD_READY: "STAGE4_PACKAGE_REQUEST_BUILD_READY",
  STAGE4_PACKAGE_REQUEST_READY: "STAGE4_PACKAGE_REQUEST_READY",
  STAGE4_PACKAGE_WAITING_RETURN: "STAGE4_PACKAGE_WAITING_RETURN",
  STAGE4_PACKAGE_NEEDS_REVIEW: "STAGE4_PACKAGE_NEEDS_REVIEW",
  STAGE4_PACKAGE_REWORK_READY: "STAGE4_PACKAGE_REWORK_READY",
  STAGE5_REVIEW_REQUEST_BUILD_READY: "STAGE5_REVIEW_REQUEST_BUILD_READY",
  STAGE5_REVIEW_REQUEST_READY: "STAGE5_REVIEW_REQUEST_READY",
  STAGE5_REVIEW_WAITING_RETURN: "STAGE5_REVIEW_WAITING_RETURN",
  STAGE5_REVIEW_STALE: "STAGE5_REVIEW_STALE",
  STAGE5_PACKAGE_ACCEPTED: "STAGE5_PACKAGE_ACCEPTED",
  STAGE6_PREPARATION_BLOCKED: "STAGE6_PREPARATION_BLOCKED",
  STAGE6_CANDIDATES_AVAILABLE: "STAGE6_CANDIDATES_AVAILABLE",
  STAGE6_REQUEST_READY: "STAGE6_REQUEST_READY",
  STAGE6_WAITING_RETURN: "STAGE6_WAITING_RETURN",
  STAGE6_COMPLETED: "STAGE6_COMPLETED"
});

const WORKFLOW_META = Object.freeze({
  [WORKFLOW_STATES.WORKSPACE_NOT_SELECTED]: { stageLabel: "Workspace", stateLabel: "Workspace folder not selected", actionKey: "selectWorkspace" },
  [WORKFLOW_STATES.SETUP_INPUT_NEEDED]: { stageLabel: "Setup", stateLabel: "Select LLMs and confirm", actionKey: "setup" },
  [WORKFLOW_STATES.STAGE1_PACKET_BUILD_READY]: { stageLabel: "Stage 01", stateLabel: "Stage 01 packet can be built", actionKey: "prepareStage1" },
  [WORKFLOW_STATES.STAGE1_REQUEST_READY]: { stageLabel: "Stage 01", stateLabel: "Stage 01 request ready to copy", actionKey: "copyStage1", expectedReturn: "Final Master Briefing" },
  [WORKFLOW_STATES.STAGE1_WAITING_RETURN]: { stageLabel: "Stage 01", stateLabel: "Waiting for Stage 01 return", actionKey: "saveStage1", expectedReturn: "Final Master Briefing" },
  [WORKFLOW_STATES.STAGE1_COMPLETED]: { stageLabel: "Stage 01", stateLabel: "Stage 01 completed", actionKey: "prepareStage2" },
  [WORKFLOW_STATES.STAGE2_WAITING_PREREQUISITE]: { stageLabel: "Stage 02", stateLabel: "Stage 02 prerequisite missing", actionKey: "prepareStage1" },
  [WORKFLOW_STATES.STAGE2_PACKET_BUILD_READY]: { stageLabel: "Stage 02", stateLabel: "Stage 02 packet can be built", actionKey: "prepareStage2" },
  [WORKFLOW_STATES.STAGE2_REQUEST_READY]: { stageLabel: "Stage 02", stateLabel: "Stage 02 request ready to copy", actionKey: "copyStage2", expectedReturn: "Architecture Spec" },
  [WORKFLOW_STATES.STAGE2_WAITING_RETURN]: { stageLabel: "Stage 02", stateLabel: "Waiting for Stage 02 return", actionKey: "saveStage2", expectedReturn: "Architecture Spec" },
  [WORKFLOW_STATES.STAGE2_BLOCKED_RETRY]: { stageLabel: "Stage 02", stateLabel: "Architecture gate blocked", actionKey: "prepareStage2Retry" },
  [WORKFLOW_STATES.STAGE2_RETRY_REQUEST_READY]: { stageLabel: "Stage 02", stateLabel: "Stage 02 retry request ready to copy", actionKey: "copyStage2Retry", expectedReturn: "Revised Architecture Spec" },
  [WORKFLOW_STATES.STAGE2_RETRY_WAITING_RETURN]: { stageLabel: "Stage 02", stateLabel: "Waiting for revised Architecture Spec", actionKey: "saveStage2Retry", expectedReturn: "Revised Architecture Spec" },
  [WORKFLOW_STATES.STAGE2_COMPLETED]: { stageLabel: "Stage 02", stateLabel: "Stage 02 completed", actionKey: "prepareStage3" },
  [WORKFLOW_STATES.STAGE3_WAITING_PREREQUISITE]: { stageLabel: "Stage 03", stateLabel: "Stage 03 prerequisite missing", actionKey: "prepareStage2" },
  [WORKFLOW_STATES.STAGE3_PACKET_BUILD_READY]: { stageLabel: "Stage 03", stateLabel: "Stage 03 packet can be built", actionKey: "prepareStage3" },
  [WORKFLOW_STATES.STAGE3_REQUEST_READY]: { stageLabel: "Stage 03", stateLabel: "Stage 03 request ready to copy", actionKey: "copyStage3", expectedReturn: "Stage 03 orchestration result" },
  [WORKFLOW_STATES.STAGE3_WAITING_RETURN]: { stageLabel: "Stage 03", stateLabel: "Waiting for Stage 03 return", actionKey: "saveStage3", expectedReturn: "Stage 03 orchestration result" },
  [WORKFLOW_STATES.STAGE3_COMPLETED_CLOSED]: { stageLabel: "Stage 03", stateLabel: "Stage 03 completed with CLOSED", actionKey: "choosePackage" },
  [WORKFLOW_STATES.STAGE3_COMPLETED_PAUSE]: { stageLabel: "Stage 03 pause", stateLabel: "Stage 03 completed with PAUSE_FOR_DECISIONS", actionKey: "preparePauseResponse" },
  [WORKFLOW_STATES.STAGE3_DECISION_PACKET_BUILD_READY]: { stageLabel: "Stage 03 pause", stateLabel: "Pause answers can be packed", actionKey: "preparePauseResponse" },
  [WORKFLOW_STATES.STAGE3_DECISION_REQUEST_READY]: { stageLabel: "Stage 03 pause", stateLabel: "Decision-response packet ready to copy", actionKey: "copyPauseResponse", expectedReturn: "Updated authoritative result" },
  [WORKFLOW_STATES.STAGE3_DECISION_WAITING_RETURN]: { stageLabel: "Stage 03 pause", stateLabel: "Waiting for updated result after pause decision", actionKey: "savePauseResult", expectedReturn: "Updated authoritative result" },
  [WORKFLOW_STATES.STAGE4_IMPLEMENTATION_PHASE_READY]: { stageLabel: "Stage 04", stateLabel: "Implementation phase ready", actionKey: "choosePackage" },
  [WORKFLOW_STATES.STAGE4_PACKAGE_SELECTION_REQUIRED]: { stageLabel: "Stage 04", stateLabel: "Package selection required", actionKey: "choosePackage" },
  [WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_BUILD_READY]: { stageLabel: "Stage 04", stateLabel: "Package ready for Stage 04 request", actionKey: "prepareStage4" },
  [WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_READY]: { stageLabel: "Stage 04", stateLabel: "Stage 04 request ready to copy", actionKey: "copyStage4", expectedReturn: "Implementation output for the current package" },
  [WORKFLOW_STATES.STAGE4_PACKAGE_WAITING_RETURN]: { stageLabel: "Stage 04", stateLabel: "Waiting for Stage 04 return", actionKey: "saveStage4", expectedReturn: "Implementation output for the current package" },
  [WORKFLOW_STATES.STAGE4_PACKAGE_NEEDS_REVIEW]: { stageLabel: "Stage 04", stateLabel: "Package now needs review", actionKey: "prepareStage5" },
  [WORKFLOW_STATES.STAGE4_PACKAGE_REWORK_READY]: { stageLabel: "Stage 04", stateLabel: "Package is in the rework loop", actionKey: "prepareStage4Rework" },
  [WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_BUILD_READY]: { stageLabel: "Stage 05", stateLabel: "Package ready for review request", actionKey: "prepareStage5" },
  [WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_READY]: { stageLabel: "Stage 05", stateLabel: "Stage 05 request ready to copy", actionKey: "copyStage5", expectedReturn: "Review report for the current package" },
  [WORKFLOW_STATES.STAGE5_REVIEW_WAITING_RETURN]: { stageLabel: "Stage 05", stateLabel: "Waiting for Stage 05 return", actionKey: "saveStage5", expectedReturn: "Review report for the current package" },
  [WORKFLOW_STATES.STAGE5_REVIEW_STALE]: { stageLabel: "Stage 05", stateLabel: "Saved review is stale and does not match the current output", actionKey: "prepareStage5" },
  [WORKFLOW_STATES.STAGE5_PACKAGE_ACCEPTED]: { stageLabel: "Stage 05", stateLabel: "Package accepted for merge consideration", actionKey: "packageAccepted" },
  [WORKFLOW_STATES.STAGE6_PREPARATION_BLOCKED]: { stageLabel: "Stage 06", stateLabel: "Merge preparation not yet possible", actionKey: "choosePackage" },
  [WORKFLOW_STATES.STAGE6_CANDIDATES_AVAILABLE]: { stageLabel: "Stage 06", stateLabel: "Merge candidates available", actionKey: "choosePackage" },
  [WORKFLOW_STATES.STAGE6_REQUEST_READY]: { stageLabel: "Stage 06", stateLabel: "Stage 06 request ready to copy", actionKey: "copyStage6", expectedReturn: "Integration Report" },
  [WORKFLOW_STATES.STAGE6_WAITING_RETURN]: { stageLabel: "Stage 06", stateLabel: "Waiting for Stage 06 return", actionKey: "saveStage6", expectedReturn: "Integration Report" },
  [WORKFLOW_STATES.STAGE6_COMPLETED]: { stageLabel: "Stage 06", stateLabel: "Merge completed", actionKey: "mergeComplete" }
});

const WORKFLOW_TRANSITIONS = Object.freeze({
  [WORKFLOW_STATES.WORKSPACE_NOT_SELECTED]: ["SELECT_WORKSPACE_ROOT"],
  [WORKFLOW_STATES.SETUP_INPUT_NEEDED]: ["EDIT_PROJECT_CONTEXT", "SELECT_LLM_BASELINE", "PREPARE_STAGE1_REQUEST", "IMPORT_BACKUP", "REPLACE_PRIOR_ARTIFACT"],
  [WORKFLOW_STATES.STAGE1_PACKET_BUILD_READY]: ["PREPARE_STAGE1_REQUEST", "EDIT_PROJECT_CONTEXT", "REPLACE_PRIOR_ARTIFACT"],
  [WORKFLOW_STATES.STAGE1_REQUEST_READY]: ["COPY_STAGE1_REQUEST", "REBUILD_STAGE1_REQUEST", "RESET_STAGE1"],
  [WORKFLOW_STATES.STAGE1_WAITING_RETURN]: ["SAVE_STAGE1_RESULT", "REBUILD_STAGE1_REQUEST", "REPLACE_PRIOR_ARTIFACT"],
  [WORKFLOW_STATES.STAGE1_COMPLETED]: ["PREPARE_STAGE2_REQUEST", "REPLACE_PRIOR_ARTIFACT", "CLEAR_STAGE1"],
  [WORKFLOW_STATES.STAGE2_WAITING_PREREQUISITE]: ["SAVE_STAGE1_RESULT", "REPLACE_PRIOR_ARTIFACT"],
  [WORKFLOW_STATES.STAGE2_PACKET_BUILD_READY]: ["PREPARE_STAGE2_REQUEST", "CLEAR_STAGE2"],
  [WORKFLOW_STATES.STAGE2_REQUEST_READY]: ["COPY_STAGE2_REQUEST", "REBUILD_STAGE2_REQUEST", "CLEAR_STAGE2"],
  [WORKFLOW_STATES.STAGE2_WAITING_RETURN]: ["SAVE_STAGE2_RESULT", "REBUILD_STAGE2_REQUEST", "REPLACE_PRIOR_ARTIFACT"],
  [WORKFLOW_STATES.STAGE2_BLOCKED_RETRY]: ["PREPARE_STAGE2_RETRY", "CLEAR_STAGE2", "REPLACE_PRIOR_ARTIFACT"],
  [WORKFLOW_STATES.STAGE2_RETRY_REQUEST_READY]: ["COPY_STAGE2_RETRY", "REBUILD_STAGE2_RETRY", "CLEAR_STAGE2"],
  [WORKFLOW_STATES.STAGE2_RETRY_WAITING_RETURN]: ["SAVE_STAGE2_RETRY_RESULT", "REPLACE_PRIOR_ARTIFACT", "CLEAR_STAGE2"],
  [WORKFLOW_STATES.STAGE2_COMPLETED]: ["PREPARE_STAGE3_REQUEST", "CLEAR_STAGE2", "REPLACE_PRIOR_ARTIFACT"],
  [WORKFLOW_STATES.STAGE3_WAITING_PREREQUISITE]: ["SAVE_STAGE2_RESULT", "SAVE_STAGE2_RETRY_RESULT", "REPLACE_PRIOR_ARTIFACT"],
  [WORKFLOW_STATES.STAGE3_PACKET_BUILD_READY]: ["PREPARE_STAGE3_REQUEST", "CLEAR_STAGE3"],
  [WORKFLOW_STATES.STAGE3_REQUEST_READY]: ["COPY_STAGE3_REQUEST", "REBUILD_STAGE3_REQUEST", "CLEAR_STAGE3"],
  [WORKFLOW_STATES.STAGE3_WAITING_RETURN]: ["SAVE_STAGE3_RESULT", "REPLACE_PRIOR_ARTIFACT", "CLEAR_STAGE3"],
  [WORKFLOW_STATES.STAGE3_COMPLETED_CLOSED]: ["SELECT_PACKAGE", "PREPARE_STAGE4_REQUEST", "PREPARE_STAGE6_REQUEST", "CLEAR_STAGE3"],
  [WORKFLOW_STATES.STAGE3_COMPLETED_PAUSE]: ["PREPARE_PAUSE_RESPONSE", "REPLACE_PRIOR_ARTIFACT", "CLEAR_STAGE3"],
  [WORKFLOW_STATES.STAGE3_DECISION_PACKET_BUILD_READY]: ["PREPARE_PAUSE_RESPONSE", "EDIT_PAUSE_ANSWERS", "CLEAR_STAGE3"],
  [WORKFLOW_STATES.STAGE3_DECISION_REQUEST_READY]: ["COPY_PAUSE_RESPONSE", "REBUILD_PAUSE_RESPONSE", "CLEAR_STAGE3"],
  [WORKFLOW_STATES.STAGE3_DECISION_WAITING_RETURN]: ["SAVE_PAUSE_RESULT", "REPLACE_PRIOR_ARTIFACT", "CLEAR_STAGE3"],
  [WORKFLOW_STATES.STAGE4_IMPLEMENTATION_PHASE_READY]: ["SELECT_PACKAGE", "PREPARE_STAGE6_REQUEST", "CLEAR_STAGE4"],
  [WORKFLOW_STATES.STAGE4_PACKAGE_SELECTION_REQUIRED]: ["SELECT_PACKAGE", "PREPARE_STAGE6_REQUEST", "CLEAR_STAGE4"],
  [WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_BUILD_READY]: ["PREPARE_STAGE4_REQUEST", "SELECT_PACKAGE", "CLEAR_PACKAGE"],
  [WORKFLOW_STATES.STAGE4_PACKAGE_REQUEST_READY]: ["COPY_STAGE4_REQUEST", "REBUILD_STAGE4_REQUEST", "SELECT_PACKAGE", "CLEAR_PACKAGE"],
  [WORKFLOW_STATES.STAGE4_PACKAGE_WAITING_RETURN]: ["SAVE_STAGE4_RESULT", "SELECT_PACKAGE", "CLEAR_PACKAGE"],
  [WORKFLOW_STATES.STAGE4_PACKAGE_NEEDS_REVIEW]: ["PREPARE_STAGE5_REQUEST", "SELECT_PACKAGE", "CLEAR_PACKAGE"],
  [WORKFLOW_STATES.STAGE4_PACKAGE_REWORK_READY]: ["PREPARE_STAGE4_REWORK", "SELECT_PACKAGE", "CLEAR_PACKAGE"],
  [WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_BUILD_READY]: ["PREPARE_STAGE5_REQUEST", "SELECT_PACKAGE", "CLEAR_PACKAGE"],
  [WORKFLOW_STATES.STAGE5_REVIEW_REQUEST_READY]: ["COPY_STAGE5_REQUEST", "REBUILD_STAGE5_REQUEST", "SELECT_PACKAGE", "CLEAR_PACKAGE"],
  [WORKFLOW_STATES.STAGE5_REVIEW_WAITING_RETURN]: ["SAVE_STAGE5_RESULT", "SELECT_PACKAGE", "CLEAR_PACKAGE"],
  [WORKFLOW_STATES.STAGE5_REVIEW_STALE]: ["PREPARE_STAGE5_REQUEST", "SELECT_PACKAGE", "CLEAR_PACKAGE"],
  [WORKFLOW_STATES.STAGE5_PACKAGE_ACCEPTED]: ["SELECT_PACKAGE", "PREPARE_STAGE6_REQUEST", "CLEAR_PACKAGE"],
  [WORKFLOW_STATES.STAGE6_PREPARATION_BLOCKED]: ["SELECT_PACKAGE", "SAVE_STAGE5_RESULT", "SAVE_STAGE4_RESULT"],
  [WORKFLOW_STATES.STAGE6_CANDIDATES_AVAILABLE]: ["PREPARE_STAGE6_REQUEST", "SELECT_PACKAGE"],
  [WORKFLOW_STATES.STAGE6_REQUEST_READY]: ["COPY_STAGE6_REQUEST", "REBUILD_STAGE6_REQUEST", "CLEAR_STAGE6"],
  [WORKFLOW_STATES.STAGE6_WAITING_RETURN]: ["SAVE_STAGE6_RESULT", "CLEAR_STAGE6"],
  [WORKFLOW_STATES.STAGE6_COMPLETED]: ["DOWNLOAD_MERGE_RESULT", "CLEAR_STAGE6", "RESET_WORKSPACE"]
});


const REQUEST_DIVIDER = "================================================================";
const PACKAGE_SEPARATOR = "\n\n------------------------------------------------------------\n\n";
const MERGE_SEPARATOR = "\n\n============================================================\n\n";


const COPY_FAIL_MESSAGE = "Copy failed in this browser. Use the download button or manual copy.";


const PERSISTENCE_BACKEND = "fileSystem";


