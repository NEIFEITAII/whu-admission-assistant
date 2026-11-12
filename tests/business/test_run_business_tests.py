# -*- coding: utf-8 -*-
import copy
import json
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from business_tests import run_business_tests as bt


def make_response(text="正常回答", data=None, sql=None, raw=None):
    return {
        "conv_uid": "conv-1",
        "raw_response": text if raw is None else raw,
        "raw_final": text,
        "final_text": text,
        "sql": sql,
        "data": data,
    }


def evaluate(turn, response, elapsed=0.1, sql_executor=None):
    assertions, oracle = bt.evaluate_response(turn, response, elapsed, sql_executor)
    return {item["name"]: item for item in assertions}, oracle


def make_turn(question="问题", mode="chat_with_db_execute", **assertions):
    return {"mode": mode, "question": question, **assertions}


def make_case(case_id="case_a", turns=None, smoke=True):
    return {
        "id": case_id,
        "title": case_id,
        "capability": "multi_turn" if turns and len(turns) > 1 else "robustness",
        "tags": ["fake"],
        "smoke": smoke,
        "turns": turns or [make_turn(case_id + "_q")],
    }


def write_config(path, cases):
    config = {"version": 1, "scenarios": cases}
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    return config


class FakeClient:
    def __init__(self, answers=None, interrupt_on=None, runtime_error_on=None):
        self.answers = answers or {}
        self.interrupt_on = set(interrupt_on or [])
        self.runtime_error_on = set(runtime_error_on or [])
        self.calls = []
        self.sql_calls = []
        self.preflight_calls = 0
        self.mode_counts = {}

    def preflight(self):
        self.preflight_calls += 1
        return "preflight-conv"

    def ask(self, mode, question, timeout=120, conv_uid=None):
        self.calls.append({
            "mode": mode, "question": question, "timeout": timeout, "conv_uid": conv_uid,
        })
        if question in self.interrupt_on:
            raise KeyboardInterrupt()
        if question in self.runtime_error_on:
            raise RuntimeError("模拟服务异常")
        if conv_uid is None:
            self.mode_counts[mode] = self.mode_counts.get(mode, 0) + 1
            conv_uid = f"{mode}-{self.mode_counts[mode]}"
        answer = self.answers.get(question, "正常回答")
        if isinstance(answer, str):
            answer = {"final_text": answer}
        result = make_response(answer.get("final_text", "正常回答"))
        result.update(answer)
        result["conv_uid"] = conv_uid
        result.setdefault("raw_response", result.get("final_text", ""))
        return result

    def exec_sql(self, sql):
        self.sql_calls.append(sql)
        return {"cols": ["value"], "rows": [[1]]}


def test_real_scenarios_schema_and_coverage():
    config = bt.load_scenarios()
    cases = config["scenarios"]
    assert len(cases) == 24
    assert sum(case.get("smoke", False) for case in cases) == 8
    assert sum(len(case["turns"]) for case in cases) == 29
    assert {case["capability"] for case in cases} == bt.CAPABILITIES
    assert {turn["mode"] for case in cases for turn in case["turns"]} == bt.MODES
    multi = [case for case in cases if case["capability"] == "multi_turn"]
    assert any(len({turn["mode"] for turn in case["turns"]}) == 1 for case in multi)
    assert any(len({turn["mode"] for turn in case["turns"]}) > 1 for case in multi)
    assert all(report["turns"][0]["question"].find("快报") >= 0
               for report in cases if report["capability"] == "report")


def test_schema_rejects_bad_mode_pairs_and_write_sql():
    valid = {"version": 1, "scenarios": [make_case()]}
    assert bt.validate_scenarios(valid) == []
    bad = copy.deepcopy(valid)
    bad["scenarios"][0]["turns"][0]["mode"] = "unknown"
    bad["scenarios"][0]["turns"][0]["paired_values"] = [[647], 3218]
    bad["scenarios"][0]["turns"][0]["oracle_sql"] = "DELETE FROM hubei_score_ranks"
    errors = bt.validate_scenarios(bad)
    assert any("mode" in error for error in errors)
    assert any("paired_values" in error for error in errors)
    assert any("SELECT" in error for error in errors)


def test_read_only_sql_accepts_cte_and_rejects_multiple_statements():
    assert bt.validate_read_only_sql(" WITH x AS (SELECT 1) SELECT * FROM x; ").startswith("WITH")
    for sql in (
        "SELECT 1; SELECT 2",
        "WITH x AS (DELETE FROM t RETURNING id) SELECT * FROM x",
        "SELECT * FROM t FOR UPDATE",
        "SELECT 1 -- comment",
        "UPDATE t SET value = 1",
    ):
        with pytest.raises(ValueError):
            bt.validate_read_only_sql(sql)


