FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port (default 8080, override with PORT env var)
EXPOSE 8080

# Start the server
CMD ["node", "dist/server.js"]
