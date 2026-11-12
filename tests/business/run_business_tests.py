# -*- coding: utf-8 -*-
"""武汉大学招生智能体业务测试运行器。"""
import argparse
import hashlib
import html
import json
import re
import sys
import threading
import time
import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import eval_agent


MODES = {"chat_knowledge", "chat_with_db_execute", "chat_with_db_react"}
CAPABILITIES = {"policy", "data_query", "analysis", "report", "multi_turn", "robustness"}
SYSTEM_ERROR_MARKERS = ("ERROR!", "Generate view content failed", "Traceback", "SERVER_ERROR")
ASSERTION_KEYS = {
    "contains_all", "contains_any", "forbidden", "sql_required", "min_rows",
    "row_count", "expected_values", "paired_values", "clarify_slots",
    "oracle_sql", "max_elapsed",
}
TURN_KEYS = {"mode", "question"} | ASSERTION_KEYS
SCENARIO_KEYS = {"id", "title", "capability", "tags", "smoke", "turns"}
DEFAULT_SCENARIOS = Path(__file__).resolve().with_name("scenarios.json")
DEFAULT_RESULTS = Path(__file__).resolve().with_name("results")


class ParameterError(Exception):
    """参数、场景或断点续跑预检错误。"""


def scenarios_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_scenarios(path=DEFAULT_SCENARIOS):
    path = Path(path)
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ParameterError(f"无法读取场景文件 {path}: {exc}") from exc
    errors = validate_scenarios(config)
    if errors:
        raise ParameterError("场景校验失败:\n" + "\n".join(f"- {e}" for e in errors))
    return config


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_scalar(value):
    return value is None or isinstance(value, (str, int, float, bool))


def _validate_string_list(value):
    return isinstance(value, list) and bool(value) and all(
        isinstance(item, str) and bool(item.strip()) for item in value
    )


def validate_read_only_sql(sql):
    """只允许单条不带注释的 SELECT/WITH，返回可执行 SQL。"""
    if not isinstance(sql, str) or not sql.strip():
        raise ValueError("oracle_sql 必须是非空 SQL")
    text = sql.strip()
    if "\x00" in text or "--" in text or "/*" in text or "*/" in text:
        raise ValueError("oracle_sql 不允许注释或 NUL 字符")
    if ";" in text[:-1] or text.count(";") > 1:
        raise ValueError("oracle_sql 只允许一条语句")
    text = text.rstrip(";").strip()
    if not re.match(r"^(?:SELECT|WITH)\b", text, re.I):
        raise ValueError("oracle_sql 只能以 SELECT 或 WITH 开头")
    banned = (
        "INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|MERGE|"
        "COPY|CALL|DO|EXECUTE|VACUUM|ANALYZE|SET|SHOW"
    )
    if re.search(rf"\b(?:{banned})\b", text, re.I):
        raise ValueError("oracle_sql 含写入或禁用关键字")
    if re.search(r"\bFOR\s+(?:UPDATE|SHARE)\b", text, re.I):
        raise ValueError("oracle_sql 不允许锁定行")
    return text