def test_sse_parsers_use_knowledge_deltas_and_only_react_final():
    knowledge_raw = (
        'data: {"choices":[{"delta":{"content":"国家"}}]}\n\n'
        'data: {"choices":[{"delta":{"content":"专项"}}]}\n\n'
        'data: {"choices":[{"delta":{"content":"计划"}}]}\n\n'
        'data: [DONE]\n'
    )
    assert bt.parse_knowledge_sse(knowledge_raw) == "国家专项计划"
    react_raw = (
        'data: {"type":"step.start","title":"sql_query"}\n\n'
        'data: {"type":"step.chunk","output_type":"markdown","content":"Thought: 中间推理"}\n\n'
        'data: {"type":"final","content":"最低分634，对应位次4125。"}\n\n'
        'data: {"type":"done"}\n'
    )
    final = bt.parse_react_sse(react_raw)
    assert final == "最低分634，对应位次4125。"
    assert "Thought" not in final


def test_service_client_payloads_and_execute_reuse(monkeypatch):
    monkeypatch.setattr(bt.eval_agent, "BASE", "http://original")
    created = []
    posts = []

    def factory(mode):
        created.append(mode)
        return f"uid-{mode}"

    def post(url, payload, timeout):
        posts.append((url, payload, timeout))
        if url.endswith("react-agent"):
            return 'data: {"type":"final","content":"最终答案"}\n'
        return 'data: {"choices":[{"delta":{"content":"知识答案"}}]}\n'

    execute_ask = Mock(return_value={
        "conv_uid": "uid-chat_with_db_execute", "raw_final": "查询结果",
        "thoughts": "查询结果", "sql": "SELECT 1", "data": [{"value": 1}],
    })
    client = bt.ServiceClient(
        "http://service/", http_post_json=post, conversation_factory=factory,
        execute_ask=execute_ask, sql_executor=Mock(),
    )
    knowledge = client.ask("chat_knowledge", "政策", timeout=9)
    react = client.ask("chat_with_db_react", "数据", timeout=8)
    execute = client.ask("chat_with_db_execute", "计划", timeout=7)

    assert knowledge["final_text"] == "知识答案"
    assert react["final_text"] == "最终答案"
    assert execute["sql"] == "SELECT 1"
    assert created == ["chat_knowledge", "chat_with_db_execute", "chat_with_db_execute"]
    knowledge_payload = posts[0][1]
    assert posts[0][0] == "http://service/api/v1/chat/completions"
    assert knowledge_payload["select_param"] == "whu_admission"
    assert knowledge_payload["incremental"] is True
    react_payload = posts[1][1]
    assert posts[1][0] == "http://service/api/v1/chat/react-agent"
    assert react_payload["chat_mode"] == "chat_with_db_execute"
    assert react_payload["incremental"] is False
    assert react_payload["ext_info"] == {
        "database_name": "admission_agent", "knowledge_space": "whu_admission",
    }
    execute_ask.assert_called_once_with("计划", timeout=7, conv_uid="uid-chat_with_db_execute")


def test_text_numeric_assertions_support_commas_and_decimal_equivalence():
    turn = make_turn(
        contains_all=["位次"], contains_any=["累计", "全省"],
        forbidden=["错误词"], expected_values=[647, 3218],
        paired_values=[647, 3218], max_elapsed=1,
    )
    result, _ = evaluate(turn, make_response("物理647分，累计3,218位次。"))
    assert all(item["passed"] for item in result.values())
    data = [{"年份": "2024", "分数": 647.0, "位次": "3,218"}]
    result, _ = evaluate(make_turn(expected_values=[2024, 647, 3218], paired_values=[647, 3218]),
                         make_response("查询结果", data=data))
    assert result["expected_values"]["passed"]
    assert result["paired_values"]["passed"]


def test_numeric_expected_value_does_not_match_substring():
    result, _ = evaluate(
        make_turn(expected_values=[647, 3218]),
        make_response("错误数值1647和13218"),
    )
    assert not result["expected_values"]["passed"]
    assert result["expected_values"]["actual"] == [647, 3218]


def test_paired_values_reject_cross_row_and_cross_line_combinations():
    rows = [{"score": 647, "rank": 9999}, {"score": 650, "rank": 3218}]
    result, _ = evaluate(
        make_turn(expected_values=[647, 3218], paired_values=[647, 3218]),
        make_response("查询结果", data=rows),
    )
    assert result["expected_values"]["passed"]
    assert not result["paired_values"]["passed"]
    result, _ = evaluate(
        make_turn(paired_values=[647, 3218]),
        make_response("647分\n3218位次"),
    )
    assert not result["paired_values"]["passed"]
    result, _ = evaluate(
        make_turn(paired_values=[647, 3218]),
        make_response("647分对应3218位次"),
    )
    assert result["paired_values"]["passed"]


