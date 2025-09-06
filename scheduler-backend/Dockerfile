FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# ensure media folder exists
RUN mkdir -p /code/media

ENV TZ=${TZ:-Etc/UTC}