def validate_scenarios(config):
    errors = []
    if not isinstance(config, dict) or not isinstance(config.get("scenarios"), list):
        return ["顶层必须为含 scenarios 数组的对象"]
    seen = set()
    for index, case in enumerate(config["scenarios"]):
        where = f"scenarios[{index}]"
        if not isinstance(case, dict):
            errors.append(f"{where} 必须为对象")
            continue
        unknown = set(case) - SCENARIO_KEYS
        if unknown:
            errors.append(f"{where} 未知字段: {sorted(unknown)}")
        case_id = case.get("id")
        if not isinstance(case_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", case_id or ""):
            errors.append(f"{where}.id 必须为字母数字、点、下划线或横线")
            case_id = where
        elif case_id in seen:
            errors.append(f"重复场景 id: {case_id}")
        else:
            seen.add(case_id)
            where = case_id
        if not isinstance(case.get("title"), str) or not case.get("title", "").strip():
            errors.append(f"{where}.title 必须非空")
        if case.get("capability") not in CAPABILITIES:
            errors.append(f"{where}.capability 无效: {case.get('capability')}")
        if "tags" in case and (
            not isinstance(case["tags"], list)
            or not all(isinstance(tag, str) and tag for tag in case["tags"])
        ):
            errors.append(f"{where}.tags 必须为字符串数组")
        if "smoke" in case and not isinstance(case["smoke"], bool):
            errors.append(f"{where}.smoke 必须为布尔值")
        turns = case.get("turns")
        if not isinstance(turns, list) or not turns:
            errors.append(f"{where}.turns 必须为非空数组")
            continue
        for turn_index, turn in enumerate(turns):
            tw = f"{where}.turns[{turn_index}]"
            if not isinstance(turn, dict):
                errors.append(f"{tw} 必须为对象")
                continue
            unknown = set(turn) - TURN_KEYS
            if unknown:
                errors.append(f"{tw} 未知字段: {sorted(unknown)}")
            if turn.get("mode") not in MODES:
                errors.append(f"{tw}.mode 无效: {turn.get('mode')}")
            if not isinstance(turn.get("question"), str) or not turn.get("question", "").strip():
                errors.append(f"{tw}.question 必须非空")
            for key in ("contains_all", "contains_any", "forbidden"):
                if key in turn and not _validate_string_list(turn[key]):
                    errors.append(f"{tw}.{key} 必须为非空字符串数组")
            if "sql_required" in turn and not isinstance(turn["sql_required"], bool):
                errors.append(f"{tw}.sql_required 必须为布尔值")
            for key in ("min_rows", "row_count"):
                if key in turn and (
                    not isinstance(turn[key], int) or isinstance(turn[key], bool) or turn[key] < 0
                ):
                    errors.append(f"{tw}.{key} 必须为非负整数")
            if "expected_values" in turn and (
                not isinstance(turn["expected_values"], list)
                or not turn["expected_values"]
                or not all(_is_scalar(v) for v in turn["expected_values"])
            ):
                errors.append(f"{tw}.expected_values 必须为非空标量数组")
            if "paired_values" in turn:
                pairs = turn["paired_values"]
                valid = isinstance(pairs, list) and bool(pairs)
                if valid and all(isinstance(item, list) for item in pairs):
                    valid = all(
                        bool(group) and all(_is_scalar(value) for value in group)
                        for group in pairs
                    )
                elif valid and any(isinstance(item, list) for item in pairs):
                    valid = False
                elif valid:
                    valid = all(_is_scalar(value) for value in pairs)
                if not valid:
                    errors.append(f"{tw}.paired_values 必须为一组值或多组值数组")
            if "clarify_slots" in turn:
                slots = turn["clarify_slots"]
                valid = isinstance(slots, list) and bool(slots) and all(
                    (isinstance(slot, str) and bool(slot.strip())) or _validate_string_list(slot)
                    for slot in slots
                )
                if not valid:
                    errors.append(f"{tw}.clarify_slots 必须为字符串或其候选数组")
            if "oracle_sql" in turn:
                try:
                    validate_read_only_sql(turn["oracle_sql"])
                except ValueError as exc:
                    errors.append(f"{tw}.oracle_sql: {exc}")
            if "max_elapsed" in turn and (
                not _is_number(turn["max_elapsed"]) or turn["max_elapsed"] <= 0
            ):
                errors.append(f"{tw}.max_elapsed 必须为正数")
    if not config["scenarios"]:
        errors.append("scenarios 不能为空")
    return errors


def _split_filters(values):
    result = []
    for value in values or []:
        for item in value.split(","):
            item = item.strip()
            if item and item not in result:
                result.append(item)
    return result


def select_scenarios(scenarios, suite="smoke", case_filters=None, tag_filters=None):
    if suite not in ("smoke", "full"):
        raise ParameterError("--suite 只能是 smoke 或 full")
    case_filters = _split_filters(case_filters)
    tag_filters = _split_filters(tag_filters)
    known = {case["id"] for case in scenarios}
    unknown = set(case_filters) - known
    if unknown:
        raise ParameterError(f"未知 --case: {', '.join(sorted(unknown))}")
    selected = []
    for case in scenarios:
        if suite == "smoke" and not case.get("smoke", False):
            continue
        if case_filters and case["id"] not in case_filters:
            continue
        tags = set(case.get("tags", [])) | {case["capability"]}
        if tag_filters and not tags.intersection(tag_filters):
            continue
        selected.append(case)
    if not selected:
        raise ParameterError("筛选后没有可运行场景")
    return selected


def iter_sse_json(raw):
    for line in (raw or "").splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload in ("", "[DONE]"):
            continue
        try:
            yield json.loads(payload)
        except (TypeError, json.JSONDecodeError):
            continue


def extract_chart_view(raw):
    if not raw:
        return None, None
    match = re.search(r'<chart-view\s+content="([^"]+)"', raw)
    if not match:
        return None, None
    try:
        content = json.loads(html.unescape(match.group(1)))
    except (TypeError, json.JSONDecodeError):
        return None, None
    return content.get("sql"), content.get("data")


def parse_knowledge_sse(raw):
    chunks = []
    for obj in iter_sse_json(raw):
        choice = (obj.get("choices") or [{}])[0]
        delta = (choice.get("delta") or {}).get("content")
        if isinstance(delta, str):
            chunks.append(delta)
    return "".join(chunks)


def parse_react_sse(raw):
    """只采用最后的 type=final，中间 step.chunk/Thought 永不作为答案。"""
    final_text = ""
    for obj in iter_sse_json(raw):
        if obj.get("type") == "final" and isinstance(obj.get("content"), str):
            final_text = obj["content"]
    return final_text


class ServiceClient:
    """三种聊天模式的统一客户端，默认实现复用 eval_agent。"""

    def __init__(self, base_url, http_post_json=None, conversation_factory=None,
                 execute_ask=None, sql_executor=None):
        self.base_url = base_url.rstrip("/")
        # eval_agent 的 ask/new_conversation 使用模块级 BASE；仅在本次进程内覆盖。
        eval_agent.BASE = self.base_url
        self.http_post_json = http_post_json or eval_agent.http_post_json
        self.conversation_factory = conversation_factory or eval_agent.new_conversation
        self.execute_ask = execute_ask or eval_agent.ask
        self.sql_executor = sql_executor or eval_agent.exec_sql

    def preflight(self):
        return self.new_conversation("chat_with_db_execute")

    def new_conversation(self, mode):
        backend_mode = "chat_with_db_execute" if mode == "chat_with_db_react" else mode
        return self.conversation_factory(backend_mode)

    @staticmethod
    def _payload(mode, question, conv_uid):
        is_knowledge = mode == "chat_knowledge"
        backend_mode = "chat_with_db_execute" if mode == "chat_with_db_react" else mode
        payload = {
            "chat_mode": backend_mode,
            "conv_uid": conv_uid,
            "user_input": question,
            "select_param": "whu_admission" if is_knowledge else "admission_agent",
            "model_name": "deepseek-chat",
            "incremental": is_knowledge,
            "user_name": "business_eval",
            "sys_code": "business_tests",
        }
        if mode == "chat_with_db_react":
            payload["ext_info"] = {
                "database_name": "admission_agent",
                "knowledge_space": "whu_admission",
            }
        return payload

    def ask(self, mode, question, timeout=120, conv_uid=None):
        if mode not in MODES:
            raise ValueError(f"不支持的模式: {mode}")
        conv_uid = conv_uid or self.new_conversation(mode)
        if mode == "chat_with_db_execute":
            result = self.execute_ask(question, timeout=timeout, conv_uid=conv_uid)
            raw_final = result.get("raw_final")
            return {
                "conv_uid": result.get("conv_uid") or conv_uid,
                "raw_response": result.get("raw_response") or raw_final or "",
                "raw_final": raw_final,
                "final_text": result.get("thoughts") or "",
                "sql": result.get("sql"),
                "data": result.get("data"),
            }
        payload = self._payload(mode, question, conv_uid)
        endpoint = (
            "/api/v1/chat/react-agent"
            if mode == "chat_with_db_react" else "/api/v1/chat/completions"
        )
        raw = self.http_post_json(self.base_url + endpoint, payload, timeout=timeout)
        final_text = parse_react_sse(raw) if mode == "chat_with_db_react" else parse_knowledge_sse(raw)
        sql, data = extract_chart_view(final_text) if mode == "chat_with_db_react" else (None, None)
        return {
            "conv_uid": conv_uid,
            "raw_response": raw,
            "raw_final": final_text,
            "final_text": final_text,
            "sql": sql,
            "data": data,
        }

    def exec_sql(self, sql):
        return self.sql_executor(validate_read_only_sql(sql))


def data_rows(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("rows"), list):
        return data["rows"]
    return []


def _as_decimal(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if re.fullmatch(r"-?\d+(?:\.\d+)?", text):
            try:
                return Decimal(text)
            except InvalidOperation:
                return None
    return None


def value_in_text(expected, text):
    if not isinstance(text, str):
        return False
    number = _as_decimal(expected)
    if number is not None:
        for match in re.finditer(r"-?\d[\d,]*(?:\.\d+)?", text):
            candidate = _as_decimal(match.group(0))
            if candidate is not None and candidate == number:
                return True
        return False
    if expected is None:
        return bool(re.search(r"\b(?:NULL|None|null)\b", text))
    return str(expected) in text


def scalar_matches(expected, actual):
    if isinstance(actual, (dict, list)):
        return False
    expected_number = _as_decimal(expected)
    actual_number = _as_decimal(actual)
    if expected_number is not None and actual_number is not None:
        return expected_number == actual_number
    if isinstance(actual, str):
        if value_in_text(expected, actual):
            return True
    if expected is None:
        return actual is None
    return str(actual) == str(expected)


def _walk_scalars(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from _walk_scalars(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_scalars(item)
    else:
        yield value


def has_expected_value(expected, data, text):
    return any(scalar_matches(expected, actual) for actual in _walk_scalars(data)) or value_in_text(expected, text)


def _record_values(record):
    if isinstance(record, dict):
        return list(record.values())
    if isinstance(record, (list, tuple)):
        return list(record)
    return [record]


def has_paired_values(expected_group, data, text):
    for record in data_rows(data):
        values = _record_values(record)
        if all(any(scalar_matches(expected, actual) for actual in values) for expected in expected_group):
            return True
    # 文本按行视作记录，严禁从不同表格行拼接分数和位次。
    for line in (text or "").splitlines():
        if line.strip() and all(value_in_text(expected, line) for expected in expected_group):
            return True
    return False


def normalize_pair_groups(value):
    if not value:
        return []
    return value if all(isinstance(item, list) for item in value) else [value]


def _assertion(name, passed, expected=None, actual=None, message=None):
    result = {"name": name, "passed": bool(passed)}
    if expected is not None:
        result["expected"] = expected
    if actual is not None:
        result["actual"] = actual
    if message:
        result["message"] = message
    return result


def evaluate_response(turn, response, elapsed, sql_executor=None):
    """执行一轮全部断言，返回 (断言列表, oracle 执行结果)。"""
    text = response.get("final_text") or ""
    raw = response.get("raw_response") or ""
    data = response.get("data")
    rows = data_rows(data)
    results = []
    # 只校验最终答案文本；ReAct 的 raw SSE 中可能包含工具中间日志，不能作为最终错误。
    found_errors = [marker for marker in SYSTEM_ERROR_MARKERS if marker in text]
    results.append(_assertion("system_error", not found_errors, actual=found_errors or "无"))
    results.append(_assertion(
        "non_empty", bool(text.strip() or rows), actual="空回答" if not text.strip() and not rows else "非空"
    ))
    for key in ("contains_all", "contains_any", "forbidden"):
        if key not in turn:
            continue
        needles = turn[key]
        if key == "contains_all":
            missing = [item for item in needles if item not in text]
            results.append(_assertion(key, not missing, expected=needles, actual=missing or "全部命中"))
        elif key == "contains_any":
            hits = [item for item in needles if item in text]
            results.append(_assertion(key, bool(hits), expected=needles, actual=hits or "未命中"))
        else:
            hits = [item for item in needles if item in text]
            results.append(_assertion(key, not hits, expected=needles, actual=hits or "未出现"))
    if turn.get("sql_required"):
        results.append(_assertion("sql_required", bool((response.get("sql") or "").strip()), actual=response.get("sql")))
    if "min_rows" in turn:
        results.append(_assertion("min_rows", len(rows) >= turn["min_rows"], expected=turn["min_rows"], actual=len(rows)))
    if "row_count" in turn:
        results.append(_assertion("row_count", len(rows) == turn["row_count"], expected=turn["row_count"], actual=len(rows)))
    if "expected_values" in turn:
        missing = [value for value in turn["expected_values"] if not has_expected_value(value, data, text)]
        results.append(_assertion("expected_values", not missing, expected=turn["expected_values"], actual=missing or "全部命中"))
    if "paired_values" in turn:
        groups = normalize_pair_groups(turn["paired_values"])
        missing = [group for group in groups if not has_paired_values(group, data, text)]
        results.append(_assertion("paired_values", not missing, expected=groups, actual=missing or "同记录命中"))
    if "clarify_slots" in turn:
        missing = []
        for slot in turn["clarify_slots"]:
            alternatives = [slot] if isinstance(slot, str) else slot
            if not any(item in text for item in alternatives):
                missing.append(slot)
        asks = bool(re.search(r"[?？]|请|告知|提供|补充|说明|需要", text))
        results.append(_assertion(
            "clarify_slots", not missing and asks,
            expected=turn["clarify_slots"], actual={"missing": missing, "has_question_cue": asks},
        ))
    if "max_elapsed" in turn:
        results.append(_assertion(
            "max_elapsed", elapsed <= turn["max_elapsed"],
            expected=turn["max_elapsed"], actual=round(elapsed, 3),
        ))
    oracle_result = None
    if "oracle_sql" in turn:
        try:
            if sql_executor is None:
                raise ValueError("未提供 oracle_sql 执行器")
            oracle_result = sql_executor(validate_read_only_sql(turn["oracle_sql"]))
            oracle_rows = data_rows(oracle_result)
            baseline = [
                value for row in oracle_rows for value in _record_values(row)
                if value is not None
            ]
            missing = [value for value in baseline if not has_expected_value(value, data, text)]
            passed = bool(oracle_rows) and not missing
            results.append(_assertion(
                "oracle_sql", passed, expected=baseline,
                actual=missing if missing else ("全部命中" if oracle_rows else "基准查询无行"),
            ))
        except Exception as exc:
            oracle_result = {"error": f"{type(exc).__name__}: {exc}"}
            results.append(_assertion("oracle_sql", False, actual=oracle_result["error"]))
    return results, oracle_result


def _json_line(record):
    return json.dumps(record, ensure_ascii=False, default=str)


def read_jsonl(path):
    records = []
    try:
        with Path(path).open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError as exc:
                    raise ParameterError(f"{path} 第 {line_number} 行损坏: {exc}") from exc
    except FileNotFoundError as exc:
        raise ParameterError(f"找不到记录文件: {path}") from exc
    return records


def completed_case_ids(records):
    return {
        record["case_id"] for record in records
        if record.get("record_type") == "case_end" and record.get("case_id")
    }


def ask_with_wall_timeout(client, mode, question, timeout, conv_uid):
    """给单轮请求增加真正的墙钟超时，避免 SSE 保持连接时挂死几十分钟。"""
    box = {}

    def target():
        try:
            box["response"] = client.ask(mode, question, timeout=timeout, conv_uid=conv_uid)
        except BaseException as exc:  # noqa: BLE001 - 需要把异常交回主线程统一记录
            box["error"] = exc

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(timeout + 5.0)
    if thread.is_alive():
        raise TimeoutError(f"wall clock timeout after {timeout:.0f}s")
    if "error" in box:
        raise box["error"]
    return box.get("response", {
        "conv_uid": conv_uid, "raw_response": "", "raw_final": "",
        "final_text": "", "sql": None, "data": None,
    })


def run_scenario(case, client, timeout, handle, run_id):
    attempt_id = uuid.uuid4().hex
    conversations = {}
    turn_records = []
    started = time.perf_counter()
    for turn_index, turn in enumerate(case["turns"], 1):
        mode = turn["mode"]
        before = time.perf_counter()
        response = None
        runtime_error = None
        try:
            response = ask_with_wall_timeout(
                client, mode, turn["question"], timeout, conversations.get(mode)
            )
            conversations[mode] = response.get("conv_uid") or conversations.get(mode)
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            runtime_error = f"{type(exc).__name__}: {exc}"
            response = {
                "conv_uid": conversations.get(mode), "raw_response": "", "raw_final": "",
                "final_text": "", "sql": None, "data": None,
            }
        elapsed = time.perf_counter() - before
        if runtime_error:
            assertions = [_assertion("runtime", False, actual=runtime_error)]
            oracle = None
        else:
            assertions, oracle = evaluate_response(turn, response, elapsed, client.exec_sql)
        record = {
            "record_type": "turn", "run_id": run_id, "attempt_id": attempt_id,
            "case_id": case["id"], "capability": case["capability"],
            "turn_index": turn_index, "mode": mode, "question": turn["question"],
            "raw_response": response.get("raw_response"),
            "raw_final": response.get("raw_final"),
            "final_text": response.get("final_text"),
            "sql": response.get("sql"), "data": response.get("data"),
            "assertions": assertions, "oracle": oracle,
            "elapsed_sec": round(elapsed, 3), "conv_uid": response.get("conv_uid"),
            "passed": all(item["passed"] for item in assertions),
        }
        if runtime_error:
            record["error"] = runtime_error
        handle.write(_json_line(record) + "\n")
        handle.flush()
        turn_records.append(record)
    errors = sum("error" in record for record in turn_records)
    failed = sum(not record["passed"] for record in turn_records) - errors
    status = "error" if errors else ("failed" if failed else "passed")
    case_end = {
        "record_type": "case_end", "run_id": run_id, "attempt_id": attempt_id,
        "case_id": case["id"], "title": case["title"], "capability": case["capability"],
        "status": status, "turn_count": len(turn_records),
        "passed_turns": len(turn_records) - failed - errors,
        "failed_turns": failed, "error_turns": errors,
        "elapsed_sec": round(time.perf_counter() - started, 3),
        "conv_uids": conversations,
    }
    handle.write(_json_line(case_end) + "\n")
    handle.flush()
    return case_end


def build_summary(records, run_id, selected_ids, scenario_hash, started_at, interrupted=False):
    latest = {}
    for record in records:
        if record.get("record_type") == "case_end" and record.get("case_id") in selected_ids:
            latest[record["case_id"]] = record
    cases = [latest[case_id] for case_id in selected_ids if case_id in latest]
    return {
        "run_id": run_id, "scenarios_sha256": scenario_hash,
        "started_at": started_at, "finished_at": datetime.now().astimezone().isoformat(),
        "interrupted": interrupted, "selected_cases": len(selected_ids),
        "completed_cases": len(cases), "passed_cases": sum(c["status"] == "passed" for c in cases),
        "failed_cases": sum(c["status"] == "failed" for c in cases),
        "error_cases": sum(c["status"] == "error" for c in cases),
        "turns": sum(c["turn_count"] for c in cases),
        "failed_turns": sum(c["failed_turns"] for c in cases),
        "error_turns": sum(c["error_turns"] for c in cases),
        "cases": cases,
    }


def write_outputs(run_dir, summary, records):
    run_dir = Path(run_dir)
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8"
    )
    lines = [
        "# 招生智能体业务测试报告", "",
        f"- 运行 ID：`{summary['run_id']}`",
        f"- 场景哈希：`{summary['scenarios_sha256']}`",
        f"- 完成：{summary['completed_cases']}/{summary['selected_cases']}；通过：{summary['passed_cases']}；失败：{summary['failed_cases']}；运行错误：{summary['error_cases']}",
        f"- 状态：{'中断' if summary['interrupted'] else '完成'}", "",
        "| 场景 | 能力 | 状态 | 轮数 | 耗时(s) | 失败原因 |",
        "|---|---|---:|---:|---:|---|",
    ]
    turns_by_attempt = {}
    for record in records:
        if record.get("record_type") == "turn":
            turns_by_attempt.setdefault(record.get("attempt_id"), []).append(record)
    for case in summary["cases"]:
        reasons = []
        for turn in turns_by_attempt.get(case.get("attempt_id"), []):
            for assertion in turn.get("assertions", []):
                if not assertion.get("passed"):
                    actual = str(assertion.get("actual", "未通过")).replace("\n", " ")[:160]
                    reasons.append(f"T{turn['turn_index']} {assertion['name']}: {actual}")
        reason = "<br>".join(reasons) or "-"
        values = [case["case_id"], case["capability"], case["status"],
                  str(case["turn_count"]), str(case["elapsed_sec"]), reason]
        values = [value.replace("|", "\\|") for value in values]
        lines.append("| " + " | ".join(values) + " |")
    (run_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def execute_run(selected, client, run_dir, run_id, scenario_hash, started_at,
                timeout, resume_records=None, metadata=None):
    resume_records = list(resume_records or [])
    done = completed_case_ids(resume_records)
    records_path = run_dir / "records.jsonl"
    interrupted = False
    with records_path.open("a", encoding="utf-8") as handle:
        if metadata is not None:
            handle.write(_json_line(metadata) + "\n")
            handle.flush()
        try:
            for case in selected:
                if case["id"] in done:
                    continue
                case_end = run_scenario(case, client, timeout, handle, run_id)
                print(f"{case['id']}: {case_end['status']} ({case_end['turn_count']} 轮)", flush=True)
        except KeyboardInterrupt:
            interrupted = True
            print("运行中断；未完成场景将在 resume 时整段重跑。", file=sys.stderr)
    records = resume_records + [
        record for record in read_jsonl(records_path)
        if record not in resume_records
    ]
    # 直接去重会保留历史记录，同时避免 resume_records 被重复计入。
    if resume_records:
        old_count = len(resume_records)
        records = resume_records + read_jsonl(records_path)[old_count:]
    summary = build_summary(
        records, run_id, [case["id"] for case in selected], scenario_hash,
        started_at, interrupted=interrupted,
    )
    write_outputs(run_dir, summary, records)
    return 1 if interrupted or summary["failed_cases"] or summary["error_cases"] or summary["completed_cases"] < len(selected) else 0


def _valid_base_url(value):
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _new_run_id():
    return datetime.now().strftime("%Y%m%d_%H%M%S_") + uuid.uuid4().hex[:8]


def build_parser():
    parser = argparse.ArgumentParser(description="招生智能体业务测试（默认仅运行 smoke）")
    parser.add_argument("--suite", choices=("smoke", "full"), help="运行套件，默认 smoke；resume 复用原选择")
    parser.add_argument("--case", action="append", help="场景 ID，可重复或逗号分隔")
    parser.add_argument("--tag", action="append", help="标签或 capability，可重复或逗号分隔")
    parser.add_argument("--base-url", help=f"服务地址，默认 {eval_agent.BASE}")
    parser.add_argument("--timeout", type=float, help="单轮超时秒数，默认 90")
    parser.add_argument("--resume", help="原运行 ID 或结果目录")
    parser.add_argument("--validate-only", action="store_true", help="只校验场景和筛选，不访问服务或数据库")
    parser.add_argument("--scenarios", default=str(DEFAULT_SCENARIOS), help=argparse.SUPPRESS)
    return parser


def main(argv=None, client=None, results_root=None):
    try:
        args = build_parser().parse_args(argv)
    except SystemExit as exc:
        return int(exc.code or 0)
    try:
        scenario_path = Path(args.scenarios).resolve()
        config = load_scenarios(scenario_path)
        scenario_hash = scenarios_sha256(scenario_path)
        if args.timeout is not None and args.timeout <= 0:
            raise ParameterError("--timeout 必须为正数")
        results_root = Path(results_root) if results_root else DEFAULT_RESULTS
        resume_records = []
        metadata = None
        if args.resume:
            resume_path = Path(args.resume)
            run_dir = resume_path if resume_path.is_absolute() else results_root / resume_path
            if not run_dir.is_dir() and resume_path.exists():
                run_dir = resume_path
            run_dir = run_dir.resolve()
            resume_records = read_jsonl(run_dir / "records.jsonl")
            starts = [r for r in resume_records if r.get("record_type") == "run_start"]
            if not starts:
                raise ParameterError("resume 目录缺少 run_start 元数据")
            original = starts[0]
            if original.get("scenarios_sha256") != scenario_hash:
                raise ParameterError("scenarios 哈希与原始运行不一致，禁止 resume")
            if args.suite or args.case or args.tag:
                raise ParameterError("--resume 不允许同时更改 --suite/--case/--tag")
            selected_ids = original.get("selected_case_ids") or []
            by_id = {case["id"]: case for case in config["scenarios"]}
            if not selected_ids or any(case_id not in by_id for case_id in selected_ids):
                raise ParameterError("resume 原始场景选择无效")
            selected = [by_id[case_id] for case_id in selected_ids]
            run_id = original["run_id"]
            started_at = original["started_at"]
            base_url = args.base_url or original["base_url"]
            timeout = args.timeout if args.timeout is not None else original["timeout"]
            metadata = {
                "record_type": "run_resume", "run_id": run_id,
                "scenarios_sha256": scenario_hash,
                "resumed_at": datetime.now().astimezone().isoformat(),
            }
        else:
            suite = args.suite or "smoke"
            selected = select_scenarios(config["scenarios"], suite, args.case, args.tag)
            base_url = args.base_url or eval_agent.BASE
            timeout = args.timeout if args.timeout is not None else 90.0
            run_id = _new_run_id()
            started_at = datetime.now().astimezone().isoformat()
            run_dir = (results_root / run_id).resolve()
        if not _valid_base_url(base_url):
            raise ParameterError(f"--base-url 无效: {base_url}")
        if args.validate_only:
            smoke_count = sum(case.get("smoke", False) for case in config["scenarios"])
            turns = sum(len(case["turns"]) for case in config["scenarios"])
            print(
                f"校验通过：{len(config['scenarios'])} 个场景（smoke {smoke_count}），"
                f"共 {turns} 轮；本次选择 {len(selected)} 个；SHA256={scenario_hash}"
            )
            return 0
        service = client or ServiceClient(base_url)
        try:
            service.preflight()
        except Exception as exc:
            raise ParameterError(f"服务预检失败: {type(exc).__name__}: {exc}") from exc
        if args.resume:
            run_dir.mkdir(parents=False, exist_ok=True)
        else:
            results_root.mkdir(parents=True, exist_ok=True)
            run_dir.mkdir(parents=False, exist_ok=False)
            metadata = {
                "record_type": "run_start", "run_id": run_id, "started_at": started_at,
                "scenarios_sha256": scenario_hash,
                "scenarios_path": str(scenario_path), "base_url": base_url, "timeout": timeout,
                "selected_case_ids": [case["id"] for case in selected],
            }
        print(f"结果目录：{run_dir}", flush=True)
        return execute_run(
            selected, service, run_dir, run_id, scenario_hash, started_at,
            timeout, resume_records=resume_records, metadata=metadata,
        )
    except ParameterError as exc:
        print(f"预检失败：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