def test_sql_row_count_and_elapsed_assertions():
    turn = make_turn(sql_required=True, min_rows=2, row_count=2, max_elapsed=0.01)
    result, _ = evaluate(turn, make_response("查询", data=[{"x": 1}], sql=None), elapsed=0.02)
    assert not result["sql_required"]["passed"]
    assert not result["min_rows"]["passed"]
    assert not result["row_count"]["passed"]
    assert not result["max_elapsed"]["passed"]
    good = make_response("查询", data=[{"x": 1}, {"x": 2}], sql="SELECT 1")
    result, _ = evaluate(turn, good, elapsed=0.001)
    assert all(result[key]["passed"] for key in ("sql_required", "min_rows", "row_count", "max_elapsed"))


def test_clarification_requires_each_slot_and_question_cue():
    turn = make_turn(clarify_slots=[["分数", "成绩"], ["科类", "选科"]])
    result, _ = evaluate(turn, make_response("请补充高考分数和选科类别，才能进一步判断？"))
    assert result["clarify_slots"]["passed"]
    result, _ = evaluate(turn, make_response("请提供高考分数。"))
    assert not result["clarify_slots"]["passed"]
    result, _ = evaluate(turn, make_response("分数和科类是判断条件。"))
    assert not result["clarify_slots"]["passed"]


@pytest.mark.parametrize("marker", bt.SYSTEM_ERROR_MARKERS)
def test_system_error_markers_fail_by_default(marker):
    result, _ = evaluate(make_turn(), make_response(f"回答中出现{marker}"))
    assert not result["system_error"]["passed"]
    assert marker in result["system_error"]["actual"]


def test_raw_server_error_and_empty_answer_fail():
    result, _ = evaluate(make_turn(), make_response("<span>ERROR!</span>Model server error", raw="data: [SERVER_ERROR]boom"))
    assert not result["system_error"]["passed"]
    result, _ = evaluate(make_turn(), make_response("  ", data=[]))
    assert not result["non_empty"]["passed"]
    result, _ = evaluate(make_turn(), make_response("", data=[{"value": 1}]))
    assert result["non_empty"]["passed"]


def test_oracle_sql_compares_real_baseline_and_calls_executor():
    calls = []

    def executor(sql):
        calls.append(sql)
        return {"cols": ["year", "total"], "rows": [[2024, 1698]]}

    turn = make_turn(oracle_sql="SELECT year, total FROM plan_summary WHERE year = 2024")
    result, oracle = evaluate(
        turn, make_response("2024年总计划1698人", data=[{"year": 2024, "total": 1698}]),
        sql_executor=executor,
    )
    assert result["oracle_sql"]["passed"]
    assert oracle["rows"] == [[2024, 1698]]
    assert calls == ["SELECT year, total FROM plan_summary WHERE year = 2024"]
    result, _ = evaluate(turn, make_response("没有数字"), sql_executor=lambda sql: {"rows": []})
    assert not result["oracle_sql"]["passed"]


def test_validate_only_does_not_touch_network(capsys):
    client = Mock()
    client.preflight.side_effect = AssertionError("不应访问网络")
    code = bt.main(["--validate-only", "--suite", "full"], client=client)
    assert code == 0
    client.preflight.assert_not_called()
    assert "24 个场景" in capsys.readouterr().out


def test_main_exit_zero_and_result_files(tmp_path):
    question = bt.load_scenarios()["scenarios"][0]["turns"][0]["question"]
    client = FakeClient({question: "国家专项要求符合户籍和学籍等报考条件。"})
    code = bt.main(["--case", "policy_01_national_special"], client=client, results_root=tmp_path)
    assert code == 0
    run_dir = next(tmp_path.iterdir())
    summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    assert summary["passed_cases"] == 1
    assert summary["failed_cases"] == 0
    assert "policy_01_national_special" in (run_dir / "report.md").read_text(encoding="utf-8")
    records = bt.read_jsonl(run_dir / "records.jsonl")
    turn = next(record for record in records if record["record_type"] == "turn")
    for key in ("raw_response", "final_text", "sql", "data", "assertions", "elapsed_sec", "conv_uid"):
        assert key in turn
    assert any(record["record_type"] == "case_end" for record in records)


