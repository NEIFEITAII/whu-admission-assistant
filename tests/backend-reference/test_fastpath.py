import pytest

from dbgpt_app.scene.chat_db.auto_execute.fastpath import match_fast_sql


@pytest.mark.parametrize(
    ("question", "signature"),
    [
        ("2024年湖北物理类600分以上一共有多少人", "above:2024:物理:600"),
        ("2024年历史科650分及以上有多少考生", "above:2024:历史:650"),
        ("2024年湖北物理类最高分是多少", "max:2024:物理"),
        ("2024年历史类最高能考到多少分", "max:2024:历史"),
        (
            "2024年湖北物理类全省排第10000名大概多少分",
            "rank2score:2024:物理:10000",
        ),
        ("2024年历史类位次第8000名相当于多少分", "rank2score:2024:历史:8000"),
        ("2024年湖北物理类考580分在全省能排多少名", "score2rank:2024:物理:580"),
        ("2024年历史类650分对应多少位次", "score2rank:2024:历史:650"),
    ],
)
def test_match_fast_sql_four_intents_and_synonyms(question, signature):
    result = match_fast_sql("admission_agent", question)

    assert result is not None
    assert result.signature == signature
    assert result.display == "response_table"
    assert result.sql


def test_rank_to_score_uses_first_cumulative_rank_and_descending_score():
    result = match_fast_sql(
        "admission_agent", "2024年湖北物理类全省排第10000名大概多少分"
    )

    assert result is not None
    assert "cumulative_count >= 10000" in result.sql
    assert "ORDER BY score DESC LIMIT 1" in result.sql


@pytest.mark.parametrize(
    "question",
    [
        "2023年和2024年物理类600分以上有多少人",
        "2024年物理类和历史类600分以上分别有多少人",
        "2024年物理类600分以上人数的变化趋势如何",
        "2024年物理类600分以上有多少人" + "请详细说明" * 30,
    ],
    ids=["cross_year", "two_subjects", "trend", "too_long"],
)
def test_ambiguous_or_overlong_questions_fall_back(question):
    assert match_fast_sql("admission_agent", question) is None


def test_other_database_falls_back():
    assert (
        match_fast_sql("other_db", "2024年湖北物理类600分以上一共有多少人") is None
    )
