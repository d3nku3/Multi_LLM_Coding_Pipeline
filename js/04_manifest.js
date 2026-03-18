// 04_manifest.js — Artifact manifest management, provenance reconciliation, and lineage helpers
// Pure state/manifest logic. No DOM. No direct I/O.

function ensureManifestStructure(targetState = state) {
  const merged = deepMerge(createDefaultManifest(), targetState.manifest || {});
  merged.slotHeads = deepMerge(createDefaultManifest().slotHeads, merged.slotHeads || {});
  merged.artifacts = merged.artifacts || {};
  Object.values(merged.artifacts).forEach(record => {
    record.relativePath = safeText(record.relativePath).trim();
    record.contentHash = safeText(record.contentHash).trim();
    record.promptSnapshotPath = safeText(record.promptSnapshotPath).trim();
  });
  merged.sessionId = merged.sessionId || createSessionId();
  merged.artifactCounter = Number(merged.artifactCounter || 0);
  targetState.manifest = merged;
  return merged;
}

function normalizeParentIds(ids) {
  return Array.from(new Set((ids || []).filter(Boolean)));
}

function sameIdSet(a, b) {
  const left = normalizeParentIds(a).sort();
  const right = normalizeParentIds(b).sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function manifestArtifactList(targetState = state) {
  ensureManifestStructure(targetState);
  return Object.values(targetState.manifest.artifacts || {});
}

function getManifestArtifact(artifactId, targetState = state) {
  if (!artifactId) return null;
  ensureManifestStructure(targetState);
  return targetState.manifest.artifacts[artifactId] || null;
}

function nextManifestArtifactId(targetState = state) {
  ensureManifestStructure(targetState);
  targetState.manifest.artifactCounter += 1;
  return `artifact_${String(targetState.manifest.artifactCounter).padStart(6, "0")}`;
}

function artifactTypeLabel(artifactType) {
  const map = {
    master_briefing: "Master Briefing",
    architecture_spec: "Architecture Spec",
    stage3_bundle: "Stage 03 bundle",
    master_orchestration: "Master Orchestration",
    execution_checklist: "Execution Checklist",
    pause_artifact: "Pause artifact",
    work_package: "Work Package",
    implementation_output: "Implementation output",
    implementation_file: "Implementation file",
    review_report: "Review report",
    merge_result: "Integration Report"
  };
  return map[artifactType] || artifactType.replace(/_/g, " ");
}

function artifactLogicalKeyFor(options) {
  if (options.logicalKey) return options.logicalKey;
  const packageKey = options.packageKey || "global";
  const map = {
    master_briefing: "stage1/master_briefing",
    architecture_spec: "stage2/architecture_spec",
    stage3_bundle: "stage3/bundle",
    master_orchestration: "stage3/master_orchestration",
    execution_checklist: "stage3/execution_checklist",
    pause_artifact: "stage3/pause_artifact",
    work_package: `stage3/work_package/${packageKey}`,
    implementation_output: `stage4/implementation_output/${packageKey}`,
    review_report: `stage5/review_report/${packageKey}`,
    merge_result: "stage6/merge_result"
  };
  return map[options.artifactType] || `${options.artifactType}/${packageKey}`;
}

function findArtifactByFingerprint(targetState, logicalKey, fingerprint, parentArtifactIds, filename = "") {
  return manifestArtifactList(targetState).find(item =>
    !item.supersededByArtifactId &&
    item.logicalKey === logicalKey &&
    item.fingerprint === fingerprint &&
    sameIdSet(item.parentArtifactIds, parentArtifactIds) &&
    (filename ? item.filename === filename : true)
  ) || null;
}

function createOrReuseArtifactRecord(targetState, options) {
  ensureManifestStructure(targetState);
  const text = safeText(options.text).trim();
  if (!text) return "";
  const parentArtifactIds = normalizeParentIds(options.parentArtifactIds);
  const logicalKey = artifactLogicalKeyFor(options);
  const fingerprint = textFingerprint(text);
  const existing = getManifestArtifact(options.currentArtifactId, targetState);

  if (
    existing &&
    existing.logicalKey === logicalKey &&
    existing.fingerprint === fingerprint &&
    sameIdSet(existing.parentArtifactIds, parentArtifactIds)
  ) {
    existing.filename = options.filename || existing.filename || "";
    existing.title = options.title || existing.title || artifactTypeLabel(existing.artifactType);
    existing.packageKey = options.packageKey || existing.packageKey || "";
    existing.packageId = options.packageId || existing.packageId || "";
    existing.sourceOrigin = existing.sourceOrigin || options.sourceOrigin || "manually pasted and saved";
    existing.consumedArtifactIds = normalizeParentIds(options.consumedArtifactIds || existing.consumedArtifactIds || parentArtifactIds);
    existing.attributes = { ...(existing.attributes || {}), ...(options.attributes || {}) };
    existing.relativePath = safeText(existing.relativePath).trim();
    existing.contentHash = safeText(existing.contentHash).trim();
    existing.promptSnapshotPath = safeText(existing.promptSnapshotPath).trim();
    return existing.artifactId;
  }

  const reused = findArtifactByFingerprint(targetState, logicalKey, fingerprint, parentArtifactIds, options.filename);
  if (reused) {
    reused.attributes = { ...(reused.attributes || {}), ...(options.attributes || {}) };
    reused.consumedArtifactIds = normalizeParentIds(options.consumedArtifactIds || reused.consumedArtifactIds || parentArtifactIds);
    reused.packageKey = options.packageKey || reused.packageKey || "";
    reused.packageId = options.packageId || reused.packageId || "";
    reused.filename = options.filename || reused.filename || "";
    reused.relativePath = safeText(reused.relativePath).trim();
    reused.contentHash = safeText(reused.contentHash).trim();
    reused.promptSnapshotPath = safeText(reused.promptSnapshotPath).trim();
    return reused.artifactId;
  }

  const previousHead = getManifestArtifact(options.previousHeadId, targetState);
  const revision = manifestArtifactList(targetState)
    .filter(item => item.logicalKey === logicalKey)
    .reduce((max, item) => Math.max(max, Number(item.revision || 0)), 0) + 1;

  const artifactId = nextManifestArtifactId(targetState);
  const record = {
    artifactId,
    artifactType: options.artifactType,
    logicalKey,
    title: options.title || artifactTypeLabel(options.artifactType),
    filename: options.filename || "",
    stageProduced: options.stageProduced || "",
    consumingStageContext: options.consumingStageContext || "",
    packageKey: options.packageKey || "",
    packageId: options.packageId || "",
    revision,
    fingerprint,
    createdAt: options.createdAt || nowStamp(),
    sourceOrigin: options.sourceOrigin || "manually pasted and saved",
    supersedesArtifactId: previousHead ? previousHead.artifactId : "",
    supersededByArtifactId: "",
    parentArtifactIds,
    consumedArtifactIds: normalizeParentIds(options.consumedArtifactIds || parentArtifactIds),
    status: "current",
    statusReason: "Current authoritative artifact.",
    lineageBranch: "active-run",
    contentLength: text.length,
    relativePath: "",
    contentHash: "",
    promptSnapshotPath: "",
    attributes: { ...(options.attributes || {}) }
  };

  if (previousHead && previousHead.artifactId !== artifactId) {
    previousHead.supersededByArtifactId = artifactId;
    previousHead.status = "superseded";
    previousHead.statusReason = `Superseded by ${record.title} r${record.revision}.`;
  }

  targetState.manifest.artifacts[artifactId] = record;
  return artifactId;
}

function currentHeadArtifactIds(targetState = state) {
  const ids = [
    targetState.stage1.currentArtifactId,
    targetState.stage2.currentArtifactId,
    targetState.stage3.bundleArtifactId,
    ...(targetState.stage3.artifacts || []).map(item => item.artifactId),
    targetState.stage6.mergeArtifactId
  ];

  Object.values(targetState.stage4.packages || {}).forEach(pkg => {
    ids.push(pkg.packageArtifactId, pkg.implementationArtifactId, pkg.reviewArtifactId);
  });

  return normalizeParentIds(ids);
}

function collectAncestorArtifactIds(seedIds, targetState = state) {
  const seen = new Set();
  const queue = [...normalizeParentIds(seedIds)];
  while (queue.length) {
    const artifactId = queue.shift();
    if (!artifactId || seen.has(artifactId)) continue;
    seen.add(artifactId);
    const record = getManifestArtifact(artifactId, targetState);
    if (!record) continue;
    normalizeParentIds(record.parentArtifactIds).forEach(parentId => {
      if (!seen.has(parentId)) queue.push(parentId);
    });
  }
  return seen;
}

function reconcileArtifactStatuses(targetState = state) {
  ensureManifestStructure(targetState);
  const currentHeads = new Set(currentHeadArtifactIds(targetState));
  const activeLineage = collectAncestorArtifactIds([...currentHeads], targetState);
  targetState.manifest.activeRunRootArtifactId = targetState.stage1.currentArtifactId || "";
  targetState.manifest.lastReconciledAt = nowStamp();

  manifestArtifactList(targetState).forEach(record => {
    let status = "reusable";
    let reason = "Saved artifact can still be inspected.";
    let lineageBranch = activeLineage.has(record.artifactId) ? "active-run" : "older-run";

    const missingParent = normalizeParentIds(record.parentArtifactIds).some(parentId => !getManifestArtifact(parentId, targetState));
    const isCurrentHead = currentHeads.has(record.artifactId);

    if (record.status === "missing_on_disk") {
      status = "missing_on_disk";
      reason = record.statusReason || "Artifact file is missing from the workspace.";
    } else if (missingParent) {
      status = "orphaned";
      reason = "One or more parent artifacts are missing from the manifest.";
      lineageBranch = "orphaned";
    } else if (record.supersededByArtifactId) {
      status = "superseded";
      reason = "A newer revision superseded this artifact.";
    } else if (record.artifactType === "review_report") {
      const boundOutput = getManifestArtifact(record.attributes?.boundArtifactId, targetState);
      const currentOutputId = record.packageKey ? targetState.stage4.packages?.[record.packageKey]?.implementationArtifactId : "";
      if (!boundOutput) {
        status = "blocked_from_reuse";
        reason = "This review could not be attached to an exact implementation output.";
      } else if (!currentOutputId) {
        status = "reusable";
        reason = "The reviewed implementation output is not currently loaded in the active package slot.";
      } else if (boundOutput.artifactId !== currentOutputId) {
        status = "stale";
        reason = "This review belongs to an older implementation output.";
      } else if (getManifestArtifact(currentOutputId, targetState)?.status !== "current") {
        status = "stale";
        reason = "The reviewed implementation output is no longer current.";
      } else if (isCurrentHead) {
        status = "current";
        reason = record.attributes?.reviewDisposition === "ACCEPT"
          ? "This review matches the current implementation output and accepts it."
          : record.attributes?.reviewDisposition === "REWORK"
          ? "This review matches the current implementation output and requires rework."
          : "This review matches the current implementation output.";
      }
    } else if (record.artifactType === "implementation_output") {
      const packageParentId = normalizeParentIds(record.parentArtifactIds).find(parentId => getManifestArtifact(parentId, targetState)?.artifactType === "work_package");
      const currentPackageId = record.packageKey ? targetState.stage4.packages?.[record.packageKey]?.packageArtifactId : "";
      if (!packageParentId) {
        status = "orphaned";
        reason = "This implementation output is not attached to a work package artifact.";
        lineageBranch = "orphaned";
      } else if (currentPackageId && packageParentId !== currentPackageId) {
        status = "stale";
        reason = "This implementation output was created from an older work package revision.";
      } else if (isCurrentHead) {
        status = "current";
        reason = "Current implementation output for this package.";
      } else if (!activeLineage.has(record.artifactId)) {
        status = "blocked_from_reuse";
        reason = "This implementation output belongs to an older run branch.";
      }
    } else if (record.artifactType === "merge_result") {
      const invalidParent = normalizeParentIds(record.parentArtifactIds).some(parentId => {
        const parent = getManifestArtifact(parentId, targetState);
        if (!parent) return true;
        if (parent.artifactType === "review_report") {
          return parent.status !== "current" || parent.attributes?.reviewDisposition !== "ACCEPT";
        }
        if (parent.artifactType === "implementation_output") {
          return parent.status !== "current";
        }
        return false;
      });
      if (invalidParent) {
        status = "stale";
        reason = "One or more consumed accepted pairs are no longer current.";
      } else if (isCurrentHead) {
        status = "current";
        reason = "Current merge result built from the active accepted pair set.";
      }
    } else if (record.artifactType === "implementation_file") {
      const packageParentId = normalizeParentIds(record.parentArtifactIds).find(parentId => getManifestArtifact(parentId, targetState)?.artifactType === "work_package");
      const currentPackageId = record.packageKey ? targetState.stage4.packages?.[record.packageKey]?.packageArtifactId : "";
      if (!packageParentId) {
        status = "orphaned";
        reason = "This imported implementation file is not attached to a work package artifact.";
        lineageBranch = "orphaned";
      } else if (currentPackageId && packageParentId !== currentPackageId) {
        status = "stale";
        reason = "This imported implementation file belongs to an older work package revision.";
      } else if (!record.supersededByArtifactId) {
        status = "current";
        reason = "Current imported implementation file for this package.";
      }
    } else if (isCurrentHead) {
      status = "current";
      reason = `Current authoritative ${artifactTypeLabel(record.artifactType).toLowerCase()}.`;
    } else if (!activeLineage.has(record.artifactId)) {
      status = "blocked_from_reuse";
      reason = "This artifact belongs to an older run branch.";
    }

    record.status = status;
    record.statusReason = reason;
    record.lineageBranch = lineageBranch;
  });
}

function inferArtifactOrigin(originMode, derived = false) {
  if (originMode === "restored from saved session") return "restored from saved session";
  return derived ? "generated as part of current run branch" : "manually pasted and saved";
}

function currentDependencyArtifactIds(pkg, targetState = state) {
  return normalizeParentIds((pkg.dependsOnIds || []).map(depId => {
    const depPkg = Object.values(targetState.stage4.packages || {}).find(item => item.packageId === depId);
    return depPkg?.implementationArtifactId || "";
  }));
}

function syncStage1Manifest(targetState, originMode) {
  const text = safeText(targetState.stage1.artifactText).trim();
  if (!text) {
    targetState.stage1.currentArtifactId = "";
    targetState.manifest.slotHeads.stage1Master = "";
    return;
  }
  const artifactId = createOrReuseArtifactRecord(targetState, {
    currentArtifactId: targetState.stage1.currentArtifactId,
    previousHeadId: targetState.manifest.slotHeads.stage1Master || targetState.stage1.currentArtifactId,
    artifactType: "master_briefing",
    stageProduced: "Stage 01",
    text,
    title: "Master Briefing",
    filename: "01_Master_Briefing.txt",
    sourceOrigin: inferArtifactOrigin(originMode, false)
  });
  targetState.stage1.currentArtifactId = artifactId;
  targetState.manifest.slotHeads.stage1Master = artifactId;
}

function syncStage2Manifest(targetState, originMode) {
  const text = safeText(targetState.stage2.artifactText).trim();
  if (!text) {
    targetState.stage2.currentArtifactId = "";
    targetState.manifest.slotHeads.stage2Architecture = "";
    return;
  }
  const artifactId = createOrReuseArtifactRecord(targetState, {
    currentArtifactId: targetState.stage2.currentArtifactId,
    previousHeadId: targetState.manifest.slotHeads.stage2Architecture || targetState.stage2.currentArtifactId,
    artifactType: "architecture_spec",
    stageProduced: "Stage 02",
    text,
    title: "Architecture Spec",
    filename: "02_Architecture_Spec.txt",
    parentArtifactIds: [targetState.stage1.currentArtifactId],
    sourceOrigin: inferArtifactOrigin(originMode, false)
  });
  targetState.stage2.currentArtifactId = artifactId;
  targetState.manifest.slotHeads.stage2Architecture = artifactId;
}

function stage3ArtifactType(kind) {
  if (kind === "master") return "master_orchestration";
  if (kind === "checklist") return "execution_checklist";
  if (kind === "pause") return "pause_artifact";
  if (kind === "package") return "work_package";
  return "stage3_bundle";
}

function syncStage3Manifest(targetState, originMode) {
  const bundleText = safeText(targetState.stage3.rawOutputText).trim();
  if (!bundleText) {
    targetState.stage3.bundleArtifactId = "";
    targetState.manifest.slotHeads.stage3Bundle = "";
    targetState.manifest.slotHeads.stage3Master = "";
    targetState.manifest.slotHeads.stage3Checklist = "";
    targetState.manifest.slotHeads.stage3Pause = "";
    targetState.manifest.slotHeads.packageContracts = {};
    (targetState.stage3.artifacts || []).forEach(item => { item.artifactId = ""; });
    return;
  }

  const bundleArtifactId = createOrReuseArtifactRecord(targetState, {
    currentArtifactId: targetState.stage3.bundleArtifactId,
    previousHeadId: targetState.manifest.slotHeads.stage3Bundle || targetState.stage3.bundleArtifactId,
    artifactType: "stage3_bundle",
    stageProduced: "Stage 03",
    text: bundleText,
    title: "Stage 03 bundle",
    filename: targetState.stage3.outcome === "pause" ? "03_Pause_For_Decisions.txt" : "03_Stage03_Output.txt",
    parentArtifactIds: [targetState.stage1.currentArtifactId, targetState.stage2.currentArtifactId],
    sourceOrigin: inferArtifactOrigin(originMode, false)
  });

  targetState.stage3.bundleArtifactId = bundleArtifactId;
  targetState.manifest.slotHeads.stage3Bundle = bundleArtifactId;
  targetState.manifest.slotHeads.stage3Master = "";
  targetState.manifest.slotHeads.stage3Checklist = "";
  targetState.manifest.slotHeads.stage3Pause = "";
  targetState.manifest.slotHeads.packageContracts = {};

  (targetState.stage3.artifacts || []).forEach(item => {
    const artifactType = stage3ArtifactType(item.kind);
    const meta = parsePackageMeta(item.filename, item.content);
    const previousHeadId =
      artifactType === "master_orchestration" ? targetState.manifest.slotHeads.stage3Master :
      artifactType === "execution_checklist" ? targetState.manifest.slotHeads.stage3Checklist :
      artifactType === "pause_artifact" ? targetState.manifest.slotHeads.stage3Pause :
      artifactType === "work_package" ? targetState.manifest.slotHeads.packageContracts[item.filename] :
      item.artifactId;

    const artifactId = createOrReuseArtifactRecord(targetState, {
      currentArtifactId: item.artifactId,
      previousHeadId,
      artifactType,
      stageProduced: "Stage 03",
      text: item.content,
      title: artifactType === "work_package" ? (meta.packageId ? `Work Package ${meta.packageId}` : "Work Package") : artifactTypeLabel(artifactType),
      filename: item.filename,
      packageKey: artifactType === "work_package" ? item.filename : "",
      packageId: artifactType === "work_package" ? meta.packageId : "",
      parentArtifactIds: [bundleArtifactId],
      sourceOrigin: inferArtifactOrigin(originMode, true)
    });

    item.artifactId = artifactId;

    if (artifactType === "master_orchestration") targetState.manifest.slotHeads.stage3Master = artifactId;
    if (artifactType === "execution_checklist") targetState.manifest.slotHeads.stage3Checklist = artifactId;
    if (artifactType === "pause_artifact") targetState.manifest.slotHeads.stage3Pause = artifactId;
    if (artifactType === "work_package") targetState.manifest.slotHeads.packageContracts[item.filename] = artifactId;
  });
}

function syncStage4PackageManifest(pkg, targetState, originMode) {
  pkg.packageArtifactId = targetState.manifest.slotHeads.packageContracts[pkg.key] || pkg.packageArtifactId || "";

  const implementationText = safeText(pkg.implementationOutputText).trim();
  if (!implementationText) {
    pkg.implementationArtifactId = "";
    targetState.manifest.slotHeads.packageImplementation[pkg.key] = "";
  } else {
    const implementationParents = [pkg.packageArtifactId, ...currentDependencyArtifactIds(pkg, targetState)];
    const implementationArtifactId = createOrReuseArtifactRecord(targetState, {
      currentArtifactId: pkg.implementationArtifactId,
      previousHeadId: targetState.manifest.slotHeads.packageImplementation[pkg.key] || pkg.implementationArtifactId,
      artifactType: "implementation_output",
      stageProduced: "Stage 04",
      text: implementationText,
      title: pkg.packageId ? `Implementation output ${pkg.packageId}` : "Implementation output",
      filename: `${pkg.filename.replace(/\.txt$/i, "")}_Stage04_Output.txt`,
      packageKey: pkg.key,
      packageId: pkg.packageId,
      parentArtifactIds: implementationParents,
      consumingStageContext: "Current implementation output saved for review and merge evaluation.",
      sourceOrigin: inferArtifactOrigin(originMode, false),
      attributes: {
        implementationStatus: pkg.implementationStatus || parseImplementationStatus(implementationText)
      }
    });
    pkg.implementationArtifactId = implementationArtifactId;
    targetState.manifest.slotHeads.packageImplementation[pkg.key] = implementationArtifactId;
  }

  const reviewText = safeText(pkg.reviewOutputText).trim();
  if (!reviewText) {
    pkg.reviewArtifactId = "";
    targetState.manifest.slotHeads.packageReviews[pkg.key] = "";
  } else {
    const bindingFingerprint = parseReviewBoundFingerprint(reviewText);
    const boundOutput = manifestArtifactList(targetState)
      .filter(item => item.artifactType === "implementation_output" && item.packageKey === pkg.key)
      .sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0))
      .find(item => item.fingerprint === bindingFingerprint) || null;
    const reviewArtifactId = createOrReuseArtifactRecord(targetState, {
      currentArtifactId: pkg.reviewArtifactId,
      previousHeadId: targetState.manifest.slotHeads.packageReviews[pkg.key] || pkg.reviewArtifactId,
      artifactType: "review_report",
      stageProduced: "Stage 05",
      text: reviewText,
      title: pkg.packageId ? `Review report ${pkg.packageId}` : "Review report",
      filename: `${pkg.filename.replace(/\.txt$/i, "")}_Stage05_Review.txt`,
      packageKey: pkg.key,
      packageId: pkg.packageId,
      parentArtifactIds: normalizeParentIds([pkg.packageArtifactId, boundOutput?.artifactId || ""]),
      consumingStageContext: "Review bound to one exact implementation output.",
      sourceOrigin: inferArtifactOrigin(originMode, false),
      attributes: {
        bindingFingerprint,
        boundArtifactId: boundOutput?.artifactId || "",
        reviewDisposition: parseReviewDisposition(reviewText),
        reviewVerdict: parseReviewVerdict(reviewText),
        reviewHasMergeBlockingFindings: parseReviewHasMergeBlockingFindings(reviewText)
      }
    });
    pkg.reviewArtifactId = reviewArtifactId;
    targetState.manifest.slotHeads.packageReviews[pkg.key] = reviewArtifactId;
  }
}

