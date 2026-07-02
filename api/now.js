// api/now.js
// 텔레그램 웹훅 엔드포인트.
// 사용자가 봇에게 "/now" 를 보내면 DeFiLlama 체인 점유율을 즉시 조회해서 답장한다.
//
// 배포: Vercel (이 폴더를 그대로 새 Vercel 프로젝트로 배포)
// 환경변수(Vercel Project Settings > Environment Variables):
//   TELEGRAM_BOT_TOKEN      - BotFather에서 받은 토큰 (필수)
//   TELEGRAM_CHAT_ID        - 본인 chat id (필수, 이 사람 아니면 무시)
//   TELEGRAM_WEBHOOK_SECRET - setWebhook 할 때 지정한 임의의 비밀 문자열 (필수)
//   HISTORY_RAW_URL         - (선택) GitHub raw history.json URL, 전일 대비용

const CHAINS_API = "https://api.llama.fi/v2/chains";
const TOP_N = 10;

function formatTvl(v) {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(v).toLocaleString()}`;
}

async function fetchChainShares() {
  const res = await fetch(CHAINS_API);
  if (!res.ok) throw new Error(`DeFiLlama API 오류: ${res.status}`);
  const raw = await res.json();
  const chains = raw.filter((c) => typeof c.tvl === "number" && c.tvl > 0);
  const total = chains.reduce((sum, c) => sum + c.tvl, 0);
  const sorted = [...chains].sort((a, b) => b.tvl - a.tvl);
  const shares = {};
  for (const c of sorted) {
    shares[c.name] = { tvl: c.tvl, share: (c.tvl / total) * 100 };
  }
  return { total, shares };
}

async function fetchPrevShares() {
  const url = process.env.HISTORY_RAW_URL;
  if (!url) return {};
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return {};
    const history = await res.json();
    const keys = Object.keys(history).sort();
    if (keys.length === 0) return {};
    // 오늘자는 아직 GitHub Actions가 안 돌았을 수 있으니 가장 최근 항목 사용
    return history[keys[keys.length - 1]] || {};
  } catch {
    return {};
  }
}

function buildMessage(total, shares, prevShares) {
  const now = new Date();
  const kst = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  const lines = [
    `📊 <b>DeFi 체인 점유율</b> (${kst} KST, 실시간 조회)`,
    `전체 TVL: ${formatTvl(total)}`,
    "",
  ];

  const entries = Object.entries(shares).slice(0, TOP_N);
  entries.forEach(([name, info], i) => {
    const prev = prevShares[name];
    let trend = "•";
    let diffStr = "";
    if (prev) {
      const diff = info.share - prev.share;
      if (Math.abs(diff) < 0.005) {
        trend = "→";
      } else if (diff > 0) {
        trend = "▲";
        diffStr = ` (+${diff.toFixed(2)}%p)`;
      } else {
        trend = "▼";
        diffStr = ` (${diff.toFixed(2)}%p)`;
      }
    }
    lines.push(
      `${i + 1}. <b>${name}</b> — ${info.share.toFixed(2)}% ${trend}${diffStr}  [${formatTvl(
        info.tvl
      )}]`
    );
  });

  lines.push("", "source: defillama.com");
  return lines.join("\n");
}

const BUTTON_LABEL = "📊 지금 조회";

const KEYBOARD_MARKUP = {
  keyboard: [[{ text: BUTTON_LABEL }]],
  resize_keyboard: true,
  is_persistent: true,
};

async function sendTelegram(chatId, text, replyMarkup) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN 환경변수가 비어있습니다.");
    throw new Error("TELEGRAM_BOT_TOKEN missing");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  if (!res.ok) {
    // Vercel Logs에 그대로 남도록 status + 응답 본문을 같이 찍는다
    console.error(`sendMessage 실패 status=${res.status} body=${body}`);
    throw new Error(`sendMessage failed: ${res.status} ${body}`);
  }

  console.log(`sendMessage 성공: ${body}`);
}

export default async function handler(req, res) {
  // Vercel Node runtime에서는 전역 fetch 사용 가능 (Node 18+)

  if (req.method !== "POST") {
    res.status(200).send("ok"); // GET으로 헬스체크 하는 경우 등
    return;
  }

  // 텔레그램이 보낸 요청인지 확인 (setWebhook 할 때 넣은 secret_token과 대조)
  const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
  if (secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    res.status(401).send("unauthorized");
    return;
  }

  const update = req.body;
  const message = update?.message;
  const text = message?.text?.trim();
  const chatId = message?.chat?.id;

  // 즉시 200 응답을 텔레그램에 보내야 재시도 폭탄을 피할 수 있으므로
  // 먼저 응답하고 나머지는 비동기로 처리해도 되지만, Vercel 서버리스는
  // 응답 후 곧바로 함수가 종료될 수 있어 순서대로 처리한다.

  const expectedChatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!chatId || String(chatId).trim() !== expectedChatId) {
    // 등록되지 않은 사람이 보낸 메시지는 무시. 디버깅용으로 로그만 남긴다.
    console.warn(
      `chat_id 불일치로 무시: 받은 chat_id="${chatId}", 등록된 TELEGRAM_CHAT_ID="${expectedChatId}"`
    );
    res.status(200).send("ignored");
    return;
  }

  try {
    if (
      text === "/now" ||
      text === "/now@" + (process.env.BOT_USERNAME || "") ||
      text === BUTTON_LABEL
    ) {
      const { total, shares } = await fetchChainShares();
      const prevShares = await fetchPrevShares();
      const msg = buildMessage(total, shares, prevShares);
      await sendTelegram(chatId, msg, KEYBOARD_MARKUP);
    } else if (text === "/start") {
      await sendTelegram(
        chatId,
        `안녕하세요! 아래 "${BUTTON_LABEL}" 버튼을 누르면 지금 이 순간의 DeFi 체인 점유율을 바로 보여드려요.`,
        KEYBOARD_MARKUP
      );
    }
  } catch (err) {
    console.error(`핸들러 처리 중 오류: ${err.message}`);
    try {
      await sendTelegram(chatId, `⚠️ 조회 중 오류가 발생했어요: ${err.message}`);
    } catch {
      // sendTelegram 자체도 실패하면 Vercel Logs의 console.error 기록에 의존한다.
    }
  }

  res.status(200).send("ok");
}
