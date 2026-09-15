import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = `${process.cwd()}/.verify-tmp/`;
const { createSampleWorkspaceState } = require(root + "state/sampleData.js");
const {
  requestBenchMaintenance,
  relocateForMaintenance,
  startBenchMaintenance,
  completeBenchMaintenance,
  cancelBenchMaintenance,
} = require(root + "domain/benchMaintenance.js");
const { assignAccession, releaseAccession } = require(root + "domain/bench.js");
const { buildClearanceSnapshot } = require(root + "domain/clearance.js");

let failures = 0;
function check(label, condition) {
  if (!condition) {
    failures += 1;
    console.error("FAIL:", label);
  } else {
    console.log("PASS:", label);
  }
}

let state = createSampleWorkspaceState();
const findBench = (id) => state.benches.find((b) => b.id === id);
const findAcc = (id) => state.accessions.find((a) => a.id === id);
const setBench = (bench) => {
  state = { ...state, benches: state.benches.map((b) => (b.id === bench.id ? bench : b)) };
};
const relocate = (fromId, accId, toId, note) => {
  const r = relocateForMaintenance(state, fromId, accId, toId, note);
  if (!r.ok) throw new Error("relocate failed: " + r.errors[0].message);
  state = {
    ...state,
    benches: state.benches.map((b) =>
      b.id === r.value.sourceBench.id
        ? r.value.sourceBench
        : b.id === r.value.targetBench.id
          ? r.value.targetBench
          : b,
    ),
  };
  return r.value;
};

// 1. 申请维护校验
let res = requestBenchMaintenance(findBench("bench-east-1"), {
  requestedAt: "2026-09-15T10:00",
  reason: "x",
});
check("short reason rejected", !res.ok);

res = requestBenchMaintenance(findBench("bench-north-2"), {
  requestedAt: "2026-09-15T10:00",
  reason: "维护受限台架测试原因",
});
check("blocked bench cannot request maintenance", !res.ok);

// 2. 正常申请
res = requestBenchMaintenance(findBench("bench-east-1"), {
  requestedAt: "2026-09-15T10:00",
  reason: "滴灌接头漏水检修",
});
check("request ok", res.ok);
setBench(res.value);
check("pending status", findBench("bench-east-1").status === "maintenance-pending");
check(
  "previousStatus captured",
  findBench("bench-east-1").maintenanceHistory[0].previousStatus === "assigned",
);

// 3. 过渡态冻结新分配与无去处移出
check("new assignment frozen while pending", !assignAccession(findAcc("acc-tom-03"), findBench("bench-east-1")).ok);
check("plain release frozen while pending", !releaseAccession("acc-tom-01", findBench("bench-east-1")).ok);
check("relocate to self rejected", !relocateForMaintenance(state, "bench-east-1", "acc-tom-01", "bench-east-1", "").ok);
check("relocate light mismatch rejected", !relocateForMaintenance(state, "bench-east-1", "acc-tom-01", "bench-north-1", "").ok);

// 4. 迁移 ACC-0001 → E-2
const rel1 = relocate("bench-east-1", "acc-tom-01", "bench-east-2", "先转移靠走道的穴盘");
check("relocation recorded", rel1.record.toBenchId === "bench-east-2");
check("relocation appended", findBench("bench-east-1").maintenanceHistory[0].relocations.length === 1);
check("source loses accession", !findBench("bench-east-1").assignedIds.includes("acc-tom-01"));
check("target gains accession", findBench("bench-east-2").assignedIds.includes("acc-tom-01"));
check("target status assigned", findBench("bench-east-2").status === "assigned");

// 5. 未清空不能开始维护
check("start blocked while occupied", !startBenchMaintenance(findBench("bench-east-1")).ok);

// 6. 取消（已迁移）→ 按占用派生
let end = cancelBenchMaintenance(findBench("bench-east-1"), "零件未到货");
check("cancel pending ok", end.ok);
setBench(end.value);
const afterCancel = findBench("bench-east-1");
check("cancelled pending restores assigned (occupied)", afterCancel.status === "assigned");
check("still contains acc-tom-02", afterCancel.assignedIds.includes("acc-tom-02"));
check("cancellation recorded", afterCancel.maintenanceHistory[0].outcome === "cancelled");
check("cancellation note kept", afterCancel.maintenanceHistory[0].endNote === "零件未到货");
check("relocation survives cancel", afterCancel.maintenanceHistory[0].relocations.length === 1);

