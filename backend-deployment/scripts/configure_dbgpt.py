"""Register the admissions data source and knowledge space in local DB-GPT."""
import os

import requests


def main():
    base = "http://127.0.0.1:15670/api"
    with requests.Session() as session:
        session.trust_env = False

        def call(method, path, **kwargs):
            response = session.request(method, f"{base}/{path}", timeout=30, **kwargs)
            response.raise_for_status()
            result = response.json()
            if result.get("success") is not True:
                raise RuntimeError(f"DB-GPT configuration request failed: {path}")
            return result.get("data")

        database = os.environ["DB_MCP_PG_DB"]
        if not call("GET", "v1/chat/db/list", params={"db_name": database}):
            call("POST", "v1/chat/db/add", json={
                "db_name": database,
                "db_type": "postgresql",
                "db_host": os.environ["DB_MCP_PG_HOST"],
                "db_port": int(os.environ["DB_MCP_PG_PORT"]),
                "db_user": os.environ["DB_MCP_PG_USER"],
                "db_pwd": os.environ["DB_MCP_PG_PASSWORD"],
                "comment": "武汉大学湖北招生公开数据",
            })

        space = "whu_admission"
        if not call("POST", "v1/knowledge/space/list", json={"name": space}):
            call("POST", "v1/knowledge/space/add", json={
                "name": space, "vector_type": "VectorStore", "desc": "武汉大学招生政策",
            })

        connectors = "v2/serve/connectors/"
        display_name = "招生数据只读查询"
        registered = call("GET", connectors) or []
        if not any(item["display_name"] == display_name for item in registered):
            call("POST", connectors, json={
                "connector_type": "custom_mcp", "display_name": display_name, "credentials": {},
                "config": {"server_uri": "http://127.0.0.1:8765/sse", "transport": "sse"},
            })
    print("Admissions data source, knowledge space, and MCP connector ready.")


if __name__ == "__main__":
    main()
