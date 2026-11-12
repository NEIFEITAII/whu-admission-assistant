import pytest

from dbgpt_app.scene.chat_db.auto_execute.chat import (
    _needs_sql,
    _normalize_admission_sql,
)


@pytest.mark.parametrize("question", ["", "你好", "hello", "谢谢"])
def test_needs_sql_allows_empty_input_and_greetings(question):
    assert _needs_sql(question) is False


@pytest.mark.parametrize(
    "question",
    ["一分一段表怎么看", "同分考生怎么确定位次", "什么是专业组"],
)
def test_needs_sql_allows_concept_questions(question):
    assert _needs_sql(question) is False


@pytest.mark.parametrize(
    "question",
    ["2024年物理类600分有多少人", "武汉大学去年录取位次", "今年招生计划是多少"],
)
def test_needs_sql_detects_data_intent(question):
    assert _needs_sql(question) is True


def test_last_year_min_rank_without_scope_uses_previous_year_all_categories():
    original = "SELECT min_rank FROM admission WHERE category = '普通类' LIMIT 1"

    normalized = _normalize_admission_sql("武汉大学去年最低录取位次是多少", original)

    assert "FROM whu_school_summary" in normalized
    assert "CURRENT_DATE - INTERVAL '1 year'" in normalized
    assert "subject_type AS 科类" in normalized
    assert "category AS 招生类别" in normalized
    assert "category = '普通类'" not in normalized
    assert "LIMIT 1" not in normalized


@pytest.mark.parametrize(
    "question",
    [
        "武汉大学去年物理类最低录取位次是多少",
        "武汉大学去年普通类最低录取位次是多少",
        "武汉大学去年国家专项最低录取位次是多少",
    ],
    ids=["subject", "regular_category", "special_category"],
)
def test_last_year_min_rank_with_explicit_scope_is_not_rewritten(question):
    original = "SELECT min_rank FROM whu_school_summary WHERE year = '2023'"

    assert _normalize_admission_sql(question, original) == original


def test_computer_major_exact_match_becomes_like():
    original = "SELECT * FROM whu_major m WHERE m.major_name = '计算机类'"

    normalized = _normalize_admission_sql("计算机类录取分数是多少", original)

    assert "m.major_name LIKE '%计算机%'" in normalized
    assert "m.major_name = '计算机类'" not in normalized


def test_physics_chemistry_score_distribution_uses_min_score_and_all_categories():
    original = (
        "SELECT MAX(m.max_score) FROM whu_major m "
        "WHERE category = '普通类' AND m.min_score IS NOT NULL"
    )

    normalized = _normalize_admission_sql("物理+化学考生分数段如何分布", original)

    assert "MAX(min_score)" in normalized
    assert "max_score" not in normalized
    assert "category = '普通类'" not in normalized
    assert "WHERE m.min_score IS NOT NULL" in normalized


def test_explicit_regular_category_is_preserved_for_score_distribution():
    original = (
        "SELECT MAX(max_score) FROM whu_major "
        "WHERE category = '普通类' AND min_score IS NOT NULL"
    )

    normalized = _normalize_admission_sql(
        "物理＋化学普通类分数分布如何", original
    )

    assert "MAX(min_score)" in normalized
    assert "category = '普通类'" in normalized


def test_unrelated_sql_is_unchanged():
    original = "SELECT major_name, min_score FROM whu_major WHERE year = 2024"

    assert _normalize_admission_sql("2024年录取分数是多少", original) == original
