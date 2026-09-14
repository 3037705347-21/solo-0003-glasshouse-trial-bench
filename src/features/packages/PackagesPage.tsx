import { useState } from "react";
import { Archive, PackageCheck, PackagePlus } from "lucide-react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  buildCompliancePackage,
  serializeCompliancePackage,
} from "../../domain/compliance";
import type { CompliancePackage } from "../../domain/types";
import { packagesForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { PackageDetail } from "./PackageDetail";

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function PackagesPage() {
  const { state, dispatch } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const trial = state.trials.find((item) => item.id === trialId);
  const packages = packagesForTrial(state, trialId);
  const selected =
    packages.find((item) => item.id === selectedId) ?? packages[0];

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const handleGenerate = () => {
    const result = buildCompliancePackage(state, trialId);
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "生成失败",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({ type: "package/generated", package: result.value });
    setSelectedId(result.value.id);
    pushToast({
      tone: result.value.status === "complete" ? "success" : "warning",
      title: `已生成第 ${result.value.version} 版合规包`,
      message:
        result.value.status === "complete"
          ? "检查全部通过，内容已冻结。"
          : `内容已冻结，${result.value.checks.length} 项检查发现需要说明。`,
    });
  };

  const handleExport = (pkg: CompliancePackage) => {
    const blob = new Blob([serializeCompliancePackage(pkg)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = pkg.exportFileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    pushToast({
      tone: "info",
      title: "导出文件已生成",
      message: pkg.exportFileName,
    });
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="试验合规包"
        title="合规包交付"
        description="按试验生成固定时点的资料集合：记录清单、对象引用、版本摘要和导出文件。包内容生成即冻结，后续修改只会形成新版本。"
        actions={
          <Button
            onClick={handleGenerate}
            disabled={!trial}
            data-testid="generate-package"
          >
            <PackagePlus size={16} />
            生成合规包
          </Button>
        }
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => {
            setTrialId(event.target.value);
            setSelectedId(null);
          }}
          aria-label="选择试验"
          data-testid="package-trial-select"
        >
          {state.trials.map((item) => (
            <option value={item.id} key={item.id}>
              {item.code} - {item.cropFamily}
            </option>
          ))}
        </select>
        {trial ? (
          <span className="muted-copy">
            {trial.code} 已有 {packages.length} 个版本
          </span>
        ) : null}
      </section>
      {!trial ? (
        <EmptyState
          icon={Archive}
          title="没有可用试验"
          description="请先在材料登记中创建试验，再生成合规包。"
        />
      ) : (
        <div className="package-workspace">
          <section className="package-list">
            <div className="package-list-heading">
              <PackageCheck size={18} aria-hidden="true" />
              <h2>历史版本</h2>
              <span>{packages.length} 个</span>
            </div>
            {packages.length === 0 ? (
              <EmptyState
                icon={Archive}
                title="还没有合规包"
                description="点击“生成合规包”为该试验固化第一份资料集合。"
              />
            ) : (
              <div className="package-versions">
                {packages.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`package-version-card ${
                      selected?.id === item.id
                        ? "package-version-card-active"
                        : ""
                    }`}
                    onClick={() => setSelectedId(item.id)}
                    data-testid={`package-version-${item.id}`}
                  >
                    <div className="package-version-top">
                      <strong>第 {item.version} 版</strong>
                      <StatusBadge
                        tone={
                          item.status === "complete" ? "positive" : "warning"
                        }
                      >
                        {item.status === "complete" ? "完整" : "含排除项"}
                      </StatusBadge>
                    </div>
                    <span>{formatDateTime(item.generatedOn)}</span>
                    <code>{item.digest}</code>
                  </button>
                ))}
              </div>
            )}
          </section>
          {selected ? (
            <PackageDetail pkg={selected} onExport={handleExport} />
          ) : (
            <section className="content-panel">
              <EmptyState
                icon={PackageCheck}
                title="选择或生成一个合规包"
                description="合规包会冻结生成时点的材料、台架位置、观测、标记处理结果和放行快照。"
              />
            </section>
          )}
        </div>
      )}
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
