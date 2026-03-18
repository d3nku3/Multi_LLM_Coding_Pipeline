// 09_init.js — Application startup
// Performs initial workspace restore, first render, and event binding.

async function initApp() {
  if (!FSAPI_SUPPORTED) {
    renderUnsupportedBrowserBlock();
    return;
  }

  const handleRestored = await tryRestoreWorkspaceHandle();

  if (handleRestored === true) {
    const loaded = await loadPersistedWorkspaceState();
    if (loaded.found && loaded.state) {
      Object.assign(state, createDefaultState(), loaded.state);
      runtimeStatus._showResumeSummary = true;
      setPersistenceStatus(
        `Workspace loaded from "${workspaceRootHandle.name}" (${formatBytes(loaded.bytes)})`,
        "success"
      );
      await appendAuditEntry(buildAuditEntry("WORKSPACE_LOADED", {
        message: `Resumed workspace from ${workspaceRootHandle.name}`,
        outcome: "success"
      }));

      // Warn about missing files
      const integrity = await checkWorkspaceIntegrity(state);
      if (!integrity.ok) {
        const names = integrity.missing.map(m => m.title).join(", ");
        await persistManifest(state.manifest);
        setWorkspaceStatus(
          `Warning: ${integrity.missing.length} artifact file(s) missing on disk: ${names}. These artifacts are marked as missing in the manifest.`,
          "warn"
        );
      }
    } else {
      if (hasLegacyLocalStorageData() && confirm("Found saved workspace data from a previous console version. Import it into this workspace?")) {
        const migrated = await migrateLegacyLocalStorage();
        setPersistenceStatus(
          migrated
            ? `Legacy workspace migrated to "${workspaceRootHandle.name}"`
            : `Migration failed — starting fresh in "${workspaceRootHandle.name}"`,
          migrated ? "success" : "warn"
        );
      } else {
        setPersistenceStatus(
          `Workspace folder "${workspaceRootHandle.name}" opened — no saved state found`,
          ""
        );
      }
    }
  } else if (handleRestored === "pending") {
    setPersistenceStatus(`Previous workspace found — click "Reconnect" to resume`, "warn");
  } else {
    setPersistenceStatus("Select a workspace folder to begin", "");
  }

  await syncWorkflowState("", { persist: false });
  render();
  bindEvents();

  // Auto-load prompts from cached prompt folder (independent of workspace)
  tryAutoLoadSiblingPromptFiles().catch(error => console.error("Prompt auto-load failed", error));
  renderWorkspaceIndicator();
}

initApp().catch(error => {
  console.error("Application initialization failed", error);
  setWorkspaceStatus("The console could not be initialized safely.", "danger");
  render();
});
