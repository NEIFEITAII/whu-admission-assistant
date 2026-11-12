import datetime
import decimal
import json
from unittest.mock import patch

import pytest

import db_mcp_server


@pytest.fixture
def connection():
    with patch.object(db_mcp_server, "_connect") as connect:
        conn = connect.return_value.__enter__.return_value
        cursor = conn.cursor.return_value.__enter__.return_value
        yield connect, conn, cursor


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT year, min_score FROM whu_school_summary;",
        "WITH selected AS (SELECT 623 AS min_score) SELECT * FROM selected",
    ],
    ids=["select", "with"],
)
def test_run_sql_allows_read_only_select_and_with(connection, sql):
    connect, conn, cursor = connection
    cursor.description = [("min_score",)]
    cursor.fetchall.return_value = [(623,)]

    result = json.loads(db_mcp_server.run_sql(sql))

    assert result == {
        "columns": ["min_score"],
        "rows": [[623]],
        "row_count": 1,
    }
    cursor.execute.assert_called_once_with(sql.strip().rstrip(";"))
    connect.assert_called_once_with()


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM whu_school_summary",
        "UPDATE whu_school_summary SET min_score = 0",
        "INSERT INTO whu_school_summary VALUES (2024)",
        "DROP TABLE whu_school_summary",
    ],
)
def test_run_sql_rejects_writes_without_connecting(sql):
    with patch.object(db_mcp_server, "_connect") as connect:
        result = json.loads(db_mcp_server.run_sql(sql))

    assert result == {"error": "仅允许只读查询（SELECT / WITH）"}
    connect.assert_not_called()


def test_list_tables_queries_public_tables_and_returns_names(connection):
    connect, conn, cursor = connection
    cursor.fetchall.return_value = [("hubei_score_ranks",), ("whu_school_summary",)]

    result = json.loads(db_mcp_server.list_tables())

    assert result == ["hubei_score_ranks", "whu_school_summary"]
    executed_sql = cursor.execute.call_args.args[0]
    assert "information_schema.tables" in executed_sql
    assert "table_schema = 'public'" in executed_sql
    assert "ORDER BY table_name" in executed_sql
    connect.assert_called_once_with()


def test_describe_table_passes_table_name_and_returns_columns(connection):
    connect, conn, cursor = connection
    cursor.fetchall.return_value = [("year", "integer"), ("min_score", "numeric")]

    result = json.loads(db_mcp_server.describe_table("whu_school_summary"))

    assert result == {
        "table": "whu_school_summary",
        "columns": [
            {"name": "year", "type": "integer"},
            {"name": "min_score", "type": "numeric"},
        ],
    }
    args, kwargs = cursor.execute.call_args
    assert "information_schema.columns" in args[0]
    assert "table_name = %s" in args[0]
    assert args[1] == ("whu_school_summary",)
    assert kwargs == {}
    connect.assert_called_once_with()


def test_run_sql_serializes_decimal_date_and_datetime(connection):
    connect, conn, cursor = connection
    cursor.description = [("score",), ("day",), ("created_at",)]
    cursor.fetchall.return_value = [
        (
            decimal.Decimal("598.50"),
            datetime.date(2024, 7, 1),
            datetime.datetime(2024, 7, 1, 12, 30, 45),
        )
    ]

    result = json.loads(db_mcp_server.run_sql("SELECT score, day, created_at FROM t"))

    assert result["rows"] == [[598.5, "2024-07-01", "2024-07-01T12:30:45"]]
    assert result["row_count"] == 1


def test_run_sql_database_exception_returns_error_json():
    with patch.object(
        db_mcp_server, "_connect", side_effect=RuntimeError("mock connection failed")
    ) as connect:
        result = json.loads(db_mcp_server.run_sql("SELECT 1"))

    assert result == {"error": "mock connection failed"}
    connect.assert_called_once_with()