function syncStage6Manifest(targetState, originMode) {
  const mergeText = safeText(targetState.stage6.mergeResultText).trim();
  if (!mergeText) {
    targetState.stage6.mergeArtifactId = "";
    targetState.manifest.slotHeads.stage6Merge = "";
    return;
  }

  const consumed = [];
  (targetState.stage6.includedPackageKeys || []).forEach(key => {
    const pkg = targetState.stage4.packages[key];
    if (!pkg) return;
    if (pkg.implementationArtifactId) consumed.push(pkg.implementationArtifactId);
    if (pkg.reviewArtifactId) consumed.push(pkg.reviewArtifactId);
  });

  const mergeArtifactId = createOrReuseArtifactRecord(targetState, {
    currentArtifactId: targetState.stage6.mergeArtifactId,
    previousHeadId: targetState.manifest.slotHeads.stage6Merge || targetState.stage6.mergeArtifactId,
    artifactType: "merge_result",
    stageProduced: "Stage 06",
    text: mergeText,
    title: "Integration Report",
    filename: "06_Integration_Report.txt",
    parentArtifactIds: normalizeParentIds([targetState.stage2.currentArtifactId, ...consumed]),
    consumingStageContext: "Integration Report derived from the accepted pair set.",
    sourceOrigin: inferArtifactOrigin(originMode, false),
    attributes: {
      mergeVerdict: parseMergeVerdict(mergeText),
      includedPackageKeys: [...(targetState.stage6.includedPackageKeys || [])]
    }
  });

  targetState.stage6.mergeArtifactId = mergeArtifactId;
  targetState.manifest.slotHeads.stage6Merge = mergeArtifactId;
}

