import { useEffect, useState } from "react";
import { todayDateOnly } from "../domain/rules";

/**
 * 今日工作台只实时派生、不保存副本；日期滚动或重新回到标签页时，
 * 通过重取当天日期触发重新派生，逾期/今日口径随之更新。
 */
export function useToday(): string {
  const [today, setToday] = useState(() => todayDateOnly());

  useEffect(() => {
    const recheck = () => {
      const current = todayDateOnly();
      setToday((previous) => (previous === current ? previous : current));
    };
    const interval = window.setInterval(recheck, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        recheck();
      }
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return today;
}