def test_main_exit_one_for_assertion_and_runtime_error(tmp_path):
    case_id = "policy_01_national_special"
    failed = FakeClient({" irrelevant ": "无关"})
    code = bt.main(["--case", case_id], client=failed, results_root=tmp_path / "failed")
    assert code == 1
    failed_dir = next((tmp_path / "failed").iterdir())
    summary = json.loads((failed_dir / "summary.json").read_text(encoding="utf-8"))
    assert summary["failed_cases"] == 1

    question = bt.load_scenarios()["scenarios"][0]["turns"][0]["question"]
    runtime = FakeClient(runtime_error_on={question})
    code = bt.main(["--case", case_id], client=runtime, results_root=tmp_path / "runtime")
    assert code == 1
    runtime_dir = next((tmp_path / "runtime").iterdir())
    summary = json.loads((runtime_dir / "summary.json").read_text(encoding="utf-8"))
    assert summary["error_cases"] == 1
    records = bt.read_jsonl(runtime_dir / "records.jsonl")
    assert any(record.get("error") == "RuntimeError: 模拟服务异常" for record in records)


def test_main_exit_two_for_bad_parameter_and_preflight(tmp_path):
    assert bt.main(["--validate-only", "--timeout", "0"], client=Mock(), results_root=tmp_path) == 2
    client = FakeClient()
    client.preflight = Mock(side_effect=ConnectionError("offline"))
    code = bt.main(["--case", "policy_01_national_special"], client=client, results_root=tmp_path)
    assert code == 2
    assert not list(tmp_path.iterdir())


def test_resume_skips_complete_and_reruns_whole_interrupted_case(tmp_path):
    scenario_path = tmp_path / "scenarios.json"
    write_config(scenario_path, [
        make_case("case_a", [make_turn("a1")]),
        make_case("case_b", [make_turn("b1"), make_turn("b2")]),
    ])
    first = FakeClient(interrupt_on={"b2"})
    code = bt.main(
        ["--scenarios", str(scenario_path), "--suite", "full"],
        client=first, results_root=tmp_path / "results",
    )
    assert code == 1
    run_dir = next((tmp_path / "results").iterdir())
    run_id = run_dir.name
    records = bt.read_jsonl(run_dir / "records.jsonl")
    assert "case_a" in bt.completed_case_ids(records)
    assert "case_b" not in bt.completed_case_ids(records)
    assert [call["question"] for call in first.calls] == ["a1", "b1", "b2"]

    resumed = FakeClient()
    code = bt.main(
        ["--scenarios", str(scenario_path), "--resume", run_id],
        client=resumed, results_root=tmp_path / "results",
    )
    assert code == 0
    assert [call["question"] for call in resumed.calls] == ["b1", "b2"]
    assert resumed.calls[1]["conv_uid"] == "chat_with_db_execute-1"
    assert len(list((tmp_path / "results").iterdir())) == 1
    records = bt.read_jsonl(run_dir / "records.jsonl")
    assert sum(r.get("record_type") == "turn" and r.get("question") == "b1" for r in records) == 2
    assert sum(r.get("record_type") == "case_end" and r.get("case_id") == "case_b" for r in records) == 1
    summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    assert summary["completed_cases"] == 2
    assert summary["passed_cases"] == 2


def test_resume_rejects_scenarios_hash_change(tmp_path):
    scenario_path = tmp_path / "scenarios.json"
    write_config(scenario_path, [make_case("case_a", [make_turn("a1")])])
    results_root = tmp_path / "results"
    assert bt.main(
        ["--scenarios", str(scenario_path), "--suite", "full"],
        client=FakeClient(), results_root=results_root,
    ) == 0
    run_id = next(results_root.iterdir()).name
    config = json.loads(scenario_path.read_text(encoding="utf-8"))
    config["scenarios"][0]["turns"][0]["question"] = "已修改"
    scenario_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
    resumed = FakeClient()
    assert bt.main(
        ["--scenarios", str(scenario_path), "--resume", run_id],
        client=resumed, results_root=results_root,
    ) == 2
    assert resumed.calls == []
    assert resumed.preflight_calls == 0


def test_runner_reuses_conversation_independently_for_each_mode(tmp_path):
    scenario_path = tmp_path / "scenarios.json"
    turns = [
        make_turn("e1", "chat_with_db_execute"),
        make_turn("e2", "chat_with_db_execute"),
        make_turn("k1", "chat_knowledge"),
        make_turn("k2", "chat_knowledge"),
        make_turn("r1", "chat_with_db_react"),
        make_turn("r2", "chat_with_db_react"),
    ]
    write_config(scenario_path, [make_case("modes", turns)])
    client = FakeClient()
    assert bt.main(
        ["--scenarios", str(scenario_path), "--suite", "full"],
        client=client, results_root=tmp_path / "results",
    ) == 0
    by_question = {call["question"]: call for call in client.calls}
    assert by_question["e2"]["conv_uid"] == "chat_with_db_execute-1"
    assert by_question["k2"]["conv_uid"] == "chat_knowledge-1"
    assert by_question["r2"]["conv_uid"] == "chat_with_db_react-1"
    assert len({by_question[q]["conv_uid"] for q in ("e2", "k2", "r2")}) == 3
