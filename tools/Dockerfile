# Brightly advice tools: Node server + the Claude Agent SDK, with Python for the skills' document work.
# Debian (glibc) rather than Alpine: the Agent SDK ships a native Claude Code binary built for glibc.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3100 DATA_DIR=/app/data TZ=Australia/Melbourne HOME=/home/node

# What the skills use to read reports and write Word/Excel documents. Add to this list as your skills need.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata \
      python3 python3-docx python3-openpyxl python3-pypdf python3-pdfminer python3-jsonschema python3-xlrd poppler-utils antiword \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
COPY agent ./agent

RUN mkdir -p /app/data && chown -R node:node /app /home/node
USER node
EXPOSE 3100
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3100/tools/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
