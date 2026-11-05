# agy_provider.py
import json
import subprocess

def call_api(prompt, options, context):
    """
    Кастомный провайдер Promptfoo (docs/providers/python/),
    вызывающий Google Antigravity CLI в headless-режиме (docs/cli/headless/).
    """
    config = options.get("config", {})
    model = config.get("model")

    # Формируем команду agy. Диагностика идет в stderr, ответ — в stdout.
    cmd = ["agy", "--output-format", "json"]
    if model:
        cmd.extend(["--model", model])
    
    # Важно: флаг -p с промптом передается последним аргументом
    cmd.extend(["-p", prompt])

    try:
        res = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False
        )
        if res.returncode != 0:
            return {"error": f"agy error (code {res.returncode}): {res.stderr.strip()}"}

        # Разбираем JSON-конверт: {"conversation_id": "...", "status": "SUCCESS", "response": "..."}
        data = json.loads(res.stdout)
        return {
            "output": data.get("response", "")
        }
    except Exception as e:
        return {"error": str(e)}