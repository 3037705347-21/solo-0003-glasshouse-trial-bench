import { useSearchParams } from "react-router-dom";
import type { Trial } from "../domain/types";

/**
 * 解析 ?trial= 深链参数，作为页面级试验选择器的初始值。
 * 参数缺失或指向未知试验时回退到第一个试验，
 * 让对比页等来源可以带着上下文跳回各工作流页面。
 */
export function useDeepLinkedTrialId(trials: Trial[]): string {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("trial");
  if (requested && trials.some((trial) => trial.id === requested)) {
    return requested;
  }
  return trials[0]?.id ?? "";
}
