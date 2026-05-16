"""
Đánh giá RAG pipeline bằng DeepEval + Gemini làm LLM judge.

Chế độ:
  triad   — Answer relevancy, Faithfulness, Contextual relevancy (không cần golden answer)
  split   — Retriever metrics (precision/recall/relevancy) + Generator metrics trên hai nhóm testcase

Chú ý khi khớp với backend NestJS: trong chat thật model còn nhận thêm ngữ cảnh DB không qua vector store;
  faithfulness trong script này chỉ đối chiếu với các chuỗi bạn đưa trong retrieval_context của file JSON.

Usage:
  .venv\\Scripts\\python run_rag_eval.py triad
  .venv\\Scripts\\python run_rag_eval.py split --output results\\split_run.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent
load_dotenv(_ROOT / ".env")


def _require_api_key() -> str:
    key = (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
    if not key:
        print(
            "Thiếu API key. Tạo file evaluation/.env từ .env.example và đặt GEMINI_API_KEY "
            "(hoặc GOOGLE_API_KEY).",
            file=sys.stderr,
        )
        sys.exit(1)
    return key


def _eval_model():
    from deepeval.models import GeminiModel

    model_name = (os.getenv("EVAL_GEMINI_MODEL") or "gemini-2.5-flash").strip()
    return GeminiModel(
        model=model_name,
        api_key=_require_api_key(),
        temperature=0.0,
    )


def _case_to_llm_test_case(raw: dict):
    from deepeval.test_case import LLMTestCase

    return LLMTestCase(
        input=raw["input"],
        actual_output=raw["actual_output"],
        expected_output=raw.get("expected_output"),
        retrieval_context=list(raw.get("retrieval_context") or []),
    )


def _metric_result(metric) -> dict:
    return {
        "name": metric.__class__.__name__,
        "score": getattr(metric, "score", None),
        "success": getattr(metric, "success", None),
        "reason": getattr(metric, "reason", None),
        "error": getattr(metric, "error", None),
        "threshold": getattr(metric, "threshold", None),
    }


def _measure_all(test_case, metrics) -> list[dict]:
    out = []
    for m in metrics:
        try:
            m.measure(test_case)
            out.append(_metric_result(m))
        except Exception as e:  # noqa: BLE001 — báo lỗi từng metric, không dừng cả lô
            out.append(
                {
                    "name": m.__class__.__name__,
                    "score": None,
                    "success": False,
                    "reason": None,
                    "error": str(e),
                    "threshold": getattr(m, "threshold", None),
                }
            )
    return out


def _format_avg_summary(value: float | None, *, decimals: int = 4) -> str:
    if value is None:
        return (
            "N/A — không có score hợp lệ (thường do metric lỗi API/không gọi được judge)"
        )
    return f"{value:.{decimals}f}"


def _failure_notes_from_report(report: dict, max_notes: int = 4) -> list[str]:
    """Coarse hints from nested metric errors so the CLI is not ambiguous."""
    seen: set[str] = set()
    out: list[str] = []
    for row in report.get("cases") or []:
        for m in row.get("metrics") or []:
            err = m.get("error")
            if not err:
                continue
            text = str(err)
            if "leaked" in text.lower():
                msg = (
                    "[403] API key báo leaked — tạo khóa mới trên AI Studio và cập nhật .env "
                    "(không commit khóa)."
                )
                key = "leaked"
            elif "RESOURCE_EXHAUSTED" in text or (
                "429" in text and "quota" in text.lower()
            ):
                msg = (
                    "[429] Quota / rate limit (free tier dễ gặp) — "
                    "chạy lại sau 1–2 phút hoặc dùng: --delay-after-case 15"
                )
                key = "429"
            elif "PERMISSION_DENIED" in text:
                msg = f"[PERMISSION_DENIED] {text[:180]}"
                key = text[:220]
            else:
                msg = text[:260] + ("…" if len(text) > 260 else "")
                key = text[:220]
            if key in seen:
                continue
            seen.add(key)
            out.append(msg)
            if len(out) >= max_notes:
                return out
    return out


def _humanize_metric_class_name(class_name: str) -> str:
    base = class_name.replace("Metric", "")
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", base)


def _test_case_cell_label(report: dict, row: dict) -> str:
    cid = row.get("id") or "?"
    if report.get("mode") == "split":
        grp = row.get("group")
        if grp == "retrieval":
            return f"test_retrieval / {cid}"
        if grp == "generation":
            return f"test_generation / {cid}"
    return f"test_rag_triad / {cid}"


def _print_deepeval_style_table(report: dict) -> None:
    """Terminal table inspired by `deepeval test run` (Rich)."""
    try:
        from rich import box
        from rich.console import Console
        from rich.table import Table
        from rich.text import Text
    except ImportError:
        print(
            "[run_rag_eval] Cần package `rich` để vẽ bảng DeepEval-style: pip install rich",
            file=sys.stderr,
        )
        return

    console = Console()
    table = Table(
        title="deepeval (style) — RAG metrics",
        box=box.ROUNDED,
        show_header=True,
        header_style="bold",
        show_lines=True,
    )
    table.add_column("Test case", style="cyan", ratio=1, max_width=28)
    table.add_column("Metric", ratio=1, max_width=26)
    table.add_column("Score / detail", ratio=2, max_width=56)
    table.add_column("Status", max_width=10)
    table.add_column("Overall Success Rate", max_width=22)

    eval_model = report.get("eval_model") or "?"
    rows_out = report.get("cases") or []

    for row in rows_out:
        if row.get("skipped"):
            lid = row.get("id") or "?"
            table.add_row(
                lid,
                "—",
                row.get("reason") or "(skipped)",
                Text("SKIP", style="yellow"),
                "—",
            )
            continue

        metrics = row.get("metrics") or []
        if not metrics:
            continue

        label = _test_case_cell_label(report, row)
        n_met = len(metrics)
        passed = sum(
            1
            for m in metrics
            if m.get("success") is True and m.get("error") is None
        )
        overall_pct = (100.0 * passed / n_met) if n_met else 0.0
        overall_str = f"{overall_pct:.2f}%"
        case_key = label

        for i, m in enumerate(metrics):
            human = _humanize_metric_class_name(m.get("name") or "Metric")
            err = m.get("error")
            score = m.get("score")
            thresh = m.get("threshold")
            reason = (m.get("reason") or "").strip()

            if err:
                detail = str(err)
                score_cell = detail if len(detail) <= 300 else detail[:297] + "…"
                status = Text("ERROR", style="bold red")
            elif score is None:
                score_cell = "N/A"
                status = Text("FAILED", style="bold red")
            else:
                th_str = (
                    f"{thresh:g}"
                    if isinstance(thresh, (float, int)) and not isinstance(thresh, bool)
                    else str(thresh)
                )
                head = (
                    f"{float(score):.2f} (threshold={th_str}, "
                    f"evaluation model={eval_model})"
                )
                score_cell = head
                if reason:
                    score_cell += "\n" + reason
                ok = m.get("success") is True
                status = (
                    Text("PASSED", style="bold green")
                    if ok
                    else Text("FAILED", style="bold red")
                )

            table.add_row(
                case_key if i == 0 else "",
                human,
                score_cell,
                status,
                overall_str if i == 0 else "",
            )

    console.print(table)
    print()


def _report_has_any_score(report: dict) -> bool:
    for row in report.get("cases") or []:
        for m in row.get("metrics") or []:
            if m.get("score") is not None:
                return True
    return False


def _avg_scores(rows: list[dict], metric_name: str) -> float | None:
    scores = []
    for row in rows:
        for m in row.get("metrics") or []:
            if m.get("name") == metric_name and m.get("score") is not None:
                scores.append(float(m["score"]))
    if not scores:
        return None
    return sum(scores) / len(scores)


def run_triad(
    cases_path: Path, output_path: Path | None, delay_after_case_seconds: float = 0
) -> dict:
    from deepeval.metrics import (
        AnswerRelevancyMetric,
        FaithfulnessMetric,
        ContextualRelevancyMetric,
    )

    model = _eval_model()
    metrics = [
        AnswerRelevancyMetric(model=model, async_mode=False, threshold=0.5),
        FaithfulnessMetric(model=model, async_mode=False, threshold=0.5),
        ContextualRelevancyMetric(model=model, async_mode=False, threshold=0.5),
    ]

    payload = json.loads(cases_path.read_text(encoding="utf-8"))
    case_list = payload.get("cases") or []
    rows = []
    for idx, raw in enumerate(case_list):
        if idx > 0 and delay_after_case_seconds > 0:
            time.sleep(delay_after_case_seconds)
        tc = _case_to_llm_test_case(raw)
        measured = _measure_all(tc, metrics)
        rows.append({"id": raw.get("id"), "input": raw.get("input"), "metrics": measured})

    report = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "mode": "triad",
        "cases_path": str(cases_path.as_posix()),
        "eval_model": os.getenv("EVAL_GEMINI_MODEL", "gemini-2.5-flash"),
        "summary": {
            "answer_relevancy_avg": _avg_scores(rows, "AnswerRelevancyMetric"),
            "faithfulness_avg": _avg_scores(rows, "FaithfulnessMetric"),
            "contextual_relevancy_avg": _avg_scores(
                rows, "ContextualRelevancyMetric"
            ),
            "case_count": len(rows),
        },
        "cases": rows,
    }
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Đã ghi: {output_path}")
    return report


def run_split(
    cases_path: Path, output_path: Path | None, delay_after_case_seconds: float = 0
) -> dict:
    from deepeval.metrics import (
        AnswerRelevancyMetric,
        FaithfulnessMetric,
        ContextualPrecisionMetric,
        ContextualRecallMetric,
        ContextualRelevancyMetric,
    )

    model = _eval_model()
    retrieval_metrics = [
        ContextualPrecisionMetric(model=model, async_mode=False, threshold=0.5),
        ContextualRecallMetric(model=model, async_mode=False, threshold=0.5),
        ContextualRelevancyMetric(model=model, async_mode=False, threshold=0.5),
    ]
    generation_metrics = [
        AnswerRelevancyMetric(model=model, async_mode=False, threshold=0.5),
        FaithfulnessMetric(model=model, async_mode=False, threshold=0.5),
    ]

    payload = json.loads(cases_path.read_text(encoding="utf-8"))
    ret_cases = payload.get("retrieval_cases") or []
    gen_cases = payload.get("generation_cases") or []

    rows = []
    case_index = 0

    def _maybe_sleep() -> None:
        nonlocal case_index
        case_index += 1
        if case_index > 1 and delay_after_case_seconds > 0:
            time.sleep(delay_after_case_seconds)

    for raw in ret_cases:
        _maybe_sleep()
        if not raw.get("expected_output"):
            rows.append(
                {
                    "group": "retrieval",
                    "id": raw.get("id"),
                    "skipped": True,
                    "reason": "Thiếu expected_output — bỏ qua metrics retrieval có reference.",
                }
            )
            continue
        tc = _case_to_llm_test_case(raw)
        measured = _measure_all(tc, retrieval_metrics)
        rows.append({"group": "retrieval", "id": raw.get("id"), "metrics": measured})

    for raw in gen_cases:
        _maybe_sleep()
        tc = _case_to_llm_test_case(raw)
        measured = _measure_all(tc, generation_metrics)
        rows.append({"group": "generation", "id": raw.get("id"), "metrics": measured})

    def avg_for(group: str, metric_name: str) -> float | None:
        sub = [r for r in rows if r.get("group") == group and "metrics" in r]
        return _avg_scores(sub, metric_name)

    report = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "mode": "split",
        "cases_path": str(cases_path.as_posix()),
        "eval_model": os.getenv("EVAL_GEMINI_MODEL", "gemini-2.5-flash"),
        "summary": {
            "retrieval": {
                "contextual_precision_avg": avg_for("retrieval", "ContextualPrecisionMetric"),
                "contextual_recall_avg": avg_for("retrieval", "ContextualRecallMetric"),
                "contextual_relevancy_avg": avg_for(
                    "retrieval", "ContextualRelevancyMetric"
                ),
            },
            "generation": {
                "answer_relevancy_avg": avg_for("generation", "AnswerRelevancyMetric"),
                "faithfulness_avg": avg_for("generation", "FaithfulnessMetric"),
            },
        },
        "cases": rows,
    }
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Đã ghi: {output_path}")
    return report


def _print_human_summary(report: dict) -> None:
    print()
    print("=== Kết quả (tóm tắt) ===")
    s = report.get("summary") or {}
    if report.get("mode") == "triad":
        print(f"  Số testcase: {s.get('case_count')}")
        print(
            f"  Answer relevancy (trung bình): "
            f"{_format_avg_summary(s.get('answer_relevancy_avg'))}"
        )
        print(
            f"  Faithfulness (trung bình):       "
            f"{_format_avg_summary(s.get('faithfulness_avg'))}"
        )
        print(
            f"  Contextual relevancy (TB):       "
            f"{_format_avg_summary(s.get('contextual_relevancy_avg'))}"
        )
    else:
        r = s.get("retrieval") or {}
        g = s.get("generation") or {}
        print("  Retrieval:")
        print(
            f"    contextual_precision_avg: "
            f"{_format_avg_summary(r.get('contextual_precision_avg'))}"
        )
        print(
            f"    contextual_recall_avg:      "
            f"{_format_avg_summary(r.get('contextual_recall_avg'))}"
        )
        print(
            f"    contextual_relevancy_avg:  "
            f"{_format_avg_summary(r.get('contextual_relevancy_avg'))}"
        )
        print("  Generation:")
        print(
            f"    answer_relevancy_avg: "
            f"{_format_avg_summary(g.get('answer_relevancy_avg'))}"
        )
        print(
            f"    faithfulness_avg:     "
            f"{_format_avg_summary(g.get('faithfulness_avg'))}"
        )
    print()
    if not _report_has_any_score(report):
        notes = _failure_notes_from_report(report)
        print(
            "Cảnh báo: Không có metric nào trả về score — đây không phải là chất lượng RAG, "
            "mà là bước gọi Gemini (judge) không thành công."
        )
        print("Gợi ý xử lý (tóm tắt từ lỗi trong JSON):")
        if notes:
            for line in notes:
                print(f"  • {line}")
        else:
            print("  • Mở file JSON đầu ra và xem cases[].metrics[].error hoặc reason.")
        print()
    print("Chi tiết từng metric (score / success / reason / error) nằm trong file JSON đầu ra.")
    print()


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser(
        description="RAG evaluation with DeepEval + Gemini judge."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--delay-after-case",
        type=float,
        default=float(os.getenv("EVAL_DELAY_AFTER_CASE_SECONDS", "0")),
        metavar="SEC",
        help="Sleep SEC seconds between test cases (Free tier Gemini ~5 RPM; try 13-15). "
        "Or set env EVAL_DELAY_AFTER_CASE_SECONDS.",
    )
    common.add_argument(
        "--no-table",
        action="store_true",
        help="Skip the Rich terminal table (DeepEval-style).",
    )

    p_triad = sub.add_parser(
        "triad",
        parents=[common],
        help="RAG Triad: answer relevancy, faithfulness, contextual relevancy",
    )
    p_triad.add_argument(
        "--cases",
        type=Path,
        default=_ROOT / "data" / "rag_triad.demo.json",
        help="JSON dataset: top-level \"cases\" array.",
    )
    p_triad.add_argument(
        "--output",
        type=Path,
        default=_ROOT / "results" / "triad_latest.json",
        help="Output JSON report path.",
    )

    p_split = sub.add_parser(
        "split",
        parents=[common],
        help="Retriever (needs expected_output) + generator-only metrics.",
    )
    p_split.add_argument(
        "--cases",
        type=Path,
        default=_ROOT / "data" / "rag_split.demo.json",
        help="JSON with retrieval_cases + generation_cases.",
    )
    p_split.add_argument(
        "--output",
        type=Path,
        default=_ROOT / "results" / "split_latest.json",
    )

    args = parser.parse_args()
    delay = float(getattr(args, "delay_after_case", 0) or 0)

    if args.command == "triad":
        report = run_triad(args.cases, args.output, delay)
    else:
        report = run_split(args.cases, args.output, delay)

    if not getattr(args, "no_table", False):
        _print_deepeval_style_table(report)
    _print_human_summary(report)


if __name__ == "__main__":
    main()
