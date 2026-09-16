import { useMemo } from "react";
import {
  CalendarRange,
  ClipboardCheck,
  LayoutGrid,
  ListTree,
  NotebookPen,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { buildWorkbench } from "../domain/workbench";
import { useToday } from "./useToday";
import { useWorkspace } from "../state/store";

const navItems = [
  { to: "/workbench", label: "今日工作台", icon: CalendarRange },
  { to: "/roster", label: "材料登记", icon: ListTree },
  { to: "/layout", label: "台架布局", icon: LayoutGrid },
  { to: "/observations", label: "生长观测", icon: NotebookPen },
  { to: "/clearance", label: "试验放行", icon: ClipboardCheck },
];

export function Nav() {
  const { state } = useWorkspace();
  const today = useToday();
  const urgentCount = useMemo(() => {
    const items = buildWorkbench(state, today);
    return items.filter(
      (item) => item.dueStatus === "overdue" || item.dueStatus === "today",
    ).length;
  }, [state, today]);

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
                {item.to === "/workbench" && urgentCount > 0 ? (
                  <span
                    className="nav-urgent-badge"
                    data-testid="nav-urgent-count"
                    aria-label={`${urgentCount} 项已逾期或今天到期`}
                  >
                    {urgentCount > 99 ? "99+" : urgentCount}
                  </span>
                ) : null}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
