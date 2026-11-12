import json
import xml.etree.ElementTree as ET
from unittest.mock import Mock

import pandas as pd
import pytest

from dbgpt_app.scene.chat_db.auto_execute.out_parser import (
    DbChatOutputParser,
    SqlAction,
)
from dbgpt_app.scene.exceptions import AppActionException


@pytest.fixture
def parser():
    return DbChatOutputParser()


def action(sql="", direct_response="", display="response_table"):
    return SqlAction(
        sql=sql,
        thoughts={},
        display=display,
        direct_response=direct_response,
    )


def view_content(view):
    element = ET.fromstring(view.split("\n", 1)[1])
    return json.loads(element.attrib["content"])


def test_parse_prompt_response_json(parser):
    result = parser.parse_prompt_response(
        json.dumps(
            {
                "thoughts": "查询录取数据",
                "sql": "SELECT * FROM whu_major",
                "display_type": "response_table",
                "direct_response": "",
            },
            ensure_ascii=False,
        )
    )

    assert result.sql == "SELECT * FROM whu_major"
    assert result.thoughts == "查询录取数据"
    assert result.display == "response_table"
    assert result.direct_response == ""


def test_parse_prompt_response_pure_sql(parser):
    result = parser.parse_prompt_response("SELECT * FROM whu_major")

    assert result == SqlAction(
        sql="SELECT * FROM whu_major",
        thoughts="",
        display="",
        direct_response="",
    )


def test_parse_prompt_response_direct_response(parser):
    result = parser.parse_prompt_response(
        '{"thoughts": "概念解释", "direct_response": "位次是全省排名"}'
    )

    assert result.sql == ""
    assert result.direct_response == "位次是全省排名"


def test_parse_view_response_quotes_numeric_alias(parser):
    executed = []

    def execute(sql):
        executed.append(sql)
        return pd.DataFrame([{"600分以上人数": 123}])

    view = parser.parse_view_response(
        "累计人数如下：",
        execute,
        action("SELECT 123 AS 600分以上人数"),
        preserve_speak=True,
    )

    expected_sql = 'SELECT 123 AS "600分以上人数"'
    assert executed == [expected_sql]
    content = view_content(view)
    assert content["sql"] == expected_sql
    assert content["data"] == [{"600分以上人数": 123}]


def test_parse_view_response_returns_normal_data(parser):
    view = parser.parse_view_response(
        "模型生成的猜测",
        lambda sql: pd.DataFrame([{"年份": 2024, "最低分": 623}]),
        action("SELECT year, min_score FROM whu_major"),
    )

    assert view.startswith("查询结果如下：\n")
    content = view_content(view)
    assert content["type"] == "response_table"
    assert content["data"] == [{"年份": 2024, "最低分": 623}]


def test_parse_view_response_empty_data_has_friendly_note(parser):
    view = parser.parse_view_response(
        "原始说明",
        lambda sql: pd.DataFrame(columns=["年份", "最低分"]),
        action("SELECT year, min_score FROM whu_major"),
    )

    assert "该条件下没有查到记录" in view
    assert view_content(view)["data"] == []


def test_parse_view_response_empty_model_response_has_friendly_note(parser):
    data = Mock()

    view = parser.parse_view_response("", data, action())

    assert "这次没能生成可用的查询结果" in view
    assert "Can not find sql in response" not in view
    data.assert_not_called()


def test_parse_view_response_direct_response_does_not_execute_sql(parser):
    data = Mock()

    view = parser.parse_view_response(
        "忽略此引导语",
        data,
        action(direct_response="一分一段表用于查看同分人数和累计人数。"),
    )

    assert view == "一分一段表用于查看同分人数和累计人数。\n"
    data.assert_not_called()


def test_parse_view_response_database_exception_is_action_error(parser):
    def execute(sql):
        raise RuntimeError("mock database failure")

    with pytest.raises(AppActionException) as exc_info:
        parser.parse_view_response(
            "查询如下", execute, action("SELECT * FROM whu_major")
        )

    assert "mock database failure" in exc_info.value.view
    assert "ERROR!" in exc_info.value.view

