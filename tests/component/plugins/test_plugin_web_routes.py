"""The plugin HTTP routes serve a plugin from install through reload to disable."""
from __future__ import annotations

import textwrap

from tests.unit.plugins.test_plugin_runtime import SETUP, plugin_home, write_plugin  # noqa: F401 — fixture


def test_web_routes_serve_a_plugin_from_install_to_reload(plugin_home):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from openprogram.programs._runtime import get
    from openprogram.webui.routes.catalog import plugins as routes

    root = write_plugin(plugin_home / "src" / "web-demo", "web-demo", SETUP.format(suffix="!"),
                        client="./ui/client.js",
                        sidebar=[{"label": "Demo", "label_zh": "演示", "page": "index.html"}])
    (root / "ui").mkdir()
    (root / "ui" / "client.js").write_text("export default (api) => {};\n", encoding="utf-8")
    (root / "secret.txt").write_text("not served", encoding="utf-8")
    app = FastAPI()
    routes.register(app)
    client = TestClient(app)

    installed = client.post("/api/plugins/install", json={"source": "path", "spec": str(root)}).json()
    assert installed["success"], installed
    enabled = client.post("/api/plugins/web-demo/toggle", json={"enabled": True}).json()
    assert enabled["loaded"] and get("shout") is not None
    assert enabled["contributions"]["tools"] == ["shout"]

    module = client.get("/api/plugins/client").json()["modules"][0]
    assert module["plugin"] == "web-demo"
    served = client.get(module["url"])
    assert served.status_code == 200 and "javascript" in served.headers["content-type"]
    assert client.get("/api/plugins/web-demo/client/secret.txt").status_code == 404
    assert client.get("/api/plugins/web-demo/client/ui/../secret.txt").status_code == 404
    item = client.get("/api/plugins/sidebar").json()["items"][0]
    assert item["href"] == "/plugin/web-demo/index.html" and item["label_zh"] == "演示"
    assert "plugin.settings" in client.get("/api/plugins/inspect").json()["client_slots"]

    (root / "plugin.py").write_text(textwrap.dedent(SETUP.format(suffix="?")), encoding="utf-8")
    assert client.post("/api/plugins/web-demo/reload").json()["loaded"]
    assert get("shout")._python_callable(text="a") == "A?"

    assert not client.post("/api/plugins/web-demo/toggle", json={"enabled": False}).json()["loaded"]
    assert get("shout") is None
    assert client.get("/api/plugins/client").json()["modules"] == []
    assert client.get("/api/plugins/sidebar").json()["items"] == []
