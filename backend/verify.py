# -*- coding: utf-8 -*-
"""部署自检：确认数据库可连接、各表行数与预期一致。

用法：
    $env:DB_MCP_PG_PASSWORD="你的postgres密码"
    python verify.py
"""
import os
import sys

import psycopg2

EXPECTED = {
    "hubei_score_ranks": 4442,
    "hubei_major_admissions": 482,
    "whu_group_admissions": 78,
    "whu_major_records": 515,
    "whu_school_summary": 54,
    "whu_data_coverage": 8,
}


def main() -> int:
    conn = psycopg2.connect(
        host=os.environ.get("DB_MCP_PG_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_MCP_PG_PORT", "5432")),
        dbname=os.environ.get("DB_MCP_PG_DB", "admission_agent"),
        user=os.environ.get("DB_MCP_PG_USER", "postgres"),
        password=os.environ.get("DB_MCP_PG_PASSWORD", ""),
        options="-c client_encoding=UTF8",
    )
    conn.autocommit = True
    cur = conn.cursor()

    failed = 0
    for table, expected in EXPECTED.items():
        try:
            cur.execute(f"SELECT COUNT(*) FROM public.{table}")
            actual = cur.fetchone()[0]
        except psycopg2.Error as exc:
            print(f"[缺失] {table}: {exc.__class__.__name__}")
            failed += 1
            conn.rollback()
            continue
        mark = "OK  " if actual == expected else "差异"
        if actual != expected:
            failed += 1
        print(f"[{mark}] {table:<24} 实际 {actual}，预期 {expected}")

    # 抽样核对典型数值
    checks = [
        ("2024 物理 647 分位次", "SELECT cumulative_count FROM hubei_score_ranks "
         "WHERE year='2024' AND category_norm='物理' AND score=647", 3218),
        ("2025 招生计划总数", "SELECT SUM(plan_count) FROM hubei_major_admissions "
         "WHERE year='2025'", 1704),
    ]
    for label, sql, expected in checks:
        cur.execute(sql)
        actual = int(cur.fetchone()[0])
        if actual != expected:
            failed += 1
            print(f"[差异] {label}: 实际 {actual}，预期 {expected}")
        else:
            print(f"[OK  ] {label}: {actual}")

    cur.close()
    conn.close()

    if failed:
        print(f"\n自检未通过，共 {failed} 项异常。请检查建表与数据导入是否完整。")
        return 1
    print("\n自检通过：数据库结构与数据均符合预期。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
