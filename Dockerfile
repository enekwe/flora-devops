# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (using lockfile for deterministic builds)
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose port (Railway will override with its own PORT env var)
EXPOSE 4003

# Set environment variables (Railway will override PORT)
ENV NODE_ENV=production

# Health check - use $PORT environment variable instead of hardcoded port
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const port = process.env.PORT || 4003; require('http').get(\`http://localhost:\${port}/health\`, (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "src/index.js"]
