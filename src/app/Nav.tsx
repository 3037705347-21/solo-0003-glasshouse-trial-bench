import {
  Archive,
  ClipboardCheck,
  LayoutGrid,
  ListTree,
  NotebookPen,
} from "lucide-react";
import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/roster", label: "材料登记", icon: ListTree, end: false },
  { to: "/layout", label: "台架布局", icon: LayoutGrid, end: false },
  { to: "/observations", label: "生长观测", icon: NotebookPen, end: false },
  { to: "/clearance/ledger", label: "放行台账", icon: Archive, end: false },
  { to: "/clearance", label: "试验放行", icon: ClipboardCheck, end: true },
];

export function Nav() {
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
                end={item.end}
                className={({ isActive }) => (isActive ? "nav-link-active" : "")}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
