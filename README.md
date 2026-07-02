# defillama-chain-share

DeFiLlama의 체인별 TVL 점유율을 매일 텔레그램으로 전송합니다.
데이터 소스: `https://api.llama.fi/v2/chains` (무료, API 키 불필요)

## 동작 방식
1. GitHub Actions가 매일 KST 09:00 (UTC 00:00)에 실행
2. DeFiLlama API에서 전체 체인 TVL을 가져와 점유율(%) 계산
3. `data/history.json`에 저장된 전일 데이터와 비교해 변화량(%p) 표시
4. 텔레그램 봇으로 메시지 전송
5. 오늘 데이터를 `data/history.json`에 저장하고 커밋

## 설정 방법

### 1. 텔레그램 봇 만들기
1. 텔레그램에서 `@BotFather` 검색 → `/newbot` 실행 → 봇 이름 설정
2. 발급받은 토큰을 복사 (예: `123456789:ABCdefGhIJKlmnOPQRstuVWXyz`)
3. 만든 봇과 대화를 한 번 시작 (아무 메시지나 전송)
4. 아래 URL에 접속해서 `chat.id` 값을 확인
   ```
   https://api.telegram.org/bot<위에서 받은 토큰>/getUpdates
   ```
   개인 채팅이면 양수, 그룹/채널이면 보통 음수(`-100...`)로 나옵니다.

### 2. GitHub 저장소 설정
1. 이 폴더로 새 저장소를 만들고 push
2. 저장소 → Settings → Secrets and variables → Actions → New repository secret
   - `TELEGRAM_BOT_TOKEN` : BotFather에서 받은 토큰
   - `TELEGRAM_CHAT_ID` : 위에서 확인한 chat id
3. Settings → Actions → General → Workflow permissions에서
   **"Read and write permissions"** 선택 (history.json 자동 커밋을 위해 필요)

### 3. 테스트
- 저장소 → Actions 탭 → "Daily DeFiLlama Chain Share to Telegram" 선택
- "Run workflow" 버튼으로 수동 실행해서 텔레그램에 메시지가 오는지 확인

### 4. 로컬 테스트 (선택)
```bash
pip install -r requirements.txt
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_CHAT_ID="..."
python send_chain_share.py
```

## 커스터마이징
- `send_chain_share.py`의 `TOP_N` 값을 바꾸면 몇 개 체인까지 보여줄지 조절 가능
- 전송 시간은 `.github/workflows/daily.yml`의 cron 표현식(UTC 기준) 수정
- 메시지 형식은 `build_message()` 함수 참고