function getCurrentPackageContractArtifact(pkg, targetState = state) {
  return getManifestArtifact(pkg?.packageArtifactId, targetState);
}

function getCurrentImplementationArtifact(pkg, targetState = state) {
  return getManifestArtifact(pkg?.implementationArtifactId, targetState);
}

function getCurrentReviewArtifact(pkg, targetState = state) {
  return getManifestArtifact(pkg?.reviewArtifactId, targetState);
}

function isCurrentReviewUsableForPackage(pkg, targetState = state) {
  if (!pkg) return false;
  const implementationArtifact = getCurrentImplementationArtifact(pkg, targetState);
  const reviewArtifact = getCurrentReviewArtifact(pkg, targetState);
  if (!implementationArtifact || !reviewArtifact) return false;
  if ((reviewArtifact.attributes?.boundArtifactId || "") !== implementationArtifact.artifactId) return false;
  return reviewArtifact.status === "current" && implementationArtifact.status === "current";
}

function syncPackageDerivedFieldsFromManifest(targetState = state) {
  Object.values(targetState.stage4.packages || {}).forEach(pkg => {
    const packageArtifact = getManifestArtifact(pkg.packageArtifactId, targetState);
    const implementationArtifact = getManifestArtifact(pkg.implementationArtifactId, targetState);
    const reviewArtifact = getManifestArtifact(pkg.reviewArtifactId, targetState);

    if (packageArtifact) {
      pkg.packageFingerprint = packageArtifact.fingerprint;
    }

    if (implementationArtifact) {
      pkg.implementationOutputFingerprint = implementationArtifact.fingerprint;
      pkg.implementationStatus = implementationArtifact.attributes?.implementationStatus || pkg.implementationStatus || "";
    } else if (pkg.implementationOutputText.trim()) {
      pkg.implementationOutputFingerprint = pkg.implementationOutputFingerprint || textFingerprint(pkg.implementationOutputText);
      pkg.implementationStatus = pkg.implementationStatus || parseImplementationStatus(pkg.implementationOutputText);
    } else {
      pkg.implementationOutputFingerprint = "";
      pkg.implementationStatus = "";
    }

    if (reviewArtifact) {
      pkg.reviewBoundFingerprint = reviewArtifact.attributes?.bindingFingerprint || "";
      pkg.reviewDisposition = reviewArtifact.attributes?.reviewDisposition || "";
      pkg.reviewVerdict = reviewArtifact.attributes?.reviewVerdict || "";
      pkg.reviewHasMergeBlockingFindings = Boolean(reviewArtifact.attributes?.reviewHasMergeBlockingFindings);
    } else if (pkg.reviewOutputText.trim()) {
      pkg.reviewBoundFingerprint = pkg.reviewBoundFingerprint || parseReviewBoundFingerprint(pkg.reviewOutputText);
      pkg.reviewDisposition = pkg.reviewDisposition || parseReviewDisposition(pkg.reviewOutputText);
      pkg.reviewVerdict = pkg.reviewVerdict || parseReviewVerdict(pkg.reviewOutputText);
      pkg.reviewHasMergeBlockingFindings = parseReviewHasMergeBlockingFindings(pkg.reviewOutputText);
    } else {
      pkg.reviewBoundFingerprint = "";
      pkg.reviewDisposition = "";
      pkg.reviewVerdict = "";
      pkg.reviewHasMergeBlockingFindings = false;
    }

    pkg.reviewUsable = isCurrentReviewUsableForPackage(pkg, targetState);
  });

  const mergeArtifact = getManifestArtifact(targetState.stage6.mergeArtifactId, targetState);
  if (mergeArtifact) {
    targetState.stage6.mergeVerdict = mergeArtifact.attributes?.mergeVerdict || targetState.stage6.mergeVerdict || "";
  }
}

