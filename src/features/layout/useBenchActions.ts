import type { Dispatch } from "react";
import type { ToastMessage } from "../../components/Toast";
import { assignAccession, releaseAccession } from "../../domain/bench";
import type { WorkspaceState } from "../../domain/types";
import { accessionById } from "../../state/selectors";
import type { WorkspaceAction } from "../../state/types";

export type BenchActionNotice = Omit<ToastMessage, "id">;

export function useBenchActions(
  state: WorkspaceState,
  dispatch: Dispatch<WorkspaceAction>,
  notify: (notice: BenchActionNotice) => void,
) {
  const assign = (accessionId: string, benchId: string) => {
    const accession = accessionById(state, accessionId);
    const bench = state.benches.find((item) => item.id === benchId);
    if (!accession || !bench) {
      return;
    }
    const result = assignAccession(accession, bench);
    if (!result.ok) {
      notify({
        tone: "error",
        title: "分配被拒绝",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({ type: "bench/assigned", bench: result.value });
    notify({
      tone: "success",
      title: "台架分配成功",
      message: `${accession.cultivar} 已分配到 ${bench.code}`,
    });
  };

  const release = (accessionId: string, benchId: string) => {
    const bench = state.benches.find((item) => item.id === benchId);
    if (!bench) {
      return;
    }
    const result = releaseAccession(accessionId, bench);
    if (!result.ok) {
      notify({
        tone: "error",
        title: "移出失败",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({ type: "bench/released", bench: result.value });
    notify({
      tone: "success",
      title: "材料已移出",
      message: "该台架空位已恢复可用。",
    });
  };

  return { assign, release };
}
