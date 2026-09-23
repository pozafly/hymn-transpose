FROM python:3.12-slim

# lilypond      : 악보 조판 엔진 (CLI)
# poppler-utils : pdftoppm (PDF -> PNG)
# fonts-noto-cjk: 한글 가사 렌더링
RUN apt-get update && apt-get install -y --no-install-recommends \
        lilypond \
        poppler-utils \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 기본 동작: G♭ / F♯ / F 세 조를 생성
CMD ["python", "score/build.py", "--png"]
