# agy_provider.py
import json
import subprocess

def call_api(prompt, options, context):
    config = options.get("config", {})
    model = config.get("model")

    cmd = ["agy", "--output-format", "json"]
    if model:
        cmd.extend(["--model", model])
    
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

        data = json.loads(res.stdout)
        return {
            "output": data.get("response", "")
        }
    except Exception as e:
        return {"error": str(e)}