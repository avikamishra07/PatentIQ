"""
Standalone Groq check for PatentIQ. Run from the backend folder:

    .\\venv\\Scripts\\python.exe check_groq.py

It reads backend/.env (found relative to this file), sends the same kind of request the
Innovation Assistant sends, and prints what came back. It NEVER prints your API key.
"""
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent / ".env"
print(f".env path : {ENV_PATH}  ({'found' if ENV_PATH.is_file() else 'NOT FOUND'})")
load_dotenv(ENV_PATH, override=True, encoding="utf-8-sig")

key = (os.environ.get("GROQ_API_KEY") or "").strip().strip("\"'")
model = (os.environ.get("PATENTIQ_GROQ_MODEL") or "openai/gpt-oss-20b").strip().strip("\"'")
effort = (os.environ.get("PATENTIQ_GROQ_REASONING_EFFORT") or "low").strip().lower()

print(f"key       : {'present' if key else 'MISSING'}, "
      f"length={len(key)}, starts with 'gsk_': {key.startswith('gsk_')}")
print(f"model     : {model}")
if not key or re.search(r"replace[_-]?with|your[_-]?(groq[_-]?)?api[_-]?key", key, re.I):
    sys.exit("\nSTOP: GROQ_API_KEY is missing or still the placeholder from .env.example.")

try:
    from groq import Groq
    import groq
except ImportError:
    sys.exit("\nSTOP: the groq package is not installed. Run: .\\venv\\Scripts\\python.exe -m pip install groq")

print(f"groq SDK  : {groq.__version__}\n")

extra = {"reasoning_effort": effort} if model.startswith("openai/gpt-oss") else {}
client = Groq(api_key=key, timeout=60.0, max_retries=0)


def attempt(label, max_tokens):
    print(f"--- {label}: max_completion_tokens={max_tokens} ---")
    try:
        r = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a concise assistant."},
                {"role": "user", "content": "Give two short ideas to make a solar irrigation controller cheaper."},
            ],
            temperature=0.35,
            max_completion_tokens=max_tokens,
            extra_body=extra or None,
        )
    except groq.APIStatusError as exc:
        body = re.sub(r"gsk_[A-Za-z0-9]+", "gsk_***", getattr(exc.response, "text", str(exc)))[:600]
        print(f"HTTP {exc.status_code} from Groq: {body}")
        return
    except groq.APIConnectionError as exc:
        print(f"Could not reach Groq: {type(exc).__name__}: {exc}")
        return
    choice = r.choices[0]
    content = (choice.message.content or "")
    reasoning = getattr(choice.message, "reasoning", None) or ""
    print(f"finish_reason : {choice.finish_reason}")
    print(f"usage         : {r.usage}")
    print(f"answer chars  : {len(content)}   hidden reasoning chars: {len(reasoning)}")
    print(f"answer preview: {content[:200]!r}\n")


attempt("small budget (what an old setting like 900 can hit)", 200)
attempt("budget used by PatentIQ", 3000)
print("If the first run shows finish_reason=length and 0 answer chars, while the second shows an")
print("answer, then the empty response was the reasoning model running out of tokens.")