function reconcileWorkspaceManifest(targetState = state, originMode = "manually pasted and saved") {
  ensureManifestStructure(targetState);
  syncStage1Manifest(targetState, originMode);
  syncStage2Manifest(targetState, originMode);
  syncStage3Manifest(targetState, originMode);

  Object.values(targetState.stage4.packages || {}).forEach(pkg => {
    syncStage4PackageManifest(pkg, targetState, originMode);
  });

  syncStage6Manifest(targetState, originMode);
  reconcileArtifactStatuses(targetState);
  syncPackageDerivedFieldsFromManifest(targetState);
}

function ensureProvenanceReconciled(originMode = "restored from saved session") {
  reconcileWorkspaceManifest(state, originMode);
}

function manifestStatusCounts(targetState = state) {
  const counts = {
    current: 0,
    superseded: 0,
    stale: 0,
    reusable: 0,
    blocked_from_reuse: 0,
    orphaned: 0
  };
  manifestArtifactList(targetState).forEach(item => {
    if (counts[item.status] == null) counts[item.status] = 0;
    counts[item.status] += 1;
  });
  return counts;
}

function currentAuthoritativeArtifacts(targetState = state) {
  return currentHeadArtifactIds(targetState)
    .map(artifactId => getManifestArtifact(artifactId, targetState))
    .filter(Boolean)
    .filter(item => item.status === "current");
}

function artifactStatusLabel(value) {
  switch (safeText(value)) {
    case "missing_on_disk": return "Missing on disk";
    default: {
      const label = safeText(value).replace(/_/g, " ");
      return label ? label.charAt(0).toUpperCase() + label.slice(1) : "Unknown";
    }
  }
}
