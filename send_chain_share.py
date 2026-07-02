"""
DeFiLlama 체인별 TVL 점유율을 가져와 텔레그램으로 전송하는 스크립트.

- 데이터 소스: https://api.llama.fi/v2/chains  (무료, 인증 불필요)
- 전일 데이터와 비교해서 점유율 변화(%p)를 함께 보여줌
- 전일 데이터는 data/history.json 에 저장해서 GitHub Actions가 커밋으로 유지
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

CHAINS_API = "https://api.llama.fi/v2/chains"
HISTORY_PATH = Path(__file__).parent / "data" / "history.json"
TOP_N = 10  # 몇 개 체인을 보여줄지

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")


def fetch_chain_tvls() -> list[dict]:
    resp = requests.get(CHAINS_API, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    # 방어적으로 tvl 없는 항목/0 이하 제거
    return [c for c in data if isinstance(c.get("tvl"), (int, float)) and c["tvl"] > 0]


def compute_shares(chains: list[dict]) -> dict[str, dict]:
    total = sum(c["tvl"] for c in chains)
    result = {}
    for c in sorted(chains, key=lambda x: x["tvl"], reverse=True):
        name = c.get("name", "Unknown")
        share = c["tvl"] / total * 100 if total else 0
        result[name] = {"tvl": c["tvl"], "share": share}
    return result


def load_history() -> dict:
    if HISTORY_PATH.exists():
        return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    return {}


def save_history(today_key: str, shares: dict[str, dict]) -> None:
    history = load_history()
    history[today_key] = shares
    # 최근 30일치만 보관 (파일 비대해지는 것 방지)
    keys_sorted = sorted(history.keys())
    for old_key in keys_sorted[:-30]:
        del history[old_key]
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(
        json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def format_tvl(v: float) -> str:
    if v >= 1_000_000_000:
        return f"${v / 1_000_000_000:.2f}B"
    if v >= 1_000_000:
        return f"${v / 1_000_000:.1f}M"
    return f"${v:,.0f}"


def build_message(today: str, shares: dict[str, dict], prev_shares: dict[str, dict]) -> str:
    total_tvl = sum(v["tvl"] for v in shares.values())
    lines = [
        f"📊 <b>DeFi 체인 점유율</b> ({today} KST 기준)",
        f"전체 TVL: {format_tvl(total_tvl)}",
        "",
    ]
    top_items = list(shares.items())[:TOP_N]
    for rank, (name, info) in enumerate(top_items, start=1):
        share = info["share"]
        tvl_str = format_tvl(info["tvl"])
        prev = prev_shares.get(name)
        if prev:
            diff = share - prev["share"]
            if abs(diff) < 0.005:
                trend = "→"
                diff_str = ""
            elif diff > 0:
                trend = "▲"
                diff_str = f" (+{diff:.2f}%p)"
            else:
                trend = "▼"
                diff_str = f" ({diff:.2f}%p)"
        else:
            trend = "•"
            diff_str = " (신규 추적)"

        lines.append(
            f"{rank}. <b>{name}</b> — {share:.2f}% {trend}{diff_str}  [{tvl_str}]"
        )

    lines.append("")
    lines.append("source: defillama.com")
    return "\n".join(lines)


def send_telegram(text: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    resp = requests.post(
        url,
        json={
            "chat_id": TELEGRAM_CHAT_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        timeout=30,
    )
    if resp.status_code != 200:
        print(f"텔레그램 전송 실패: {resp.status_code} {resp.text}", file=sys.stderr)
        sys.exit(1)


def main():
    now_kst = datetime.now(timezone.utc)
    today_key = now_kst.strftime("%Y-%m-%d")

    chains = fetch_chain_tvls()
    shares = compute_shares(chains)

    history = load_history()
    # 오늘 이전 가장 최근 날짜를 '전일'로 사용
    prev_keys = sorted(k for k in history.keys() if k < today_key)
    prev_shares = history[prev_keys[-1]] if prev_keys else {}

    message = build_message(today_key, shares, prev_shares)
    print(message)  # 로그 확인용

    send_telegram(message)
    save_history(today_key, shares)


if __name__ == "__main__":
    main()
