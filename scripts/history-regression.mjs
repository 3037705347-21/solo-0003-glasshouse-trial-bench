import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

async function loadHistoryModules() {
  const directory = await mkdtemp(join(tmpdir(), "glasshouse-history-"));
  try {
    const entry = join(directory, "entry.ts");
    await writeFile(
      entry,
      `
        export * from ${JSON.stringify(join(process.cwd(), "src/state/history.ts"))};
        export * from ${JSON.stringify(join(process.cwd(), "src/state/rootReducer.ts"))};
        export * from ${JSON.stringify(join(process.cwd(), "src/state/sampleData.ts"))};
        export * from ${JSON.stringify(join(process.cwd(), "src/domain/clearance.ts"))};
      `,
    );
    await build({
      configFile: false,
      logLevel: "silent",
      build: {
        lib: { entry, formats: ["es"], fileName: () => "history.mjs" },
        outDir: directory,
        emptyOutDir: false,
        write: true,
      },
    });
    return await import(pathToFileURL(join(directory, "history.mjs")).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function commit(modules, root, command) {
  const envelope = modules.createEnvelope(command, root.workspace);
  return modules.rootReducer(
    root,
    {
      type: "workspace/command",
      envelopeId: envelope.id,
      at: envelope.at,
      label: envelope.label,
      reversible: envelope.reversible,
      command,
    },
  );
}

function undoTop(modules, root) {
  const id = root.history.undoStack[root.history.undoStack.length - 1];
  return modules.rootReducer(
    root,
    { type: "history/undo", envelopeId: id },
  );
}

function makeReadyClearance(modules, workspace, trialId) {
  const readyWorkspace = {
    ...workspace,
    trials: workspace.trials.map((trial) =>
      trial.id === trialId ? { ...trial, state: "active" } : trial,
    ),
    flags: workspace.flags.map((flag) =>
      flag.trialId === trialId
        ? {
            ...flag,
            state: "resolved",
            resolvedOn: "2026-09-14T09:00:00.000Z",
            resolutionNote: "复测确认异常指标已恢复。",
          }
        : flag,
    ),
    benches: workspace.benches.map((bench) =>
      bench.status === "blocked" || bench.status === "quarantine"
        ? { ...bench, status: "available", blockedReason: undefined }
        : bench,
    ),
  };
  let snapshot = modules.buildClearanceSnapshot(readyWorkspace, trialId);
  assert.equal(snapshot.status, "blocked");
  const assignmentEntries = snapshot.blockers
    .filter((blocker) => blocker.code === "UNASSIGNED")
    .map((blocker) => blocker.accessionId);
  let nextWorkspace = readyWorkspace;
  for (const accessionId of assignmentEntries) {
    const accession = nextWorkspace.accessions.find(
      (item) => item.id === accessionId,
    );
    const bench = nextWorkspace.benches.find(
      (item) =>
        item.status === "available" &&
        item.assignedIds.length < item.capacity &&
        (item.lightProfile === accession.preferredLight ||
          (item.lightProfile === "full-sun" &&
            accession.preferredLight === "partial-shade")),
    );
    assert.ok(bench, `expected an available bench for ${accessionId}`);
    nextWorkspace = {
      ...nextWorkspace,
      benches: nextWorkspace.benches.map((item) =>
        item.id === bench.id
          ? {
              ...item,
              assignedIds: [...item.assignedIds, accessionId],
              status: "assigned",
            }
          : item,
      ),
    };
  }
  snapshot = modules.buildClearanceSnapshot(nextWorkspace, trialId);
  assert.equal(snapshot.status, "ready", JSON.stringify(snapshot.blockers));
  return { snapshot, workspace: nextWorkspace };
}

async function main() {
  const modules = await loadHistoryModules();
  const sample = modules.createSampleWorkspaceState();
  const trialId = "trial-sol-01";
  const ready = makeReadyClearance(modules, sample, trialId);

  let root = {
    workspace: ready.workspace,
    history: modules.emptyHistory,
  };

  // Clear the trial. The clearance snapshot itself stays immutable in business
  // state; only the trial transition is reversible.
  root = commit(modules, root, {
    type: "clearance/generated",
    snapshot: ready.snapshot,
    fromState: "active",
    cleared: true,
  });
  const clearId = root.history.undoStack[root.history.undoStack.length - 1];
  assert.equal(
    root.workspace.trials.find((trial) => trial.id === trialId).state,
    "cleared",
  );
  assert.deepEqual(root.history.undoStack, [clearId]);

  // Command X after clearance: reopen the pre-existing resolved flag. It is a
  // reversible flag transition on the same trial.
  const flagBefore = root.workspace.flags.find(
    (flag) => flag.trialId === trialId,
  );
  assert.ok(flagBefore);
  const flagAfter = {
    ...flagBefore,
    state: "open",
    resolvedOn: undefined,
    resolutionNote: undefined,
  };
  root = commit(modules, root, {
    type: "flag/transitioned",
    before: flagBefore,
    after: flagAfter,
  });
  const xId = root.history.undoStack[root.history.undoStack.length - 1];
  assert.deepEqual(root.history.undoStack, [clearId, xId]);
  assert.equal(
    root.workspace.flags.find((flag) => flag.id === flagBefore.id).state,
    "open",
  );

  // Undo X. The clearance becomes the current undo stack top.
  root = undoTop(modules, root);
  assert.equal(root.lastError, undefined);
  assert.deepEqual(root.history.undoStack, [clearId]);
  assert.deepEqual(root.history.redoStack, [xId]);
  assert.equal(
    root.history.entries.find((entry) => entry.id === xId).status,
    "undone",
  );

  // Choose a new branch Y with a same-trial bench release. X's redo branch is
  // now discarded even though its entry remains in the append-only audit log.
  root = commit(modules, root, {
    type: "bench/released",
    accessionId: "acc-tom-02",
    benchId: "bench-east-1",
  });
  const yId = root.history.undoStack[root.history.undoStack.length - 1];
  assert.deepEqual(root.history.undoStack, [clearId, yId]);
  assert.deepEqual(root.history.redoStack, []);
  assert.equal(
    root.history.entries.find((entry) => entry.id === xId).status,
    "discarded",
  );
  assert.equal(
    root.history.entries.find((entry) => entry.id === clearId).status,
    "active",
  );

  // Undo Y. The clearance again becomes the current undo stack top.
  root = undoTop(modules, root);
  assert.equal(root.lastError, undefined);
  assert.deepEqual(root.history.undoStack, [clearId]);
  assert.deepEqual(root.history.redoStack, [yId]);
  assert.equal(
    root.history.entries.find((entry) => entry.id === yId).status,
    "undone",
  );

  // Undo the earlier clearance. The discarded X entry must not be treated as a
  // later currently-effective dependency merely because it is later in the
  // append-only audit log.
  const beforeClearanceUndo = root;
  root = undoTop(modules, root);
  assert.equal(root.lastError, undefined);
  assert.equal(
    root.workspace.trials.find((trial) => trial.id === trialId).state,
    "active",
  );
  assert.deepEqual(root.history.undoStack, []);
  assert.deepEqual(root.history.redoStack, [yId, clearId]);
  assert.equal(
    root.history.entries.find((entry) => entry.id === clearId).status,
    "undone",
  );
  assert.equal(
    root.history.entries.find((entry) => entry.id === xId).status,
    "discarded",
  );
  // The immutable snapshot remains business history even though its command is
  // no longer effective.
  assert.ok(
    root.workspace.clearanceSnapshots.some(
      (snapshot) => snapshot.id === ready.snapshot.id,
    ),
  );

  // Stack-order failures must be atomic: Y is on the redo stack, not the undo
  // the undo stack.
  const wrongOrder = modules.rootReducer(root, {
    type: "history/undo",
    envelopeId: yId,
  });
  assert.match(wrongOrder.lastError, /只能按顺序/);
  assert.equal(wrongOrder.workspace, root.workspace);
  assert.equal(wrongOrder.history, root.history);

  // Semantic failures must be equally atomic. The top redo is the clearance.
  // Delete the trial it transitions through a concurrent non-logged change; the
  // action passes stack-order validation and then fails the semantic guard.
  // Neither business state nor either stack may change.
  const semanticFailureState = {
    ...root,
    workspace: {
      ...root.workspace,
      trials: root.workspace.trials.filter(
        (trial) => trial.id !== trialId,
      ),
    },
  };
  const semanticFailure = modules.rootReducer(semanticFailureState, {
    type: "history/redo",
    envelopeId: clearId,
  });
  assert.match(semanticFailure.lastError, /试验/);
  assert.notEqual(semanticFailure, semanticFailureState);
  assert.equal(
    semanticFailure.workspace,
    semanticFailureState.workspace,
  );
  assert.equal(semanticFailure.history, semanticFailureState.history);
  assert.deepEqual(
    semanticFailure.history.undoStack,
    semanticFailureState.history.undoStack,
  );
  assert.deepEqual(
    semanticFailure.history.redoStack,
    semanticFailureState.history.redoStack,
  );
  assert.equal(
    semanticFailure.history.entries.find((entry) => entry.id === clearId)
      .status,
    "undone",
  );

  // Sanity: the preceding failed redo did not advance state in the normal root.
  assert.notEqual(root, beforeClearanceUndo);

  console.log("✅ history branch regression");
}

main().catch((error) => {
  console.error("❌ history branch regression");
  console.error(error);
  process.exitCode = 1;
});