// 7. 历史观测/标记不被改写
const pass = state.observationPasses.find((p) => p.id === "obs-tom-01");
check("observation history untouched", pass.entries.some((e) => e.accessionId === "acc-tom-01"));
check("flag history untouched", state.flags.some((f) => f.accessionId === "acc-tom-01"));

// 8. 无迁移取消 → 精确还原 previousStatus
const east2BeforeStatus = findBench("bench-east-2").status;
setBench(requestBenchMaintenance(findBench("bench-east-2"), {
  requestedAt: "2026-09-16T09:00",
  reason: "计划性检查后取消",
}).value);
setBench(cancelBenchMaintenance(findBench("bench-east-2"), "无需维修").value);
check("cancel w/o relocations restores previous status", findBench("bench-east-2").status === east2BeforeStatus);
check("acc-tom-01 still on E-2 after cancel", findBench("bench-east-2").assignedIds.includes("acc-tom-01"));

// 9. 完整维护流程
setBench(requestBenchMaintenance(findBench("bench-east-1"), {
  requestedAt: "2026-09-17T08:00",
  reason: "正式更换灌溉分流阀",
}).value);
relocate("bench-east-1", "acc-tom-02", "bench-east-2", "");
check("east-1 fully evacuated", findBench("bench-east-1").assignedIds.length === 0);
check("cannot complete from pending", !completeBenchMaintenance(findBench("bench-east-1"), "x").ok);
setBench(startBenchMaintenance(findBench("bench-east-1")).value);
check("in maintenance", findBench("bench-east-1").status === "maintenance");
check("startedAt set", Boolean(findBench("bench-east-1").maintenanceHistory[1].startedAt));
check("assignment blocked during maintenance", !assignAccession(findAcc("acc-tom-03"), findBench("bench-east-1")).ok);

setBench(cancelBenchMaintenance(findBench("bench-east-1"), "中止维护").value);
check("cancel during maintenance → available", findBench("bench-east-1").status === "available");

setBench(requestBenchMaintenance(findBench("bench-east-1"), {
  requestedAt: "2026-09-18T08:00",
  reason: "重新维护更换阀门",
}).value);
setBench(startBenchMaintenance(findBench("bench-east-1")).value);
end = completeBenchMaintenance(findBench("bench-east-1"), "阀门已更换并测压");
check("complete ok", end.ok);
setBench(end.value);
const done = findBench("bench-east-1");
check("completed → available", done.status === "available");
const lastRecord = done.maintenanceHistory[done.maintenanceHistory.length - 1];
check("outcome completed", lastRecord.outcome === "completed");
check("endNote recorded", lastRecord.endNote === "阀门已更换并测压");
check("history has 3 records (cancelled, cancelled, completed)", done.maintenanceHistory.length === 3);

// 10. 放行阻止项
setBench(requestBenchMaintenance(findBench("bench-east-2"), {
  requestedAt: "2026-09-19T08:00",
  reason: "计划性维护检查",
}).value);
let snap = buildClearanceSnapshot(state, "trial-sol-01");
check(
  "pending bench is clearance blocker",
  snap.blockers.some((b) => b.code === "BENCH_MAINTENANCE_PENDING" && b.benchId === "bench-east-2"),
);
for (const id of [...findBench("bench-east-2").assignedIds]) {
  relocate("bench-east-2", id, "bench-east-1", "");
}
setBench(startBenchMaintenance(findBench("bench-east-2")).value);
snap = buildClearanceSnapshot(state, "trial-sol-01");
check(
  "maintenance bench is clearance blocker",
  snap.blockers.some((b) => b.code === "BENCH_MAINTENANCE" && b.benchId === "bench-east-2"),
);
check(
  "relocated active accessions still assigned (no UNASSIGNED blocker)",
  !snap.blockers.some((b) => b.code === "UNASSIGNED" && (b.accessionId === "acc-tom-01" || b.accessionId === "acc-tom-02")),
);
check("observation passes intact after all operations", state.observationPasses.length === 2);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll maintenance domain checks passed.");
