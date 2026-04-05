FROM node:20-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --production

# Remove build dependencies to keep image small
RUN apk del python3 make g++

COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "server.js"]
