import {
  ClipboardCheck,
  LayoutGrid,
  ListTree,
  NotebookPen,
  ShieldCheck,
} from "lucide-react";
import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import { scanWorkspace } from "../domain/quality";
import { useWorkspace } from "../state/store";

const navItems = [
  { to: "/roster", label: "材料登记", icon: ListTree },
  { to: "/layout", label: "台架布局", icon: LayoutGrid },
  { to: "/observations", label: "生长观测", icon: NotebookPen },
  { to: "/clearance", label: "试验放行", icon: ClipboardCheck },
];

export function Nav() {
  const { state, bootFindings, activeRepair } = useWorkspace();
  const blockingCount = useMemo(() => {
    const report = scanWorkspace(state, { persistenceFindings: bootFindings });
    return report.counts.blocking + (activeRepair ? 1 : 0);
  }, [state, bootFindings, activeRepair]);

  return (
    <nav className="side-nav" aria-label="主导航">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          温试
        </span>
        <span>
          <strong>温室</strong>
          <small>试验台</small>
        </span>
      </div>
      <ul>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => (isActive ? "nav-link-active" : "")}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
        <li>
          <NavLink
            to="/quality"
            className={({ isActive }) => (isActive ? "nav-link-active" : "")}
            data-testid="nav-quality"
          >
            <ShieldCheck size={18} aria-hidden="true" />
            <span>数据质量</span>
            {blockingCount > 0 ? (
              <span
                className="nav-quality-badge"
                aria-label={`${blockingCount} 个阻断问题`}
                data-testid="nav-quality-badge"
              >
                {blockingCount}
              </span>
            ) : (
              <span
                className="nav-quality-ok"
                aria-label="数据质量正常"
                data-testid="nav-quality-ok"
              />
            )}
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
